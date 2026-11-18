/**
 * PDF previews of Office files, made by DSH's own converter (the `officeToPdf`
 * service behind its document preview) when it is there. The PDF is stored
 * like any item, encrypted to the assistant and tied to its source, so a
 * device opens it the way it opens the file, and it goes when the file goes.
 */
import { decryptFile, encryptToFile } from './files.js'
import { newId } from './store.js'

export const OFFICE = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
const MAX_SOURCE = 100 * 1024 * 1024
const extensionOf = name => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''

export function createPreviews({ store, identity, officeToPdf, logger }) {
  const running = new Map()

  async function make(item, converter) {
    const pieces = []
    for await (const piece of decryptFile(store.itemPath(item.id), identity.priv, item.size)) pieces.push(piece)
    const bytes = new Uint8Array(Buffer.concat(pieces))
    const result = await converter.convert({
      extension: extensionOf(item.name),
      priority: 'foreground',
      source: { key: `sealed-files:${item.id}`, version: String(item.created), bytes: bytes.length, read: async () => ({ bytes, version: String(item.created) }) },
    })
    const id = newId()
    const { cipherSize, payloadAt } = await encryptToFile([Buffer.from(result.pdf)], result.pdf.length, store.itemPath(id), identity.pub)
    await store.addItem({
      id,
      derivedOf: item.id,
      space: item.space,
      folder: item.folder,
      name: `${item.name.replace(/\.[^.]+$/, '')}.pdf`,
      type: 'application/pdf',
      kind: 'file',
      size: result.pdf.length,
      cipherSize,
      payloadAt,
      from: item.from,
      created: Date.now(),
      pinned: true,
      expires: null,
      seenByAssistant: true,
    })
    logger.info('made a PDF preview of %s', item.id)
    return id
  }

  return {
    /** File extensions a preview can be made for, here. */
    available: () => (officeToPdf() ? [...OFFICE] : []),
    /** The id of `item`'s PDF preview, made on first ask. */
    async pdfOf(item) {
      if (item.type === 'application/pdf') return item.id
      const converter = officeToPdf()
      if (!converter || !OFFICE.has(extensionOf(item.name))) throw Object.assign(new Error('no preview for this file'), { status: 415 })
      if (item.size > MAX_SOURCE) throw Object.assign(new Error('file too large to preview'), { status: 413 })
      const existing = store.derivedOf(item.id)[0]
      if (existing !== undefined) return existing.id
      let job = running.get(item.id)
      if (job === undefined) {
        job = make(item, converter).finally(() => running.delete(item.id))
        running.set(item.id, job)
      }
      return job
    },
  }
}
