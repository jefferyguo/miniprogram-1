'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { inspectMp4 } = require('./media-inspector')

function box(type, payload = Buffer.alloc(0)) {
  const result = Buffer.alloc(8 + payload.length)
  result.writeUInt32BE(result.length, 0)
  result.write(type, 4, 4, 'ascii')
  payload.copy(result, 8)
  return result
}

function makeTrack(handlerType, codec = 'mp4a') {
  const hdlrPayload = Buffer.alloc(12)
  hdlrPayload.write(handlerType, 8, 4, 'ascii')
  const samplePayload = Buffer.alloc(28)
  samplePayload.writeUInt16BE(2, 16)
  samplePayload.writeUInt32BE(48000 * 65536, 24)
  const stsdPayload = Buffer.concat([Buffer.alloc(8), box(codec, samplePayload)])
  return box('trak', box('mdia', Buffer.concat([
    box('hdlr', hdlrPayload),
    box('minf', box('stbl', box('stsd', stsdPayload)))
  ])))
}

test('detects AAC audio stream metadata in an MP4 container', () => {
  const info = inspectMp4(box('moov', Buffer.concat([makeTrack('vide', 'avc1'), makeTrack('soun', 'mp4a')])))
  assert.equal(info.probeStatus, 'ok')
  assert.equal(info.hasAudioStream, true)
  assert.equal(info.audioCodec, 'mp4a')
  assert.equal(info.sampleRate, 48000)
  assert.equal(info.channels, 2)
})

test('distinguishes an MP4 with no audio track', () => {
  const info = inspectMp4(box('moov', makeTrack('vide', 'avc1')))
  assert.equal(info.probeStatus, 'ok')
  assert.equal(info.hasAudioStream, false)
})

test('does not make a false no-audio claim for an unparseable file', () => {
  const info = inspectMp4(Buffer.from('not an mp4'))
  assert.equal(info.probeStatus, 'unsupported_or_incomplete')
  assert.equal(info.hasAudioStream, null)
})
