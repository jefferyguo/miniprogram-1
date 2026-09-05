'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { collectShareableRecords, isVideoWorkRecord } = require('./video-share-policy')

test('任一类型或媒体字段表明视频时，云端都按视频处理', () => {
  assert.equal(isVideoWorkRecord({ workType: 'audio' }), false)
  assert.equal(isVideoWorkRecord({ workType: 'audio', mediaType: 'video' }), true)
  assert.equal(isVideoWorkRecord({ workType: 'audio', type: '录像作品' }), true)
  assert.equal(isVideoWorkRecord({ workType: 'audio', videoFileID: 'cloud://env/video' }), true)
  assert.equal(isVideoWorkRecord({ workType: 'audio', mediaUrl: 'https://example.com/work.mp4' }), true)
  assert.equal(isVideoWorkRecord({ filePath: 'https://example.com/work.mp3' }), false)
})

test('首批全是视频时继续翻页，直到取到所需语音作品', async () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    _id: `video-${index}`,
    workType: 'video'
  })).concat([
    { _id: 'audio-1', workType: 'audio' },
    { _id: 'audio-2', workType: 'audio' }
  ])
  const offsets = []
  const visible = await collectShareableRecords((offset, limit) => {
    offsets.push(offset)
    return records.slice(offset, offset + limit)
  }, { limit: 2, batchSize: 100 })

  assert.deepEqual(visible.map(item => item._id), ['audio-1', 'audio-2'])
  assert.deepEqual(offsets, [0, 100])
})
