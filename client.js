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

    function SidebarIcon({ size }) {
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
            disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 13, locale: NS, label: () => t('panel') }, SidebarIcon)))
          }).catch(error => console.warn('[sealed-files] words: %s', error.message))
          return () => {
            live = false
            for (const dispose of disposers.reverse()) dispose()
          }
        }, 'sealed-files: entries')

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
