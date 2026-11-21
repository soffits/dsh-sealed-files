/**
 * What the assistant does with Sealed Files through its tool: see what
 * arrived, read a file, note or clipboard snippet, put one in, tidy up, and add or remove
 * devices. It holds the key every file is encrypted to, so it reads and
 * writes directly, without a device.
 */
import { createReadStream } from 'node:fs'
import { mkdir, open, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ID, SHARED, SNIPPET, cleanFolder } from '../web/protocol.js'
import { decryptFile } from './files.js'
import { ASSISTANT } from './store.js'

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

  const view = async item => ({ ...(await service.fullView(item)), link: link(item.id), unseen: !item.seenByAssistant })

  return {
    spaces: () => store.spacesOf(ASSISTANT).map(space => ({ id: space, name: space === SHARED ? 'shared' : service.nameOf(space) })),

    async list({ space, folder, unseen } = {}) {
      let items = store.itemsFor(ASSISTANT)
      if (space) items = items.filter(item => item.space === space)
      if (folder !== undefined) items = items.filter(item => item.folder === folder)
      if (unseen) items = items.filter(item => !item.seenByAssistant)
      items.sort((a, b) => b.created - a.created)
      const out = await Promise.all(items.map(view))
      await store.markSeen(items.map(item => item.id))
      return { spaces: this.spaces(), folders: store.foldersFor(ASSISTANT), items: out }
    },

    async get({ id }) {
      if (!ID.test(String(id))) throw fail('bad id')
      const item = store.item(id)
      if (item === null || item.derivedOf) throw Object.assign(new Error('no such file'), { status: 404 })
      await store.markSeen([id])
      if (item.kind === SNIPPET) return view(item)
      if (item.kind === 'text' && item.size <= INLINE_TEXT) {
        const pieces = []
        for await (const piece of decryptFile(store.itemPath(id), identity.priv, item.size)) pieces.push(piece)
        return { ...(await view(item)), text: Buffer.concat(pieces).toString('utf8') }
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
      return { ...(await view(item)), path }
    },

    async put({ path, space, folder, name }) {
      const info = await stat(path)
      if (!info.isFile()) throw fail('not a file')
      const fileName = name || basename(path)
      return view(await service.addFile(createReadStream(path), info.size, { space: spaceOf(space), folder, name: fileName, type: typeByName(fileName), kind: 'file', from: ASSISTANT }))
    },

    text: async ({ text, space, folder, title }) => view(await service.addNote(ASSISTANT, { text, space: spaceOf(space), folder, title })),
    snippet: async ({ text, space }) => view(await service.addSnippet(ASSISTANT, { text, space: spaceOf(space) })),

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
