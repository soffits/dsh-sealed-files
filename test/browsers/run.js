/**
 * Sealed Files in a real DSH with the plugin linked in, driven through
 * Chromium: a phone-sized device is added (pairing code, approval), sends a
 * file that is cut off by a reload and resumed, a part lost on the network and
 * retried, a video that plays and seeks, a picture and a note; the file comes
 * back byte for byte as a download; a desktop device is added and approved
 * from the first; a note the assistant puts in shows on both without a
 * reload. Every request is recorded, and no file name or note text may appear
 * in any of them.
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
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'chromium', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  try {
    // A phone: add it.
    const phone = await device(browser, dsh.url, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const p = phone.page
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

    // A large file: cut off by a reload after the first part, then resumed.
    let cut = 0
    await p.route('**/api/sealed-files/part?**', (route) => {
      const n = Number(new URL(route.request().url()).searchParams.get('n'))
      if (n === 0) return route.continue()
      cut++
      return route.abort('connectionreset')
    })
    const firstPart = p.waitForResponse(response => response.url().includes('/api/sealed-files/part?') && response.url().includes('&n=0') && response.ok())
    await p.locator('input[type=file]').setInputFiles(big)
    await firstPart
    while (cut < 2) await sleep(100)
    await p.reload()
    await p.unroute('**/api/sealed-files/part?**')
    await p.getByText('Unfinished').waitFor()
    if (shots) await p.screenshot({ path: join(shots, 'phone-unfinished.png') })
    const before = phone.requests.length
    let dropped = false
    await p.route('**/api/sealed-files/part?**', (route) => {
      const n = Number(new URL(route.request().url()).searchParams.get('n'))
      if (n === 2 && !dropped) { dropped = true; return route.abort('connectionreset') }
      return route.continue()
    })
    await p.locator('input[type=file]').setInputFiles(big)
    await p.getByText('Sent holiday-archive.bin').waitFor({ timeout: 60_000 })
    const resumed = phone.requests.slice(before).filter(r => r.url.includes('/api/sealed-files/part?')).map(r => Number(new URL(r.url).searchParams.get('n')))
    assert.ok(!resumed.includes(0), `part 0 was not sent again (${resumed})`)
    assert.ok(resumed.filter(n => n === 2).length === 2, `the lost part was retried (${resumed})`)
    await p.unroute('**/api/sealed-files/part?**')
    log('resumed after a reload, sent', resumed)

    // A video and a picture, then a note.
    await p.locator('input[type=file]').setInputFiles([video, picture])
    await p.getByText('Sent beach-walk.mp4').waitFor({ timeout: 60_000 })
    await p.getByText('Sent boarding-pass.png').waitFor({ timeout: 60_000 })
    await p.getByRole('button', { name: 'New' }).click()
    await p.getByRole('menuitem', { name: 'New note' }).click()
    await p.locator('input[placeholder="Title (optional)"]').fill('Hotel booking')
    await p.locator('textarea').fill('Confirmation 7731-QX\nCheck-in 15:00, room 412')
    await p.getByRole('button', { name: 'Save note' }).click()
    await p.locator('.row', { hasText: 'Hotel booking.txt' }).waitFor()
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
    const desk = await device(browser, dsh.url, { viewport: { width: 1440, height: 900 } })
    const d = desk.page
    await d.goto(`${origin}/`)
    // DSH's first-run notice.
    await d.getByRole('button', { name: 'Continue' }).click({ timeout: 5000 }).catch(() => {})
    await d.keyboard.press('Escape')
    await d.getByText('Sealed Files').first().click()
    const frame = frameOf(d)
    await frame.getByRole('button', { name: 'Add this device' }).click()
    const deskCode = (await frame.locator('.code').textContent()).trim()
    await p.getByRole('button', { name: 'Devices' }).click()
    await p.locator('.devices li', { hasText: deskCode }).getByRole('button', { name: 'Approve' }).click()
    await p.locator('.sheet-wrap').last().getByRole('button', { name: 'Approve' }).click()
    await frame.getByRole('button', { name: 'New' }).waitFor({ timeout: 10_000 })
    await p.getByRole('button', { name: 'Close' }).click()
    log('desktop approved from the phone')

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

    // Nothing readable went over the wire.
    const secrets = ['holiday-archive', 'beach-walk', 'boarding-pass', 'Hotel booking', 'room 412', '7731-QX', 'e-ticket']
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
    await browser.close()
    dsh.stop()
    await sleep(500)
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
