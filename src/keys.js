/**
 * The assistant's side of the crypto: its age identity on disk, the pairwise
 * key with each device, and Node's native ChaCha20-Poly1305 for bulk chunks.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { decodeIdentity, encodeIdentity, encodeRecipient, setChunkCipher } from '../web/age.js'
import { derivePairKey } from '../web/seal.js'
import { x25519 } from '../web/vendor.js'

setChunkCipher({
  seal(key, nonce, data) {
    const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
    return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])
  },
  open(key, nonce, data) {
    if (data.length < 16) throw new Error('chunk too short')
    const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
    decipher.setAuthTag(data.subarray(data.length - 16))
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()])
  },
})

/** Read the identity file, or make one (mode 600) when it is missing. */
export function loadIdentity(file) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const priv = x25519.utils.randomSecretKey()
    const pub = x25519.getPublicKey(priv)
    writeFileSync(file, `# created: ${new Date().toISOString()}\n# public key: ${encodeRecipient(pub)}\n${encodeIdentity(priv)}\n`, { mode: 0o600, flag: 'wx' })
    chmodSync(file, 0o600)
  }
  const line = readFileSync(file, 'utf8').split('\n').map(l => l.trim()).find(l => l.startsWith('AGE-SECRET-KEY-1'))
  if (line === undefined) throw new Error(`no AGE-SECRET-KEY-1 line in ${file}`)
  const priv = decodeIdentity(line)
  const pub = x25519.getPublicKey(priv)
  const pairKeys = new Map()
  return {
    priv,
    pub,
    recipient: encodeRecipient(pub),
    /** The AES-GCM key shared with the device whose X25519 public key is `devicePub` (cached). */
    async pairKey(devicePub) {
      const id = Buffer.from(devicePub).toString('base64')
      let key = pairKeys.get(id)
      if (key === undefined) {
        key = await derivePairKey(x25519.getSharedSecret(priv, devicePub), devicePub, pub)
        pairKeys.set(id, key)
      }
      return key
    },
  }
}
