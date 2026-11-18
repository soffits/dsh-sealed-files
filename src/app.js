/**
 * The page itself under /sealed-files/app/: index.html, its modules and
 * styles, its words, and the service worker whose scope it is. Behind DSH's
 * own login (`connection.admit`), with a strict content security policy that
 * lets only this folder's own scripts run, so nothing a proxy adds to the page
 * can execute. /sealed-files/app/stream/ exists only inside the service
 * worker, which decrypts there; the server never answers it.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROUTE = '/sealed-files'
const APP = `${ROUTE}/app/`
const here = dirname(fileURLToPath(import.meta.url))
// src/ next to web/ in the repository; dist/ next to web/ once built.
const WEB = resolve(here, '../web')
const LOCALE = resolve(here, '../locale')
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml' }

export function admitOwner(connection, request) {
  const admission = connection.admit(request)
  if ('rejection' in admission) return { ok: false, status: admission.rejection }
  if (admission.peer?.principal?.kind !== 'owner') return { ok: false, status: 403 }
  return { ok: true }
}

function policy(host) {
  const self = host ? `${host}${APP}` : "'self'"
  return [
    "default-src 'none'",
    `script-src ${self}`,
    `worker-src ${self}`,
    `style-src ${self}`,
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function fileFor(path) {
  if (!path.startsWith(APP)) return null
  const rest = path.slice(APP.length)
  if (rest === '' || rest === 'index.html') return resolve(WEB, 'index.html')
  if (/^[a-z][a-z0-9-]*\.(js|css|svg)$/.test(rest)) return resolve(WEB, rest)
  const locale = /^locale\/([a-z]{2,3}(-[a-z0-9]{2,8})*)\.json$/i.exec(rest)
  if (locale) return resolve(LOCALE, `${locale[1].toLowerCase()}.json`)
  return null
}

/** Every locale/<tag>.json's `ui` table, by tag, read per request so an update never serves old words. */
export async function readLocales() {
  const out = {}
  for (const name of (await readdir(LOCALE)).filter(n => /^[a-z]{2,3}(-[a-z0-9]+)*\.json$/i.test(n)).sort()) {
    try {
      const { ui } = JSON.parse(await readFile(resolve(LOCALE, name), 'utf8'))
      if (ui && typeof ui === 'object') out[name.slice(0, -5)] = ui
    } catch { /* a broken file is skipped */ }
  }
  return out
}

/** The node:http handler for the /sealed-files prefix. */
export function createAppHandler({ connection }) {
  return async (req, res) => {
    const admitted = admitOwner(connection, req)
    if (!admitted.ok) {
      res.writeHead(admitted.status, { 'content-type': 'text/plain' })
      return res.end(admitted.status === 401 ? 'Sign in first.' : 'Forbidden.')
    }
    const path = new URL(req.url ?? '/', 'http://local.invalid').pathname
    if (path === ROUTE || path === `${ROUTE}/` || path === APP.slice(0, -1)) {
      res.writeHead(302, { location: APP })
      return res.end()
    }
    let file = req.method === 'GET' || req.method === 'HEAD' ? fileFor(path) : null
    let body
    try {
      if (path === `${APP}locales.json`) {
        file = 'locales.json'
        body = Buffer.from(JSON.stringify(await readLocales()))
      } else {
        body = file === null ? null : await readFile(file)
      }
    } catch {
      body = null
    }
    if (body === null) {
      res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      return res.end('Not found.')
    }
    const type = TYPES[file.split('.').pop()] ?? 'application/octet-stream'
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-cache, no-transform',
      'content-security-policy': policy(req.headers.host),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
