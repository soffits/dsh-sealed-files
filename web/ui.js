/** Small DOM helpers: elements, icons (Lucide shapes, ISC), sheets, menus, prompts and toasts. */
import { t } from './i18n.js'

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    // Through the CSSOM: the page's policy refuses style attributes.
    else if (key === 'style') node.style.cssText = value
    else if (value === true) node.setAttribute(key, '')
    else node.setAttribute(key, value)
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child))
  return node
}

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  folder: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z',
  file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Zm-1 0v5h6',
  text: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Zm-1 0v5h6M16 13H8M16 17H8M10 9H8',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12 4-3.09-3.09a2 2 0 0 0-2.82 0L6 21',
  video: 'm16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  audio: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  pdf: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Zm-1 0v5h6M9 15h6M9 18h4',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  note: 'M12 20h9M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86Z',
  'folder-plus': 'M12 10v6M9 13h6M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  devices: 'M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8M10 19v-3.96M7 19h5M18 12h4a0 0 0 0 1 0 0v8a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  x: 'M18 6 6 18M6 6l12 12',
  pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  trash: 'M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
  edit: 'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z',
  move: 'M5 12h14M12 5l7 7-7 7',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm2 0V7a5 5 0 0 1 10 0v4',
  back: 'm15 18-6-6 6-6',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', PATHS[name] ?? PATHS.file)
  svg.append(path)
  return svg
}

export const iconFor = item => (item.kind === 'text' ? 'text'
  : /^image\//.test(item.type) ? 'image'
    : /^video\//.test(item.type) ? 'video'
      : /^audio\//.test(item.type) ? 'audio'
        : /pdf$/.test(item.type) ? 'pdf'
          : /zip|tar|compressed|7z|rar/.test(item.type) ? 'archive' : 'file')

/** A modal sheet (bottom sheet on phones, dialog on wide screens). Returns { body, close }. */
export function sheet({ title, small = false, onClose }) {
  const body = el('div', { class: 'body' })
  const wrap = el('div', { class: 'sheet-wrap', role: 'presentation' })
  const close = () => {
    wrap.remove()
    document.removeEventListener('keydown', onKey)
    onClose?.()
  }
  const onKey = event => { if (event.key === 'Escape') close() }
  const heading = el('h2', { text: title })
  const panel = el('div', { class: `sheet${small ? ' small' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('header', {}, heading, el('button', { class: 'btn icon', 'aria-label': t('close'), title: t('close'), onclick: close }, icon('x'))),
    body)
  wrap.append(panel)
  wrap.addEventListener('click', event => { if (event.target === wrap) close() })
  document.addEventListener('keydown', onKey)
  document.body.append(wrap)
  return { body, close, setTitle: text => { heading.textContent = text } }
}

/** A menu under `anchor`: items `{ icon, label, run }`. */
export function menu(anchor, items) {
  document.querySelector('.menu')?.remove()
  const box = el('div', { class: 'menu', role: 'menu' }, items.map(item => el('button', { role: 'menuitem', onclick: () => { box.remove(); item.run() } }, icon(item.icon), item.label)))
  document.body.append(box)
  const rect = anchor.getBoundingClientRect()
  const width = box.offsetWidth
  box.style.top = `${rect.bottom + 6}px`
  box.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`
  setTimeout(() => document.addEventListener('click', function away(event) {
    if (!box.contains(event.target)) { box.remove(); document.removeEventListener('click', away) }
  }), 0)
  box.querySelector('button')?.focus()
}

/** Ask for one line of text. Resolves with it, or null. */
export function ask({ title, label, value = '', confirm = t('ok') }) {
  return new Promise((done) => {
    let answered = false
    const s = sheet({ title, small: true, onClose: () => { if (!answered) done(null) } })
    const input = el('input', { class: 'text', value, enterkeyhint: 'done' })
    const submit = () => {
      const text = input.value.trim()
      if (text === '') return
      answered = true
      s.close()
      done(text)
    }
    input.addEventListener('keydown', event => { if (event.key === 'Enter') submit() })
    s.body.append(el('label', { class: 'field' }, label, input), el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: submit }, confirm)))
    setTimeout(() => { input.focus(); input.select() }, 30)
  })
}

/** Ask yes or no. */
export function confirmed(text, yes = t('delete')) {
  return new Promise((done) => {
    let answered = false
    const s = sheet({ title: text, small: true, onClose: () => { if (!answered) done(false) } })
    s.body.append(el('div', { class: 'actions' },
      el('button', { class: 'btn danger', onclick: () => { answered = true; s.close(); done(true) } }, yes),
      el('button', { class: 'btn', onclick: () => s.close() }, t('cancel'))))
  })
}

export function toast(text) {
  document.querySelector('.toast')?.remove()
  const node = el('div', { class: 'toast', role: 'status', text })
  document.body.append(node)
  setTimeout(() => node.remove(), 2600)
}

export function clear(node) { while (node.firstChild) node.firstChild.remove() }
