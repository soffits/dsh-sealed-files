/**
 * Sealed Files as one service: the store, uploads, the assistant's key, device
 * enrollment and the operations a device may run. The routes (src/api.js) and
 * the assistant's tool (tools.js, through src/assistant.js) both go through it.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { b64, deviceIdOf, openBytes, pairingCode } from '../web/seal.js'
import { ID, SHARED, cleanFolder, cleanName } from '../web/protocol.js'
import { readKey } from './files.js'
import { loadIdentity } from './keys.js'
import { createPeople } from './people.js'
import { createPreviews } from './preview.js'
import { ASSISTANT, createStore } from './store.js'
import { createUploads } from './uploads.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
const DEVICE_NAME = 80

export async function createService({ config, limits, stateDir, identityFile, officeToPdf, logger }) {
  const identity = loadIdentity(identityFile)
  const people = createPeople(config, (...args) => logger.warn(...args))
  const store = await createStore({ dir: stateDir, people, sharedSpace: config.sharedSpace, retentionDays: config.retentionDays, deviceIdleDays: config.deviceIdleDays, logger })
  const uploads = await createUploads({ dir: stateDir, store, identity, limits, uploadDays: config.uploadDays, logger })
  const previews = createPreviews({ store, identity, officeToPdf, logger })
  const keyCache = new Map()

  const nameOf = person => (person === ASSISTANT ? null : people.all().find(p => p.id === person)?.name ?? person)

  function notify(event) {
    const [command, ...args] = config.notifyCommand
    if (command === undefined) return
    try {
      const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], detached: false })
      let errors = ''
      child.stderr.on('data', chunk => { errors += chunk })
      child.on('error', error => logger.warn('notify command failed: %s', error.message))
      child.on('exit', code => { if (code !== 0) logger.warn('notify command exited %s: %s', code, errors.slice(0, 500)) })
      child.stdin.end(`${JSON.stringify(event)}\n`)
    } catch (error) {
      logger.warn('notify command failed: %s', error.message)
    }
  }

  /** What a page may know about an item. */
  const itemView = item => ({
    id: item.id,
    space: item.space,
    folder: item.folder,
    name: item.name,
    type: item.type,
    kind: item.kind,
    size: item.size,
    from: { person: item.from.person, name: nameOf(item.from.person) },
    created: item.created,
    expires: item.expires,
    pinned: item.pinned,
    preview: item.preview,
  })

  const deviceView = (device, current) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    created: device.created,
    seenAt: device.seenAt ?? null,
    current: device.id === current,
    code: device.status === 'pending' ? device.code : undefined,
  })

  /** A new device asks to be added: `pub` is its X25519 key, `name` sealed under the pair key. */
  async function enroll(person, { pub, name }) {
    let devicePub
    try {
      devicePub = b64.decode(pub)
    } catch {
      throw fail(400, 'bad key')
    }
    if (devicePub.length !== 32) throw fail(400, 'bad key')
    const id = deviceIdOf(devicePub)
    const existing = store.device(id)
    if (existing !== null) {
      if (existing.person !== person.id) throw fail(409, 'key in use')
      return { id, status: existing.status }
    }
    let label = ''
    try {
      label = new TextDecoder().decode(await openBytes(await identity.pairKey(devicePub), `sealed-files/v1/enroll\n${id}`, b64.decode(name)))
    } catch {
      throw fail(400, 'bad seal')
    }
    label = (cleanName(label) ?? 'Browser').slice(0, DEVICE_NAME)
    const code = pairingCode(devicePub, identity.pub)
    const pending = store.devicesOf(person.id).filter(d => d.status === 'pending')
    if (pending.length >= 5) throw fail(429, 'too many pending devices')
    await store.putDevice({ id, person: person.id, name: label, pub, status: 'pending', code, created: Date.now() })
    notify({ event: 'device-pending', person: person.id, personName: person.name, device: { id, name: label }, code })
    return { id, status: 'pending' }
  }

  async function fileKey(id) {
    let entry = keyCache.get(id)
    if (entry === undefined) {
      const { fileKey, nonce, payloadAt } = await readKey(store.itemPath(id), identity.priv)
      entry = { fileKey: b64.encode(fileKey), nonce: b64.encode(nonce), payloadAt }
      if (keyCache.size > 500) keyCache.delete(keyCache.keys().next().value)
      keyCache.set(id, entry)
    }
    return entry
  }

  const itemId = value => {
    if (!ID.test(String(value))) throw fail(400, 'bad id')
    return value
  }

  async function approve(id, by) {
    const device = store.device(id)
    if (device === null) throw fail(404, 'no such device')
    if (device.status === 'approved') return deviceView(device)
    return deviceView(await store.setDevice(id, { status: 'approved', approvedAt: Date.now(), approvedBy: by, code: undefined }))
  }

  /** The operations a device runs through its sealed channel. */
  const operations = {
    status: ({ device, person }) => ({ status: device.status, assistantName: config.assistantName, person: { id: person.id, name: person.name }, device: { id: device.id, name: device.name } }),
    index: ({ person, device }) => ({
      person: { id: person.id, name: person.name },
      device: device.id,
      spaces: store.spacesOf(person.id).map(space => ({ id: space, own: space === person.id, shared: space === SHARED })),
      items: store.itemsFor(person.id).map(itemView),
      folders: store.foldersFor(person.id),
      uploads: uploads.listFor(device),
      limits: { maxFileBytes: limits.maxFileBytes },
      previews: previews.available(),
      version: store.version,
    }),
    key: async ({ person, args }) => {
      const item = store.visibleItem(person.id, itemId(args.id))
      if (item === null) throw fail(404, 'no such file')
      return { ...(await fileKey(item.id)), size: item.size, type: item.type, name: item.name }
    },
    mkdir: ({ person, args }) => store.makeFolder(person.id, args.space, args.path).then(() => ({})),
    'folder.move': ({ person, args }) => store.moveFolder(person.id, args.space, args.from, args.to).then(() => ({})),
    'folder.remove': ({ person, args }) => store.moveFolder(person.id, args.space, args.path, null).then(() => ({})),
    rename: async ({ person, args }) => {
      const name = cleanName(args.name)
      if (name === null) throw fail(400, 'bad name')
      return itemView(await store.updateItem(person.id, itemId(args.id), { name }))
    },
    move: async ({ person, args }) => {
      const folder = cleanFolder(args.folder ?? '')
      if (folder === null) throw fail(400, 'bad folder')
      return itemView(await store.updateItem(person.id, itemId(args.id), { space: args.space, folder }))
    },
    remove: ({ person, args }) => store.removeItem(person.id, itemId(args.id)).then(() => ({})),
    pin: async ({ person, args }) => itemView(await store.updateItem(person.id, itemId(args.id), { pinned: args.pinned === true })),
    'upload.start': ({ person, device, args }) => uploads.start(person.id, device, { space: args.space, folder: args.folder, size: args.size, prefix: b64.decode(String(args.prefix)) }),
    'upload.status': ({ device, args }) => uploads.status(device, args.id),
    'upload.finish': async ({ device, args }) => {
      const name = cleanName(args.name)
      if (name === null) throw fail(400, 'bad name')
      const type = typeof args.type === 'string' && /^[\w.+-]+\/[\w.+-]+(;[\w=.-]+)?$/.test(args.type) ? args.type : 'application/octet-stream'
      const preview = typeof args.preview === 'string' ? args.preview.slice(0, 2000) : null
      return itemView(await uploads.finish(device, args.id, { name, type, kind: args.kind === 'text' ? 'text' : 'file', preview }))
    },
    'upload.cancel': ({ device, args }) => uploads.cancel(device, args.id).then(() => ({})),
    devices: ({ person, device }) => store.devicesOf(person.id).map(d => deviceView(d, device.id)),
    'device.approve': async ({ person, device, args }) => {
      const other = store.device(String(args.id))
      if (other === null || other.person !== person.id) throw fail(404, 'no such device')
      return approve(other.id, device.id)
    },
    'device.remove': async ({ person, args }) => {
      const other = store.device(String(args.id))
      if (other === null || other.person !== person.id) throw fail(404, 'no such device')
      await store.dropDevice(other.id)
      return {}
    },
    'device.rename': async ({ person, args }) => {
      const other = store.device(String(args.id))
      const name = cleanName(args.name)
      if (other === null || other.person !== person.id || name === null) throw fail(400, 'bad device')
      return deviceView(await store.setDevice(other.id, { name: name.slice(0, DEVICE_NAME) }))
    },
    preview: async ({ person, args }) => {
      const item = store.visibleItem(person.id, itemId(args.id))
      if (item === null) throw fail(404, 'no such file')
      return { id: await previews.pdfOf(item) }
    },
  }

  return {
    logger,
    identity,
    people,
    store,
    uploads,
    previews,
    enroll,
    approve,
    notify,
    itemView,
    deviceView,
    fileKey,
    nameOf,
    /** Run a device operation; `device` is the roster entry, `person` its owner. */
    async run(op, context) {
      const handler = Object.hasOwn(operations, op) ? operations[op] : undefined
      if (handler === undefined) throw fail(400, 'unknown operation')
      if (context.device.status !== 'approved' && op !== 'status') throw fail(403, 'not-approved')
      return handler({ ...context, args: context.args ?? {} })
    },
    itemsDir: join(stateDir, 'items'),
  }
}
