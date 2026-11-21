/**
 * Sending a file: it is encrypted here to the assistant's pinned key, chunk by
 * chunk, and sent in numbered parts a few at a time. The file key and nonce
 * of an unfinished upload are kept on this device, sealed under its pair key,
 * so the same file picked again after a reload, a lost connection or a
 * restart produces the same bytes and only the missing parts are sent.
 */
import { FILE_KEY_BYTES, NONCE_BYTES, concat, encodeHeader, payloadKey, random, sealChunk, chunkCount } from './age.js'
import { b64 } from './seal.js'
import { sha256 } from './vendor.js'
import { api, call, idb, openLocal, sealLocal } from './device.js'
import { PARTS_IN_FLIGHT, PART_BYTES, PART_CHUNKS, TEXT_TYPE, partCount } from './protocol.js'

const RETRIES = 6
const sleep = ms => new Promise(done => setTimeout(done, ms))

/** What identifies "the same file, to the same place" across reloads. */
export function resumeKey(device, file, space, folder) {
  const text = [device.id, space, folder, file.name, file.size, file.lastModified ?? 0].join('\n')
  return b64.encode(sha256(new TextEncoder().encode(text)).subarray(0, 16))
}

/**
 * Send `file` (a File or Blob with a name) to `space`/`folder`. `onProgress(sentBytes, totalBytes)`.
 * `keep` is stored with the resume record (a file handle, say). Resolves with the new item; rejects after repeated failures (the upload stays resumable) or when `signal` aborts.
 */
export async function upload(device, file, { space, folder, kind = 'file', keep = {}, onProgress = () => {}, signal }) {
  const key = resumeKey(device, file, space, folder)
  let record = await idb.get('uploads', key)
  let state = null
  if (record) {
    try {
      state = await call(device, 'upload.status', { id: record.id })
    } catch (error) {
      if (error.status !== 404) throw error
      await idb.delete('uploads', key)
      record = undefined
    }
  }
  let fileKey
  let nonce
  if (record && state) {
    fileKey = await openLocal(device, record.id, b64.decode(record.fileKey))
    nonce = b64.decode(record.nonce)
  } else {
    fileKey = random(FILE_KEY_BYTES)
    nonce = random(NONCE_BYTES)
    const prefix = concat(encodeHeader(fileKey, b64.decode(device.assistantPub)), nonce)
    state = await call(device, 'upload.start', { space, folder, size: file.size, prefix: b64.encode(prefix) })
    record = { ...keep, id: state.id, fileKey: b64.encode(await sealLocal(device, state.id, fileKey)), nonce: b64.encode(nonce), name: file.name, size: file.size, space, folder, kind, created: Date.now() }
    await idb.put('uploads', key, record)
  }
  const pkey = payloadKey(fileKey, nonce)
  const total = partCount(file.size)
  const missing = new Set(state.missing)
  let sent = (total - missing.size) * PART_BYTES
  onProgress(Math.min(sent, file.size), file.size)

  const final = chunkCount(file.size) - 1
  async function encryptPart(n) {
    const start = n * PART_BYTES
    const plain = new Uint8Array(await file.slice(start, Math.min(file.size, start + PART_BYTES)).arrayBuffer())
    const pieces = []
    for (let c = 0; c < PART_CHUNKS; c++) {
      const index = n * PART_CHUNKS + c
      if (index > final) break
      pieces.push(sealChunk(pkey, index, index === final, plain.subarray(c * 65536, (c + 1) * 65536)))
    }
    return concat(...pieces)
  }

  async function sendPart(n) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      try {
        const body = await encryptPart(n)
        const response = await fetch(`${api('part')}?d=${device.id}&u=${record.id}&n=${n}`, { method: 'POST', body, credentials: 'same-origin', cache: 'no-store', signal })
        if (response.ok) {
          sent += Math.min(PART_BYTES, file.size - n * PART_BYTES)
          onProgress(Math.min(sent, file.size), file.size)
          return
        }
        if (response.status === 404) throw Object.assign(new Error('upload-gone'), { status: 404, fatal: true })
        if (response.status === 403) throw Object.assign(new Error('not-approved'), { status: 403, fatal: true })
        throw new Error(`HTTP ${response.status}`)
      } catch (error) {
        if (error.fatal || signal?.aborted || attempt >= RETRIES) throw error
        await sleep(Math.min(30_000, 1000 * 2 ** attempt))
      }
    }
  }

  const queue = [...missing].sort((a, b) => a - b)
  await Promise.all(Array.from({ length: Math.min(PARTS_IN_FLIGHT, queue.length) }, async () => {
    while (queue.length > 0) await sendPart(queue.shift())
  }))

  const item = await call(device, 'upload.finish', { id: record.id, name: file.name, type: kind === 'text' ? TEXT_TYPE : file.type || 'application/octet-stream', kind })
  await idb.delete('uploads', key)
  return item
}

/** Forget an unfinished upload, here and on the Host. */
export async function cancelUpload(device, id) {
  await call(device, 'upload.cancel', { id }).catch(() => {})
  for (const key of await idb.keys('uploads')) {
    const record = await idb.get('uploads', key)
    if (record?.id === id) await idb.delete('uploads', key)
  }
}
