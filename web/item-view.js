/**
 * One item opened: its preview (decrypted by the service worker as it is
 * read, so a video seeks and a large file never sits in memory), what is
 * known about it, and what can be done with it.
 */
import { streamUrl } from './device.js'
import { bytes, dateTime, t, when } from './i18n.js'
import { ask, confirmed, el, icon, sheet, toast } from './ui.js'

const SHARE_LIMIT = 200 * 1024 * 1024
const canShare = () => typeof navigator.canShare === 'function' && /iPhone|iPad|Android/.test(navigator.userAgent)

export function openItem(app, item) {
  const s = sheet({ title: item.name, onClose: () => app.closedItem() })
  const view = el('div', { class: 'view' })
  const facts = el('div', { class: 'facts' })
  const actions = el('div', { class: 'actions' })
  s.body.append(view, facts, actions)

  const render = (current) => {
    facts.replaceChildren(
      el('span', { text: bytes(current.size) }),
      el('span', { text: `${t('from', { name: app.senderName(current) })} · ${dateTime(current.created)}` }),
      el('span', { text: current.pinned ? t('kept') : t('expires', { when: when(current.expires) }) }))
    actions.replaceChildren(...[
      el('button', { class: 'btn primary', onclick: () => save(current) }, icon('download'), canShare() ? t('save') : t('download')),
      current.kind === 'text' && el('button', { class: 'btn', onclick: () => copy(current) }, icon('copy'), t('copy')),
      el('button', { class: 'btn', onclick: () => app.op('pin', { id: current.id, pinned: !current.pinned }).then(render) }, icon('pin'), current.pinned ? t('unpin') : t('pin')),
      el('button', { class: 'btn', onclick: () => rename(current) }, icon('edit'), t('rename')),
      el('button', { class: 'btn', onclick: () => app.moveItem(current).then(next => next && render(next)) }, icon('move'), t('move')),
      el('button', { class: 'btn danger', onclick: () => remove(current) }, icon('trash'), t('delete')),
    ].filter(Boolean))
  }

  async function save(current) {
    if (canShare() && current.size <= SHARE_LIMIT) {
      try {
        const blob = await fetch(streamUrl(current.id)).then(r => r.blob())
        const file = new File([blob], current.name, { type: current.type.split(';')[0] })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] })
          return
        }
      } catch (error) {
        if (error.name === 'AbortError') return
      }
    }
    // A navigation inside the worker's scope, answered as an attachment: the browser's own downloader takes the stream.
    const frame = el('iframe', { src: streamUrl(current.id, true), hidden: true, title: current.name })
    document.body.append(frame)
    setTimeout(() => frame.remove(), 120_000)
  }

  async function copy(current) {
    const text = await fetch(streamUrl(current.id)).then(r => r.text())
    await navigator.clipboard.writeText(text)
    toast(t('copied'))
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
  preview(app, item, view)
  return s
}

const OFFICE = /\.(docx?|xlsx?|pptx?)$/i

function preview(app, item, view) {
  const url = streamUrl(item.id)
  const type = item.type.split(';')[0]
  if (item.kind === 'text' || type === 'text/plain' || type === 'text/markdown' || type === 'application/json' || type === 'text/csv') {
    const pre = el('pre', { text: item.preview ?? t('opening') })
    view.replaceChildren(pre)
    if (item.size < 5 * 1024 * 1024) fetch(url).then(r => r.text()).then(text => { pre.textContent = text }, () => {})
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
