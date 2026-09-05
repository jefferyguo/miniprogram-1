const assert = require('assert')

const cloudApiPath = require.resolve('../utils/cloud-api')
const accessControlPath = require.resolve('../utils/access-control')
const trainingDataPath = require.resolve('../utils/training-data')
const remoteTrainingPath = require.resolve('../utils/remote-training')

const IDS = {
  retell1: 'tc_e80818d80ebb3b007a0e39a80f1c3edf',
  reading1: 'tc_4c646238524a9c643cc1a25cd2b06e96',
  reading2: 'tc_8c799ff0226a82073ababbedd5d71ad1',
  speech1: 'tc_65a5e1283bb2068c669fdfde84aa7e8e'
}

const storage = new Map()
const cachedCatalogs = new Map()
let catalogRequestCount = 0
let resolveCatalogRequest = null
let detailRequestCount = 0
let detailHandler = null
let lastDetailRequest = null

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

function normalizeContentId(value) {
  const contentId = String(value || '').trim()
  return /^tc_[0-9a-f]{32}$/.test(contentId) ? contentId : ''
}

require.cache[cloudApiPath] = {
  id: cloudApiPath,
  filename: cloudApiPath,
  loaded: true,
  exports: {
    getTrainingCatalogByModule(moduleId) {
      catalogRequestCount += 1
      return new Promise(resolve => {
        resolveCatalogRequest = result => resolve({ ...result, moduleId })
      })
    },
    getTrainingContentById(contentId) {
      detailRequestCount += 1
      lastDetailRequest = { contentId }
      return detailHandler(contentId)
    },
    getTrainingContents() {
      throw new Error('主训练目录不得回退到旧 getTrainingContents 接口')
    }
  }
}

require.cache[accessControlPath] = {
  id: accessControlPath,
  filename: accessControlPath,
  loaded: true,
  exports: {
    syncCloudTrainingAccess() { return true }
  }
}

require.cache[trainingDataPath] = {
  id: trainingDataPath,
  filename: trainingDataPath,
  loaded: true,
  exports: {
    clearCloudTrainingContents(moduleId = '') {
      if (moduleId) cachedCatalogs.delete(moduleId === 'retelling' ? 'retell' : moduleId)
      else cachedCatalogs.clear()
    },
    formatContentTitle(item = {}) { return item.title || '' },
    normalizeTrainingContentId: normalizeContentId,
    setCloudTrainingContents(contents = [], options = {}) {
      const moduleId = options.moduleId === 'retelling' ? 'retell' : options.moduleId
      cachedCatalogs.set(moduleId, contents.slice())
      return true
    },
    splitTitleAndAuthor(title = '') { return { title, author: '' } }
  }
}

delete require.cache[remoteTrainingPath]
const {
  ensureTrainingContentById,
  loadRemoteTrainingContent,
  refreshRemoteTrainingContents
} = require(remoteTrainingPath)

function cloudContent(contentId, moduleId = 'retell', content = '完整训练正文。', extra = {}) {
  return {
    success: true,
    source: 'cloud',
    found: true,
    content: {
      contentId,
      moduleId,
      day: 1,
      sortOrder: 1,
      title: '测试训练',
      content,
      contentVersion: 1,
      status: 'active',
      ...extra
    }
  }
}

async function testCatalogRequestDeduplication() {
  const first = refreshRemoteTrainingContents({ force: true, category: 'retelling' })
  const second = refreshRemoteTrainingContents({ force: true, category: 'retell' })
  assert.equal(catalogRequestCount, 1, 'retell/retelling 必须复用同一模块在途目录请求')

  resolveCatalogRequest({
    success: true,
    source: 'cloud',
    moduleVersion: 'retell-catalog-v1',
    contents: [{
      contentId: IDS.retell1,
      moduleId: 'retell',
      day: 1,
      sortOrder: 1,
      title: '复述测试',
      contentVersion: 1,
      status: 'active'
    }]
  })

  const results = await Promise.all([first, second])
  assert.ok(results.every(result => result.source === 'cloud'))
  assert.equal(cachedCatalogs.get('retell').length, 1)
  assert.equal(cachedCatalogs.get('retell')[0].content, undefined, '轻量目录不得包含完整正文')
}

async function testPermanentIdDetailAndCache() {
  let resolveDetail
  detailHandler = () => new Promise(resolve => { resolveDetail = resolve })
  const first = loadRemoteTrainingContent({ contentId: IDS.retell1 })
  const second = loadRemoteTrainingContent({ contentId: IDS.retell1 })
  assert.equal(detailRequestCount, 1, '同一永久 contentId 必须复用在途详情请求')
  assert.equal(lastDetailRequest.contentId, IDS.retell1)
  resolveDetail(cloudContent(IDS.retell1))

  const results = await Promise.all([first, second])
  assert.ok(results.every(result => result.status === 'ready'))

  detailHandler = () => Promise.reject(Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }))
  const cached = await ensureTrainingContentById({ contentId: IDS.retell1 })
  assert.equal(cached.status, 'ready')
  assert.equal(cached.source, 'content_cache')
  assert.equal(cached.content.content, '完整训练正文。')
  assert.equal(detailRequestCount, 2, '有效缓存仍需在线复核，网络失败时才回退缓存')

  const oldId = await ensureTrainingContentById({ contentId: 'retell-day-1' })
  assert.equal(oldId.status, 'notFound')
  assert.equal(oldId.code, 'INVALID_PERMANENT_CONTENT_ID')
  assert.equal(detailRequestCount, 2, '旧 day 型 ID 不得发往云端')
}

async function testResponseValidationAndErrors() {
  detailHandler = () => Promise.resolve(cloudContent(IDS.reading2, 'reading'))
  const mismatch = await ensureTrainingContentById({ contentId: IDS.reading1 })
  assert.equal(mismatch.status, 'error')
  assert.equal(mismatch.code, 'TRAINING_CONTENT_ID_MISMATCH')

  detailHandler = () => Promise.resolve({
    success: true,
    source: 'cloud',
    found: false,
    content: null,
    message: '内容同步中或暂时无法获取。'
  })
  const missing = await ensureTrainingContentById({ contentId: IDS.reading2 })
  assert.equal(missing.status, 'notFound')
  assert.notEqual(missing.message, '该训练内容已下架。')

  const networkId = 'tc_11111111111111111111111111111111'
  detailHandler = () => Promise.reject(Object.assign(new Error('network unavailable'), { code: 'NETWORK_ERROR' }))
  const failed = await ensureTrainingContentById({ contentId: networkId })
  assert.equal(failed.status, 'networkError')
  assert.equal(failed.code, 'NETWORK_ERROR')
  assert.notEqual(failed.message, '该训练内容已下架。')
}

async function testLastSuccessfulContentCache() {
  detailHandler = () => Promise.resolve(cloudContent(
    IDS.speech1,
    'speech',
    '需要保留的上次成功正文。'
  ))
  const first = await ensureTrainingContentById({ contentId: IDS.speech1, contentVersion: 1 })
  assert.equal(first.status, 'ready')

  const requestsAfterSuccess = detailRequestCount
  detailHandler = () => Promise.reject(new Error('network unavailable'))
  const cached = await ensureTrainingContentById({ contentId: IDS.speech1, contentVersion: 1 })
  assert.equal(cached.status, 'ready')
  assert.equal(cached.source, 'content_cache')
  assert.equal(cached.content.content, '需要保留的上次成功正文。')
  assert.equal(detailRequestCount, requestsAfterSuccess + 1, '命中缓存后仍应在线复核')

  detailHandler = () => Promise.resolve({
    success: true,
    source: 'cloud',
    found: true,
    code: 'content_inactive',
    content: null,
    message: '该训练内容已下架。'
  })
  const inactive = await ensureTrainingContentById({ contentId: IDS.speech1, contentVersion: 1 })
  assert.equal(inactive.status, 'inactive', '云端明确下架必须覆盖旧缓存')

  detailHandler = () => Promise.reject(new Error('network unavailable'))
  const afterInvalidation = await ensureTrainingContentById({ contentId: IDS.speech1, contentVersion: 1 })
  assert.equal(afterInvalidation.status, 'networkError', '下架后必须移除旧正文缓存')
}

async function main() {
  await testCatalogRequestDeduplication()
  await testPermanentIdDetailAndCache()
  await testResponseValidationAndErrors()
  await testLastSuccessfulContentCache()
  console.log('[check-task-content-loading] PASS')
}

main().catch(error => {
  console.error('[check-task-content-loading] FAIL:', error.stack || error.message)
  process.exitCode = 1
})
