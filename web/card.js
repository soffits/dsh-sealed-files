/**
 * The transfers card: a small card in the corner of every page while files
 * move, like a cloud drive's. A header with what is happening and the time
 * left, one row per file (name, bar, cancel, continue), collapsible to the
 * header, lingering a few seconds after the last one ends. On phone widths it
 * is a strip above the bottom of the screen. Fed by the engine and the
 * service worker over the bus; `onPick(job)` asks the page to pick a file
 * again (resuming where the browser can't keep a file handle).
 */
import { engineLink } from './bus.js'

const LINGER = 6000

export function mountCard({ doc = document, t, bytes, onPick, onChange = () => {} }) {
  const link = engineLink()
  const bus = link.channel
  let uploads = []
  const downloads = new Map()
  /** The person's own choice; until they make one, phones show only the header unless something needs them. */
  let chosen = null
  const narrow = matchMedia('(max-width: 640px)')
  let dismissedAt = 0

  const node = doc.createElement('section')
  node.className = 'sfc'
  node.setAttribute('aria-live', 'polite')
  node.hidden = true
  doc.body.append(node)

  const make = (tag, cls, text) => {
    const e = doc.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }
  const button = (cls, label, run, text) => {
    const b = make('button', cls, text ?? '')
    b.type = 'button'
    b.title = label
    b.setAttribute('aria-label', label)
    b.addEventListener('click', run)
    return b
  }

  function jobs() {
    const now = Date.now()
    for (const [key, job] of downloads) if (job.done && now - job.done > LINGER) downloads.delete(key)
    return [...uploads, ...downloads.values()]
  }

  function remaining(list) {
    let left = 0
    let rate = 0
    for (const job of list) {
      if (job.status !== 'sending' || !job.startedAt) continue
      const elapsed = (Date.now() - job.startedAt) / 1000
      const moved = job.sent - (job.sentAtStart ?? 0)
      if (elapsed > 2 && moved > 0) rate += moved / elapsed
      left += job.size - job.sent
    }
    return rate > 0 ? left / rate : null
  }

  const minutes = seconds => (seconds < 60 ? t('card.lessMinute') : t('card.minutes', { n: Math.ceil(seconds / 60) }))

  function header(list) {
    const sending = list.filter(j => j.status === 'sending' || j.status === 'queued')
    const ups = sending.filter(j => j.kind !== 'download')
    const downs = sending.filter(j => j.kind === 'download')
    if (ups.length > 0) {
      const left = remaining(ups)
      return t('card.uploading', { n: ups.length }) + (left === null ? '' : ` · ${t('card.left', { time: minutes(left) })}`)
    }
    if (downs.length > 0) return t('card.downloading', { n: downs.length })
    if (list.some(j => j.status === 'paused')) return t('card.paused', { n: list.filter(j => j.status === 'paused').length })
    if (list.some(j => j.status === 'failed')) return t('card.failed')
    return t('card.done', { n: list.length })
  }

  function rowStatus(job) {
    const percent = job.size === 0 ? 100 : Math.floor((job.sent / job.size) * 100)
    if (job.status === 'done') return job.kind === 'download' ? t('card.downloaded') : t('card.sent')
    if (job.status === 'failed') return t('card.rowFailed', { error: job.error ?? '' })
    if (job.status === 'paused') return job.resumable ? t('card.pausedHandle', { percent }) : t('card.pausedPick', { percent })
    if (job.status === 'queued') return t('card.waiting')
    return `${percent}% · ${bytes(job.sent)} / ${bytes(job.size)}`
  }

  function draw() {
    const list = jobs()
    const active = list.some(j => j.status === 'sending' || j.status === 'queued')
    if (list.length === 0 || (!active && dismissedAt > Math.max(...list.map(j => j.done ?? Date.now())))) {
      node.hidden = true
      onChange({ active: false, fraction: 0 })
      return
    }
    node.hidden = false
    node.replaceChildren()
    const collapsed = chosen ?? (narrow.matches && !list.some(j => j.status === 'paused' || j.status === 'failed'))
    const toggle = () => { chosen = !collapsed; draw() }
    const head = make('div', 'sfc-head')
    const title = make('button', 'sfc-title', header(list))
    title.type = 'button'
    title.setAttribute('aria-expanded', String(!collapsed))
    title.addEventListener('click', toggle)
    head.append(title, button('sfc-icon', collapsed ? t('card.expand') : t('card.collapse'), toggle, collapsed ? '▴' : '▾'))
    if (!active) head.append(button('sfc-icon', t('card.dismiss'), () => { dismissedAt = Date.now(); draw() }, '✕'))
    node.append(head)
    if (!collapsed) {
      const rows = make('ul', 'sfc-rows')
      for (const job of list) {
        const row = make('li', `sfc-row sfc-${job.status}`)
        const what = make('div', 'sfc-what')
        what.append(make('div', 'sfc-name', job.name), make('div', 'sfc-sub', rowStatus(job)))
        const bar = make('div', 'sfc-bar')
        const fill = make('i')
        fill.style.width = `${job.size === 0 ? 100 : Math.min(100, (job.sent / job.size) * 100)}%`
        bar.append(fill)
        what.append(bar)
        row.append(what)
        if (job.kind !== 'download') {
          if (job.status === 'paused' && job.resumable) row.append(button('sfc-btn', t('card.continue'), () => resume(job), t('card.continue')))
          if (job.status === 'paused' && !job.resumable) row.append(button('sfc-btn', t('upload.pick'), () => onPick(job), t('upload.pick')))
          if (job.status === 'failed') row.append(button('sfc-btn', t('upload.retry'), () => link.send({ type: 'resume', key: job.key }), t('upload.retry')))
          if (job.status !== 'done') row.append(button('sfc-icon', t('upload.cancel'), () => link.send({ type: 'cancel', key: job.key }), '✕'))
        }
        rows.append(row)
      }
      node.append(rows)
    }
    const moving = list.filter(j => j.status === 'sending' && j.size > 0)
    const total = moving.reduce((n, j) => n + j.size, 0)
    onChange({ active, fraction: total === 0 ? 0 : moving.reduce((n, j) => n + j.sent, 0) / total })
  }

  /** Asking to read the file again needs this page and a press, so it happens here, not in the engine. */
  async function resume(job) {
    const record = await new Promise((done) => {
      const request = indexedDB.open('sealed-files', 1)
      request.onsuccess = () => {
        const get = request.result.transaction('uploads').objectStore('uploads').get(job.key)
        get.onsuccess = () => done(get.result)
        get.onerror = () => done(null)
      }
      request.onerror = () => done(null)
    })
    if (record?.handle && (await record.handle.requestPermission({ mode: 'read' })) === 'granted') link.send({ type: 'resume', key: job.key })
  }

  bus.onmessage = ({ data }) => {
    if (data?.type === 'state') uploads = data.jobs
    else if (data?.type === 'download') downloads.set(data.job.key, data.job)
    else return
    draw()
    if (jobs().some(j => j.done)) setTimeout(draw, LINGER + 100)
  }
  const tick = setInterval(() => { if (jobs().some(j => j.status === 'sending')) draw() }, 5000)

  return {
    /** Whether leaving the page now would stop an upload that can't pick itself up again. */
    wouldLose: () => uploads.some(j => (j.status === 'sending' || j.status === 'queued') && !j.resumable),
    send: message => link.send(message),
    dispose() { clearInterval(tick); link.close(); node.remove() },
  }
}
