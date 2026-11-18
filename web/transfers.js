/**
 * The transfer engine: a worker the DSH page keeps (shared between every open
 * page of the app where the browser has SharedWorker), so an upload goes on
 * when the person moves to another page, closes the panel or switches tabs.
 * Pages talk to it over one BroadcastChannel (`BUS`):
 *
 *   page -> engine  { type: 'enqueue', files: [File], handles?: [FileSystemFileHandle], space, folder, kind }
 *                   { type: 'cancel', key } · { type: 'resume', key } · { type: 'hello' }
 *   engine -> page  { type: 'state', jobs: [...] }   (after every change, and in answer to hello)
 *
 * Downloads, which the service worker streams, report on the same channel
 * ({ type: 'download', ... }) so one card shows both. Pacing comes from the
 * requests themselves; a Web Lock is held while anything moves, so the
 * browser doesn't freeze the page.
 */
import { BUS } from './bus.js'
import { call, idb, loadDevice } from './device.js'
import { resumeKey, upload } from './upload.js'

const bus = new BroadcastChannel(BUS)
const jobs = new Map()
let device = null
let lock = null

const view = job => ({ key: job.key, space: job.space, folder: job.folder, name: job.name, size: job.size, sent: job.sent, status: job.status, error: job.error, kind: job.kind, startedAt: job.startedAt, sentAtStart: job.sentAtStart, resumable: job.handle !== null, done: job.doneAt ?? null, id: job.itemId ?? null })
const publish = () => bus.postMessage({ type: 'state', jobs: [...jobs.values()].map(view) })

function holdLock() {
  if (lock !== null || !navigator.locks) return
  lock = new Promise((release) => {
    navigator.locks.request('sealed-files-transfer', () => new Promise((done) => { lock = { release: () => { done(); release() } } }))
  })
}
function maybeRelease() {
  if ([...jobs.values()].some(job => job.status === 'sending' || job.status === 'queued')) return
  if (lock?.release) lock.release()
  lock = null
}

async function ensureDevice() {
  device ??= await loadDevice()
  if (device === null || device.id === null) throw new Error('this device is not set up')
  return device
}

async function run(job) {
  job.status = 'sending'
  job.error = null
  job.controller = new AbortController()
  holdLock()
  publish()
  try {
    const file = job.file ?? await job.handle.getFile()
    const item = await upload(await ensureDevice(), file, {
      space: job.space,
      folder: job.folder,
      kind: job.kind,
      keep: job.handle ? { handle: job.handle } : {},
      signal: job.controller.signal,
      onProgress: (sent) => {
        job.startedAt ??= Date.now()
        job.sentAtStart ??= sent
        job.sent = sent
        publish()
      },
    })
    job.status = 'done'
    job.doneAt = Date.now()
    job.itemId = item.id
    setTimeout(() => { if (jobs.get(job.key) === job) { jobs.delete(job.key); publish() } }, 6000)
  } catch (error) {
    if (job.controller.signal.aborted) {
      jobs.delete(job.key)
    } else {
      job.status = 'failed'
      job.error = error.code ?? error.message
    }
  } finally {
    publish()
    maybeRelease()
  }
}

async function enqueue({ files, handles = [], space, folder, kind = 'file' }) {
  const own = await ensureDevice()
  files.forEach((file, i) => {
    const key = resumeKey(own, file, space, folder)
    if (jobs.get(key)?.status === 'sending') return
    const handle = handles[i] ?? null
    const job = { key, name: file.name, size: file.size, sent: 0, status: 'queued', file, handle, space, folder, kind, startedAt: null, sentAtStart: null }
    jobs.set(key, job)
    run(job)
  })
  publish()
}

/** Unfinished uploads from before (a reload, a closed tab): resumed at once when the file can be read without asking. */
async function recover() {
  let own
  try { own = await ensureDevice() } catch { return }
  for (const key of await idb.keys('uploads')) {
    const record = await idb.get('uploads', key)
    if (!record || jobs.has(key)) continue
    let status
    try {
      status = await call(own, 'upload.status', { id: record.id })
    } catch (error) {
      if (error.status === 404) await idb.delete('uploads', key)
      continue
    }
    const sent = (status.parts - status.missing.length) * 8 * 1024 * 1024
    const job = { key, name: record.name, size: record.size, sent: Math.min(sent, record.size), status: 'paused', file: null, handle: record.handle ?? null, space: record.space, folder: record.folder, kind: record.kind ?? 'file', startedAt: null, sentAtStart: null, uploadId: record.id }
    jobs.set(key, job)
    if (job.handle && (await job.handle.queryPermission?.({ mode: 'read' })) === 'granted') run(job)
  }
  publish()
}

bus.onmessage = async ({ data }) => {
  if (data?.type === 'hello') return publish()
  if (data?.type === 'enqueue') return enqueue(data).catch(error => bus.postMessage({ type: 'error', error: error.message }))
  const job = jobs.get(data?.key)
  if (!job) return undefined
  if (data.type === 'cancel') {
    job.controller?.abort()
    jobs.delete(job.key)
    const record = await idb.get('uploads', job.key)
    if (record) {
      await call(await ensureDevice(), 'upload.cancel', { id: record.id }).catch(() => {})
      await idb.delete('uploads', job.key)
    }
    publish()
    maybeRelease()
  } else if (data.type === 'resume' && job.handle && job.status !== 'sending') {
    run(job)
  }
  return undefined
}

// A SharedWorker gets connections; a dedicated worker starts at once. Either way the bus is the only way in.
self.addEventListener?.('connect', event => event.ports?.[0]?.start?.())
recover()
