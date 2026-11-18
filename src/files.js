/**
 * age files on disk, from the Host's side: reading an item's file key,
 * checking uploaded chunks, and encrypting or decrypting whole files as
 * streams (for the assistant's own puts and gets, and for previews).
 */
import { open } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { CHUNK, CHUNK_CT, NONCE_BYTES, FILE_KEY_BYTES, chunkCount, encodeHeader, openChunk, parseHeader, payloadKey, payloadSize, random, sealChunk, unwrapFileKey } from '../web/age.js'

const HEADER_READ = 64 * 1024

/** The file key, payload nonce and payload offset of an age file for identity `priv`. */
export async function readKey(path, priv) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEADER_READ)
    const { bytesRead } = await handle.read(buffer, 0, HEADER_READ, 0)
    return keyOfPrefix(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead), priv)
  } finally {
    await handle.close()
  }
}

/** The same, from the first bytes of a file (its header and nonce at least). */
export function keyOfPrefix(bytes, priv) {
  const header = parseHeader(bytes)
  if (header === null || bytes.length < header.length + NONCE_BYTES) throw new Error('incomplete age header')
  const fileKey = unwrapFileKey(header, priv)
  const nonce = bytes.slice(header.length, header.length + NONCE_BYTES)
  return { fileKey, nonce, payloadAt: header.length + NONCE_BYTES, key: payloadKey(fileKey, nonce) }
}

/** Check that `buffer` holds chunks first.. of a file whose last chunk index is `final`. Throws on the first bad one. */
export function verifyChunks(key, first, final, buffer) {
  for (let at = 0, i = first; at < buffer.length; at += CHUNK_CT, i++) openChunk(key, i, i === final, buffer.subarray(at, Math.min(at + CHUNK_CT, buffer.length)))
}

/** Plaintext of an age file, chunk by chunk (each checked). */
export async function* decryptFile(path, priv, size) {
  const { key, payloadAt } = await readKey(path, priv)
  const final = chunkCount(size) - 1
  let index = 0
  let pending = Buffer.alloc(0)
  for await (const piece of createReadStream(path, { start: payloadAt, highWaterMark: CHUNK_CT * 4 })) {
    pending = pending.length === 0 ? piece : Buffer.concat([pending, piece])
    while (index < final && pending.length >= CHUNK_CT) {
      yield openChunk(key, index, false, pending.subarray(0, CHUNK_CT))
      pending = pending.subarray(CHUNK_CT)
      index++
    }
    if (index === final && pending.length > CHUNK_CT) throw new Error('age file longer than its size')
  }
  if (index !== final) throw new Error('age file truncated')
  yield openChunk(key, index, true, pending)
}

/**
 * Encrypt plaintext pieces (any sizes, `size` bytes in all) to `recipientPub` into a new file at `dest`.
 * @returns {Promise<{ cipherSize: number, payloadAt: number }>}
 */
export async function encryptToFile(pieces, size, dest, recipientPub) {
  const fileKey = random(FILE_KEY_BYTES)
  const nonce = random(NONCE_BYTES)
  const key = payloadKey(fileKey, nonce)
  const header = encodeHeader(fileKey, recipientPub)
  const final = chunkCount(size) - 1
  const handle = await open(dest, 'wx', 0o600)
  let written = 0
  const write = async bytes => { await handle.write(bytes, 0, bytes.length, written); written += bytes.length }
  try {
    await write(header)
    await write(nonce)
    let index = 0
    let total = 0
    let pending = Buffer.alloc(0)
    for await (const piece of pieces) {
      total += piece.length
      if (total > size) throw new Error('more bytes than the stated size')
      pending = pending.length === 0 ? Buffer.from(piece) : Buffer.concat([pending, piece])
      while (index < final && pending.length >= CHUNK) {
        await write(sealChunk(key, index, false, pending.subarray(0, CHUNK)))
        pending = pending.subarray(CHUNK)
        index++
      }
    }
    if (total !== size || index !== final) throw new Error('fewer bytes than the stated size')
    await write(sealChunk(key, index, true, pending))
    if (written !== header.length + NONCE_BYTES + payloadSize(size)) throw new Error('age file size mismatch')
    return { cipherSize: written, payloadAt: header.length + NONCE_BYTES }
  } finally {
    await handle.close()
  }
}
