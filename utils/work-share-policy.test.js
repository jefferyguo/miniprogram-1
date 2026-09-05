'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  VIDEO_SHARE_DISABLED_MESSAGE,
  isVideoWork,
  isWorkShareAllowed
} = require('./work-share-policy')
const { buildWorkShareConfig } = require('./work-share')

test('语音作品允许分享，所有视频类型写法都禁止分享', () => {
  assert.equal(VIDEO_SHARE_DISABLED_MESSAGE, '视频训练作品暂不支持分享')
  assert.equal(isWorkShareAllowed({ workType: 'audio' }), true)
  assert.equal(isWorkShareAllowed({ mediaType: 'voice' }), true)
  assert.equal(isWorkShareAllowed({ workType: 'video' }), false)
  assert.equal(isWorkShareAllowed({ workType: 'VIDEO' }), false)
  assert.equal(isWorkShareAllowed({ mediaType: 'video' }), false)
  assert.equal(isWorkShareAllowed({ submitType: 'video_record' }), false)
  assert.equal(isWorkShareAllowed({ type: '录像作品' }), false)
  assert.equal(isVideoWork({ videoFileID: 'cloud://video.mp4' }), true)
  assert.equal(isVideoWork({ videoUrl: 'https://example.com/video.mp4' }), true)
  assert.equal(isVideoWork({ workType: 'audio', mediaType: 'video' }), true)
  assert.equal(isVideoWork({ workType: 'audio', mediaUrl: 'https://example.com/conflict.mp4' }), true)
})

test('语音生成公开作品卡片，视频不生成分享卡片或链接', () => {
  const audio = buildWorkShareConfig({
    _id: 'audio-work',
    workType: 'audio',
    title: '朗读练习'
  }, 'mine')
  assert.equal(audio.path, '/pages/work-detail/work-detail?workId=audio-work&source=share')
  assert.match(audio.title, /朗读练习/)

  assert.equal(buildWorkShareConfig({
    _id: 'video-work',
    workType: 'video',
    title: '录像练习'
  }, 'mine'), null)
})
