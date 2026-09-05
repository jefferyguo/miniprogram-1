'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

let detailImplementation = async () => ({ data: {} })
const cloudApiPath = require.resolve('../../utils/cloud-api')
require.cache[cloudApiPath] = {
  id: cloudApiPath,
  filename: cloudApiPath,
  loaded: true,
  exports: {
    getSquareWorkDetail: (...args) => detailImplementation(...args),
    toggleSquareLike: async () => ({})
  }
}

const shareCalls = { hide: 0, show: 0, toast: [] }
global.wx = {
  hideShareMenu() { shareCalls.hide += 1 },
  showShareMenu() { shareCalls.show += 1 },
  showToast(options) { shareCalls.toast.push(options.title) },
  switchTab() {},
  cloud: {}
}

let pageDefinition = null
global.Page = definition => { pageDefinition = definition }
require('./work-detail')

function createPage(workId = 'work-1') {
  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      workId
    }
  }
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch)
    if (typeof callback === 'function') callback()
  }
  return page
}

function resetCalls() {
  shareCalls.hide = 0
  shareCalls.show = 0
  shareCalls.toast = []
}

test('构造视频公开详情路由时不加载媒体、不生成卡片并保持系统分享关闭', async () => {
  resetCalls()
  detailImplementation = async () => ({
    data: {
      _id: 'video-1',
      available: true,
      workType: 'video',
      videoUrl: 'https://example.com/video.mp4'
    }
  })
  const page = createPage('video-1')

  await page.loadWorkDetail()

  assert.equal(page.data.videoShareBlocked, true)
  assert.equal(page.data.errorText, '视频训练作品暂不支持分享')
  assert.equal(page.data.work, null)
  assert.equal(page.data.playableSrc, '')
  assert.equal(shareCalls.show, 0)
  assert.equal(page.onShareAppMessage(), undefined)
  assert.equal(page.onShareTimeline(), undefined)
})

test('云端拒绝视频详情时展示明确提示，语音详情仍生成原有分享路径', async () => {
  resetCalls()
  detailImplementation = async () => {
    const error = new Error('视频训练作品暂不支持分享')
    error.code = 'VIDEO_SHARE_DISABLED'
    throw error
  }
  const blockedPage = createPage('video-2')
  await blockedPage.loadWorkDetail()
  assert.equal(blockedPage.data.videoShareBlocked, true)
  assert.equal(blockedPage.data.errorText, '视频训练作品暂不支持分享')

  detailImplementation = async () => ({
    data: {
      _id: 'audio-1',
      available: true,
      workType: 'audio',
      audioUrl: 'https://example.com/audio.mp3',
      title: '语音训练'
    }
  })
  const audioPage = createPage('audio-1')
  await audioPage.loadWorkDetail()
  const shareConfig = audioPage.onShareAppMessage()

  assert.equal(audioPage.data.videoShareBlocked, false)
  assert.equal(audioPage.data.shareImageReady, false)
  assert.equal(audioPage.data.work.shareAllowed, true)
  assert.match(shareConfig.path, /workId=audio-1/)
  assert.equal(shareCalls.show > 0, true)
})
