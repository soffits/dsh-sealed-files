/**
 * What the assistant does with Sealed Files through its tool: see what
 * arrived, read a file or note, put one in, tidy up, and add or remove
 * devices. It holds the key every file is encrypted to, so it reads and
 * writes directly, without a device.
 */
import { createReadStream } from 'node:fs'
import { mkdir, open, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ID, PREVIEW_CHARS, SHARED, TEXT_TYPE, cleanFolder, cleanName } from '../web/protocol.js'
import { decryptFile, encryptToFile } from './files.js'
import { ASSISTANT, newId } from './store.js'

const INLINE_TEXT = 64 * 1024
export { typeByName as typeOf } from '../web/types.js'
import { typeByName } from '../web/types.js'
const fail = message => Object.assign(new Error(message), { status: 400 })

export function createAssistant({ service, outDir, origin }) {
  const { store, identity } = service
  const link = id => `${(origin() ?? '').replace(/\/$/, '')}/?sealed-files=${id}`

  function spaceOf(space) {
    const spaces = store.spacesOf(ASSISTANT)
    if (!spaces.includes(space)) throw fail(`unknown space ${space}; spaces: ${spaces.join(', ')}`)
    return space
  }

  const view = item => ({ ...service.itemView(item), link: link(item.id), unseen: !item.seenByAssistant })

  async function addFile(pieces, size, { space, folder, name, type, kind, preview }) {
    const where = cleanFolder(folder ?? '')
    const clean = cleanName(name)
    if (where === null) throw fail('bad folder')
    if (clean === null) throw fail('bad name')
    await service.uploads.makeRoom(size + 4096)
    const id = newId()
    const { cipherSize, payloadAt } = await encryptToFile(pieces, size, store.itemPath(id), identity.pub)
    const now = Date.now()
    return view(await store.addItem({ id, space: spaceOf(space), folder: where, name: clean, type, kind, preview, size, cipherSize, payloadAt, from: { person: ASSISTANT }, created: now, pinned: false, expires: store.expiresAt(false, now), seenByAssistant: true }))
  }

  return {
    spaces: () => store.spacesOf(ASSISTANT).map(space => ({ id: space, name: space === SHARED ? 'shared' : service.nameOf(space) })),

    async list({ space, folder, unseen } = {}) {
      let items = store.itemsFor(ASSISTANT)
      if (space) items = items.filter(item => item.space === space)
      if (folder !== undefined) items = items.filter(item => item.folder === folder)
      if (unseen) items = items.filter(item => !item.seenByAssistant)
      items.sort((a, b) => b.created - a.created)
      const out = items.map(view)
      await store.markSeen(items.map(item => item.id))
      return { spaces: this.spaces(), folders: store.foldersFor(ASSISTANT), items: out }
    },

    async get({ id }) {
      if (!ID.test(String(id))) throw fail('bad id')
      const item = store.item(id)
      if (item === null || item.derivedOf) throw Object.assign(new Error('no such file'), { status: 404 })
      await store.markSeen([id])
      if (item.kind === 'text' && item.size <= INLINE_TEXT) {
        const pieces = []
        for await (const piece of decryptFile(store.itemPath(id), identity.priv, item.size)) pieces.push(piece)
        return { ...view(item), text: Buffer.concat(pieces).toString('utf8') }
      }
      const dir = join(outDir, id)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const path = join(dir, item.name)
      let size = 0
      // Written chunk by chunk so a large file never sits in memory whole.
      const handle = await open(path, 'w', 0o600)
      try {
        for await (const piece of decryptFile(store.itemPath(id), identity.priv, item.size)) {
          await handle.write(piece, 0, piece.length, size)
          size += piece.length
        }
      } finally {
        await handle.close()
      }
      return { ...view(item), path }
    },

    async put({ path, space, folder, name }) {
      const info = await stat(path)
      if (!info.isFile()) throw fail('not a file')
      const fileName = name || basename(path)
      return addFile(createReadStream(path), info.size, { space, folder, name: fileName, type: typeByName(fileName), kind: 'file', preview: null })
    },

    async text({ text, space, folder, title }) {
      if (typeof text !== 'string' || text === '') throw fail('no text')
      const bytes = Buffer.from(text, 'utf8')
      const name = cleanName(title) ?? `${text.split('\n')[0].slice(0, 40).trim() || 'Note'}.txt`
      return addFile([bytes], bytes.length, { space, folder, name: /\.[a-z0-9]+$/i.test(name) ? name : `${name}.txt`, type: TEXT_TYPE, kind: 'text', preview: text.slice(0, PREVIEW_CHARS) })
    },

    remove: async ({ id }) => { await store.removeItem(ASSISTANT, id); return { removed: id } },
    pin: async ({ id, pinned }) => view(await store.updateItem(ASSISTANT, id, { pinned: pinned !== false })),
    move: async ({ id, space, folder }) => view(await store.updateItem(ASSISTANT, id, { space: spaceOf(space), folder: cleanFolder(folder ?? '') ?? '' })),
    mkdir: async ({ space, folder }) => { await store.makeFolder(ASSISTANT, spaceOf(space), folder); return { space, folder } },

    devices({ person } = {}) {
      const persons = person ? [person] : service.people.all().map(p => p.id)
      return persons.flatMap(id => store.devicesOf(id).map(device => ({ person: id, ...service.deviceView(device) })))
    },
    async revoke({ device }) {
      const dropped = await store.dropDevice(String(device), { event: 'revoke', by: { kind: 'assistant' } })
      if (dropped === null) throw Object.assign(new Error('no such device'), { status: 404 })
      return { removed: device }
    },
  }
}
