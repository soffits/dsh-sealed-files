/**
 * This device: its X25519 key (made here, non-extractable, never sent), the
 * assistant's key it pinned when it was added, the pair key both give, and
 * the sealed calls to the Host. Kept in IndexedDB, which the page and the
 * service worker share. Also the small stores both need: what the page knows
 * about each item (so the worker never needs names in a URL) and unfinished
 * uploads.
 */
import { b64, derivePairKey, openResponse, sealRequest, sealBytes, openBytes } from './seal.js'

const DB_NAME = 'sealed-files'
const STORES = ['device', 'meta', 'uploads']
const subtle = globalThis.crypto.subtle

/** Where DSH is mounted: everything before /sealed-files/app/ in this page's or worker's path. */
export const base = (() => {
  const path = (globalThis.location?.pathname ?? '/')
  const at = path.indexOf('/sealed-files/app/')
  return at < 0 ? '/' : path.slice(0, at + 1)
})()
export const api = path => `${base}api/sealed-files/${path}`
export const streamUrl = (id, download = false) => `${base}sealed-files/app/stream/${id}${download ? '?download=1' : ''}`

let dbPromise
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx(store, mode, run) {
  return db().then(database => new Promise((resolve, reject) => {
    const t = database.transaction(store, mode)
    const result = run(t.objectStore(store))
    t.oncomplete = () => resolve(result?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  put: (store, key, value) => tx(store, 'readwrite', s => s.put(value, key)),
  delete: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  all: store => tx(store, 'readonly', s => s.getAll()),
  keys: store => tx(store, 'readonly', s => s.getAllKeys()),
}

/** The device record, or null before this browser was set up. */
export const loadDevice = () => idb.get('device', 'self').then(record => record ?? null)

/** Make this browser's key and the pair key with the assistant whose public key is `assistantPub`. */
export async function createDevice(assistantPub) {
  const pair = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
  const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
  const assistant = await subtle.importKey('raw', assistantPub, { name: 'X25519' }, true, [])
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: assistant }, pair.privateKey, 256))
  const pairKey = await derivePairKey(shared, pub, assistantPub)
  shared.fill(0)
  const record = { id: null, pub: b64.encode(pub), assistantPub: b64.encode(assistantPub), privateKey: pair.privateKey, pairKey, created: Date.now() }
  await idb.put('device', 'self', record)
  return record
}

export const saveDevice = record => idb.put('device', 'self', record)
export const forgetDevice = () => idb.delete('device', 'self')

/** A sealed call: `op` with `args`, answered with the result or a thrown error carrying `status`. */
export async function call(device, op, args = {}) {
  const envelope = await sealRequest(device.pairKey, device.id, { op, args })
  const response = await fetch(api('call'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope), credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { status: response.status, code: body.error })
  }
  const answer = await openResponse(device.pairKey, device.id, envelope.n, await response.json())
  if (!answer.ok) throw Object.assign(new Error(answer.error), { status: answer.status, code: answer.error })
  return answer.result
}

export const sealName = (device, id, name) => sealBytes(device.pairKey, `sealed-files/v1/enroll\n${id}`, new TextEncoder().encode(name)).then(b64.encode)

/** Bytes kept on this device only in sealed form (an unfinished upload's file key). */
export const sealLocal = (device, label, bytes) => sealBytes(device.pairKey, `sealed-files/v1/local\n${label}`, bytes)
export const openLocal = (device, label, sealed) => openBytes(device.pairKey, `sealed-files/v1/local\n${label}`, sealed)

/** A guess at this browser's name, for the device list: "Safari on iPhone". */
export function guessName(ua = navigator.userAgent) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} on ${os}`
}
