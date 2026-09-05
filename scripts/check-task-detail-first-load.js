const assert = require('assert')

const trainingData = require('../utils/training-data')
const { CONTENT_STATE } = require('../utils/training-content-state')
const remoteTrainingPath = require.resolve('../utils/remote-training')
const taskDetailPath = require.resolve('../pages/task-detail/task-detail.js')

const storage = new Map()
const toastTitles = []
let detailHandler = null
let detailRequestCount = 0
let pageDefinition = null

function getContentId(moduleId, day) {
  const module = trainingData.getModuleById(moduleId)
  const task = module && module.days.find(item => Number(item.day) === Number(day))
  assert.ok(task && /^tc_[0-9a-f]{32}$/.test(task.contentId), `${moduleId} Day ${day} 缺少永久 contentId`)
  return task.contentId
}

function createInnerAudioContext() {
  return {
    autoplay: false,
    src: '',
    currentTime: 0,
    duration: 0,
    play() {},
    pause() {},
    stop() {},
    seek() {},
    destroy() {},
    onPlay() {},
    onPause() {},
    onStop() {},
    onEnded() {},
    onTimeUpdate() {},
    onCanplay() {},
    onError() {}
  }
}

global.wx = {
  getStorageSync(key) {
    return storage.get(key)
  },
  setStorageSync(key, value) {
    storage.set(key, value)
  },
  removeStorageSync(key) {
    storage.delete(key)
  },
  showToast(options = {}) {
    toastTitles.push(options.title || '')
  },
  showModal() {},
  showShareMenu() {},
  createInnerAudioContext,
  getRecorderManager() {
    return {
      onStart() {},
      onStop() {},
      onError() {},
      start() {},
      stop() {}
    }
  }
}
global.getApp = () => ({ globalData: {} })
global.Page = definition => {
  pageDefinition = definition
}

require.cache[remoteTrainingPath] = {
  id: remoteTrainingPath,
  filename: remoteTrainingPath,
  loaded: true,
  exports: {
    ensureTrainingContentById(options) {
      detailRequestCount += 1
      return detailHandler(options)
    },
    getRemoteTrainingDebugState() {
      return {
        categoryLoading: false,
        contentLoading: false,
        cacheHit: false
      }
    },
    refreshRemoteTrainingContents() {
      return Promise.resolve({ source: 'local_fallback' })
    }
  }
}

delete require.cache[taskDetailPath]
require(taskDetailPath)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createPage() {
  const page = { ...pageDefinition }
  page.data = clone(pageDefinition.data)
  page._setDataCount = 0
  page.setData = function setData(patch, callback) {
    this._setDataCount += 1
    this.data = { ...this.data, ...patch }
    if (typeof callback === 'function') callback()
  }
  return page
}

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

function waitForMicrotasks() {
  return new Promise(resolve => setImmediate(resolve))
}

function readyResult(contentId, content, options = {}) {
  const category = options.category || 'retell'
  const day = Number(options.day || 1)
  const item = {
    contentId,
    category,
    day,
    title: options.title || '1885次拒绝，史泰龙的逆袭之路',
    content,
    material: content,
    membershipLevel: 'free',
    status: 'published'
  }
  return { status: 'ready', source: 'cloud', found: true, content: item }
}

async function testRepresentativeRoutes() {
  storage.set('userInfo', {
    _id: 'member-user',
    nickname: '口才学员ABC234',
    nicknameSource: 'random',
    profileCompleted: true,
    phone: '13800138000',
    phoneBound: true,
    isLogin: true,
    membershipType: 'yearly',
    membershipStatus: 'active'
  })
  const remoteCases = [
    {
      moduleId: 'reading',
      category: 'reading',
      day: 1,
      contentId: getContentId('reading', 1)
    },
    {
      moduleId: 'reading',
      category: 'reading',
      day: 214,
      contentId: getContentId('reading', 214)
    },
    {
      moduleId: 'retell',
      category: 'retell',
      day: 255,
      contentId: getContentId('retell', 255)
    }
  ]

  for (const item of remoteCases) {
    trainingData.clearCloudTrainingContents(item.category)
    detailHandler = () => Promise.resolve(readyResult(
      item.contentId,
      `${item.contentId} 完整正文`,
      item
    ))
    const page = createPage()
    page.onLoad({
      moduleId: item.moduleId,
      day: String(item.day),
      contentId: item.contentId
    })
    assert.strictEqual(page.data.contentLoadState, CONTENT_STATE.LOADING)
    await waitForMicrotasks()
    assert.strictEqual(page.data.contentLoadState, CONTENT_STATE.READY)
    assert.strictEqual(page.data.task.contentId, item.contentId)
  }

  trainingData.clearCloudTrainingContents('speech')
  detailRequestCount = 0
  const speechContentId = getContentId('speech', 1)
  detailHandler = () => Promise.resolve(readyResult(
    speechContentId,
    '演讲 Day 1 云端完整正文。',
    { moduleId: 'speech', category: 'speech', day: 1 }
  ))
  const speechPage = createPage()
  speechPage.onLoad({
    moduleId: 'speech',
    day: '1',
    contentId: speechContentId
  })
  assert.strictEqual(speechPage.data.contentLoadState, CONTENT_STATE.LOADING)
  await waitForMicrotasks()
  assert.strictEqual(speechPage.data.contentLoadState, CONTENT_STATE.READY)
  assert.strictEqual(detailRequestCount, 1)
  storage.delete('userInfo')
}

async function testFirstLoadAndCache() {
  trainingData.clearCloudTrainingContents('retell')
  toastTitles.length = 0
  detailRequestCount = 0
  const request = deferred()
  detailHandler = () => request.promise
  const page = createPage()
  const retellContentId = getContentId('retell', 1)

  page.onLoad({
    moduleId: 'retell',
    day: '1',
    contentId: retellContentId
  })

  assert.strictEqual(page.data.contentLoadState, CONTENT_STATE.LOADING)
  assert.strictEqual(page.data.contentReady, false)
  assert.strictEqual(toastTitles.includes('训练任务不存在'), false)

  setTimeout(() => {
    request.resolve(readyResult(retellContentId, '首次进入后自动显示的完整复述正文。'))
  }, 50)
  await new Promise(resolve => setTimeout(resolve, 80))
  await waitForMicrotasks()

  assert.strictEqual(page.data.contentLoadState, CONTENT_STATE.READY)
  assert.strictEqual(page.data.contentReady, true)
  assert.strictEqual(page.data.task.material, '首次进入后自动显示的完整复述正文。')
  assert.strictEqual(toastTitles.includes('训练任务不存在'), false)

  assert.strictEqual(detailRequestCount, 1)
}

async function testErrorAndNotFound() {
  trainingData.clearCloudTrainingContents('retell')
  const retellContentId = getContentId('retell', 1)
  detailHandler = () => Promise.resolve({
    status: 'networkError',
    source: 'none',
    message: '训练内容读取失败，请检查网络后重试。'
  })
  const errorPage = createPage()
  errorPage.onLoad({ moduleId: 'retell', day: '1', contentId: retellContentId })
  await waitForMicrotasks()
  assert.strictEqual(errorPage.data.contentLoadState, CONTENT_STATE.NETWORK_ERROR)
  assert.strictEqual(errorPage.data.trainingContentMessage, '训练内容读取失败，请检查网络后重试。')

  detailHandler = () => Promise.resolve(readyResult(
    retellContentId,
    '点击重新加载后同页恢复的完整正文。'
  ))
  errorPage.retryTrainingContent()
  await waitForMicrotasks()
  assert.strictEqual(errorPage.data.contentLoadState, CONTENT_STATE.READY)
  assert.strictEqual(errorPage.data.task.material, '点击重新加载后同页恢复的完整正文。')

  trainingData.clearCloudTrainingContents('retell')
  detailHandler = () => Promise.resolve({
    status: 'notFound',
    source: 'cloud',
    found: false,
    message: '内容同步中或暂时无法获取。'
  })
  const missingPage = createPage()
  missingPage.onLoad({
    moduleId: 'retell',
    day: '404',
    contentId: 'tc_33333333333333333333333333333333'
  })
  await waitForMicrotasks()
  assert.strictEqual(missingPage.data.contentLoadState, CONTENT_STATE.NOT_FOUND)
  assert.strictEqual(missingPage.data.trainingContentMessage, '内容同步中或暂时无法获取。')
}

async function testRaceAndUnload() {
  trainingData.clearCloudTrainingContents('retell')
  const first = deferred()
  const second = deferred()
  let callIndex = 0
  detailHandler = () => {
    callIndex += 1
    return callIndex === 1 ? first.promise : second.promise
  }
  const page = createPage()
  const retellContentId = getContentId('retell', 1)
  const route = { moduleId: 'retell', day: '1', contentId: retellContentId }
  page.onLoad(route)
  page.loadCurrentTrainingContent(route, { retry: true })
  second.resolve(readyResult(retellContentId, '后发请求成功正文。'))
  await waitForMicrotasks()
  first.resolve({ status: 'networkError', source: 'none', message: '迟到的旧失败' })
  await waitForMicrotasks()
  assert.strictEqual(page.data.contentLoadState, CONTENT_STATE.READY)
  assert.strictEqual(page.data.task.material, '后发请求成功正文。')

  trainingData.clearCloudTrainingContents('retell')
  const unloadRequest = deferred()
  detailHandler = () => unloadRequest.promise
  const unloadingPage = createPage()
  unloadingPage.onLoad(route)
  unloadingPage.onUnload()
  const countAfterUnload = unloadingPage._setDataCount
  unloadRequest.resolve(readyResult(retellContentId, '卸载后不应写入页面。'))
  await waitForMicrotasks()
  assert.strictEqual(unloadingPage._setDataCount, countAfterUnload)

  const historicalRequest = deferred()
  detailHandler = () => historicalRequest.promise
  const historicalPage = createPage()
  historicalPage.onLoad({
    historyOriginal: '1',
    moduleId: 'retell',
    contentId: retellContentId
  })
  historicalPage.onUnload()
  const historicalCountAfterUnload = historicalPage._setDataCount
  historicalRequest.resolve(readyResult(retellContentId, '历史原文迟到响应不应写入页面。'))
  await waitForMicrotasks()
  assert.strictEqual(historicalPage._setDataCount, historicalCountAfterUnload)
}

async function main() {
  await testFirstLoadAndCache()
  await testErrorAndNotFound()
  await testRaceAndUnload()
  await testRepresentativeRoutes()
  console.log('[check-task-detail-first-load] PASS')
}

main().catch(error => {
  console.error('[check-task-detail-first-load] FAIL:', error.stack || error.message)
  process.exitCode = 1
})
