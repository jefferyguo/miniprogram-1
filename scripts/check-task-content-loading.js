const assert = require('assert')

const cloudApiPath = require.resolve('../utils/cloud-api')
const accessControlPath = require.resolve('../utils/access-control')
const trainingDataPath = require.resolve('../utils/training-data')
const remoteTrainingPath = require.resolve('../utils/remote-training')

let listRequestCount = 0
let resolveListRequest
let detailRequestCount = 0
let detailHandler = null
let lastDetailOptions = null
const cachedContents = []

require.cache[cloudApiPath] = {
  id: cloudApiPath,
  filename: cloudApiPath,
  loaded: true,
  exports: {
    getTrainingContentById(contentId, category, options) {
      detailRequestCount += 1
      lastDetailOptions = options
      return detailHandler(contentId, category, options)
    },
    getTrainingContents() {
      listRequestCount += 1
      return new Promise(resolve => {
        resolveListRequest = resolve
      })
    }
  }
}

require.cache[accessControlPath] = {
  id: accessControlPath,
  filename: accessControlPath,
  loaded: true,
  exports: {
    getCurrentAccessStatus() {
      return { membershipType: 'free' }
    }
  }
}

require.cache[trainingDataPath] = {
  id: trainingDataPath,
  filename: trainingDataPath,
  loaded: true,
  exports: {
    clearCloudTrainingContents() {
      cachedContents.length = 0
    },
    formatContentTitle(item = {}) {
      return item.title || ''
    },
    getTaskByModuleAndContentId(moduleId, contentId) {
      return cachedContents.find(item => item.contentId === contentId) || null
    },
    isTrainingContentComplete(item = {}) {
      if (!item) return false
      const content = String(item.content || item.material || '').trim()
      return Boolean(content && content !== '内容正在加载，请稍后重试。')
    },
    setCloudTrainingContents(contents = []) {
      cachedContents.length = 0
      cachedContents.push(...contents)
    },
    splitTitleAndAuthor(title = '') {
      return { title, author: '' }
    },
    upsertCloudTrainingContent(item) {
      cachedContents.push(item)
    }
  }
}

delete require.cache[remoteTrainingPath]
const { ensureTrainingContentById, loadRemoteTrainingContent, refreshRemoteTrainingContents } = require(remoteTrainingPath)

async function main() {
  const first = refreshRemoteTrainingContents({ force: true, category: 'retelling' })
  const second = refreshRemoteTrainingContents({ force: true, category: 'retelling' })

  assert.strictEqual(
    listRequestCount,
    1,
    '同一分类已有加载请求时，后续 force 请求必须复用在途 Promise，避免旧结果覆盖新缓存'
  )

  resolveListRequest({
    success: true,
    source: 'cloud',
    contents: [{ contentId: 'retelling-v4-day-1', title: '测试正文', content: '完整正文' }],
    hasMore: false
  })

  await Promise.all([first, second])

  cachedContents.length = 0
  let resolveDetailRequest
  detailHandler = () => new Promise(resolve => {
    resolveDetailRequest = resolve
  })
  const firstDetail = loadRemoteTrainingContent({
    contentId: 'retelling-v4-day-1',
    category: 'retelling'
  })
  const secondDetail = loadRemoteTrainingContent({
    contentId: 'retelling-v4-day-1',
    category: 'retelling'
  })
  assert.strictEqual(detailRequestCount, 1, '同一 contentId 的详情请求必须复用在途 Promise')
  resolveDetailRequest({
    success: true,
    source: 'cloud',
    found: true,
    archived: false,
    content: {
      contentId: 'retelling-v4-day-1',
      title: '测试正文',
      content: '这是完整训练正文。'
    }
  })
  const [firstDetailResult, secondDetailResult] = await Promise.all([firstDetail, secondDetail])
  assert.strictEqual(firstDetailResult.status, 'ready')
  assert.strictEqual(secondDetailResult.status, 'ready')
  assert.strictEqual(cachedContents.length, 1, '成功详情必须按 contentId 回填共享缓存')

  const cached = await ensureTrainingContentById({
    contentId: 'retelling-v4-day-1',
    category: 'retelling',
    expectedActive: true
  })
  assert.strictEqual(cached.status, 'ready')
  assert.strictEqual(cached.source, 'cache')
  assert.strictEqual(detailRequestCount, 1, '完整 contentId 缓存命中后不能重复请求')

  cachedContents.length = 0
  detailHandler = contentId => Promise.resolve({
    success: true,
    source: 'cloud',
    found: true,
    archived: false,
    legacyFallback: true,
    sourceContentId: 'reading-day-2',
    content: {
      contentId,
      requestedContentId: contentId,
      sourceContentId: 'reading-day-2',
      legacyFallback: true,
      category: 'reading',
      day: 2,
      title: '旧版云端标题',
      content: '迁移期间读取到的旧版完整正文。'
    }
  })
  const legacyReady = await ensureTrainingContentById({
    contentId: 'reading-v4-day-2',
    category: 'reading',
    day: 2,
    expectedActive: true
  })
  assert.strictEqual(legacyReady.status, 'ready', '当前训练必须允许同分类同 Day 的旧云记录迁移回退')
  assert.strictEqual(legacyReady.content.contentId, 'reading-v4-day-2', '旧云正文必须缓存到请求的 v4 contentId')
  assert.strictEqual(legacyReady.content.sourceContentId, 'reading-day-2')
  assert.strictEqual(legacyReady.content.legacyFallback, true)
  assert.strictEqual(lastDetailOptions.day, 2, '详情请求必须把 Day 传给迁移兼容查询')
  assert.strictEqual(lastDetailOptions.allowLegacyCurrentFallback, true, '普通训练必须显式允许迁移兼容查询')

  detailHandler = () => Promise.resolve({
    success: true,
    source: 'cloud',
    found: false,
    content: null
  })
  const missing = await loadRemoteTrainingContent({
    contentId: 'retelling-v4-day-404',
    category: 'retelling'
  })
  assert.strictEqual(missing.status, 'notFound', '只有云端明确 found=false 才能判定不存在')

  detailHandler = () => Promise.reject(new Error('network unavailable'))
  const failed = await loadRemoteTrainingContent({
    contentId: 'retelling-v4-day-500',
    category: 'retelling'
  })
  assert.strictEqual(failed.status, 'error', '网络错误必须进入可重试状态')

  detailHandler = () => Promise.resolve({
    success: true,
    source: 'cloud',
    found: true,
    content: {
      contentId: 'reading-day-1',
      title: '旧版同 Day 正文',
      content: '旧版正文不能冒充 v4 内容。'
    }
  })
  const wrongContent = await ensureTrainingContentById({
    contentId: 'reading-v4-day-1',
    category: 'reading',
    expectedActive: true
  })
  assert.strictEqual(wrongContent.status, 'error', '详情接口返回不同 contentId 时必须拒绝写入缓存')
  assert.strictEqual(wrongContent.code, 'TRAINING_CONTENT_ID_MISMATCH')

  const unknownActionError = new Error('unknown action: getTrainingContentById')
  unknownActionError.code = 'UNKNOWN_ACTION'
  detailHandler = () => Promise.reject(unknownActionError)
  const unknownAction = await ensureTrainingContentById({
    contentId: 'reading-v4-day-214',
    category: 'reading',
    expectedActive: true
  })
  assert.strictEqual(unknownAction.status, 'error', '旧云函数 unknown action 必须作为可重试接口错误')
  assert.strictEqual(unknownAction.code, 'UNKNOWN_ACTION')

  detailHandler = () => Promise.resolve({
    success: true,
    source: 'cloud',
    found: false,
    content: null
  })
  const mismatch = await ensureTrainingContentById({
    contentId: 'reading-v4-day-214',
    category: 'reading',
    day: 214,
    expectedActive: true
  })
  assert.strictEqual(mismatch.status, 'error', '本地 active v4 索引存在但云端缺失时不能误报下架')
  assert.strictEqual(mismatch.code, 'TRAINING_CONTENT_VERSION_MISMATCH')

  detailHandler = () => Promise.resolve({
    success: true,
    source: 'cloud',
    found: false,
    legacyFallbackAttempted: true,
    content: null
  })
  const confirmedMissing = await ensureTrainingContentById({
    contentId: 'reading-v4-day-213',
    category: 'reading',
    day: 213,
    expectedActive: true
  })
  assert.strictEqual(confirmedMissing.status, 'notFound', '精确查询和合法迁移回退都未命中后才可确认不存在')

  cachedContents.length = 0
  const categoryLoad = refreshRemoteTrainingContents({ force: true, category: 'speech' })
  detailHandler = () => Promise.resolve({
    success: true,
    source: 'cloud',
    found: false,
    content: null
  })
  const ensureDuringCategoryLoad = ensureTrainingContentById({
    contentId: 'speech-v4-day-1',
    category: 'speech',
    expectedActive: true
  })
  resolveListRequest({
    success: true,
    source: 'cloud',
    contents: [{
      contentId: 'speech-v4-day-1',
      category: 'speech',
      day: 1,
      title: '演讲 Day 1',
      content: '分类请求返回的完整演讲正文。'
    }],
    hasMore: false
  })
  await categoryLoad
  const ensuredFromCategory = await ensureDuringCategoryLoad
  assert.strictEqual(ensuredFromCategory.status, 'ready', '精确查询暂未命中时必须等待已有分类 in-flight 请求')
  assert.strictEqual(ensuredFromCategory.source, 'category-cache')
  console.log('[check-task-content-loading] PASS')
}

main().catch(error => {
  console.error('[check-task-content-loading] FAIL:', error.stack || error.message)
  process.exitCode = 1
})
