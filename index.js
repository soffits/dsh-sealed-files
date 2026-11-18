/**
 * DeepSeek Harness Host plugin: Sealed Files, end-to-end encrypted files and
 * text between the people signed in to DSH and the assistant.
 *
 * Mounts the page under /sealed-files/app/ on DSH's web server and the sealed
 * API under DSH's /api/sealed-files (src/api.js), and provides the
 * `sealedFiles` service the assistant's tool (tools.js) looks up at call time.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createApiRoutes } from './src/api.js'
import { ROUTE, createAppHandler } from './src/app.js'
import { Config, limitsOf } from './src/config.js'
import { followDecisions } from './src/decisions.js'
import { createService } from './src/service.js'

export const name = 'dsh-sealed-files'
export const inject = ['webServer', 'connection']
export { Config }

/** This package's version, read from its manifest when asked (one level up once built into dist/). */
function version() {
  for (const relative of ['./package.json', '../package.json']) {
    try {
      const manifest = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'))
      if (manifest.name === '@soffits/dsh-sealed-files') return manifest.version
    } catch { /* try the next */ }
  }
  return '0.0.0'
}
const expand = path => resolve(path.replace(/^~(?=$|\/)/, homedir()))
const DAY_MS = 86_400_000

export function apply(ctx, config) {
  const logger = ctx.logger('sealed-files')
  let current

  ctx.provide?.('sealedFiles', Object.freeze({ service: () => current }))

  ctx.effect(() => {
    const stateDir = expand(config.stateDir)
    const identityFile = config.identityFile === '' ? join(stateDir, 'identity.txt') : expand(config.identityFile)
    const peopleFile = config.peopleFile === '' ? '' : expand(config.peopleFile)
    let stopped = false
    let timer
    let stopDecisions
    const starting = createService({
      config: { ...config, peopleFile },
      limits: limitsOf(config),
      stateDir,
      identityFile,
      officeToPdf: () => ctx.get('officeToPdf'),
      publicOrigin: () => ctx.get('webApp')?.getAdvertisedUrl?.(),
      logger,
    }).then(async (service) => {
      if (stopped) return
      current = service
      stopDecisions = await followDecisions({ stateDir, decide: service.decide, logger })
      // The clock changes what exists here only when something expires: sleep until then (at most a day).
      const sweep = async () => {
        const next = await service.store.sweep().catch(error => { logger.warn('sweep failed: %s', error.message); return null })
        await service.uploads.sweep().catch(() => {})
        if (stopped) return
        timer = setTimeout(sweep, Math.min(DAY_MS, Math.max(60_000, (next ?? Infinity) - Date.now())))
      }
      await sweep()
    }).catch(error => logger.warn('could not start: %s', error.message))

    const routes = createApiRoutes({ service: () => current, identity: () => ctx.get('requestIdentity'), version })
      .map(route => ctx.connection.fetch.register(route))
    const disposeHttp = ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: createAppHandler({ connection: ctx.connection }) })

    return async () => {
      stopped = true
      clearTimeout(timer)
      disposeHttp()
      await Promise.all(routes.map(dispose => dispose()))
      await starting
      await stopDecisions?.()
      await current?.store.flush()
      current = undefined
    }
  }, 'sealed-files.service()')
}
