const assert = require('assert')

const trainingData = require('../utils/training-data')
const remoteTrainingPath = require.resolve('../utils/remote-training')
const taskDetailPath = require.resolve('../pages/task-detail/task-detail.js')

const storage = new Map()
const toastTitles = []
let detailHandler = null
let detailRequestCount = 0
let pageDefinition = null

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
  const category = options.category || 'retelling'
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
  trainingData.upsertCloudTrainingContent(item)
  return { status: 'ready', source: 'cloud', found: true, content: item }
}

async function testRepresentativeRoutes() {
  storage.set('userInfo', {
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
      contentId: 'reading-v4-day-1'
    },
    {
      moduleId: 'reading',
      category: 'reading',
      day: 214,
      contentId: 'reading-v4-day-214'
    },
    {
      moduleId: 'retell',
      category: 'retelling',
      day: 255,
      contentId: 'retelling-v4-day-255'
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
    assert.strictEqual(page.data.contentLoadState, 'loading')
    await waitForMicrotasks()
    assert.strictEqual(page.data.contentLoadState, 'ready')
    assert.strictEqual(page.data.task.contentId, item.contentId)
  }

  trainingData.clearCloudTrainingContents('speech')
  detailRequestCount = 0
  detailHandler = () => Promise.reject(new Error('演讲 Day 1 本地正文完整，不应请求云端'))
  const speechPage = createPage()
  speechPage.onLoad({
    moduleId: 'speech',
    day: '1',
    contentId: 'speech-v4-day-1'
  })
  assert.strictEqual(speechPage.data.contentLoadState, 'ready')
  assert.strictEqual(detailRequestCount, 0)
  storage.delete('userInfo')
}

async function testFirstLoadAndCache() {
  trainingData.clearCloudTrainingContents('retelling')
  toastTitles.length = 0
  detailRequestCount = 0
  const request = deferred()
  detailHandler = () => request.promise
  const page = createPage()

  page.onLoad({
    moduleId: 'retell',
    day: '1',
    contentId: 'retelling-v4-day-1'
  })

  assert.strictEqual(page.data.contentLoadState, 'loading')
  assert.strictEqual(page.data.contentReady, false)
  assert.strictEqual(toastTitles.includes('训练任务不存在'), false)

  setTimeout(() => {
    request.resolve(readyResult('retelling-v4-day-1', '首次进入后自动显示的完整复述正文。'))
  }, 500)
  await new Promise(resolve => setTimeout(resolve, 550))
  await waitForMicrotasks()

  assert.strictEqual(page.data.contentLoadState, 'ready')
  assert.strictEqual(page.data.contentReady, true)
  assert.strictEqual(page.data.task.material, '首次进入后自动显示的完整复述正文。')
  assert.strictEqual(toastTitles.includes('训练任务不存在'), false)

  detailRequestCount = 0
  detailHandler = () => Promise.reject(new Error('完整缓存命中时不应请求云端'))
  const cachedPage = createPage()
  cachedPage.onLoad({
    moduleId: 'retell',
    day: '1',
    contentId: 'retelling-v4-day-1'
  })
  assert.strictEqual(cachedPage.data.contentLoadState, 'ready')
  assert.strictEqual(detailRequestCount, 0)
}

async function testErrorAndNotFound() {
  trainingData.clearCloudTrainingContents('retelling')
  detailHandler = () => Promise.resolve({ status: 'error', source: 'none', message: 'network failed' })
  const errorPage = createPage()
  errorPage.onLoad({ moduleId: 'retell', day: '1', contentId: 'retelling-v4-day-1' })
  await waitForMicrotasks()
  assert.strictEqual(errorPage.data.contentLoadState, 'error')
  assert.strictEqual(errorPage.data.trainingContentMessage, '完整训练内容加载失败，请检查网络后重新加载。')

  detailHandler = () => Promise.resolve(readyResult(
    'retelling-v4-day-1',
    '点击重新加载后同页恢复的完整正文。'
  ))
  errorPage.retryTrainingContent()
  await waitForMicrotasks()
  assert.strictEqual(errorPage.data.contentLoadState, 'ready')
  assert.strictEqual(errorPage.data.task.material, '点击重新加载后同页恢复的完整正文。')

  trainingData.clearCloudTrainingContents('retelling')
  detailHandler = () => Promise.resolve({ status: 'notFound', source: 'cloud', found: false })
  const missingPage = createPage()
  missingPage.onLoad({ moduleId: 'retell', day: '404', contentId: 'retelling-v4-day-404' })
  await waitForMicrotasks()
  assert.strictEqual(missingPage.data.contentLoadState, 'notFound')
  assert.strictEqual(missingPage.data.trainingContentMessage, '该训练内容暂不存在或已下架。')
}

async function testRaceAndUnload() {
  trainingData.clearCloudTrainingContents('retelling')
  const first = deferred()
  const second = deferred()
  let callIndex = 0
  detailHandler = () => {
    callIndex += 1
    return callIndex === 1 ? first.promise : second.promise
  }
  const page = createPage()
  const route = { moduleId: 'retell', day: '1', contentId: 'retelling-v4-day-1' }
  page.onLoad(route)
  page.loadCurrentTrainingContent(route, { retry: true })
  second.resolve(readyResult('retelling-v4-day-1', '后发请求成功正文。'))
  await waitForMicrotasks()
  first.resolve({ status: 'error', source: 'none', message: '迟到的旧失败' })
  await waitForMicrotasks()
  assert.strictEqual(page.data.contentLoadState, 'ready')
  assert.strictEqual(page.data.task.material, '后发请求成功正文。')

  trainingData.clearCloudTrainingContents('retelling')
  const unloadRequest = deferred()
  detailHandler = () => unloadRequest.promise
  const unloadingPage = createPage()
  unloadingPage.onLoad(route)
  unloadingPage.onUnload()
  const countAfterUnload = unloadingPage._setDataCount
  unloadRequest.resolve(readyResult('retelling-v4-day-1', '卸载后不应写入页面。'))
  await waitForMicrotasks()
  assert.strictEqual(unloadingPage._setDataCount, countAfterUnload)
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
