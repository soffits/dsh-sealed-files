/**
 * The Sealed Files page: sets this device up (or finds it), then shows the
 * person's spaces and folders, sends files and notes, and opens items. The
 * file list arrives sealed for this device and is redrawn whenever the
 * Host's change stream says something this person sees changed.
 */
import { b64, deviceIdOf, pairingCode } from './seal.js'
import { api, call, createDevice, forgetDevice, guessName, idb, loadDevice, saveDevice, sealName } from './device.js'
import { bytes, loadWords, t, when } from './i18n.js'
import { followShellTheme } from './theme.js'
import { ask, clear, confirmed, el, icon, iconFor, menu, sheet, toast } from './ui.js'
import { openItem } from './item-view.js'
import { openDevices } from './devices-view.js'
import { cancelUpload, upload } from './upload.js'
import { parentOf } from './protocol.js'

const params = new URLSearchParams(location.hash.slice(1))
const embedded = params.has('embedded')
let linkedItem = params.get('item')

const state = { device: null, index: null, space: null, folder: '', jobs: new Map(), whoami: null, openId: null, version: null }
const root = el('div', { style: 'display:contents' })

async function boot() {
  document.body.append(root)
  await loadWords()
  if (embedded) followShellTheme()
  if (!globalThis.crypto?.subtle || !(await supportsX25519())) return screen(t('title'), [el('p', { text: t('noCrypto') })])
  if (!('serviceWorker' in navigator)) return screen(t('title'), [el('p', { text: t('noWorker') })])
  await navigator.serviceWorker.register('./sw.js', { scope: './' })
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) {
    // The first visit: the worker takes this page over once it is active.
    await new Promise((done) => {
      navigator.serviceWorker.addEventListener('controllerchange', done, { once: true })
      setTimeout(done, 4000)
    })
    if (!navigator.serviceWorker.controller) return screen(t('title'), [el('p', { text: t('noWorker') }), el('button', { class: 'btn', onclick: () => location.reload() }, t('upload.retry'))])
  }
  navigator.storage?.persist?.().catch(() => {})
  state.whoami = await fetch(api('whoami'), { cache: 'no-store' }).then(r => r.json())
  if (!state.whoami.mapped) return screen(t('title'), [el('p', { text: t('notMapped') })])
  const assistantPub = state.whoami.assistant.pub
  state.device = await loadDevice()
  if (state.device && state.device.assistantPub !== assistantPub) return keyChanged()
  if (!state.device || state.device.id === null) return enrollScreen(b64.decode(assistantPub))
  follow()
  await refreshStatus()
}

async function supportsX25519() {
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
    return true
  } catch {
    return false
  }
}

function screen(title, children) {
  clear(root)
  root.append(el('div', { class: 'screen' }, el('h2', { text: title }), ...children))
}

function keyChanged() {
  screen(t('keyChanged.title'), [
    el('p', { class: 'warn', text: t('keyChanged.text') }),
    el('button', { class: 'btn danger', onclick: async () => { await forgetDevice(); location.reload() } }, t('keyChanged.reset')),
  ])
}

const assistantName = () => state.assistantName || t('from.assistant')
const iosBrowserTab = () => /iPhone|iPad/.test(navigator.userAgent) && !(window.navigator.standalone || (() => { try { return window.parent.navigator.standalone } catch { return false } })())

function enrollScreen(assistantPub) {
  const name = el('input', { class: 'text', value: guessName(), maxlength: '80' })
  const start = el('button', { class: 'btn primary', onclick: async () => {
    start.disabled = true
    try {
      const device = await createDevice(assistantPub)
      const pub = b64.decode(device.pub)
      device.id = deviceIdOf(pub)
      const label = name.value.trim() || guessName()
      const response = await fetch(api('enroll'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pub: device.pub, name: await sealName(device, device.id, label) }) })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`)
      await saveDevice(device)
      state.device = device
      follow()
      await refreshStatus()
    } catch (error) {
      start.disabled = false
      toast(t('error', { error: error.message }))
    }
  } }, t('enroll.start'))
  screen(t('enroll.title'), [
    el('p', { text: t('enroll.text') }),
    el('label', { class: 'field' }, t('enroll.name'), name),
    iosBrowserTab() && el('p', { text: t('enroll.homeScreen') }),
    start,
  ])
}

function pendingScreen() {
  const code = pairingCode(b64.decode(state.device.pub), b64.decode(state.device.assistantPub))
  screen(t('enroll.title'), [
    el('label', { class: 'field' }, t('enroll.code'), el('div', { class: 'code', text: code })),
    el('p', { text: t('enroll.wait', { assistant: assistantName() }) }),
    el('p', { class: 'sub', text: t('enroll.waiting') }),
    iosBrowserTab() && el('p', { text: t('enroll.homeScreen') }),
    el('button', { class: 'btn', onclick: async () => { await forgetDevice(); location.reload() } }, t('cancel')),
  ])
}

async function refreshStatus() {
  try {
    const status = await call(state.device, 'status')
    state.assistantName = status.assistantName
    if (status.status !== 'approved') return pendingScreen()
    await refresh()
  } catch (error) {
    // A device the Host no longer knows (removed, or expired while pending) starts over.
    if (error.status === 403 && (error.code === 'unknown-device')) {
      await forgetDevice()
      return location.reload()
    }
    screen(t('title'), [el('p', { text: t('error', { error: error.message }) }), el('button', { class: 'btn', onclick: () => location.reload() }, t('upload.retry'))])
  }
}

let source
let refreshing = null
function follow() {
  source?.close()
  source = new EventSource(api('events'))
  source.onmessage = () => {
    if (state.index === null) refreshStatus()
    else refresh()
  }
  source.onopen = () => { if (state.index !== null) refresh() }
}

async function refresh() {
  if (refreshing) { refreshing.again = true; return refreshing.promise }
  refreshing = { again: false }
  refreshing.promise = (async () => {
    do {
      refreshing.again = false
      const index = await call(state.device, 'index')
      state.index = index
      state.previews = index.previews
      state.space ??= index.spaces.find(s => s.own)?.id ?? index.spaces[0]?.id
      if (!index.spaces.some(s => s.id === state.space)) state.space = index.spaces[0]?.id
      if (state.folder !== '' && !(index.folders[state.space] ?? []).includes(state.folder)) state.folder = ''
      await Promise.all(index.items.map(item => remember(item)))
      state.localUploads = new Map((await idb.all('uploads')).map(record => [record.id, record]))
      draw()
      if (linkedItem) {
        const item = index.items.find(i => i.id === linkedItem)
        linkedItem = null
        if (item) { state.space = item.space; state.folder = item.folder; draw(); open(item) }
      }
    } while (refreshing.again)
  })().finally(() => { refreshing = null })
  return refreshing.promise
}

/** What the service worker needs to name a file it streams, kept on this device only. */
const remember = item => idb.put('meta', item.id, { name: item.name, type: item.type, size: item.size })

const spaceLabel = space => (space.own ? t('space.own') : space.shared ? t('space.shared') : t('space.person', { name: space.id }))
const senderName = item => (item.from.person === state.index.person.id ? t('from.you') : item.from.person === 'assistant' ? assistantName() : item.from.name ?? item.from.person)

async function op(name, args) {
  try {
    return await call(state.device, name, args)
  } catch (error) {
    toast(errorText(error))
    throw error
  }
}

const errorText = error => (['file-too-large', 'store-full', 'disk-full', 'not-approved'].includes(error.code ?? error.message)
  ? t(`error.${error.code ?? error.message}`, { max: bytes(state.index?.limits.maxFileBytes ?? 0) })
  : t('error', { error: error.message }))

const fileInput = el('input', { type: 'file', multiple: true, hidden: true, onchange: () => { sendFiles([...fileInput.files]); fileInput.value = '' } })

function draw() {
  const index = state.index
  const list = el('ul', { class: 'list' })
  const folders = (index.folders[state.space] ?? []).filter(f => parentOf(f) === state.folder && f !== state.folder)
  const items = index.items.filter(i => i.space === state.space && i.folder === state.folder).sort((a, b) => b.created - a.created)
  for (const folder of folders) {
    const count = index.items.filter(i => i.space === state.space && (i.folder === folder || i.folder.startsWith(`${folder}/`))).length
    list.append(el('li', { class: 'row', tabindex: '0', onclick: () => { state.folder = folder; draw() }, onkeydown: e => { if (e.key === 'Enter') { state.folder = folder; draw() } } },
      el('div', { class: 'tile', 'data-tone': 'folder' }, icon('folder')),
      el('div', { class: 'what' }, el('div', { class: 'name', text: folder.split('/').pop() }), el('div', { class: 'sub', text: t('count.items', { n: count }) })),
      count === 0 && el('button', { class: 'btn icon', 'aria-label': t('delete'), title: t('delete'), onclick: async (event) => {
        event.stopPropagation()
        if (await confirmed(t('confirmFolder', { name: folder.split('/').pop() }))) await op('folder.remove', { space: state.space, path: folder })
      } }, icon('trash'))))
  }
  for (const item of items) {
    list.append(el('li', { class: 'row', tabindex: '0', 'data-id': item.id, onclick: () => open(item), onkeydown: e => { if (e.key === 'Enter') open(item) } },
      el('div', { class: 'tile' }, icon(iconFor(item))),
      el('div', { class: 'what' },
        el('div', { class: 'name', text: item.name }),
        item.kind === 'text' && item.preview && el('div', { class: 'snippet', text: item.preview.slice(0, 200) }),
        el('div', { class: 'sub', text: `${bytes(item.size)} · ${t('from', { name: senderName(item) })} · ${when(item.created)}` })),
      item.pinned && el('span', { class: 'pin', title: t('kept') }, icon('pin'))))
  }
  const crumbs = el('nav', { class: 'crumbs' }, el('button', { onclick: () => { state.folder = ''; draw() } }, spaceLabel(index.spaces.find(s => s.id === state.space))))
  let path = ''
  for (const part of state.folder === '' ? [] : state.folder.split('/')) {
    path = path === '' ? part : `${path}/${part}`
    const target = path
    crumbs.append(el('span', { text: '/' }), el('button', { onclick: () => { state.folder = target; draw() } }, part))
  }
  const newButton = el('button', { class: 'btn primary', onclick: () => menu(newButton, [
    { icon: 'upload', label: t('upload'), run: () => fileInput.click() },
    { icon: 'note', label: t('note'), run: writeNote },
    { icon: 'folder-plus', label: t('folder.new'), run: newFolder },
  ]) }, icon('plus'), t('new'))
  const bar = el('div', { class: 'bar' },
    el('h1', { text: t('title') }),
    el('div', { class: 'grow' }),
    embedded && el('a', { class: 'btn icon', href: './', target: '_blank', rel: 'noopener', title: t('openTab'), 'aria-label': t('openTab') }, icon('external')),
    el('button', { class: 'btn icon', title: t('devices'), 'aria-label': t('devices'), onclick: () => openDevices(app) }, icon('devices')),
    newButton)
  const tabs = el('div', { class: 'tabs', role: 'tablist' }, index.spaces.map(space => el('button', { class: 'tab', role: 'tab', 'aria-selected': String(space.id === state.space), onclick: () => { state.space = space.id; state.folder = ''; draw() } }, spaceLabel(space))))
  const main = el('main', {}, list, folders.length + items.length === 0 && el('div', { class: 'empty', text: state.folder === '' ? t('empty') : t('emptyFolder') }),
    el('div', { class: 'foot', text: t('version', { version: state.whoami.version }) }))
  clear(root)
  root.append(...[bar, tabs, state.folder !== '' && crumbs, main, fileInput, tray].filter(Boolean))
  drawTray()
}

function open(item) {
  state.openId = item.id
  openItem(app, item)
}

async function newFolder() {
  const name = await ask({ title: t('folder.new'), label: t('folder.name'), confirm: t('folder.create') })
  if (name === null) return
  const path = state.folder === '' ? name : `${state.folder}/${name}`
  await op('mkdir', { space: state.space, path })
  state.folder = path
  draw()
}

function writeNote() {
  const s = sheet({ title: t('note') })
  const title = el('input', { class: 'text', placeholder: t('note.title') })
  const text = el('textarea', { class: 'text', placeholder: t('note.placeholder') })
  s.body.append(title, text, el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: () => {
    if (text.value.trim() === '') return
    const name = `${(title.value.trim() || t('note.name', { when: new Date().toLocaleString() })).replace(/[/\\]/g, '-')}${/\.[a-z0-9]{1,5}$/i.test(title.value.trim()) ? '' : '.txt'}`
    s.close()
    sendFiles([new File([text.value], name, { type: 'text/plain', lastModified: Date.now() })], 'text')
  } }, t('note.send'))))
  setTimeout(() => text.focus(), 30)
}

// Uploads.

const tray = el('div', { class: 'tray', 'aria-live': 'polite' })

function sendFiles(files, kind = 'file') {
  const space = state.space
  const folder = state.folder
  for (const file of files) {
    if (file.size > state.index.limits.maxFileBytes) { toast(t('error.file-too-large', { max: bytes(state.index.limits.maxFileBytes) })); continue }
    const job = { name: file.name, sent: 0, total: file.size, status: 'sending', error: null, controller: new AbortController(), file, space, folder, kind }
    state.jobs.set(job, job)
    run(job)
  }
  drawTray()
}

async function run(job) {
  job.status = 'sending'
  job.error = null
  drawTray()
  try {
    await upload(state.device, job.file, { space: job.space, folder: job.folder, kind: job.kind, signal: job.controller.signal, onProgress: (sent, total) => { job.sent = sent; job.total = total; drawTray() } })
    job.status = 'done'
    drawTray()
    setTimeout(() => { state.jobs.delete(job); drawTray() }, 1500)
  } catch (error) {
    if (job.controller.signal.aborted) { state.jobs.delete(job); drawTray(); return }
    job.status = 'failed'
    job.error = errorText(error)
    drawTray()
  }
}

function drawTray() {
  clear(tray)
  const sending = new Set([...state.jobs.values()].map(job => job.name))
  for (const job of state.jobs.values()) {
    const percent = job.total === 0 ? 100 : Math.round((job.sent / job.total) * 100)
    tray.append(el('div', { class: `job${job.status === 'failed' ? ' failed' : ''}` },
      el('div', { class: 'top' },
        el('span', { class: 'label', text: job.status === 'done' ? t('upload.done', { name: job.name }) : job.status === 'failed' ? t('upload.failed', { name: job.name, error: job.error }) : `${t('upload.sending', { name: job.name })} · ${percent}%` }),
        job.status === 'failed' && el('button', { class: 'btn', onclick: () => { job.controller = new AbortController(); run(job) } }, t('upload.retry')),
        job.status !== 'done' && el('button', { class: 'btn icon', title: t('upload.cancel'), 'aria-label': t('upload.cancel'), onclick: () => { job.controller.abort(); state.jobs.delete(job); drawTray() } }, icon('x'))),
      el('div', { class: 'meter' }, el('i', { style: `width:${percent}%` }))))
  }
  // Unfinished uploads from an earlier visit: picking the same file again continues them.
  for (const upload of state.index?.uploads ?? []) {
    if (sending.size > 0) break
    tray.append(el('div', { class: 'job' },
      el('div', { class: 'top' },
        el('span', { class: 'label', text: t('upload.resume', { name: `${state.localUploads?.get(upload.id)?.name ?? ''} (${bytes(upload.size)})` }) }),
        el('button', { class: 'btn', onclick: () => { state.space = upload.space; state.folder = upload.folder; fileInput.click() } }, t('upload.pick')),
        el('button', { class: 'btn icon', title: t('upload.cancel'), 'aria-label': t('upload.cancel'), onclick: () => cancelUpload(state.device, upload.id).then(refresh) }, icon('x'))),
      el('div', { class: 'meter' }, el('i', { style: `width:${Math.round(((upload.parts - upload.missing.length) / upload.parts) * 100)}%` }))))
  }
}

// Dropping files anywhere on the page.
let dragDepth = 0
const dropHint = el('div', { class: 'drop', text: '' })
document.addEventListener('dragenter', (event) => {
  if (!state.index || !event.dataTransfer?.types.includes('Files')) return
  dragDepth++
  dropHint.textContent = t('dropHere')
  document.body.append(dropHint)
})
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropHint.remove() } })
document.addEventListener('dragover', (event) => { if (state.index) event.preventDefault() })
document.addEventListener('drop', (event) => {
  dragDepth = 0
  dropHint.remove()
  if (!state.index || !event.dataTransfer?.files.length) return
  event.preventDefault()
  sendFiles([...event.dataTransfer.files])
})
// Pasting a file or text into the page.
document.addEventListener('paste', (event) => {
  if (!state.index || document.querySelector('.sheet-wrap')) return
  const files = [...(event.clipboardData?.files ?? [])]
  if (files.length > 0) { event.preventDefault(); sendFiles(files) }
})

/** What the item and device views use. */
const app = {
  get device() { return state.device },
  get index() { return state.index },
  get previews() { return state.previews ?? [] },
  op,
  remember,
  senderName,
  spaceLabel,
  assistantName,
  closedItem: () => { state.openId = null },
  refresh,
  async moveItem(item) {
    const choices = state.index.spaces.flatMap(space => ['', ...(state.index.folders[space.id] ?? [])].map(folder => ({ space: space.id, folder, label: `${spaceLabel(space)}${folder ? ` / ${folder}` : ''}` })))
    return new Promise((done) => {
      const s = sheet({ title: t('moveTo'), small: true, onClose: () => done(null) })
      s.body.append(el('div', { class: 'devices' }, choices.map(choice => el('button', { class: 'btn', style: 'justify-content:flex-start', disabled: choice.space === item.space && choice.folder === item.folder, onclick: async () => {
        const next = await op('move', { id: item.id, space: choice.space, folder: choice.folder })
        s.close()
        done(next)
      } }, icon(choice.folder ? 'folder' : 'lock'), choice.label))))
    })
  },
}

boot().catch((error) => screen(t('title'), [el('p', { text: t('error', { error: error.message }) })]))
