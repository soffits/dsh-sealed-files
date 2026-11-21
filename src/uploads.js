/**
 * Resumable uploads. A device starts one with the age header it made for the
 * assistant (sealed, so it arrives as sent), then sends the encrypted chunks
 * in numbered parts, a few at a time, each written at its place in one
 * preallocated file. A part counts only once all its chunks decrypt, so a
 * part that broke off or was changed on the way is simply sent again; what
 * is missing is always known from the bitmap on disk, across reloads and
 * restarts. Finishing moves the file into place: nothing is joined or copied.
 */
import { mkdir, open, readdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHUNK_CT, NONCE_BYTES, chunkCount, parseHeader, payloadSize } from '../web/age.js'
import { cleanFolder, partCount, partShape } from '../web/protocol.js'
import { keyOfPrefix, verifyChunks } from './files.js'
import { newId } from './store.js'

const DAY = 86_400_000
const UPLOAD_ID = /^[a-z2-7]{16}$/

export async function createUploads({ dir, store, identity, limits, uploadDays, logger }) {
  const root = join(dir, 'uploads')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const metas = new Map()
  const keys = new Map()

  for (const name of await readdir(root).catch(() => [])) {
    try {
      metas.set(name, JSON.parse(await readFile(join(root, name, 'meta.json'), 'utf8')))
    } catch {
      await rm(join(root, name), { recursive: true, force: true })
    }
  }

  const fail = (status, message) => Object.assign(new Error(message), { status })
  const saving = new Map()
  /** Saved one at a time per upload (parts arrive in parallel), through a temporary file, so meta.json is always whole. */
  function saveMeta(meta) {
    const write = async () => {
      const file = join(root, meta.id, 'meta.json')
      await writeFile(`${file}.tmp`, JSON.stringify(meta), { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    }
    const next = (saving.get(meta.id) ?? Promise.resolve()).then(write, write)
    saving.set(meta.id, next)
    return next
  }
  const dataPath = id => join(root, id, 'data.age')

  async function keyOf(meta) {
    let key = keys.get(meta.id)
    if (key === undefined) {
      const handle = await open(dataPath(meta.id), 'r')
      try {
        const prefix = Buffer.alloc(meta.payloadAt)
        await handle.read(prefix, 0, meta.payloadAt, 0)
        key = keyOfPrefix(new Uint8Array(prefix), identity.priv).key
      } finally {
        await handle.close()
      }
      keys.set(meta.id, key)
    }
    return key
  }

  function owned(id, device) {
    const meta = UPLOAD_ID.test(String(id)) ? metas.get(id) : undefined
    if (meta === undefined || meta.device !== device.id) throw fail(404, 'no such upload')
    return meta
  }

  async function reservedBytes() {
    let total = 0
    for (const meta of metas.values()) total += meta.cipherSize
    return total
  }

  /** Check the limits for `bytes` more, refusing with a reason. */
  async function makeRoom(bytes) {
    if (bytes > limits.maxFileBytes + 1024 * 1024) throw fail(413, 'file-too-large')
    const used = (await store.usedBytes()) + (await reservedBytes())
    if (used + bytes > limits.maxStoreBytes) throw fail(507, 'store-full')
    const disk = await statfs(dir)
    if (disk.bavail * disk.bsize - bytes < limits.minFreeBytes) throw fail(507, 'disk-full')
  }

  /**
   * @param {{ space: string, folder: string, size: number, prefix: Uint8Array }} request
   */
  async function start(person, device, { space, folder, size, prefix }) {
    if (!store.canSee(person, space)) throw fail(403, 'no such space')
    const where = cleanFolder(folder ?? '')
    if (where === null) throw fail(400, 'bad folder')
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxFileBytes) throw fail(413, 'file-too-large')
    const header = parseHeader(prefix)
    if (header === null || prefix.length !== header.length + NONCE_BYTES) throw fail(400, 'bad header')
    try {
      keyOfPrefix(prefix, identity.priv)
    } catch {
      throw fail(400, 'header not for this assistant')
    }
    const cipherSize = prefix.length + payloadSize(size)
    await makeRoom(cipherSize)
    const id = newId().slice(0, 16)
    await mkdir(join(root, id), { mode: 0o700 })
    const handle = await open(dataPath(id), 'wx', 0o600)
    try {
      await handle.truncate(cipherSize)
      await handle.write(prefix, 0, prefix.length, 0)
    } finally {
      await handle.close()
    }
    const now = Date.now()
    const meta = { id, person, device: device.id, space, folder: where, size, payloadAt: prefix.length, cipherSize, received: new Array(partCount(size)).fill(false), created: now, touched: now }
    await saveMeta(meta)
    metas.set(id, meta)
    return status(meta)
  }

  const status = meta => ({ id: meta.id, size: meta.size, parts: meta.received.length, missing: meta.received.flatMap((ok, n) => (ok ? [] : [n])) })

  /** Take part `n` from `body` (a byte stream). Resolves once it is checked and written. */
  async function part(device, id, n, body) {
    const meta = owned(id, device)
    if (!Number.isInteger(n) || n < 0 || n >= meta.received.length) throw fail(400, 'bad part')
    const shape = partShape(meta.size, n)
    const buffer = Buffer.alloc(shape.bytes)
    let length = 0
    for await (const piece of body) {
      if (length + piece.length > shape.bytes) throw fail(400, 'part too long')
      buffer.set(piece, length)
      length += piece.length
    }
    if (length !== shape.bytes) throw fail(400, 'part too short')
    try {
      verifyChunks(await keyOf(meta), shape.first, chunkCount(meta.size) - 1, buffer)
    } catch {
      throw fail(422, 'part does not decrypt')
    }
    if (!metas.has(id)) throw fail(404, 'no such upload')
    const handle = await open(dataPath(id), 'r+')
    try {
      await handle.write(buffer, 0, buffer.length, meta.payloadAt + shape.first * CHUNK_CT)
    } finally {
      await handle.close()
    }
    meta.received[n] = true
    meta.touched = Date.now()
    await saveMeta(meta)
    return { ok: true }
  }

  /** Move a complete upload into place as an item described by `about`. */
  async function finish(device, id, about) {
    const meta = owned(id, device)
    if (meta.received.some(ok => !ok)) throw fail(409, 'parts missing')
    const itemId = newId()
    await rename(dataPath(id), store.itemPath(itemId))
    await saving.get(id)?.catch(() => {})
    saving.delete(id)
    metas.delete(id)
    keys.delete(id)
    await rm(join(root, id), { recursive: true, force: true })
    const now = Date.now()
    return store.addItem({
      id: itemId,
      space: meta.space,
      folder: meta.folder,
      name: about.name,
      type: about.type,
      kind: about.kind,
      size: meta.size,
      cipherSize: meta.cipherSize,
      payloadAt: meta.payloadAt,
      from: { person: meta.person, device: device.id },
      created: now,
      pinned: false,
      expires: store.expiresAt(about.kind, false, now),
      seenByAssistant: false,
    })
  }

  async function cancel(device, id) {
    owned(id, device)
    await drop(id)
  }

  async function drop(id) {
    await saving.get(id)?.catch(() => {})
    saving.delete(id)
    metas.delete(id)
    keys.delete(id)
    await rm(join(root, id), { recursive: true, force: true })
  }

  async function sweep(now = Date.now()) {
    for (const meta of [...metas.values()]) {
      if (now - meta.touched > uploadDays * DAY) {
        logger.info('dropping unfinished upload %s', meta.id)
        await drop(meta.id)
      }
    }
  }

  return {
    start,
    part,
    finish,
    cancel,
    sweep,
    status: (device, id) => status(owned(id, device)),
    /** This device's unfinished uploads. */
    listFor: device => [...metas.values()].filter(meta => meta.device === device.id).map(meta => ({ ...status(meta), space: meta.space, folder: meta.folder, created: meta.created })),
    reservedBytes,
    makeRoom,
  }
}
