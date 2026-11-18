/** The channel between the pages, the transfer engine and the service worker. */
export const BUS = 'sealed-files'
export const ENGINE = 'transfers.js'

/**
 * Start (or join) the transfer engine for this browser. A SharedWorker is one engine for every open page; without
 * SharedWorker only the top page starts a dedicated one, so a framed panel never makes a second.
 */
export function startEngine(appUrl) {
  const url = new URL(ENGINE, appUrl)
  if (typeof SharedWorker === 'function') return new SharedWorker(url, { type: 'module', name: BUS })
  if (globalThis.top === globalThis) return new Worker(url, { type: 'module', name: BUS })
  return null
}

/**
 * A channel to the engine that holds messages until the engine has answered once: a BroadcastChannel delivers only
 * to listeners already there, and the engine may still be starting.
 */
export function engineLink() {
  const channel = new BroadcastChannel(BUS)
  let ready = false
  const waiting = []
  const hello = () => { if (!ready) channel.postMessage({ type: 'hello' }) }
  channel.addEventListener('message', ({ data }) => {
    if (ready || data?.type !== 'state') return
    ready = true
    clearInterval(timer)
    for (const message of waiting.splice(0)) channel.postMessage(message)
  })
  const timer = setInterval(hello, 300)
  hello()
  return {
    channel,
    send(message) { if (ready) channel.postMessage(message); else waiting.push(message) },
    close() { clearInterval(timer); channel.close() },
  }
}
