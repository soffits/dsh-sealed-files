/**
 * The pairwise channel between one device and the assistant. Both sides hold
 * an X25519 key; their shared secret, run through HKDF with both public keys,
 * gives one AES-256-GCM key that only these two can compute. Every request a
 * device makes and every answer it gets that carries meaning (names, keys,
 * the file list, changes) is sealed with it, so whatever sits in between sees
 * random bytes and can neither read, forge, replay nor reorder them.
 *
 * WebCrypto only, so the same code runs in the page, the service worker and
 * Node. On a device the X25519 private key and the derived key are
 * non-extractable CryptoKeys.
 */
import { base32nopad, base64urlnopad, sha256 } from './vendor.js'

const subtle = globalThis.crypto.subtle
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const VERSION = 'sealed-files/v1'
export const b64 = { encode: bytes => base64urlnopad.encode(bytes), decode: text => base64urlnopad.decode(text) }

const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** The AES-GCM key for a device and the assistant, from their X25519 shared secret (raw 32 bytes). */
export async function derivePairKey(shared, devicePub, assistantPub) {
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: join(devicePub, assistantPub), info: encoder.encode(`${VERSION}/pair`) },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** A device's id: a short hash of its public key, so the same key always has the same id. */
export const deviceIdOf = pub => base32nopad.encode(sha256(join(encoder.encode(`${VERSION}/device\n`), pub)).subarray(0, 10)).toLowerCase()

/**
 * The code a person compares on the device and in the message from the assistant. It covers the device's key and the
 * assistant's key as the device saw them, so a swap of either shows as a different code. 60 bits.
 */
export function pairingCode(devicePub, assistantPub) {
  const text = base32nopad.encode(sha256(join(encoder.encode(`${VERSION}/code\n`), devicePub, assistantPub)).subarray(0, 8)).slice(0, 12)
  return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}`
}

export async function sealBytes(key, aad, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, bytes))
  return join(iv, ct)
}

export async function openBytes(key, aad, sealed) {
  if (sealed.length < 28) throw new Error('sealed data too short')
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: encoder.encode(aad) }, key, sealed.subarray(12)))
}

const requestAad = (device, time, nonce) => `${VERSION}/request\n${device}\n${time}\n${nonce}`
const responseAad = (device, nonce) => `${VERSION}/response\n${device}\n${nonce}`

/** A device's sealed request: `{ d, t, n, c }`. Keep `n` to open the answer. */
export async function sealRequest(key, device, body, now = Date.now()) {
  const n = b64.encode(crypto.getRandomValues(new Uint8Array(16)))
  const c = b64.encode(await sealBytes(key, requestAad(device, now, n), encoder.encode(JSON.stringify(body))))
  return { d: device, t: now, n, c }
}

/** Open a sealed request on the assistant's side. Freshness (time window, nonce reuse) is the caller's check. */
export async function openRequest(key, envelope) {
  const plain = await openBytes(key, requestAad(envelope.d, envelope.t, envelope.n), b64.decode(envelope.c))
  return JSON.parse(decoder.decode(plain))
}

/** The answer to request nonce `n`, sealed for that device: `{ c }`. */
export async function sealResponse(key, device, n, body) {
  return { c: b64.encode(await sealBytes(key, responseAad(device, n), encoder.encode(JSON.stringify(body)))) }
}

export async function openResponse(key, device, n, envelope) {
  const plain = await openBytes(key, responseAad(device, n), b64.decode(envelope.c))
  return JSON.parse(decoder.decode(plain))
}
