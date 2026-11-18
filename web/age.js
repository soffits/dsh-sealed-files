/**
 * The age v1 file format (https://age-encryption.org/v1), the parts this
 * plugin needs: an X25519 recipient stanza, the header and its MAC, and the
 * STREAM payload addressed chunk by chunk, so a file can be encrypted in
 * resumable pieces and read from any offset. Every stored file is a normal
 * age file that `age -d` opens.
 *
 * Pure: runs in the page, the service worker and Node. Bulk ChaCha20-Poly1305
 * can be swapped for a faster one (`setChunkCipher`), with the same inputs.
 */
import { base64nopad, bech32, chacha20poly1305, hkdf, hmac, sha256, x25519 } from './vendor.js'

export const CHUNK = 64 * 1024
export const TAG = 16
export const CHUNK_CT = CHUNK + TAG
export const NONCE_BYTES = 16
export const FILE_KEY_BYTES = 16

const INTRO = 'age-encryption.org/v1'
const X25519_LABEL = 'age-encryption.org/v1/X25519'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

let chunkCipher = { seal: (key, nonce, data) => chacha20poly1305(key, nonce).encrypt(data), open: (key, nonce, data) => chacha20poly1305(key, nonce).decrypt(data) }

/** Use another ChaCha20-Poly1305 for payload chunks (Node's native one on the server). */
export function setChunkCipher(cipher) { chunkCipher = cipher }

export function random(n) {
  const out = new Uint8Array(n)
  for (let at = 0; at < n; at += 65536) crypto.getRandomValues(out.subarray(at, at + 65536))
  return out
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
export { concat }

/** Number of payload chunks for a plaintext size; an empty file still has one (empty, final) chunk. */
export const chunkCount = size => (size === 0 ? 1 : Math.ceil(size / CHUNK))
/** Payload bytes (after the 16-byte nonce) for a plaintext size. */
export const payloadSize = size => size + chunkCount(size) * TAG
/** Plaintext length of chunk `i` of a file of `size` bytes. */
export const chunkLength = (size, i) => Math.min(CHUNK, size - i * CHUNK)

/** STREAM nonce: 11-byte big-endian counter, then 1 for the final chunk. */
export function chunkNonce(i, last) {
  const nonce = new Uint8Array(12)
  let n = i
  for (let at = 10; at >= 0 && n > 0; at--) { nonce[at] = n % 256; n = Math.floor(n / 256) }
  nonce[11] = last ? 1 : 0
  return nonce
}

export const payloadKey = (fileKey, nonce) => hkdf(sha256, fileKey, nonce, encoder.encode('payload'), 32)
export const sealChunk = (key, i, last, plaintext) => chunkCipher.seal(key, chunkNonce(i, last), plaintext)
export const openChunk = (key, i, last, ciphertext) => chunkCipher.open(key, chunkNonce(i, last), ciphertext)

/** age recipient string (age1…) for a raw X25519 public key, and back. */
export const encodeRecipient = pub => bech32.encode('age', bech32.toWords(pub), false)
export function decodeRecipient(s) {
  const { prefix, words } = bech32.decode(s, false)
  if (prefix !== 'age') throw new Error('not an age X25519 recipient')
  return Uint8Array.from(bech32.fromWords(words))
}
/** age identity string (AGE-SECRET-KEY-1…) for a raw X25519 private key, and back. */
export const encodeIdentity = priv => bech32.encode('age-secret-key-', bech32.toWords(priv), false).toUpperCase()
export function decodeIdentity(s) {
  const { prefix, words } = bech32.decode(s.toLowerCase(), false)
  if (prefix !== 'age-secret-key-') throw new Error('not an age X25519 identity')
  return Uint8Array.from(bech32.fromWords(words))
}

function wrapLines(b64) {
  const lines = []
  for (let at = 0; at < b64.length; at += 64) lines.push(b64.slice(at, at + 64))
  if (b64.length % 64 === 0) lines.push('')
  return lines
}

/**
 * An age header with one X25519 stanza wrapping `fileKey` to `recipientPub`, MAC included.
 * @returns {Uint8Array} the header bytes, ending with the MAC line's newline
 */
export function encodeHeader(fileKey, recipientPub) {
  const ephemeral = x25519.utils.randomSecretKey()
  const share = x25519.getPublicKey(ephemeral)
  const secret = x25519.getSharedSecret(ephemeral, recipientPub)
  const wrapKey = hkdf(sha256, secret, concat(share, recipientPub), encoder.encode(X25519_LABEL), 32)
  const body = chacha20poly1305(wrapKey, new Uint8Array(12)).encrypt(fileKey)
  const text = [INTRO, `-> X25519 ${base64nopad.encode(share)}`, ...wrapLines(base64nopad.encode(body)), '---'].join('\n')
  const macInput = encoder.encode(text)
  const mac = hmac(sha256, hkdf(sha256, fileKey, new Uint8Array(0), encoder.encode('header'), 32), macInput)
  return concat(macInput, encoder.encode(` ${base64nopad.encode(mac)}\n`))
}

/**
 * Parse an age header at the start of `bytes`.
 * @returns {{ stanzas: { type: string, args: string[], body: Uint8Array }[], macInput: Uint8Array, mac: Uint8Array, length: number } | null}
 *   null when `bytes` ends before the header does
 * @throws on a malformed header
 */
export function parseHeader(bytes) {
  const stanzas = []
  let at = 0
  const line = () => {
    const end = bytes.indexOf(10, at)
    if (end < 0) return null
    const text = decoder.decode(bytes.subarray(at, end))
    at = end + 1
    return text
  }
  if (line() !== INTRO) {
    if (bytes.indexOf(10) < 0) return null
    throw new Error('not an age v1 file')
  }
  for (;;) {
    const start = at
    const next = line()
    if (next === null) return null
    if (next.startsWith('--- ')) {
      const macInput = bytes.subarray(0, start + 3)
      const mac = base64nopad.decode(next.slice(4))
      if (mac.length !== 32) throw new Error('bad header MAC')
      return { stanzas, macInput, mac, length: at }
    }
    if (!next.startsWith('-> ')) throw new Error('malformed header')
    const [type, ...args] = next.slice(3).split(' ')
    let b64 = ''
    for (;;) {
      const chunk = line()
      if (chunk === null) return null
      if (chunk.length > 64) throw new Error('malformed stanza')
      b64 += chunk
      if (chunk.length < 64) break
    }
    stanzas.push({ type, args, body: base64nopad.decode(b64) })
  }
}

/**
 * The file key from a parsed header, for the X25519 identity `priv`, with the header MAC checked.
 * @throws when no stanza is for this identity or the MAC is wrong
 */
export function unwrapFileKey(header, priv) {
  const pub = x25519.getPublicKey(priv)
  for (const stanza of header.stanzas) {
    if (stanza.type !== 'X25519' || stanza.args.length !== 1 || stanza.body.length !== 32) continue
    const share = base64nopad.decode(stanza.args[0])
    const secret = x25519.getSharedSecret(priv, share)
    const wrapKey = hkdf(sha256, secret, concat(share, pub), encoder.encode(X25519_LABEL), 32)
    let fileKey
    try {
      fileKey = chacha20poly1305(wrapKey, new Uint8Array(12)).decrypt(stanza.body)
    } catch {
      continue
    }
    const expected = hmac(sha256, hkdf(sha256, fileKey, new Uint8Array(0), encoder.encode('header'), 32), header.macInput)
    if (!equalBytes(expected, header.mac)) throw new Error('header MAC mismatch')
    return fileKey
  }
  throw new Error('no stanza for this identity')
}

export function equalBytes(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Which ciphertext bytes hold plaintext [start, end] (inclusive) of a file whose payload starts at `payloadAt`
 * (header length + 16) and whose plaintext is `size` bytes.
 */
export function cipherSpan(payloadAt, size, start, end) {
  const first = Math.floor(start / CHUNK)
  const last = Math.floor(end / CHUNK)
  const total = chunkCount(size)
  return {
    first,
    last,
    final: total - 1,
    from: payloadAt + first * CHUNK_CT,
    to: payloadAt + Math.min((last + 1) * CHUNK_CT, payloadSize(size)) - 1,
  }
}
