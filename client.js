/*
 * Browser half of dsh-sealed-files inside the DSH shell: the sidebar entry
 * and a page in the main column that frames the app at /sealed-files/app/.
 *
 * The app is its own document on purpose: its service worker decrypts files
 * for video, audio, pictures and downloads, and a service worker serves only
 * pages inside its scope. It also runs under its own strict content policy,
 * and the same bundle can run from a browser extension. The frame follows the
 * shell's theme and language (web/theme.js reads them from here).
 *
 * A link with ?sealed-files=<id> opens the page on that item.
 */
window.__ModuleLoader__.load({
  id: '@soffits/dsh-sealed-files',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-sealed-files'
    const PANEL = 'dsh-sealed-files'
    const LINK_PARAM = 'sealed-files'
    const app = new URL('sealed-files/app/', document.baseURI).href
    const api = path => new URL(`api/sealed-files/${path}`, document.baseURI).href
    const STYLE_ID = 'dsh-sealed-files-style'
    const CSS = '.sealed-files-icon{position:relative;display:inline-flex}.sealed-files-ring{position:absolute;left:-3.5px;top:-3.5px;pointer-events:none}.sealed-files-badge{position:absolute;top:-5px;right:-8px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:7px;background:var(--dsw-alias-state-error-primary);color:#fff;font-size:9px;font-weight:600;line-height:14px;text-align:center;pointer-events:none}'

    /** How many of the signed-in person's devices wait for approval: the sidebar badge, followed live. */
    const waiting = { count: 0, listeners: new Set() }
    const setWaiting = (count) => {
      if (count === waiting.count) return
      waiting.count = count
      for (const listener of waiting.listeners) listener()
    }
    const subscribeWaiting = (listener) => { waiting.listeners.add(listener); return () => waiting.listeners.delete(listener) }

    /** Transfers in progress (from the card): a ring around the icon while files move. */
    const moving = { active: false, fraction: 0 }
    const setMoving = (next) => {
      if (next.active === moving.active && Math.abs(next.fraction - moving.fraction) < 0.01) return
      Object.assign(moving, next)
      for (const listener of waiting.listeners) listener()
    }

    function SidebarIcon({ size }) {
      const count = React.useSyncExternalStore(subscribeWaiting, () => waiting.count)
      const fraction = React.useSyncExternalStore(subscribeWaiting, () => (moving.active ? moving.fraction : -1))
      const r = size / 2 + 2.5
      const ring = fraction >= 0 && h('svg', { className: 'sealed-files-ring', width: size + 7, height: size + 7, viewBox: `0 0 ${size + 7} ${size + 7}`, 'aria-hidden': true },
        h('circle', { cx: (size + 7) / 2, cy: (size + 7) / 2, r, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.18, strokeWidth: 1.6 }),
        h('circle', { cx: (size + 7) / 2, cy: (size + 7) / 2, r, fill: 'none', stroke: 'var(--dsw-alias-state-business-primary, #4d6bfe)', strokeWidth: 1.6, strokeLinecap: 'round',
          strokeDasharray: `${Math.max(0.02, fraction) * 2 * Math.PI * r} ${2 * Math.PI * r}`, transform: `rotate(-90 ${(size + 7) / 2} ${(size + 7) / 2})` }))
      return h('span', { className: 'sealed-files-icon' }, h(FolderGlyph, { size }), ring,
        count > 0 && h('span', { className: 'sealed-files-badge', 'aria-label': String(count) }, count > 9 ? '9+' : String(count)))
    }

    function FolderGlyph({ size }) {
      const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M1.75 4.25c0-.69.56-1.25 1.25-1.25h3l1.3 1.5H13c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25v-8Z', ...stroke }),
        h('rect', { x: 6.2, y: 8.1, width: 3.6, height: 2.9, rx: 0.6, ...stroke }),
        h('path', { d: 'M6.9 8.1V7.3a1.1 1.1 0 0 1 2.2 0v.8', ...stroke }))
    }

    /** An item asked for by the page's URL, taken once and handed to the frame in its fragment. */
    let linked = null
    function takeLink() {
      const params = new URLSearchParams(location.search)
      const id = params.get(LINK_PARAM)
      if (id === null) return
      linked = /^[a-z2-7]{16,32}$/.test(id) ? id : null
      params.delete(LINK_PARAM)
      const query = params.toString()
      history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
    }

    function SealedFilesPage() {
      const [src] = React.useState(() => {
        const id = linked
        linked = null
        return `${app}#embedded${id ? `&item=${id}` : ''}`
      })
      return h('div', { style: { display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0 } },
        h('iframe', { src, title: 'Sealed Files', allow: 'clipboard-write; fullscreen', style: { flex: 1, border: 0, width: '100%', height: '100%', background: 'transparent' } }))
    }

    /**
     * The transfer engine and its card on every page of the app: uploads go on while the person moves around DSH.
     * The card, the engine and the panel share modules the plugin serves under /sealed-files/app/.
     */
    function mountTransfers(t) {
      let card = null
      let live = true
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `${app}card.css`
      document.head.appendChild(link)
      const beforeUnload = (event) => {
        if (!card?.wouldLose()) return
        event.preventDefault()
        event.returnValue = t('card.leave')
      }
      window.addEventListener('beforeunload', beforeUnload)
      Promise.all([import(`${app}bus.js`), import(`${app}card.js`), import(`${app}i18n.js`)]).then(([bus, cards, words]) => {
        if (!live) return
        bus.startEngine(app)
        card = cards.mountCard({
          t: (key, vars = {}) => String(t(key)).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`)),
          bytes: words.bytes,
          onChange: setMoving,
          onPick(job) {
            const input = document.createElement('input')
            input.type = 'file'
            input.addEventListener('change', () => {
              if (input.files.length > 0) card.send({ type: 'enqueue', files: [...input.files], space: job.space, folder: job.folder, kind: job.kind })
            }, { once: true })
            input.click()
          },
        })
      }, error => console.warn('[sealed-files] transfers: %s', error.message))
      return () => {
        live = false
        window.removeEventListener('beforeunload', beforeUnload)
        card?.dispose()
        link.remove()
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        // The words register first, so neither the entry nor the page ever shows a bare key.
        ctx.effect(() => {
          let live = true
          const disposers = []
          fetch(`${app}locales.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((words) => {
            if (!live) return
            disposers.push(ctx.locale.register(NS, words))
            disposers.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, SealedFilesPage)))
            disposers.push(mountTransfers(t))
            disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 13, locale: NS, label: () => t('panel') }, SidebarIcon)))
          }).catch(error => console.warn('[sealed-files] words: %s', error.message))
          return () => {
            live = false
            for (const dispose of disposers.reverse()) dispose()
          }
        }, 'sealed-files: entries')

        ctx.effect(() => {
          if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return () => {}
          const tag = document.createElement('style')
          tag.id = STYLE_ID
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'sealed-files: styles')

        // The badge: read once, then again whenever the plugin's change stream says this person's devices changed.
        ctx.effect(() => {
          if (typeof EventSource !== 'function') return () => {}
          const read = () => fetch(api('waiting'), { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : { count: 0 })).then(body => setWaiting(body.count ?? 0), () => {})
          const source = new EventSource(api('events'), { withCredentials: true })
          source.onopen = read
          source.onmessage = (event) => { try { if (JSON.parse(event.data).devices) read() } catch { /* a beat */ } }
          return () => source.close()
        }, 'sealed-files: waiting devices')

        ctx.effect(() => {
          takeLink()
          if (linked === null) return () => {}
          let tries = 0
          const timer = setInterval(() => {
            const layout = ctx.get('layout')
            try {
              layout?.selectPanel(PANEL)
              if (layout) clearInterval(timer)
            } catch {
              // The main slot entry is not registered yet.
            }
            if (++tries > 50) clearInterval(timer)
          }, 100)
          return () => clearInterval(timer)
        }, 'sealed-files: link')
      },
    }
  },
})
