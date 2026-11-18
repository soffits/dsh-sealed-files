/**
 * The page's words, one table per locale/<tag>.json (served together as
 * locales.json), in the shell's language when framed, else the browser's.
 * English is the fallback for anything a table lacks.
 */
let tables = {}
let tag = 'en'

function shellLanguage() {
  try {
    if (window.parent !== window) return window.parent.document.documentElement.lang || ''
  } catch { /* not same-origin */ }
  return ''
}

export async function loadWords() {
  tables = await fetch('./locales.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({}))
  const wanted = [shellLanguage(), ...(navigator.languages ?? [navigator.language])].filter(Boolean).map(l => l.toLowerCase())
  for (const want of wanted) {
    const match = Object.keys(tables).find(t => t === want) ?? Object.keys(tables).find(t => t === want.split('-')[0])
    if (match) { tag = match; break }
  }
  document.documentElement.lang = tag
}

export const language = () => tag

/** The text for `key` with {name} slots filled. */
export function t(key, vars = {}) {
  const text = tables[tag]?.[key] ?? tables.en?.[key] ?? key
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`))
}

export function bytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 }).format(value)} ${units[unit]}`
}

/** "3 days ago", "in 29 days", by the nearest sensible unit. */
export function when(at, now = Date.now()) {
  const format = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })
  const seconds = (at - now) / 1000
  const steps = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', Infinity]]
  let value = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit)
    value /= size
  }
  return ''
}

export const dateTime = at => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
