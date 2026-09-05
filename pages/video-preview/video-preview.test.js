'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const storage = new Map()
const calls = { hidden: 0, navigatedUrl: '', toasts: [] }
global.wx = {
  setStorageSync(key, value) { storage.set(key, value) },
  getStorageSync(key) { return storage.get(key) },
  removeStorageSync(key) { storage.delete(key) },
  navigateTo(options) { calls.navigatedUrl = options.url },
  hideShareMenu() { calls.hidden += 1 },
  showToast(options) { calls.toasts.push(options.title) }
}

const { previewVideoByPath } = require('../../utils/work-media')
let pageDefinition = null
global.Page = definition => { pageDefinition = definition }
require('./video-preview')

function createPage() {
  const page = { ...pageDefinition, data: { ...pageDefinition.data } }
  page.setData = function setData(patch) { Object.assign(this.data, patch) }
  return page
}

test('正常回看通过本机一次性凭据打开，路由不携带视频地址', () => {
  const videoUrl = 'https://example.com/private-video.mp4?token=secret'
  previewVideoByPath(videoUrl, '本人训练录像')

  assert.match(calls.navigatedUrl, /^\/pages\/video-preview\/video-preview\?previewKey=/)
  assert.equal(calls.navigatedUrl.includes(videoUrl), false)
  const previewKey = decodeURIComponent(calls.navigatedUrl.split('previewKey=')[1])
  assert.equal(storage.get(previewKey).src, videoUrl)

  const page = createPage()
  page.onLoad({ previewKey: encodeURIComponent(previewKey) })
  assert.equal(page.data.src, videoUrl)
  assert.equal(page.data.title, '本人训练录像')
  assert.equal(storage.has(previewKey), false)
  assert.equal(calls.hidden > 0, true)
})

test('直接构造 src 参数不能打开视频', () => {
  const page = createPage()
  page.onLoad({ src: encodeURIComponent('https://example.com/public.mp4') })

  assert.equal(page.data.src, '')
  assert.equal(page.data.hasError, true)
  assert.equal(calls.toasts.at(-1), '视频文件暂时无法查看')
})
