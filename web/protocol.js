/**
 * What the page and the Host agree on besides the age format: how an upload
 * is cut into parts, the shape of ids and names, and the folder rules.
 */
import { CHUNK, CHUNK_CT, TAG, chunkCount, chunkLength } from './age.js'

/** Age chunks per upload part: 8 MiB of plaintext, far under a proxy's request cap. */
export const PART_CHUNKS = 128
export const PART_BYTES = PART_CHUNKS * CHUNK
export const PARTS_IN_FLIGHT = 3
/** Text sent as a note is stored as a file of this type. */
export const TEXT_TYPE = 'text/plain;charset=utf-8'
export const PREVIEW_CHARS = 2000

export const partCount = size => Math.ceil(chunkCount(size) / PART_CHUNKS)

/** Chunks [first, first + count) and the ciphertext length of part `n`. */
export function partShape(size, n) {
  const first = n * PART_CHUNKS
  const count = Math.min(PART_CHUNKS, chunkCount(size) - first)
  const lastIndex = first + count - 1
  const tail = lastIndex === chunkCount(size) - 1 ? chunkLength(size, lastIndex) + TAG : CHUNK_CT
  return { first, count, bytes: (count - 1) * CHUNK_CT + tail }
}

export const ID = /^[a-z2-7]{16,32}$/
export const SHARED = 'shared'

/** A folder path: segments of 1-120 characters, no slashes, dots-only or control characters; '' is the top. */
export function cleanFolder(path) {
  if (typeof path !== 'string') return null
  const parts = path.split('/').map(p => p.trim()).filter(p => p !== '')
  if (parts.length > 12) return null
  for (const part of parts) if (!cleanName(part) || part !== cleanName(part)) return null
  return parts.join('/')
}

/** A file or folder name, trimmed, or null when it can't be one. */
export function cleanName(name) {
  if (typeof name !== 'string') return null
  const text = name.normalize('NFC').trim()
  // eslint-disable-next-line no-control-regex
  if (text === '' || text.length > 200 || /[/\\\u0000-\u001f\u007f]/.test(text) || /^\.+$/.test(text)) return null
  return text
}

export const parentOf = folder => folder.split('/').slice(0, -1).join('/')
export const within = (folder, root) => root === '' || folder === root || folder.startsWith(`${root}/`)
