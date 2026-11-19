import assert from 'node:assert/strict'
import { test } from 'node:test'
import { typeOf } from '../web/types.js'

test('a file without a useful stored type gets one from its name', () => {
  assert.equal(typeOf('真君大人是萝莉-时雨梦辰.epub', 'application/octet-stream'), 'application/epub+zip')
  assert.equal(typeOf('Scan.PDF', ''), 'application/pdf')
  assert.equal(typeOf('IMG_0001.HEIC'), 'image/heic')
  assert.equal(typeOf('clip.mov', 'application/octet-stream'), 'video/quicktime')
  assert.equal(typeOf('photo.jpg', 'image/png'), 'image/png')
  assert.equal(typeOf('notes.txt', 'text/plain;charset=utf-8'), 'text/plain')
  assert.equal(typeOf('unknown.xyz', ''), 'application/octet-stream')
})
