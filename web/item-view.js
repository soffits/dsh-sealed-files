/**
 * One item opened: its preview (decrypted by the service worker as it is
 * read, so a video seeks and a large file never sits in memory), what is
 * known about it, and what can be done with it.
 */
import { streamUrl } from './device.js'
import { typeOf } from './types.js'
import { bytes, dateTime, t, when } from './i18n.js'
import { ask, confirmed, copyText, el, icon, sheet, toast } from './ui.js'

/** Phones save through the share sheet (Save to Files, Save Image), which must open within the tap: small files are fetched as the item opens. */
const SHARE_LIMIT = 50 * 1024 * 1024
const phone = () => /iPhone|iPad|Android/.test(navigator.userAgent)
const canShare = () => phone() && typeof navigator.canShare === 'function'

export function openItem(app, item) {
  const s = sheet({ title: item.name, onClose: () => app.closedItem() })
  const view = el('div', { class: 'view' })
  const facts = el('div', { class: 'facts' })
  const actions = el('div', { class: 'actions' })
  s.body.append(view, facts, actions)

  const opened = app.prepare(item.id)
  let ready = null
  let failed = null
  if (canShare() && item.size <= SHARE_LIMIT) {
    opened.then(() => checked(streamUrl(item.id))).then(r => r.blob()).then((blob) => {
      const file = new File([blob], item.name, { type: typeOf(item.name, item.type) })
      if (navigator.canShare({ files: [file] })) ready = file
    }, (error) => { failed = error })
  }

  const render = (current) => {
    facts.replaceChildren(
      el('span', { text: bytes(current.size) }),
      el('span', { text: `${t('from', { name: app.senderName(current) })} · ${dateTime(current.created)}` }),
      el('span', { text: current.pinned ? t('kept') : t('expires', { when: when(current.expires) }) }))
    actions.replaceChildren(...[
      el('button', { class: 'btn primary', onclick: () => save(current) }, icon('download'), phone() ? t('save') : t('download')),
      current.kind === 'text' && el('button', { class: 'btn', onclick: () => copy(current) }, icon('copy'), t('copy')),
      el('button', { class: 'btn', onclick: () => app.op('pin', { id: current.id, pinned: !current.pinned }).then(render) }, icon('pin'), current.pinned ? t('unpin') : t('pin')),
      el('button', { class: 'btn', onclick: () => rename(current) }, icon('edit'), t('rename')),
      el('button', { class: 'btn', onclick: () => app.moveItem(current).then(next => next && render(next)) }, icon('move'), t('move')),
      el('button', { class: 'btn danger', onclick: () => remove(current) }, icon('trash'), t('delete')),
    ].filter(Boolean))
  }

  async function save(current) {
    try {
      await opened
    } catch (error) {
      toast(t('error', { error: error.message }))
      return
    }
    if (failed !== null && current.id === item.id) {
      toast(t('error', { error: failed.message }))
      return
    }
    if (ready !== null && current.id === item.id) {
      try {
        await navigator.share({ files: [ready] })
      } catch (error) {
        if (error.name !== 'AbortError') toast(t('error', { error: error.message }))
      }
      return
    }
    if (phone()) {
      // The browser's own download prompt: a navigation answered as an attachment leaves this page in place.
      location.assign(streamUrl(current.id, true))
      return
    }
    // A navigation inside the worker's scope, answered as an attachment: the browser's own downloader takes the stream.
    const frame = el('iframe', { src: streamUrl(current.id, true), hidden: true, title: current.name })
    document.body.append(frame)
    setTimeout(() => frame.remove(), 120_000)
  }

  function copy(current) {
    // The write starts within the tap and the text follows (see copyText), or Safari refuses it.
    const text = opened.then(() => checked(streamUrl(current.id))).then(r => r.text())
    copyText(text).then(() => toast(t('copied')), () => toast(t('clip.copyFailed')))
  }

  async function rename(current) {
    const name = await ask({ title: t('rename'), label: t('name'), value: current.name })
    if (name === null || name === current.name) return
    const next = await app.op('rename', { id: current.id, name })
    s.setTitle(next.name)
    render(next)
  }

  async function remove(current) {
    if (!(await confirmed(t('confirmDelete', { name: current.name })))) return
    await app.op('remove', { id: current.id })
    s.close()
  }

  render(item)
  opened.then(() => preview(app, item, view), error => view.replaceChildren(el('div', { class: 'hint', text: t('error', { error: error.message }) })))
  return s
}

/** A fetch of a stream URL that refuses an error answer instead of handing its text on as the file. */
async function checked(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error((await response.text().catch(() => '')) || `HTTP ${response.status}`)
  return response
}

const OFFICE = /\.(docx?|xlsx?|pptx?)$/i

function preview(app, item, view) {
  const url = streamUrl(item.id)
  const type = typeOf(item.name, item.type)
  if (item.kind === 'text' || type === 'text/plain' || type === 'text/markdown' || type === 'application/json' || type === 'text/csv') {
    const pre = el('pre', { text: item.preview ?? t('opening') })
    view.replaceChildren(pre)
    if (item.size < 5 * 1024 * 1024) checked(url).then(r => r.text()).then(text => { pre.textContent = text }, (error) => { pre.textContent = t('error', { error: error.message }) })
  } else if (/^image\/(png|jpeg|gif|webp|avif|heic|heif|bmp)$/.test(type)) {
    view.replaceChildren(el('img', { src: url, alt: item.name }))
  } else if (type.startsWith('video/')) {
    view.replaceChildren(el('video', { src: url, controls: true, playsinline: true, preload: 'metadata' }))
  } else if (type.startsWith('audio/')) {
    view.replaceChildren(el('audio', { src: url, controls: true, preload: 'metadata' }))
  } else if (type === 'application/pdf') {
    pdf(view, url)
  } else if (OFFICE.test(item.name) && app.previews.length > 0) {
    const button = el('button', { class: 'btn', onclick: async () => {
      button.disabled = true
      button.textContent = t('preview.making')
      try {
        const { id } = await app.op('preview', { id: item.id })
        await app.remember({ ...item, id, name: item.name.replace(/\.[^.]+$/, '.pdf'), type: 'application/pdf' })
        await app.prepare(id)
        pdf(view, streamUrl(id))
      } catch (error) {
        view.replaceChildren(el('div', { class: 'hint', text: t('error', { error: error.message }) }))
      }
    } }, t('preview.office'))
    view.replaceChildren(el('div', { class: 'hint' }, button))
  } else {
    view.replaceChildren(el('div', { class: 'hint', text: t('preview.none') }))
  }
}

function pdf(view, url) {
  view.replaceChildren(el('iframe', { src: url, title: 'PDF' }),
    el('div', { class: 'actions', style: 'padding:8px' }, el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon('external'), t('openFull'))))
}
