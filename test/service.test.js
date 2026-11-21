/**
 * The service through its real /api routes, with devices simulated the way
 * the page makes them (WebCrypto X25519, the same seal and age modules).
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiRoutes } from '../src/api.js'
import { followDecisions } from '../src/decisions.js'
import { createAssistant } from '../src/assistant.js'
import { limitsOf, Config } from '../src/config.js'
import { createService } from '../src/service.js'
import { createStore } from '../src/store.js'
import * as age from '../web/age.js'
import { PART_BYTES, PREVIEW_CHARS, SNIPPET_CHARS, partShape } from '../web/protocol.js'
import { b64, derivePairKey, deviceIdOf, openResponse, pairingCode, sealBytes, sealRequest } from '../web/seal.js'

const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'sealed-test-'))
const quiet = { info() {}, warn() {}, debug() {} }
let service
let routes
let who = null
const notices = []

before(async () => {
  writeFileSync(join(dir, 'people.json'), JSON.stringify({ oidc_users: { 'sub-a': 'Alice', 'sub-b': 'Bob' } }))
  writeFileSync(join(dir, 'notify.mjs'), `import { appendFileSync } from 'node:fs'\nlet data = ''\nprocess.stdin.on('data', d => { data += d })\nprocess.stdin.on('end', () => appendFileSync(${JSON.stringify(join(dir, 'notices.jsonl'))}, data))\n`)
  const config = Config({ stateDir: join(dir, 'state'), peopleFile: join(dir, 'people.json'), peopleKey: 'oidc_users', maxFileGb: 0.1, maxStoreGb: 0.5, minFreeGb: 0, notifyCommand: [process.execPath, join(dir, 'notify.mjs')], assistantName: 'Helper' })
  service = await createService({ config, limits: limitsOf(config), stateDir: config.stateDir, identityFile: join(dir, 'state/identity.txt'), officeToPdf: () => undefined, logger: quiet })
  routes = Object.fromEntries(createApiRoutes({ service: () => service, identity: () => ({ current: () => (who ? { provider: 'oidc', issuer: 'x', id: who } : null) }), version: () => 'test' }).map(r => [r.path.split('/').pop(), r]))
})
after(async () => {
  await service.store.flush()
  await new Promise(done => setTimeout(done, 200))
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const request = (name, init = {}, query = '') => routes[name].fetch(new Request(`http://local/api/sealed-files/${name}${query}`, init))

async function makeDevice(sub) {
  who = sub
  const whoami = await (await request('whoami')).json()
  assert.equal(whoami.mapped, true)
  const assistantPub = b64.decode(whoami.assistant.pub)
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const assistant = await crypto.subtle.importKey('raw', assistantPub, { name: 'X25519' }, true, [])
  const pairKey = await derivePairKey(new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: assistant }, pair.privateKey, 256)), pub, assistantPub)
  const id = deviceIdOf(pub)
  const name = b64.encode(await sealBytes(pairKey, `sealed-files/v1/enroll\n${id}`, new TextEncoder().encode(`phone of ${sub}`)))
  const enrolled = await (await request('enroll', { method: 'POST', body: JSON.stringify({ pub: b64.encode(pub), name }) })).json()
  assert.deepEqual(enrolled, { id, status: 'pending' })
  return { id, sub, pairKey, pub, assistantPub }
}

async function call(device, op, args = {}, { envelope } = {}) {
  who = device.sub
  const sealed = envelope ?? await sealRequest(device.pairKey, device.id, { op, args })
  const response = await request('call', { method: 'POST', body: JSON.stringify(sealed) })
  if (!response.ok) return { httpError: (await response.json()).error, sealed }
  return { ...(await openResponse(device.pairKey, device.id, sealed.n, await response.json())), sealed }
}

const result = async (...args) => {
  const answer = await call(...args)
  assert.equal(answer.ok, true, JSON.stringify(answer))
  return answer.result
}

let alice
let bob

test('a device is pending until approved, and the pairing code reaches its person', async () => {
  alice = await makeDevice('sub-a')
  bob = await makeDevice('sub-b')
  assert.equal((await result(alice, 'status')).status, 'pending')
  assert.equal((await call(alice, 'index')).status, 403)
  await new Promise(done => setTimeout(done, 300))
  const lines = readFileSync(join(dir, 'notices.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  const forAlice = lines.find(line => line.person === 'alice')
  assert.equal(forAlice.code, pairingCode(alice.pub, alice.assistantPub))
  assert.equal(forAlice.device.name, 'phone of sub-a')
  assert.deepEqual(await service.decide({ device: alice.id, code: 'AAAA-BBBB-CCCC', choice: 'yes' }), { applied: false, reason: 'code does not match' })
  assert.equal((await service.decide({ device: alice.id, code: forAlice.code, choice: 'yes', person: 'bob' })).applied, false)
  assert.equal((await service.decide({ device: alice.id, code: forAlice.code, choice: 'yes', person: 'alice', by: 'test' })).applied, true)
  // The same decision from outside, through the command and the spool the plugin follows.
  const stop = await followDecisions({ stateDir: join(dir, 'state'), decide: service.decide, logger: quiet })
  execFileSync(process.execPath, [join(here, '../bin/dsh-sealed-files-decide.js'), '--state-dir', join(dir, 'state'), '--event'],
    { input: JSON.stringify({ events: [{ data: { choice: 'yes', person: 'bob', payload: { device: bob.id, code: pairingCode(bob.pub, bob.assistantPub) } } }] }) })
  for (let i = 0; i < 50 && service.store.device(bob.id).status !== 'approved'; i++) await new Promise(done => setTimeout(done, 50))
  await stop()
  assert.equal(service.store.device(bob.id).status, 'approved')
  assert.equal(service.store.device(bob.id).code, undefined)
  const index = await result(alice, 'index')
  assert.deepEqual(index.spaces.map(s => s.id), ['alice', 'shared'])
})

test('a sealed request works once, from its own device only', async () => {
  const first = await call(alice, 'index')
  assert.equal(first.ok, true)
  assert.equal((await call(alice, 'index', {}, { envelope: first.sealed })).httpError, 'stale')
  const forged = await sealRequest(bob.pairKey, alice.id, { op: 'index' })
  assert.equal((await call(alice, 'index', {}, { envelope: forged })).httpError, 'bad-seal')
  assert.equal((await call({ ...bob, sub: 'sub-a' }, 'index')).httpError, 'unknown-device')
})

async function sendPart(device, upload, size, key, n, mutate) {
  const shape = partShape(size, n)
  const pieces = []
  for (let c = 0; c < shape.count; c++) {
    const index = shape.first + c
    pieces.push(age.sealChunk(key, index, index === age.chunkCount(size) - 1, plain.subarray(index * age.CHUNK, (index + 1) * age.CHUNK)))
  }
  const body = age.concat(...pieces)
  mutate?.(body)
  who = device.sub
  return request('part', { method: 'POST', body, duplex: 'half' }, `?d=${device.id}&u=${upload}&n=${n}`)
}

const plain = age.random(2 * PART_BYTES + 12345)
let itemId

test('an upload resumes, refuses a changed part, and reads back by range', async () => {
  const fileKey = age.random(16)
  const nonce = age.random(16)
  const key = age.payloadKey(fileKey, nonce)
  const prefix = age.concat(age.encodeHeader(fileKey, alice.assistantPub), nonce)
  const started = await result(alice, 'upload.start', { space: 'alice', folder: 'trip/photos', size: plain.length, prefix: b64.encode(prefix) })
  assert.deepEqual(started.missing, [0, 1, 2])
  assert.equal((await sendPart(alice, started.id, plain.length, key, 1)).status, 200)
  assert.equal((await sendPart(alice, started.id, plain.length, key, 2, body => { body[10] ^= 1 })).status, 422)
  assert.equal((await sendPart(bob, started.id, plain.length, key, 0)).status, 404)
  // As after a reload: ask what is missing, send only that.
  assert.deepEqual((await result(alice, 'upload.status', { id: started.id })).missing, [0, 2])
  assert.equal((await call(alice, 'upload.finish', { id: started.id, name: 'x.bin', type: 'application/octet-stream' })).status, 409)
  for (const n of [0, 2, 2]) assert.equal((await sendPart(alice, started.id, plain.length, key, n)).status, 200)
  const item = await result(alice, 'upload.finish', { id: started.id, name: 'beach.mp4', type: 'video/mp4' })
  itemId = item.id
  assert.equal(item.folder, 'trip/photos')
  assert.equal(item.from.person, 'alice')

  const got = await result(alice, 'key', { id: item.id })
  const pkey = age.payloadKey(b64.decode(got.fileKey), b64.decode(got.nonce))
  const start = PART_BYTES - 100
  const end = PART_BYTES + 70_000
  const span = age.cipherSpan(got.payloadAt, got.size, start, end)
  who = 'sub-a'
  const response = await request('blob', { headers: { range: `bytes=${span.from}-${span.to}` } }, `?d=${alice.id}&id=${item.id}`)
  assert.equal(response.status, 206)
  const cipher = new Uint8Array(await response.arrayBuffer())
  const out = []
  for (let i = span.first, at = 0; i <= span.last; i++, at += age.CHUNK_CT) out.push(age.openChunk(pkey, i, i === span.final, cipher.subarray(at, at + age.CHUNK_CT)))
  const joined = age.concat(...out)
  assert.deepEqual(joined.subarray(start - span.first * age.CHUNK, end - span.first * age.CHUNK + 1), plain.subarray(start, end + 1))
})

test('people see their own space and the shared one, never another person\'s', async () => {
  assert.equal((await call(bob, 'key', { id: itemId })).status, 404)
  who = 'sub-b'
  assert.equal((await request('blob', {}, `?d=${bob.id}&id=${itemId}`)).status, 404)
  assert.equal((await result(bob, 'index')).items.length, 0)
  await result(alice, 'move', { id: itemId, space: 'shared', folder: '' })
  assert.equal((await result(bob, 'index')).items[0].name, 'beach.mp4')
  assert.equal((await call(bob, 'move', { id: itemId, space: 'alice', folder: '' })).status, 403)
})

test('the assistant reads what arrived and puts files and notes in', async () => {
  const assistant = createAssistant({ service, outDir: join(dir, 'out'), origin: () => 'https://dsh.example' })
  const listed = await assistant.list({ unseen: true })
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].link, `https://dsh.example/?sealed-files=${itemId}`)
  assert.equal((await assistant.list({ unseen: true })).items.length, 0)
  const got = await assistant.get({ id: itemId })
  assert.deepEqual(new Uint8Array(readFileSync(got.path)), plain)
  writeFileSync(join(dir, 'report.pdf'), 'pdf bytes')
  const put = await assistant.put({ path: join(dir, 'report.pdf'), space: 'alice', folder: 'docs' })
  assert.equal(put.type, 'application/pdf')
  const note = await assistant.text({ text: 'flight XY 123\nseat 31K', space: 'alice' })
  assert.equal(note.name, 'flight XY 123.txt')
  const index = await result(alice, 'index')
  assert.deepEqual(index.items.map(i => i.name).sort(), ['beach.mp4', 'flight XY 123.txt', 'report.pdf'])
  assert.deepEqual(index.folders.alice, ['docs'])
  assert.equal((await assistant.get({ id: note.id })).text, 'flight XY 123\nseat 31K')
  const key = await result(alice, 'key', { id: put.id })
  assert.equal(key.size, 9)
})

test('an approved device sees a new one waiting, approves or rejects it, and removes it', async () => {
  const rejected = await makeDevice('sub-a')
  assert.deepEqual((await result(alice, 'index')).pending.map(d => d.id), [rejected.id])
  assert.equal((await result(bob, 'index')).pending.length, 0)
  assert.equal((await call(bob, 'device.reject', { id: rejected.id })).status, 404)
  await result(alice, 'device.reject', { id: rejected.id })
  assert.equal(service.store.device(rejected.id), null)
  const second = await makeDevice('sub-a')
  const listed = await result(alice, 'devices')
  assert.equal(listed.find(d => d.id === second.id).code, pairingCode(second.pub, second.assistantPub))
  assert.equal((await call(bob, 'device.approve', { id: second.id })).status, 404)
  await result(alice, 'device.approve', { id: second.id })
  assert.equal((await result(second, 'index')).person.id, 'alice')
  await result(alice, 'device.remove', { id: second.id })
  assert.equal((await call(second, 'index')).httpError, 'unknown-device')
})

test('folders rename with their contents and go only when empty', async () => {
  await result(alice, 'mkdir', { space: 'alice', path: 'a/b' })
  assert.equal((await call(alice, 'folder.remove', { space: 'alice', path: 'docs' })).status, 409)
  await result(alice, 'folder.move', { space: 'alice', from: 'docs', to: 'papers' })
  const index = await result(alice, 'index')
  assert.ok(index.items.some(i => i.folder === 'papers'))
  assert.deepEqual(index.folders.alice, ['a', 'a/b', 'papers'])
})

test('expired items are swept and pinned ones stay', async () => {
  const index = await result(alice, 'index')
  const [keep, drop] = index.items.filter(i => i.space === 'alice')
  await result(alice, 'pin', { id: keep.id, pinned: true })
  await service.store.sweep(Date.now() + 40 * 86_400_000)
  const after = await result(alice, 'index')
  assert.ok(after.items.some(i => i.id === keep.id))
  assert.ok(!after.items.some(i => i.id === drop.id))
})

test('limits refuse a file over the size cap', async () => {
  const prefix = age.concat(age.encodeHeader(age.random(16), alice.assistantPub), age.random(16))
  assert.equal((await call(alice, 'upload.start', { space: 'alice', folder: '', size: 200 * 1024 * 1024, prefix: b64.encode(prefix) })).error, 'file-too-large')
})

test('every tool answer is plain JSON (no undefined anywhere)', async () => {
  const assistant = createAssistant({ service, outDir: join(dir, 'out'), origin: () => 'https://dsh.example' })
  const pending = await makeDevice('sub-b')
  const answers = [await assistant.list({}), assistant.devices({}), assistant.spaces(), await assistant.text({ text: 'x', space: 'bob' }), await assistant.snippet({ text: 'y', space: 'bob' })]
  for (const answer of answers) assert.deepEqual(JSON.parse(JSON.stringify(answer)), answer)
  assert.ok(assistant.devices({}).some(d => d.id === pending.id && d.code))
})

test('every change to the device list is logged with who made it', async () => {
  const assistant = createAssistant({ service, outDir: join(dir, 'out'), origin: () => 'https://dsh.example' })
  await result(alice, 'device.rename', { id: alice.id, name: 'work laptop' })
  const revoked = await makeDevice('sub-b')
  await assistant.revoke({ device: revoked.id })
  await assert.rejects(assistant.revoke({ device: revoked.id }), /no such device/)
  const stale = await makeDevice('sub-b')
  await service.store.sweep(Date.now() + 2 * 86_400_000)
  await service.store.flush()
  const log = readFileSync(join(dir, 'state/devices.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const of = id => log.filter(line => line.device.id === id).map(({ event, by }) => [event, by])
  const fromAlice = { kind: 'device', person: 'alice', device: alice.id, name: 'phone of sub-a' }
  assert.deepEqual(of(alice.id), [
    ['pair', { kind: 'person', person: 'alice' }],
    ['approve', { kind: 'outside', label: 'test' }],
    ['rename', fromAlice],
  ])
  assert.deepEqual(log.find(line => line.event === 'rename').was, { name: 'phone of sub-a' })
  assert.deepEqual(of(bob.id), [['pair', { kind: 'person', person: 'bob' }], ['approve', { kind: 'outside', label: 'outside' }]])
  const second = log.find(line => line.event === 'remove').device.id
  assert.deepEqual(of(second), [['pair', { kind: 'person', person: 'alice' }], ['approve', fromAlice], ['remove', fromAlice]])
  assert.deepEqual(log.filter(line => line.event === 'reject').map(line => line.by), [fromAlice])
  assert.deepEqual(of(revoked.id), [['pair', { kind: 'person', person: 'bob' }], ['revoke', { kind: 'assistant' }]])
  assert.deepEqual(of(stale.id).at(-1), ['sweep', { kind: 'sweep', reason: 'pending over a day' }])
  for (const line of log) assert.ok(!Number.isNaN(Date.parse(line.at)) && line.device.person && line.device.status)
})

test('clipboard snippets: sent in one call, text only in the sealed answer, a day to live unless kept', async () => {
  const HOUR = 3_600_000
  const sent = await result(alice, 'snippet.put', { space: 'alice', text: 'wifi pass: Correct-Horse 42' })
  assert.equal(sent.kind, 'snippet')
  assert.equal(sent.text, 'wifi pass: Correct-Horse 42')
  assert.ok(Math.abs(sent.expires - (Date.now() + 24 * HOUR)) < 60_000, 'a snippet lives a day')
  const seen = (await result(alice, 'index')).items.find(i => i.id === sent.id)
  assert.equal(seen.text, 'wifi pass: Correct-Horse 42')
  await service.store.flush()
  assert.ok(!readFileSync(join(dir, 'state/index.json'), 'utf8').includes('Correct-Horse'), 'the text is not in the index file')
  assert.ok(!readFileSync(join(dir, `state/items/${sent.id}.age`)).includes(Buffer.from('Correct-Horse')), 'the stored file is encrypted')

  assert.ok(!(await result(bob, 'index')).items.some(i => i.id === sent.id))
  assert.equal((await call(bob, 'snippet.put', { space: 'alice', text: 'hi' })).status, 403)
  assert.equal((await call(alice, 'snippet.put', { space: 'alice', text: '   ' })).status, 400)
  assert.equal((await call(alice, 'snippet.put', { space: 'alice', text: 'x'.repeat(SNIPPET_CHARS + 1) })).error, 'snippet-too-long')

  // The assistant reads what arrived, with the text, and puts one in.
  const assistant = createAssistant({ service, outDir: join(dir, 'out'), origin: () => 'https://dsh.example' })
  const arrived = (await assistant.list({ unseen: true })).items.find(i => i.id === sent.id)
  assert.equal(arrived.text, 'wifi pass: Correct-Horse 42')
  assert.equal((await assistant.get({ id: sent.id })).text, 'wifi pass: Correct-Horse 42')
  const code = await assistant.snippet({ text: '481 552', space: 'alice' })
  assert.equal(code.unseen, false)
  assert.equal((await result(alice, 'index')).items.find(i => i.id === code.id).text, '481 552')
  await assert.rejects(assistant.snippet({ text: 'x', space: 'nobody' }), /unknown space/)

  // A kept snippet stays; let go, it has a day again; files outlive both.
  await result(alice, 'pin', { id: code.id, pinned: true })
  const file = await assistant.text({ text: 'a note', space: 'alice' })
  await service.store.sweep(Date.now() + 2 * 24 * HOUR)
  const left = (await result(alice, 'index')).items.map(i => i.id)
  assert.ok(!left.includes(sent.id) && left.includes(code.id) && left.includes(file.id))
  const unpinned = await result(alice, 'pin', { id: code.id, pinned: false })
  assert.ok(Math.abs(unpinned.expires - (Date.now() + 24 * HOUR)) < 60_000)
})

test('a note\'s preview reaches devices only sealed, never stored in the clear', async () => {
  const assistant = createAssistant({ service, outDir: join(dir, 'out'), origin: () => 'https://dsh.example' })
  const long = `Gate B-17 boards 14:05\n${'界'.repeat(PREVIEW_CHARS * 3)}`
  const note = await assistant.text({ text: long, space: 'alice', title: 'Boarding' })
  const listed = (await result(alice, 'index')).items.find(i => i.id === note.id)
  assert.equal(listed.preview, long.slice(0, PREVIEW_CHARS))
  await service.store.flush()
  const stored = readFileSync(join(dir, 'state/index.json'), 'utf8')
  assert.ok(!stored.includes('B-17') && !stored.includes('"preview"'), 'no note text in the index')
})

test('previews an older version stored in the index are removed on start', async () => {
  const old = join(dir, 'old-state')
  mkdirSync(old)
  const item = { id: 'aaaaaaaaaaaaaaaa', space: 'alice', folder: '', name: 'n.txt', kind: 'text', preview: 'pin 4471', size: 8, created: 1, expires: null, pinned: true, from: { person: 'alice' } }
  writeFileSync(join(old, 'index.json'), JSON.stringify({ items: { [item.id]: item }, folders: {} }))
  const store = await createStore({ dir: old, people: { all: () => [] }, sharedSpace: true, retentionDays: 30, snippetHours: 24, deviceIdleDays: 90, logger: quiet })
  await store.flush()
  assert.equal(store.item(item.id).preview, undefined)
  assert.ok(!readFileSync(join(old, 'index.json'), 'utf8').includes('4471'))
})
