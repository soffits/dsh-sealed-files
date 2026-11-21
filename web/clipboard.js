/**
 * The clipboard at the top of a space: a box to paste or type short text and
 * send it in one step, and the snippets that are there, each shown in full
 * with a copy button. A snippet's text arrives with the sealed index; sending
 * one is a single sealed call, so nothing here waits on the transfer engine.
 */
import { SNIPPET, SNIPPET_CHARS } from './protocol.js'
import { t, when } from './i18n.js'
import { confirmed, copyText, el, icon, toast } from './ui.js'

/** Snippets newest first. */
export const snippetsOf = (index, space) => index.items.filter(i => i.kind === SNIPPET && i.space === space).sort((a, b) => b.created - a.created)

export function createClipboard(app) {
  // Kept across redraws, so a change arriving while someone types never loses their text.
  const input = el('textarea', { class: 'text clip-input', rows: '1', placeholder: t('clip.placeholder'), 'aria-label': t('clip.title'), maxlength: String(SNIPPET_CHARS) })
  const send = el('button', { class: 'btn primary', disabled: true, onclick: () => submit() }, icon('send'), t('clip.send'))
  const expanded = new Set()
  let sending = false

  const fit = () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight + 2, 200)}px`
    send.disabled = sending || input.value.trim() === ''
  }
  input.addEventListener('input', fit)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() }
  })

  async function submit() {
    const text = input.value
    if (sending || text.trim() === '') return
    if (text.length > SNIPPET_CHARS) { toast(t('error.snippet-too-long', { max: SNIPPET_CHARS })); return }
    sending = true
    fit()
    try {
      await app.op('snippet.put', { space: app.space, text })
      input.value = ''
    } catch {
      // The toast says why; the text stays in the box.
    } finally {
      sending = false
      fit()
    }
  }

  function copy(item, button) {
    // Called straight from the tap, with the text already here: Safari allows clipboard writes only within the gesture.
    copyText(item.text).then(() => {
      button.replaceChildren(icon('check'), t('clip.copied'))
      setTimeout(() => button.replaceChildren(icon('copy'), t('clip.copy')), 1600)
    }, () => toast(t('clip.copyFailed')))
  }

  function row(item) {
    const long = item.text.length > 280 || item.text.split('\n').length > 4
    const open = expanded.has(item.id)
    const text = el('div', { class: `clip-text${long && !open ? ' clamped' : ''}`, text: item.text })
    const copyButton = el('button', { class: 'btn primary clip-copy', onclick: () => copy(item, copyButton) }, icon('copy'), t('clip.copy'))
    const facts = `${t('from', { name: app.senderName(item) })} · ${when(item.created)} · ${item.pinned ? t('kept') : t('expires', { when: when(item.expires) })}`
    return el('li', { class: 'clip-item', 'data-id': item.id },
      text,
      long && el('button', { class: 'link', onclick: () => { if (open) expanded.delete(item.id); else expanded.add(item.id); app.redraw() } }, open ? t('clip.less') : t('clip.more')),
      el('div', { class: 'clip-foot' },
        el('div', { class: 'sub', text: facts }),
        el('button', { class: `btn icon${item.pinned ? ' on' : ''}`, title: item.pinned ? t('unpin') : t('pin'), 'aria-label': item.pinned ? t('unpin') : t('pin'), 'aria-pressed': String(item.pinned), onclick: () => app.op('pin', { id: item.id, pinned: !item.pinned }) }, icon('pin')),
        el('button', { class: 'btn icon', title: t('delete'), 'aria-label': t('delete'), onclick: async () => { if (await confirmed(t('clip.confirmDelete'))) await app.op('remove', { id: item.id }) } }, icon('trash')),
        copyButton))
  }

  return {
    /** The section for this space, drawn from the index the page holds. */
    view(snippets) {
      for (const id of expanded) if (!snippets.some(s => s.id === id)) expanded.delete(id)
      const section = el('section', { class: 'clip', 'aria-label': t('clip.title') },
        el('div', { class: 'clip-head', text: t('clip.title') }),
        el('div', { class: 'clip-compose' }, input, send),
        snippets.length > 0 && el('ul', { class: 'clips' }, snippets.map(row)))
      requestAnimationFrame(fit)
      return section
    },
  }
}
