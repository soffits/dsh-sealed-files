import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption'
import * as age from '../web/age.js'
import { x25519 } from '../web/vendor.js'

function encrypt(plaintext, recipientPub) {
  const fileKey = age.random(age.FILE_KEY_BYTES)
  const nonce = age.random(age.NONCE_BYTES)
  const key = age.payloadKey(fileKey, nonce)
  const parts = [age.encodeHeader(fileKey, recipientPub), nonce]
  const total = age.chunkCount(plaintext.length)
  for (let i = 0; i < total; i++) parts.push(age.sealChunk(key, i, i === total - 1, plaintext.subarray(i * age.CHUNK, (i + 1) * age.CHUNK)))
  return age.concat(...parts)
}

function decrypt(file, priv) {
  const header = age.parseHeader(file)
  const fileKey = age.unwrapFileKey(header, priv)
  const nonce = file.subarray(header.length, header.length + age.NONCE_BYTES)
  const key = age.payloadKey(fileKey, nonce)
  const payload = file.subarray(header.length + age.NONCE_BYTES)
  const total = Math.ceil(payload.length / age.CHUNK_CT) || 1
  const out = []
  for (let i = 0; i < total; i++) out.push(age.openChunk(key, i, i === total - 1, payload.subarray(i * age.CHUNK_CT, (i + 1) * age.CHUNK_CT)))
  return age.concat(...out)
}

const sizes = [0, 1, age.CHUNK - 1, age.CHUNK, age.CHUNK + 1, 3 * age.CHUNK, 200_001]

test('our files open with typage, typage files open with ours', async () => {
  const identity = await generateX25519Identity()
  const priv = age.decodeIdentity(identity)
  const pub = age.decodeRecipient(await identityToRecipient(identity))
  assert.deepEqual(pub, x25519.getPublicKey(priv))
  assert.equal(age.encodeIdentity(priv), identity)
  for (const size of sizes) {
    const plaintext = age.random(size)
    const ours = encrypt(plaintext, pub)
    assert.equal(ours.length, age.parseHeader(ours).length + age.NONCE_BYTES + age.payloadSize(size))
    const d = new Decrypter()
    d.addIdentity(identity)
    assert.deepEqual(await d.decrypt(ours), plaintext, `typage reads ours, ${size} bytes`)
    const e = new Encrypter()
    e.addRecipient(await identityToRecipient(identity))
    assert.deepEqual(decrypt(await e.encrypt(plaintext), priv), plaintext, `ours reads typage, ${size} bytes`)
  }
})

test('a changed header or chunk is refused', () => {
  const priv = x25519.utils.randomSecretKey()
  const file = encrypt(age.random(1000), x25519.getPublicKey(priv))
  const header = age.parseHeader(file)
  const badMac = file.slice()
  badMac[header.length - 3] ^= 1
  assert.throws(() => decrypt(badMac, priv))
  const badBody = file.slice()
  badBody[file.length - 1] ^= 1
  assert.throws(() => decrypt(badBody, priv))
  assert.throws(() => decrypt(file, x25519.utils.randomSecretKey()), /no stanza/)
})

test('a truncated header parses as incomplete', () => {
  const file = encrypt(age.random(10), x25519.getPublicKey(x25519.utils.randomSecretKey()))
  const header = age.parseHeader(file)
  for (const cut of [5, 30, header.length - 1]) assert.equal(age.parseHeader(file.subarray(0, cut)), null)
})

test('chunk spans cover the asked range', () => {
  const size = 5 * age.CHUNK + 10
  assert.deepEqual(age.cipherSpan(100, size, 0, 0), { first: 0, last: 0, final: 5, from: 100, to: 100 + age.CHUNK_CT - 1 })
  const tail = age.cipherSpan(100, size, size - 1, size - 1)
  assert.equal(tail.first, 5)
  assert.equal(tail.to, 100 + age.payloadSize(size) - 1)
})

test('the age command opens our files', { skip: !hasAge() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealed-age-'))
  try {
    const priv = x25519.utils.randomSecretKey()
    writeFileSync(join(dir, 'key.txt'), `${age.encodeIdentity(priv)}\n`)
    const plaintext = age.random(3 * age.CHUNK + 7)
    writeFileSync(join(dir, 'f.age'), encrypt(plaintext, x25519.getPublicKey(priv)))
    execFileSync('age', ['-d', '-i', join(dir, 'key.txt'), '-o', join(dir, 'f'), join(dir, 'f.age')])
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'f'))), plaintext)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function hasAge() {
  try { execFileSync('age', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}
