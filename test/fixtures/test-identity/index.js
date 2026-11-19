/**
 * Test stand-in for a sign-in plugin: every /api request is the person named
 * by the browser's `test-person` cookie (default `tester`), scoped the way a
 * real one does it (DSH's `connection/request` hook). Two routes do what the
 * assistant does through its tool: approve a device, put a note in.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export const name = 'sealed-files-test-identity'
export const inject = ['connection']

export function apply(ctx) {
  const requests = new AsyncLocalStorage()
  ctx.on('connection/request', async (request, _response, next) => {
    const person = /(?:^|;\s*)test-person=([a-z]+)/.exec(request.headers.cookie ?? '')?.[1] ?? 'tester'
    await requests.run({ provider: 'test', issuer: 'test', id: person, name: person }, next)
  })
  ctx.provide('requestIdentity', { current: () => requests.getStore() ?? null })

  const service = () => ctx.get('sealedFiles')?.service()
  ctx.connection.fetch.register({ path: '/api/sealed-files-test/approve', methods: ['POST'], requestBody: 'buffered', fetch: async (request) => {
    const { id } = await request.json()
    const device = service().store.device(id)
    return Response.json(await service().decide({ device: id, code: device.code, choice: 'yes', by: 'test' }))
  } })
  ctx.connection.fetch.register({ path: '/api/sealed-files-test/note', methods: ['POST'], requestBody: 'buffered', fetch: async (request) => {
    const { createAssistant } = await import(process.env.SEALED_FILES_ASSISTANT)
    const { text, space } = await request.json()
    return Response.json(await createAssistant({ service: service(), outDir: '/tmp', origin: () => '' }).text({ text, space }))
  } })
  ctx.connection.fetch.register({ path: '/api/sealed-files-test/put', methods: ['POST'], requestBody: 'buffered', fetch: async (request) => {
    const { createAssistant } = await import(process.env.SEALED_FILES_ASSISTANT)
    const { path, space } = await request.json()
    return Response.json(await createAssistant({ service: service(), outDir: '/tmp', origin: () => '' }).put({ path, space }))
  } })
}
