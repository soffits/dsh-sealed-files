/**
 * The file list, folders and devices, kept as two JSON files next to the
 * encrypted items, and the change signal every view follows. One writer: all
 * changes go through here, are saved before they are announced, and reach
 * every open page through `subscribe`. Every change to the device list also
 * appends one line to `devices.jsonl`: what happened, to which device, and who
 * did it, so a device that went missing can be traced.
 *
 * Spaces: one per person (their own) and, unless turned off, `shared` for
 * everyone. A person sees their own and the shared one; the assistant sees all.
 */
import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SHARED, SNIPPET, cleanFolder, within } from '../web/protocol.js'
import { base32nopad } from '../web/vendor.js'

export const ASSISTANT = 'assistant'
const DAY = 86_400_000
const HOUR = 3_600_000
const PENDING_MS = DAY

export const newId = () => base32nopad.encode(randomBytes(10)).toLowerCase()

export async function createStore({ dir, people, sharedSpace, retentionDays, snippetHours, deviceIdleDays, logger }) {
  const itemsDir = join(dir, 'items')
  await mkdir(itemsDir, { recursive: true, mode: 0o700 })
  const indexFile = join(dir, 'index.json')
  const devicesFile = join(dir, 'devices.json')
  const rosterLog = join(dir, 'devices.jsonl')
  const index = { items: {}, folders: {}, ...(await readJson(indexFile)) }
  const roster = { devices: {}, ...(await readJson(devicesFile)) }
  const listeners = new Set()
  let version = 0
  let saving = Promise.resolve()

  async function readJson(file) {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') logger.warn('could not read %s: %s', file, error.message)
      return {}
    }
  }

  function save(which) {
    const run = async () => {
      for (const [file, data] of which) {
        const temp = `${file}.${process.pid}.tmp`
        await writeFile(temp, JSON.stringify(data), { mode: 0o600 })
        await rename(temp, file)
      }
    }
    saving = saving.then(run, run)
    return saving
  }

  /** Tell views: `spaces` changed (items, folders), and/or `persons` (their devices). */
  function changed({ spaces = [], persons = [] }) {
    version++
    for (const listener of listeners) listener({ version, spaces, persons })
  }

  const spacesOf = person => (person === ASSISTANT ? allSpaces() : [person, ...(sharedSpace ? [SHARED] : [])])
  const allSpaces = () => [...people.all().map(p => p.id), ...(sharedSpace ? [SHARED] : [])]
  const canSee = (person, space) => spacesOf(person).includes(space)
  /** Whether a change in `spaces` or to `persons` concerns `person`. */
  const concerns = (person, change) => person === ASSISTANT || change.persons.includes(person) || change.spaces.some(space => canSee(person, space))

  const itemPath = id => join(itemsDir, `${id}.age`)
  /** When an item of this kind, kept or not, goes: snippets live hours, everything else days. */
  const expiresAt = (kind, pinned, now = Date.now()) => (pinned ? null : now + (kind === SNIPPET ? snippetHours * HOUR : retentionDays * DAY))

  function itemsFor(person) {
    const spaces = new Set(spacesOf(person))
    return Object.values(index.items).filter(item => spaces.has(item.space) && !item.derivedOf)
  }

  function foldersFor(person) {
    const out = {}
    for (const space of spacesOf(person)) {
      const set = new Set(index.folders[space] ?? [])
      for (const item of Object.values(index.items)) if (item.space === space && item.folder !== '') set.add(item.folder)
      // Every ancestor of a folder is a folder too.
      for (const folder of [...set]) for (let parts = folder.split('/'); parts.length > 1; parts.pop()) set.add(parts.slice(0, -1).join('/'))
      out[space] = [...set].sort()
    }
    return out
  }

  function visibleItem(person, id) {
    const item = index.items[id]
    if (item === undefined || !canSee(person, item.space)) return null
    return item
  }

  async function addItem(item) {
    index.items[item.id] = item
    await save([[indexFile, index]])
    changed({ spaces: [item.space] })
    return item
  }

  async function updateItem(person, id, patch) {
    const item = visibleItem(person, id)
    if (item === null) throw Object.assign(new Error('no such file'), { status: 404 })
    if (patch.space !== undefined && !canSee(person, patch.space)) throw Object.assign(new Error('no such space'), { status: 403 })
    const before = item.space
    Object.assign(item, patch)
    if (patch.pinned !== undefined) item.expires = expiresAt(item.kind, patch.pinned)
    await save([[indexFile, index]])
    changed({ spaces: [...new Set([before, item.space])] })
    return item
  }

  async function removeItem(person, id) {
    const item = visibleItem(person, id)
    if (item === null) throw Object.assign(new Error('no such file'), { status: 404 })
    const ids = [id, ...Object.values(index.items).filter(other => other.derivedOf === id).map(other => other.id)]
    for (const each of ids) delete index.items[each]
    await save([[indexFile, index]])
    await Promise.all(ids.map(each => rm(itemPath(each), { force: true })))
    changed({ spaces: [item.space] })
  }

  async function makeFolder(person, space, path) {
    const folder = cleanFolder(path)
    if (!canSee(person, space) || folder === null || folder === '') throw Object.assign(new Error('bad folder'), { status: 400 })
    const list = new Set(index.folders[space] ?? [])
    list.add(folder)
    index.folders[space] = [...list].sort()
    await save([[indexFile, index]])
    changed({ spaces: [space] })
  }

  /** Rename or move a folder (and everything in it), or remove it when `to` is null and it is empty. */
  async function moveFolder(person, space, from, to) {
    const source = cleanFolder(from)
    if (!canSee(person, space) || source === null || source === '') throw Object.assign(new Error('bad folder'), { status: 400 })
    const inside = Object.values(index.items).filter(item => item.space === space && within(item.folder, source))
    if (to === null) {
      if (inside.length > 0) throw Object.assign(new Error('folder not empty'), { status: 409 })
      index.folders[space] = (index.folders[space] ?? []).filter(folder => !within(folder, source))
    } else {
      const target = cleanFolder(to)
      if (target === null || target === '' || within(target, source)) throw Object.assign(new Error('bad folder'), { status: 400 })
      const swap = folder => (within(folder, source) ? target + folder.slice(source.length) : folder)
      for (const item of inside) item.folder = swap(item.folder)
      index.folders[space] = [...new Set((index.folders[space] ?? []).map(swap))].sort()
    }
    await save([[indexFile, index]])
    changed({ spaces: [space] })
  }

  async function markSeen(ids) {
    let any = false
    for (const id of ids) {
      const item = index.items[id]
      if (item !== undefined && !item.seenByAssistant) { item.seenByAssistant = true; any = true }
    }
    if (any) await save([[indexFile, index]])
  }

  // Devices. Each change names what happened (`pair`, `approve`, `reject`, `remove`, `rename`, `revoke`,
  // `sweep`) and who did it: `{ kind: 'device', person, device, name }` for a page, `{ kind: 'outside', label }`
  // for a decision from outside the page, `{ kind: 'assistant' }`, or `{ kind: 'sweep', reason }`.

  const devicesOf = person => Object.values(roster.devices).filter(device => device.person === person)

  /** Save the roster and log the changes, in that order, behind any save already running. */
  function saveRoster(changes) {
    const at = new Date().toISOString()
    const lines = changes.map(({ event, device, by, ...more }) => `${JSON.stringify({ at, event, device: { id: device.id, person: device.person, name: device.name, status: device.status }, by, ...more })}\n`)
    save([[devicesFile, roster]])
    const run = () => appendFile(rosterLog, lines.join(''), { mode: 0o600 })
    saving = saving.then(run, run)
    return saving
  }

  async function putDevice(device, { event, by }) {
    roster.devices[device.id] = device
    await saveRoster([{ event, device, by }])
    changed({ persons: [device.person] })
    return device
  }

  async function setDevice(id, patch, { event, by }) {
    const device = roster.devices[id]
    if (device === undefined) throw Object.assign(new Error('no such device'), { status: 404 })
    const before = { ...device }
    Object.assign(device, patch)
    const was = Object.fromEntries(Object.keys(patch).filter(key => before[key] !== device[key]).map(key => [key, before[key]]))
    await saveRoster([{ event, device, by, was }])
    changed({ persons: [device.person] })
    return device
  }

  async function dropDevice(id, { event, by }) {
    const device = roster.devices[id]
    if (device === undefined) return null
    delete roster.devices[id]
    await saveRoster([{ event, device, by }])
    changed({ persons: [device.person] })
    return device
  }

  /** Last use, written at most once an hour per device so a busy page doesn't rewrite the roster. */
  function touchDevice(device) {
    const now = Date.now()
    if (now - (device.seenAt ?? 0) < 3_600_000) return
    device.seenAt = now
    save([[devicesFile, roster]]).catch(() => {})
  }

  /** Delete expired items, stale pending devices and long-unused ones. Returns when the next item expires. */
  async function sweep(now = Date.now()) {
    const gone = Object.values(index.items).filter(item => item.expires !== null && item.expires <= now)
    for (const item of gone) delete index.items[item.id]
    const orphans = Object.values(index.items).filter(item => item.derivedOf && index.items[item.derivedOf] === undefined)
    for (const item of orphans) delete index.items[item.id]
    const stale = device => (device.status === 'pending' && now - device.created > PENDING_MS ? 'pending over a day'
      : device.status === 'approved' && now - (device.seenAt ?? device.created) > deviceIdleDays * DAY ? `unused ${deviceIdleDays} days` : null)
    const dropped = Object.values(roster.devices).map(device => ({ device, reason: stale(device) })).filter(({ reason }) => reason !== null)
    for (const { device } of dropped) delete roster.devices[device.id]
    if (gone.length + orphans.length > 0) {
      await save([[indexFile, index]])
      await Promise.all([...gone, ...orphans].map(item => rm(itemPath(item.id), { force: true })))
      changed({ spaces: [...new Set(gone.map(item => item.space))] })
    }
    if (dropped.length > 0) {
      await saveRoster(dropped.map(({ device, reason }) => ({ event: 'sweep', device, by: { kind: 'sweep', reason } })))
      changed({ persons: [...new Set(dropped.map(({ device }) => device.person))] })
    }
    const next = Object.values(index.items).map(item => item.expires).filter(at => at !== null)
    return next.length === 0 ? null : Math.min(...next)
  }

  async function usedBytes() {
    let total = 0
    for (const item of Object.values(index.items)) {
      try { total += (await stat(itemPath(item.id))).size } catch { /* already gone */ }
    }
    return total
  }

  return {
    dir,
    itemPath,
    spacesOf,
    canSee,
    concerns,
    itemsFor,
    foldersFor,
    visibleItem,
    item: id => index.items[id] ?? null,
    derivedOf: id => Object.values(index.items).filter(item => item.derivedOf === id),
    addItem,
    updateItem,
    removeItem,
    makeFolder,
    moveFolder,
    markSeen,
    device: id => roster.devices[id] ?? null,
    devicesOf,
    putDevice,
    setDevice,
    dropDevice,
    touchDevice,
    sweep,
    usedBytes,
    expiresAt,
    get version() { return version },
    /** Follow changes: `listener({ version, spaces, persons })`. Returns the unsubscribe. */
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    flush: () => saving,
  }
}
