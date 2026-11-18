/**
 * The service worker (built into web/sw.js as a classic script): it answers
 * /sealed-files/app/stream/<id> by fetching only the ciphertext chunks a
 * request needs, decrypting them here and answering with the plaintext, Range
 * and all. So <video> seeks, <img> and PDFs show, and downloads stream to
 * disk, with nothing decrypted ever leaving the device. The URL carries only
 * the random id; the name and type come from this device's own store.
 */
import { CHUNK, CHUNK_CT, cipherSpan, openChunk, payloadKey } from './age.js'
import { b64 } from './seal.js'
import { api, call, idb, loadDevice } from './device.js'
import { BUS } from './bus.js'

const bus = new BroadcastChannel(BUS)

const STREAM = '/sealed-files/app/stream/'
/** Types shown in place; anything else is only ever downloaded, so no file can run as a page of this origin. */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif|heic|heif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/
const keys = new Map()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data?.type === 'forget') keys.clear()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const at = url.pathname.indexOf(STREAM)
  if (at < 0 || url.origin !== self.location.origin) return
  event.respondWith(answer(event.request, url, url.pathname.slice(at + STREAM.length).split('/')[0]).catch(error => new Response(`Could not open this file: ${error.message}`, { status: error.status ?? 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })))
})

async function keyFor(device, id) {
  let entry = keys.get(id)
  if (entry === undefined) {
    const result = await call(device, 'key', { id })
    entry = { ...result, key: payloadKey(b64.decode(result.fileKey), b64.decode(result.nonce)) }
    keys.set(id, entry)
  }
  return entry
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (match === null) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '') return rawEnd === '' ? null : [Math.max(0, size - Number(rawEnd)), size - 1]
  return [Number(rawStart), rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)]
}

const disposition = (kind, name) => `${kind}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`

async function answer(request, url, id) {
  const device = await loadDevice()
  if (device === null || device.id === null) throw Object.assign(new Error('this device is not set up'), { status: 403 })
  const entry = await keyFor(device, id)
  const meta = (await idb.get('meta', id)) ?? {}
  const name = meta.name ?? entry.name
  const download = url.searchParams.has('download')
  const inline = !download && INLINE.test(entry.type.split(';')[0])
  const size = entry.size
  const headers = {
    'content-type': inline ? (entry.type.startsWith('text/plain') ? 'text/plain; charset=utf-8' : entry.type) : 'application/octet-stream',
    'content-disposition': disposition(inline ? 'inline' : 'attachment', name),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
  // A decrypted file shown in place never runs as a page of this origin; downloads aren't rendered (and a sandboxed one is refused).
  if (inline && !entry.type.startsWith('application/pdf')) headers['content-security-policy'] = "sandbox; default-src 'none'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'unsafe-inline'"
  if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'content-length': '0' } })
  const asked = parseRange(request.headers.get('range'), size)
  if (asked !== null && (asked[0] >= size || asked[1] < asked[0])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
  const [start, end] = asked ?? [0, size - 1]
  headers['content-length'] = String(end - start + 1)
  if (asked !== null) headers['content-range'] = `bytes ${start}-${end}/${size}`
  if (request.method === 'HEAD') return new Response(null, { status: asked ? 206 : 200, headers })
  // Not tied to the request's signal: a navigation that turns into a download ends that signal while the download goes on.
  const report = download ? downloadReport(`dl-${id}-${Date.now()}`, name, end - start + 1) : null
  return new Response(plaintext(device, id, entry, start, end, report), { status: asked ? 206 : 200, headers })
}

/** Plaintext bytes [start, end] as a stream, fetched and decrypted a chunk at a time. */
/** A download's progress on the bus, for the transfers card: every 16 chunks and at the end. */
function downloadReport(key, name, size) {
  let sent = 0
  let count = 0
  const post = status => bus.postMessage({ type: 'download', job: { key, name, size, sent, status, kind: 'download', done: status === 'done' ? Date.now() : null } })
  post('sending')
  return {
    add(bytes) { sent += bytes; if (++count % 16 === 0) post('sending') },
    end(ok) { post(ok ? 'done' : 'failed') },
  }
}

function plaintext(device, id, entry, start, end, report) {
  const span = cipherSpan(entry.payloadAt, entry.size, start, end)
  let reader
  let buffer = new Uint8Array(0)
  let index = span.first
  const take = (controller, chunk) => {
    const plain = openChunk(entry.key, index, index === span.final, chunk)
    const from = index === span.first ? start - index * CHUNK : 0
    const to = index === span.last ? end - index * CHUNK + 1 : plain.length
    controller.enqueue(plain.subarray(from, to))
    report?.add(to - from)
    index++
  }
  return new ReadableStream({
    async start() {
      const response = await fetch(`${api('blob')}?d=${device.id}&id=${id}`, { headers: { range: `bytes=${span.from}-${span.to}` }, credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      reader = response.body.getReader()
    },
    async pull(controller) {
      for (;;) {
        const whole = index === span.final ? null : CHUNK_CT
        if (whole !== null && buffer.length >= whole) {
          take(controller, buffer.subarray(0, whole))
          buffer = buffer.subarray(whole)
          if (index > span.last) { controller.close(); report?.end(true); reader.cancel().catch(() => {}) }
          return
        }
        const { value, done } = await reader.read()
        if (done) {
          if (index === span.final && index <= span.last) take(controller, buffer)
          else if (index <= span.last) { report?.end(false); throw new Error('file ended early') }
          controller.close()
          report?.end(true)
          return
        }
        const joined = new Uint8Array(buffer.length + value.length)
        joined.set(buffer)
        joined.set(value, buffer.length)
        buffer = joined
      }
    },
    cancel() { report?.end(false); reader?.cancel().catch(() => {}) },
  })
}
