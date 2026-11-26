/**
 * Sealed Files in a real DSH with the plugin linked in, driven through
 * Chromium: a phone-sized device is added (pairing code, approval), sends a
 * file that is cut off by a reload and resumed, a part lost on the network and
 * retried, a video that plays and seeks, a picture and a note; the file comes
 * back byte for byte as a download; a desktop device is added and approved
 * from the first; a note the assistant puts in shows on both without a
 * reload; a clipboard snippet sent from the phone shows in full on the desktop
 * and copies in one tap, and one from the assistant reaches both. Every
 * request is recorded, and no file name, note or snippet text may appear in
 * any of them.
 *
 * Boots a throwaway DSH home; never point it at a DSH home people use.
 * Env: CHROME_PATH (default `chromium` on PATH), SCREENSHOT_DIR (optional).
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, request as httpRequest } from 'node:http'
import { chromium } from 'playwright-core'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shots = process.env.SCREENSHOT_DIR
const sleep = ms => new Promise(done => setTimeout(done, ms))
const log = (...args) => console.log('·', ...args)
const sha = buffer => createHash('sha256').update(buffer).digest('hex')

async function bootDsh(root) {
  const notices = join(root, 'notices.jsonl')
  writeFileSync(join(root, 'notify.mjs'), `import { appendFileSync } from 'node:fs'\nlet d = ''\nprocess.stdin.on('data', c => { d += c })\nprocess.stdin.on('end', () => appendFileSync(${JSON.stringify(notices)}, d))\n`)
  const env = { ...process.env, DSH_HOME: join(root, 'home'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'sk-placeholder', SEALED_FILES_ASSISTANT: join(repo, 'src/assistant.js') }
  execFileSync('dsh', ['plugin', '--profile', 'web', 'add', `link:${repo}`], { env, cwd: root, stdio: 'ignore' })
  execFileSync('dsh', ['plugin', '--profile', 'web', 'add', `link:${join(repo, 'test/fixtures/test-identity')}`], { env, cwd: root, stdio: 'ignore' })
  writeFileSync(join(env.DSH_HOME, 'profiles/web/cordis.patch.yml'), JSON.stringify([{ id: 'sealed-files', config: { stateDir: join(root, 'state'), people: { tester: 'Tester' }, notifyCommand: [process.execPath, join(root, 'notify.mjs')], assistantName: 'Helper', maxFileGb: 1, maxStoreGb: 2, minFreeGb: 0 } }]))
  const port = 40000 + Math.floor(Math.random() * 20000)
  const child = spawn('dsh', ['--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let output = ''
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`DSH did not start in 120 s:\n${output.slice(-2000)}`)), 120_000)
    const read = (chunk) => {
      output += chunk
      const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(output)
      if (match) { clearTimeout(timer); done(match[1]) }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
  })
  return { url, notices, output: () => output, stop: () => { try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ } } }
}

function makeVideo(path, seconds) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=25:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '3M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path])
}

/**
 * A proxy in front of DSH for one browser, so the test can drop any request on the way, also those a worker
 * makes (which the browser automation can't intercept). `hook(url)` returns 'drop' to cut the connection.
 */
async function interruptingProxy(target) {
  const to = new URL(target)
  const seen = []
  let hook = () => 'pass'
  const server = createServer((req, res) => {
    seen.push(req.url)
    if (hook(req.url) === 'drop') { req.socket.destroy(); return }
    const headers = { ...req.headers, host: to.host }
    if (headers.origin) headers.origin = to.origin
    const upstream = httpRequest({ host: to.hostname, port: to.port, path: req.url, method: req.method, headers }, (answer) => {
      const out = { ...answer.headers }
      if (out['content-security-policy']) out['content-security-policy'] = out['content-security-policy'].replaceAll(to.host, `127.0.0.1:${server.address().port}`)
      res.writeHead(answer.statusCode, out)
      answer.pipe(res)
    })
    upstream.on('error', () => res.destroy())
    req.pipe(upstream)
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return { origin: `http://127.0.0.1:${server.address().port}`, seen, setHook: (fn) => { hook = fn }, close: () => server.close() }
}

async function device(browser, signIn, options) {
  const context = await browser.newContext({ acceptDownloads: true, ...options })
  const page = await context.newPage()
  const requests = []
  page.on('request', request => requests.push({ url: request.url(), body: request.postDataBuffer() }))
  context.on('serviceworker', worker => log('service worker', worker.url()))
  page.on('pageerror', error => log('page error:', error.message))
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_RESET/.test(message.text())) log('console:', message.text()) })
  await page.goto(signIn)
  await page.waitForLoadState('networkidle').catch(() => {})
  return { context, page, requests }
}

const frameOf = page => page.frameLocator('iframe[title="Sealed Files"]')

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'sealed-dsh-'))
  const files = join(root, 'files')
  mkdirSync(files)
  const big = join(files, 'holiday-archive.bin')
  writeFileSync(big, randomBytes(20 * 1024 * 1024 + 4321))
  const video = join(files, 'beach-walk.mp4')
  makeVideo(video, 40)
  const picture = join(files, 'boarding-pass.png')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=800x500', '-frames:v', '1', picture])
  const dsh = await bootDsh(root)
  const origin = new URL(dsh.url).origin
  const app = `${origin}/sealed-files/app/`
  log('DSH at', origin)
  let proxy = null
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'chromium', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  try {
    // A phone: add it.
    const phone = await device(browser, dsh.url, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    let p = phone.page
    await p.goto(app)
    await p.getByRole('button', { name: 'Add this device' }).click()
    const code = (await p.locator('.code').textContent()).trim()
    await sleep(500)
    const notice = readFileSync(dsh.notices, 'utf8').trim().split('\n').map(JSON.parse).at(-1)
    assert.equal(notice.code, code, 'the pairing code sent to the person matches the screen')
    assert.equal(notice.person, 'tester')
    if (shots) await p.screenshot({ path: join(shots, 'phone-pairing.png') })
    await p.evaluate(id => fetch('/api/sealed-files-test/approve', { method: 'POST', body: JSON.stringify({ id }) }), notice.device.id)
    await p.getByRole('button', { name: 'New' }).waitFor({ timeout: 10_000 })
    log('phone added and approved; the page moved on by itself')
    // Only AES-GCM keys are stored: WebKit loses a stored non-extractable X25519 key on the next read.
    const stored = await p.evaluate(() => new Promise((done) => {
      const request = indexedDB.open('sealed-files', 1)
      request.onsuccess = () => {
        const get = request.result.transaction('device').objectStore('device').get('self')
        get.onsuccess = () => done(Object.values(get.result).filter(v => v instanceof CryptoKey).map(k => k.algorithm.name))
      }
    }))
    assert.deepEqual(stored, ['AES-GCM'], `stored keys: ${stored}`)

    // A large file: cut off by a reload after the first part, then resumed.
    // Uploads run in the transfer engine (a worker), so the phone goes through a proxy that can cut them.
    proxy = await interruptingProxy(origin)
    const partOf = url => (url.includes('/api/sealed-files/part?') ? Number(new URL(url, proxy.origin).searchParams.get('n')) : null)
    let cut = 0
    let firstLanded = false
    proxy.setHook((url) => {
      const n = partOf(url)
      if (n === null) return 'pass'
      if (n === 0) { setTimeout(() => { firstLanded = true }, 300); return 'pass' }
      cut++
      return 'drop'
    })
    await p.goto(`${proxy.origin}/sealed-files/app/`)
    await p.getByRole('button', { name: 'Add this device' }).click()
    let proxyDeviceId = notice.device.id
    while (proxyDeviceId === notice.device.id) {
      await sleep(200)
      proxyDeviceId = readFileSync(dsh.notices, 'utf8').trim().split('\n').map(JSON.parse).at(-1).device.id
    }
    await p.evaluate(id => fetch('/api/sealed-files-test/approve', { method: 'POST', body: JSON.stringify({ id }) }), proxyDeviceId)
    await p.getByRole('button', { name: 'New' }).waitFor({ timeout: 10_000 })
    await p.locator('input[type=file]').setInputFiles(big)
    while (!firstLanded || cut < 2) await sleep(100)
    // The tab is closed and opened again: the engine goes with its last page, the sent parts stay on the host.
    await p.close()
    proxy.setHook(() => 'pass')
    p = await phone.context.newPage()
    p.on('pageerror', error => log('page error:', error.message))
    await p.goto(`${proxy.origin}/sealed-files/app/`)
    const row = p.locator('.sfc-row', { hasText: 'holiday-archive.bin' })
    await row.waitFor({ timeout: 20_000 })
    if (shots) await p.screenshot({ path: join(shots, 'phone-unfinished.png') })
    let dropped = false
    proxy.setHook((url) => {
      if (partOf(url) === 2 && !dropped) { dropped = true; return 'drop' }
      return 'pass'
    })
    // An engine that outlived the tab carries on by itself; one that went with it shows the upload paused.
    if (await row.evaluate(node => node.classList.contains('sfc-paused'))) await p.locator('input[type=file]').setInputFiles(big)
    await p.locator('.row', { hasText: 'holiday-archive.bin' }).waitFor({ timeout: 90_000 })
    const resumed = proxy.seen.map(partOf).filter(n => n !== null)
    assert.equal(resumed.filter(n => n === 0).length, 1, `part 0 went up once (${resumed})`)
    log('resumed after the tab was closed, sent', resumed)

    // A video and a picture, then a note.
    await p.locator('input[type=file]').setInputFiles([video, picture])
    await p.locator('.row', { hasText: 'beach-walk.mp4' }).waitFor({ timeout: 60_000 })
    await p.locator('.row', { hasText: 'boarding-pass.png' }).waitFor({ timeout: 60_000 })
    await p.getByRole('button', { name: 'New' }).click()
    await p.getByRole('menuitem', { name: 'New note' }).click()
    await p.locator('input[placeholder="Title (optional)"]').fill('Hotel booking')
    await p.locator('.sheet-wrap textarea').fill('Confirmation 7731-QX\nCheck-in 15:00, room 412')
    await p.getByRole('button', { name: 'Save note' }).click()
    await p.locator('.row .snippet', { hasText: 'Confirmation 7731-QX' }).waitFor()
    // A note left untitled is named by its time, never by its text.
    await p.getByRole('button', { name: 'New' }).click()
    await p.getByRole('menuitem', { name: 'New note' }).click()
    await p.locator('.sheet-wrap textarea').fill('Tr0ub4dor-one-line')
    await p.getByRole('button', { name: 'Save note' }).click()
    const untitled = p.locator('.row', { has: p.locator('.snippet', { hasText: 'Tr0ub4dor-one-line' }) })
    await untitled.waitFor()
    const untitledName = await untitled.locator('.name').textContent()
    assert.match(untitledName, /^Note .+\.txt$/, `untitled note name: ${untitledName}`)
    assert.ok(!untitledName.includes('Tr0ub4dor'), 'the note text is not its name')
    if (shots) await p.screenshot({ path: join(shots, 'phone-list.png') })

    await p.locator('.row', { hasText: 'beach-walk.mp4' }).click()
    const played = await p.locator('video').evaluate(async (v) => {
      v.muted = true
      await new Promise((done, fail) => { if (v.readyState >= 1) done(); else { v.onloadedmetadata = done; v.onerror = () => fail(new Error(`video error ${v.error?.code}`)) } })
      const duration = v.duration
      v.currentTime = 30
      await new Promise(done => { v.onseeked = done })
      await v.play()
      await new Promise(done => setTimeout(done, 1200))
      return { duration, at: v.currentTime, width: v.videoWidth }
    })
    assert.ok(Math.abs(played.duration - 40) < 1, `duration ${played.duration}`)
    assert.ok(played.at > 30.3 && played.at < 33, `played from the seek point: ${played.at}`)
    assert.equal(played.width, 1280)
    if (shots) await p.screenshot({ path: join(shots, 'phone-video.png') })
    log('video plays and seeks', played)
    await p.getByRole('button', { name: 'Close' }).click()

    await p.locator('.row', { hasText: 'boarding-pass.png' }).click()
    const picturedWidth = await p.locator('.view img').evaluate(img => (img.complete ? img.naturalWidth : new Promise(done => { img.onload = () => done(img.naturalWidth) })))
    assert.equal(picturedWidth, 800)
    await p.getByRole('button', { name: 'Close' }).click()

    await p.locator('.row', { hasText: 'Hotel booking.txt' }).click()
    await p.locator('.view pre', { hasText: 'Check-in 15:00, room 412' }).waitFor()
    await p.getByRole('button', { name: 'Close' }).click()

    // A desktop: added, approved from the phone.
    const desk = await device(browser, dsh.url, { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const d = desk.page
    await d.goto(`${origin}/`)
    // DSH's first-run notice.
    await d.getByRole('button', { name: 'Continue' }).click({ timeout: 5000 }).catch(() => {})
    await d.keyboard.press('Escape')
    await d.getByText('Sealed Files').first().click()
    const frame = frameOf(d)
    await frame.getByRole('button', { name: 'Add this device' }).click()
    const deskCode = (await frame.locator('.code').textContent()).trim()

    // The phone shows the waiting desktop on its own, with its code.
    const banner = p.locator('.banner', { hasText: deskCode })
    await banner.waitFor({ timeout: 10_000 })
    if (shots) await p.screenshot({ path: join(shots, 'phone-new-device.png') })
    await banner.getByRole('button', { name: 'Approve' }).click()
    await p.locator('.sheet-wrap .code', { hasText: deskCode }).waitFor()
    if (shots) await p.screenshot({ path: join(shots, 'phone-approve-check.png') })
    await p.locator('.sheet-wrap').last().getByRole('button', { name: 'Approve' }).click()
    await frame.getByRole('button', { name: 'New' }).waitFor({ timeout: 10_000 })
    await banner.waitFor({ state: 'detached' })
    log('desktop approved from the phone')

    // An upload started in the panel goes on when the person moves to another page of DSH.
    const moved = join(root, 'files', 'moved-away.bin')
    writeFileSync(moved, randomBytes(24 * 1024 * 1024))
    await frame.locator('input[type=file]').setInputFiles(moved)
    await d.locator('.sfc', { hasText: 'moved-away.bin' }).waitFor({ timeout: 10_000 })
    if (shots) await d.screenshot({ path: join(shots, 'desktop-card.png') })
    await d.getByText('Plugins').first().click()
    await sleep(500)
    assert.equal(await d.locator('iframe[title="Sealed Files"]').count(), 0, 'the panel is closed')
    await d.locator('.sfc-row.sfc-done', { hasText: 'moved-away.bin' }).waitFor({ timeout: 90_000 })
    log('an upload went on after leaving the panel')
    await d.getByText('Sealed Files').first().click()
    await frame.locator('.row', { hasText: 'moved-away.bin' }).waitFor({ timeout: 10_000 })

    // The download is the file, byte for byte.
    await frame.locator('.row', { hasText: 'holiday-archive.bin' }).click()
    const [download] = await Promise.all([d.waitForEvent('download'), frame.getByRole('button', { name: 'Download' }).click()])
    const saved = join(root, 'downloaded.bin')
    await download.saveAs(saved)
    assert.equal(sha(readFileSync(saved)), sha(readFileSync(big)), 'the download matches the original')
    assert.equal(download.suggestedFilename(), 'holiday-archive.bin')
    await frame.getByRole('button', { name: 'Close' }).click()
    log('download matches')

    // The assistant puts a note in: both pages show it without a reload.
    await p.evaluate(() => fetch('/api/sealed-files-test/note', { method: 'POST', body: JSON.stringify({ text: 'Your e-ticket is in the trip folder', space: 'tester' }) }))
    await frame.locator('.row', { hasText: 'Your e-ticket' }).first().waitFor({ timeout: 10_000 })
    await p.locator('.row', { hasText: 'Your e-ticket' }).first().waitFor({ timeout: 10_000 })
    log('a note from the assistant arrived on both')
    if (shots) {
      await d.screenshot({ path: join(shots, 'desktop-panel.png') })
      await frame.locator('.row', { hasText: 'beach-walk.mp4' }).click()
      await sleep(1500)
      await d.screenshot({ path: join(shots, 'desktop-video.png') })
      await frame.getByRole('button', { name: 'Close' }).click()
    }

    // The clipboard: a code typed on the phone goes in one step and shows in full on the desktop; Copy puts it on the clipboard.
    const clipText = 'Door code 7319#\nback gate'
    await p.locator('.clip-input').fill(clipText)
    await p.locator('.clip').getByRole('button', { name: 'Send' }).click()
    await p.locator('.clip-item .clip-text', { hasText: 'Door code 7319#' }).waitFor({ timeout: 10_000 })
    assert.equal(await p.locator('.clip-input').inputValue(), '', 'the box is empty after sending')
    const deskClip = frame.locator('.clip-item', { hasText: 'Door code 7319#' })
    await deskClip.waitFor({ timeout: 10_000 })
    assert.equal(await deskClip.locator('.clip-text').textContent(), clipText, 'the whole text shows inline')
    assert.equal(await frame.locator('.row', { hasText: 'snippet' }).count(), 0, 'a snippet is not a row in the file list')
    await deskClip.getByRole('button', { name: 'Copy' }).click()
    await deskClip.getByRole('button', { name: 'Copied' }).waitFor()
    assert.equal(await frame.locator('body').evaluate(() => navigator.clipboard.readText()), clipText, 'Copy put the text on the clipboard')
    // Typing while a change arrives keeps the text in the box.
    await frame.locator('.clip-input').fill('half typed')
    await p.evaluate(() => fetch('/api/sealed-files-test/snippet', { method: 'POST', body: JSON.stringify({ text: 'Verification code 640 118', space: 'tester' }) }))
    await frame.locator('.clip-item', { hasText: 'Verification code 640 118' }).waitFor({ timeout: 10_000 })
    await p.locator('.clip-item', { hasText: 'Verification code 640 118' }).waitFor({ timeout: 10_000 })
    assert.equal(await frame.locator('.clip-input').inputValue(), 'half typed')
    await frame.locator('.clip-input').fill('')
    if (shots) {
      await p.screenshot({ path: join(shots, 'phone-clipboard.png') })
      await d.screenshot({ path: join(shots, 'desktop-clipboard.png') })
    }
    // Copy text in an opened note: the write starts within the tap while the text is still being decrypted.
    await frame.locator('.row', { hasText: 'Hotel booking.txt' }).click()
    await frame.getByRole('button', { name: 'Copy text' }).click()
    await frame.getByText('Copied').waitFor()
    assert.equal(await frame.locator('body').evaluate(() => navigator.clipboard.readText()), 'Confirmation 7731-QX\nCheck-in 15:00, room 412')
    await frame.getByRole('button', { name: 'Close' }).click()
    // Kept, then deleted from the phone.
    const phoneClip = p.locator('.clip-item', { hasText: 'Door code 7319#' })
    await phoneClip.getByRole('button', { name: 'Keep' }).click()
    await phoneClip.getByText('kept').waitFor({ timeout: 10_000 })
    await phoneClip.getByRole('button', { name: 'Delete' }).click()
    await p.locator('.sheet-wrap').last().getByRole('button', { name: 'Delete' }).click()
    await deskClip.waitFor({ state: 'detached', timeout: 10_000 })
    log('a snippet went from the phone to the desktop in one step, copied, kept and deleted; one from the assistant reached both')

    // A third device asks to join: both added devices show it at once, badges included, and it is rejected.
    const third = await device(browser, dsh.url, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await third.page.goto(app)
    await third.page.getByRole('button', { name: 'Add this device' }).click()
    const thirdCode = (await third.page.locator('.code').textContent()).trim()
    await frame.locator('.banner', { hasText: thirdCode }).waitFor({ timeout: 10_000 })
    await p.locator('.banner', { hasText: thirdCode }).waitFor({ timeout: 10_000 })
    await d.locator('.sealed-files-badge', { hasText: '1' }).waitFor({ timeout: 10_000 })
    assert.equal(await p.locator('.btn.alert .badge').textContent(), '1')
    assert.equal(await frame.locator('.btn.alert .badge').textContent(), '1')
    if (shots) {
      await sleep(400)
      await p.screenshot({ path: join(shots, 'phone-waiting.png') })
      await d.screenshot({ path: join(shots, 'desktop-waiting.png') })
    }
    await frame.locator('.banner', { hasText: thirdCode }).getByRole('button', { name: 'Reject' }).click()
    await p.locator('.banner').waitFor({ state: 'detached', timeout: 10_000 })
    await d.locator('.sealed-files-badge').waitFor({ state: 'detached', timeout: 10_000 })
    assert.equal(await p.locator('.btn.alert').count(), 0)
    await third.context.close()
    log('a waiting device showed live on both (banner, Devices badge, sidebar badge) and was rejected')

    // The service worker can't read the device's keys (WebKit can't unwrap CryptoKeys from IndexedDB inside a service
    // worker) and was restarted since the page started: an assistant's file still downloads whole, never as an error text.
    const book = join(root, 'files', '测试书-下载.epub')
    writeFileSync(book, randomBytes(1_254_310))
    await d.evaluate(path => fetch('/api/sealed-files-test/put', { method: 'POST', body: JSON.stringify({ path, space: 'tester' }) }), book)
    await frame.locator('.row', { hasText: '测试书-下载.epub' }).waitFor({ timeout: 10_000 })
    await frame.locator('body').evaluate(() => new Promise((done) => {
      const request = indexedDB.open('sealed-files', 1)
      request.onsuccess = () => { const t = request.result.transaction('device', 'readwrite'); t.objectStore('device').delete('self'); t.oncomplete = done }
    }))
    await frame.locator('.row', { hasText: '测试书-下载.epub' }).click()
    await frame.locator('body').evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'forget' }))
    const [bookDownload] = await Promise.all([d.waitForEvent('download'), frame.getByRole('button', { name: 'Download' }).click()])
    await bookDownload.saveAs(join(root, 'book.epub'))
    assert.equal(sha(readFileSync(join(root, 'book.epub'))), sha(readFileSync(book)), 'the book downloads whole without the stored device')
    assert.equal(bookDownload.suggestedFilename(), '测试书-下载.epub')
    assert.equal(await bookDownload.path().then(() => 'ok'), 'ok')
    await frame.getByRole('button', { name: 'Close' }).click()
    // An answer that is an error is shown, never saved: an id nobody has.
    const failed = await frame.locator('body').evaluate(async () => (await fetch('/sealed-files/app/stream/aaaaaaaaaaaaaaaa')).status)
    assert.ok(failed >= 400, `an unknown file answers an error (${failed})`)
    log('an assistant file downloads whole when the worker cannot read the device')

    // Nothing readable went over the wire.
    const secrets = ['holiday-archive', 'beach-walk', 'boarding-pass', 'Hotel booking', 'room 412', '7731-QX', 'e-ticket', '测试书', 'Door code', '7319', '640 118']
    for (const { url, body } of [...phone.requests, ...desk.requests]) {
      if (!url.includes('/api/sealed-files/') && !url.includes('/sealed-files/app/')) continue
      for (const secret of secrets) {
        assert.ok(!decodeURIComponent(url).includes(secret), `${secret} in ${url}`)
        if (body) assert.ok(!body.includes(Buffer.from(secret)), `${secret} in the body of ${url}`)
      }
    }
    log('no name or text in any request')
    console.log('PASS')
  } finally {
    proxy?.close()
    await browser.close()
    dsh.stop()
    await sleep(500)
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
