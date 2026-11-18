/**
 * The routes under DSH's `/api` (exact Fetch routes, so DSH admits the browser
 * first and the sign-in plugin's `requestIdentity` names the person):
 *
 *   GET  /api/sealed-files/whoami   the assistant's public key; whether this sign-in maps to a person
 *   POST /api/sealed-files/enroll   a new device's public key (its name sealed)
 *   POST /api/sealed-files/call     every other operation, sealed both ways with the device's pair key
 *   POST /api/sealed-files/part     ?d=&u=&n=  one encrypted upload part, streamed
 *   GET  /api/sealed-files/blob     ?d=&id=    an item's ciphertext, with Range
 *   GET  /api/sealed-files/events   a Server-Sent Events stream: "something you see changed"
 *
 * In plain text these carry only public keys, random ids, sizes and
 * ciphertext; names, the file list and keys travel sealed.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { b64, openRequest, sealResponse } from '../web/seal.js'
import { ID } from '../web/protocol.js'

export const API = '/api/sealed-files'
const WINDOW_MS = 10 * 60_000
const HEARTBEAT_MS = 25_000
export const HEADERS = { 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'content-type': 'application/json' } })
const refuse = (status, code) => json(status, { error: code })

export function createApiRoutes({ service, identity, version }) {
  const seen = new Map()

  /** A nonce is good once within the window. */
  function fresh(envelope) {
    const now = Date.now()
    if (!Number.isFinite(envelope.t) || Math.abs(now - envelope.t) > WINDOW_MS) return false
    for (const [nonce, at] of seen) if (now - at > 2 * WINDOW_MS) seen.delete(nonce); else break
    const key = `${envelope.d}:${envelope.n}`
    if (seen.has(key)) return false
    seen.set(key, now)
    return true
  }

  const current = () => service()
  const personOf = svc => svc.people.current(identity())

  /** The person and their device for a request that names one, or a refusal. */
  function deviceOf(svc, person, id, { approved = true } = {}) {
    if (person === null) return { refusal: refuse(403, 'not-mapped') }
    const device = typeof id === 'string' ? svc.store.device(id) : null
    if (device === null || device.person !== person.id) return { refusal: refuse(403, 'unknown-device') }
    if (approved && device.status !== 'approved') return { refusal: refuse(403, 'not-approved') }
    return { device }
  }

  const guarded = handler => async (request) => {
    const svc = current()
    if (svc === undefined) return refuse(503, 'starting')
    try {
      return await handler(request, svc)
    } catch (error) {
      if (typeof error.status === 'number') return refuse(error.status, error.message)
      svc.logger?.warn?.('request failed: %s', error.message)
      return refuse(500, 'failed')
    }
  }

  const whoami = guarded(async (request, svc) => json(200, { mapped: personOf(svc) !== null, assistant: { pub: b64.encode(svc.identity.pub), recipient: svc.identity.recipient }, version }))

  const enroll = guarded(async (request, svc) => {
    const person = personOf(svc)
    if (person === null) return refuse(403, 'not-mapped')
    const body = await request.json().catch(() => null)
    if (body === null || typeof body.pub !== 'string' || typeof body.name !== 'string') return refuse(400, 'bad request')
    return json(200, await svc.enroll(person, body))
  })

  const call = guarded(async (request, svc) => {
    const envelope = await request.json().catch(() => null)
    if (envelope === null || typeof envelope.d !== 'string' || typeof envelope.n !== 'string' || typeof envelope.c !== 'string') return refuse(400, 'bad request')
    const person = personOf(svc)
    const { device, refusal } = deviceOf(svc, person, envelope.d, { approved: false })
    if (refusal) return refusal
    const key = await svc.identity.pairKey(b64.decode(device.pub))
    let body
    try {
      body = await openRequest(key, envelope)
    } catch {
      return refuse(400, 'bad-seal')
    }
    if (!fresh(envelope)) return refuse(400, 'stale')
    svc.store.touchDevice(device)
    let answer
    try {
      answer = { ok: true, result: await svc.run(String(body.op), { person, device, args: body.args }) }
    } catch (error) {
      if (typeof error.status !== 'number') svc.logger?.warn?.('%s failed: %s', body.op, error.message)
      answer = { ok: false, status: error.status ?? 500, error: typeof error.status === 'number' ? error.message : 'failed' }
    }
    return json(200, await sealResponse(key, device.id, envelope.n, answer))
  })

  const part = guarded(async (request, svc) => {
    const url = new URL(request.url)
    const { device, refusal } = deviceOf(svc, personOf(svc), url.searchParams.get('d'))
    if (refusal) return refusal
    if (request.body === null) return refuse(400, 'no body')
    return json(200, await svc.uploads.part(device, url.searchParams.get('u'), Number(url.searchParams.get('n')), request.body))
  })

  const blob = guarded(async (request, svc) => {
    const url = new URL(request.url)
    const person = personOf(svc)
    const { refusal } = deviceOf(svc, person, url.searchParams.get('d'))
    if (refusal) return refusal
    const id = url.searchParams.get('id')
    const item = ID.test(String(id)) ? svc.store.visibleItem(person.id, id) : null
    if (item === null) return refuse(404, 'no such file')
    const path = svc.store.itemPath(item.id)
    const size = (await stat(path)).size
    const range = parseRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...HEADERS, 'content-range': `bytes */${size}` } })
    const [start, end] = range ?? [0, size - 1]
    const headers = { ...HEADERS, 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1) }
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`
    const body = request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(createReadStream(path, { start, end }))
    return new Response(body, { status: range ? 206 : 200, headers })
  })

  const events = guarded(async (request, svc) => {
    const person = personOf(svc)
    if (person === null) return refuse(403, 'not-mapped')
    const encoder = new TextEncoder()
    let stop = () => {}
    const stream = new ReadableStream({
      start(controller) {
        const write = (chunk) => {
          try { controller.enqueue(encoder.encode(chunk)) } catch { stop() }
        }
        write('retry: 4000\n: open\n\n')
        const off = svc.store.subscribe((change) => {
          if (svc.store.concerns(person.id, change)) write(`data: ${JSON.stringify({ v: change.version, devices: change.persons.includes(person.id) })}\n\n`)
        })
        const beat = setInterval(() => write(': beat\n\n'), HEARTBEAT_MS)
        stop = () => { off(); clearInterval(beat) }
        request.signal?.addEventListener('abort', () => {
          stop()
          try { controller.close() } catch { /* closed */ }
        }, { once: true })
      },
      cancel() { stop() },
    })
    return new Response(stream, { status: 200, headers: { ...HEADERS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } })
  })

  return [
    { path: `${API}/whoami`, methods: ['GET'], requestBody: 'buffered', fetch: whoami },
    { path: `${API}/enroll`, methods: ['POST'], requestBody: 'buffered', fetch: enroll },
    { path: `${API}/call`, methods: ['POST'], requestBody: 'buffered', fetch: call },
    { path: `${API}/part`, methods: ['POST'], requestBody: 'streaming', fetch: part },
    { path: `${API}/blob`, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: blob },
    { path: `${API}/events`, methods: ['GET'], requestBody: 'buffered', fetch: events },
  ]
}

/** `[start, end]` for a single-range header, null without one, 'unsatisfiable' when it can't be served. */
export function parseRange(header, size) {
  if (typeof header !== 'string' || header.trim() === '') return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (match === null || size <= 0) return 'unsatisfiable'
  const [, rawStart, rawEnd] = match
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (rawEnd === '' || !(suffix > 0)) return 'unsatisfiable'
    return [Math.max(0, size - suffix), size - 1]
  }
  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (start >= size || end < start) return 'unsatisfiable'
  return [start, end]
}
