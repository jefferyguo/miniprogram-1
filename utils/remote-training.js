const {
  getTrainingCatalogByModule,
  getTrainingContentById,
  getTrainingContents
} = require('./cloud-api')
const { syncCloudTrainingAccess } = require('./access-control')
const { normalizeError } = require('./error-normalizer')
const {
  clearCloudTrainingContents,
  formatContentTitle,
  normalizeTrainingContentId,
  setCloudTrainingContents,
  splitTitleAndAuthor
} = require('./training-data')

const MAIN_MODULES = ['reading', 'retell', 'topic', 'mandarin', 'speech', 'leaderSpeech']
const CATALOG_SCHEMA_VERSION = 1
const CONTENT_CACHE_SCHEMA_VERSION = 1
const CONTENT_CACHE_PREFIX = 'training-content:'
const CONTENT_CACHE_INDEX_KEY = 'training-content-cache-index'
const CATALOG_CACHE_PREFIX = 'training-catalog:'
const MAX_CONTENT_CACHE_ITEMS = 40
const pendingCatalogRequests = new Map()
const pendingContentRequests = new Map()
const catalogRevisions = new Map()
const lastLoadedAt = new Map()
let lastContentCacheAccessAt = 0

function nextContentCacheAccessAt() {
  lastContentCacheAccessAt = Math.max(Date.now(), lastContentCacheAccessAt + 1)
  return lastContentCacheAccessAt
}

function normalizeCategory(value = '') {
  const category = String(value || '').trim()
  return category === 'retelling' ? 'retell' : category
}

function isMainModule(value = '') {
  return MAIN_MODULES.includes(normalizeCategory(value))
}

function getTrainingBody(item = {}) {
  return String(item.content || '').trim()
}

function getContentVersion(item = {}) {
  const version = Number(item.contentVersion || item.version || 0)
  return Number.isFinite(version) && version >= 1 ? version : 0
}

function canUseStorage() {
  return typeof wx !== 'undefined' &&
    typeof wx.getStorageSync === 'function' &&
    typeof wx.setStorageSync === 'function'
}

function storageGet(key) {
  if (!canUseStorage()) return null
  try {
    return wx.getStorageSync(key) || null
  } catch (error) {
    console.warn('[remote-training] 读取缓存失败:', error && error.message ? error.message : error)
    return null
  }
}

function storageSet(key, value) {
  if (!canUseStorage()) return false
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (error) {
    console.warn('[remote-training] 写入缓存失败:', error && error.message ? error.message : error)
    return false
  }
}

function storageRemove(key) {
  if (!canUseStorage()) return
  try {
    if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key)
    else wx.setStorageSync(key, '')
  } catch (_) {}
}

function normalizeTrainingItem(item = {}) {
  const parts = splitTitleAndAuthor(item.title || '')
  const author = Object.prototype.hasOwnProperty.call(item, 'author')
    ? String(item.author || '').trim()
    : parts.author
  const title = parts.title || String(item.title || '').trim()
  const contentId = normalizeTrainingContentId(item.contentId)
  const content = getTrainingBody(item)
  return {
    ...item,
    contentId,
    moduleId: normalizeCategory(item.moduleId || item.category),
    category: normalizeCategory(item.moduleId || item.category),
    title,
    contentTitle: title,
    author,
    displayTitle: formatContentTitle({ title, author }),
    content,
    // material 只在 UI 边界映射，云端和缓存的正文真值始终是 content。
    material: content
  }
}

function getCatalogCacheKey(moduleId) {
  return `${CATALOG_CACHE_PREFIX}${normalizeCategory(moduleId)}`
}

function saveCatalogCache(moduleId, result) {
  storageSet(getCatalogCacheKey(moduleId), {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    moduleId,
    moduleVersion: String(result.moduleVersion || ''),
    cachedAt: Date.now(),
    contents: Array.isArray(result.contents) ? result.contents : []
  })
}

function loadCatalogCache(moduleId) {
  const cached = storageGet(getCatalogCacheKey(moduleId))
  if (!cached || cached.schemaVersion !== CATALOG_SCHEMA_VERSION || cached.moduleId !== moduleId) return null
  if (!Array.isArray(cached.contents) || !cached.contents.length) return null
  return cached
}

function getContentStorageKey(contentId) {
  return `${CONTENT_CACHE_PREFIX}${contentId}`
}

function getCacheIndex() {
  const index = storageGet(CONTENT_CACHE_INDEX_KEY)
  return Array.isArray(index) ? index.filter(item => item && normalizeTrainingContentId(item.contentId)) : []
}

function writeCacheIndex(index) {
  storageSet(CONTENT_CACHE_INDEX_KEY, index)
}

function removeContentCache(contentId) {
  const permanentId = normalizeTrainingContentId(contentId)
  if (!permanentId) return
  storageRemove(getContentStorageKey(permanentId))
  writeCacheIndex(getCacheIndex().filter(item => item.contentId !== permanentId))
}

function validateCachedContent(payload, expected = {}) {
  if (!payload || payload.schemaVersion !== CONTENT_CACHE_SCHEMA_VERSION) return null
  const contentId = normalizeTrainingContentId(payload.contentId)
  if (!contentId || contentId !== normalizeTrainingContentId(expected.contentId)) return null
  if (String(payload.status || '').toLowerCase() !== 'active') return null
  if (!String(payload.title || '').trim() || !String(payload.content || '').trim()) return null
  const contentVersion = Number(payload.contentVersion || 0)
  if (!Number.isFinite(contentVersion) || contentVersion < 1) return null
  if (expected.contentVersion && contentVersion < Number(expected.contentVersion)) return null
  return payload
}

function touchContentCache(payload) {
  const now = nextContentCacheAccessAt()
  const touched = { ...payload, lastAccessedAt: now }
  storageSet(getContentStorageKey(payload.contentId), touched)
  const index = getCacheIndex()
    .filter(item => item.contentId !== payload.contentId)
    .concat({ contentId: payload.contentId, lastAccessedAt: now })
    .sort((left, right) => Number(right.lastAccessedAt || 0) - Number(left.lastAccessedAt || 0))
  const evicted = index.slice(MAX_CONTENT_CACHE_ITEMS)
  evicted.forEach(item => storageRemove(getContentStorageKey(item.contentId)))
  writeCacheIndex(index.slice(0, MAX_CONTENT_CACHE_ITEMS))
  return touched
}

function saveContentCache(content = {}) {
  const normalized = normalizeTrainingItem(content)
  const contentId = normalizeTrainingContentId(normalized.contentId)
  const contentVersion = getContentVersion(normalized)
  if (!contentId || !contentVersion || !normalized.title || !normalized.content) return null
  const existing = validateCachedContent(storageGet(getContentStorageKey(contentId)), { contentId })
  if (existing && Number(existing.contentVersion || 0) > contentVersion) {
    return touchContentCache(existing)
  }
  const now = Date.now()
  const payload = {
    schemaVersion: CONTENT_CACHE_SCHEMA_VERSION,
    contentId,
    moduleId: normalizeCategory(normalized.moduleId || normalized.category),
    title: normalized.title,
    content: normalized.content,
    contentVersion,
    status: 'active',
    cachedAt: now,
    lastAccessedAt: now,
    day: Number(normalized.day || normalized.sortOrder || 0),
    sortOrder: Number(normalized.sortOrder || normalized.day || 0),
    membershipLevel: normalized.membershipLevel || '',
    titleStyle: normalized.titleStyle || null,
    contentStyle: normalized.contentStyle || null,
    contentRichStyle: normalized.contentRichStyle || null,
    richContentHtml: normalized.richContentHtml || ''
  }
  return touchContentCache(payload)
}

function loadContentCache(contentId, expectedVersion = 0) {
  const permanentId = normalizeTrainingContentId(contentId)
  if (!permanentId) return null
  const cached = storageGet(getContentStorageKey(permanentId))
  const valid = validateCachedContent(cached, {
    contentId: permanentId,
    contentVersion: Number(expectedVersion || 0)
  })
  if (!valid) {
    if (cached) removeContentCache(permanentId)
    return null
  }
  return normalizeTrainingItem(touchContentCache(valid))
}

function fetchMainCatalog(moduleId) {
  return getTrainingCatalogByModule(moduleId).then(result => ({
    success: result && result.success === true,
    source: result && result.source || 'local_fallback',
    moduleId,
    moduleVersion: result && result.moduleVersion || '',
    contents: result && Array.isArray(result.contents) ? result.contents : [],
    message: result && result.message || ''
  }))
}

function fetchExtraTrainingContents(category) {
  const contents = []
  const pageSize = 80
  function load(page) {
    return getTrainingContents('free', { category, page, pageSize }).then(result => {
      syncCloudTrainingAccess(result && result.access)
      const list = Array.isArray(result && result.contents) ? result.contents : []
      contents.push(...list)
      if (result && result.hasMore === true && page < 100) return load(page + 1)
      return {
        success: result && result.success === true,
        source: result && result.source || 'local_fallback',
        contents,
        message: result && result.message || ''
      }
    })
  }
  return load(1)
}

function refreshOneCategory(category, options = {}) {
  const force = options.force === true
  const normalized = normalizeCategory(category)
  const pending = pendingCatalogRequests.get(normalized)
  if (pending) return pending
  const loadedAt = Number(lastLoadedAt.get(normalized) || 0)
  if (!force && loadedAt && Date.now() - loadedAt < 60 * 1000) {
    return Promise.resolve({ source: 'memory_cache', moduleId: normalized })
  }

  const revision = Number(catalogRevisions.get(normalized) || 0) + 1
  catalogRevisions.set(normalized, revision)
  const loader = isMainModule(normalized)
    ? fetchMainCatalog(normalized)
    : fetchExtraTrainingContents(normalized)

  const request = loader.then(result => {
    if (catalogRevisions.get(normalized) !== revision) {
      return { source: 'stale_request_discarded', moduleId: normalized, count: 0 }
    }
    const list = Array.isArray(result.contents) ? result.contents : []
    if (result.success && result.source === 'cloud' && list.length) {
      const accepted = setCloudTrainingContents(list, {
        moduleId: normalized,
        category: normalized,
        schemaVersion: CATALOG_SCHEMA_VERSION
      })
      if (accepted) {
        if (isMainModule(normalized)) saveCatalogCache(normalized, result)
        lastLoadedAt.set(normalized, Date.now())
        return { source: 'cloud', moduleId: normalized, count: list.length, moduleVersion: result.moduleVersion || '' }
      }
    }

    if (isMainModule(normalized)) {
      const cached = loadCatalogCache(normalized)
      if (cached && setCloudTrainingContents(cached.contents, { moduleId: normalized, schemaVersion: cached.schemaVersion })) {
        lastLoadedAt.set(normalized, Date.now())
        return { source: 'catalog_cache', moduleId: normalized, count: cached.contents.length, message: result.message || '' }
      }
      if (result.success && result.source === 'local_fallback') {
        clearCloudTrainingContents(normalized)
        lastLoadedAt.set(normalized, Date.now())
      }
    }
    return { source: 'local_fallback', moduleId: normalized, count: 0, message: result.message || '' }
  }).catch(error => {
    const normalizedError = normalizeError(error, '训练内容读取失败')
    console.warn('[remote-training] 云端训练目录读取失败:', {
      moduleId: normalized,
      message: normalizedError.message,
      errMsg: normalizedError.errMsg,
      code: normalizedError.code || normalizedError.errCode,
      requestId: normalizedError.requestId
    })
    if (isMainModule(normalized)) {
      const cached = loadCatalogCache(normalized)
      if (cached && setCloudTrainingContents(cached.contents, { moduleId: normalized, schemaVersion: cached.schemaVersion })) {
        return { source: 'catalog_cache', moduleId: normalized, count: cached.contents.length, error: true }
      }
    }
    return { source: 'local_fallback', moduleId: normalized, count: 0, error: true }
  }).then(result => {
    if (pendingCatalogRequests.get(normalized) === request) pendingCatalogRequests.delete(normalized)
    return result
  })

  pendingCatalogRequests.set(normalized, request)
  return request
}

function refreshRemoteTrainingContents(options = {}) {
  const category = normalizeCategory(options.category || options.moduleId)
  if (category) return refreshOneCategory(category, options)
  return Promise.all(MAIN_MODULES.map(moduleId => refreshOneCategory(moduleId, options)))
    .then(results => ({
      source: results.every(item => item.source === 'cloud') ? 'cloud' : 'mixed_fallback',
      count: results.reduce((sum, item) => sum + Number(item.count || 0), 0),
      modules: results
    }))
}

function fetchTrainingContentOverrides(category = '') {
  const moduleId = normalizeCategory(category)
  return isMainModule(moduleId) ? fetchMainCatalog(moduleId) : fetchExtraTrainingContents(moduleId)
}

function getRemoteTrainingDebugState(options = {}) {
  const contentId = normalizeTrainingContentId(options.contentId)
  const category = normalizeCategory(options.category)
  return {
    categoryLoading: pendingCatalogRequests.has(category),
    contentLoading: contentId
      ? Array.from(pendingContentRequests.keys()).some(key => key.startsWith(`${contentId}:`))
      : false,
    cacheHit: Boolean(contentId && validateCachedContent(storageGet(getContentStorageKey(contentId)), { contentId }))
  }
}

function semanticErrorCode(value) {
  return String(value && (value.code || value.errCode) || '')
}

function ensureTrainingContentById(options = {}) {
  const contentId = normalizeTrainingContentId(options.contentId)
  const expectedVersion = Number(options.contentVersion || 0)
  if (!contentId) {
    return Promise.resolve({
      status: 'notFound',
      source: 'local',
      found: false,
      content: null,
      code: 'INVALID_PERMANENT_CONTENT_ID',
      message: '训练内容 ID 无效。'
    })
  }

  const cached = loadContentCache(contentId, expectedVersion)
  // 同一正文的不同期望版本不能复用请求，否则新版目录可能拿到旧版正文。
  const pendingKey = `${contentId}:${expectedVersion}`
  const pending = pendingContentRequests.get(pendingKey)
  if (pending) return pending
  console.log('[remote-training][ensure-by-id] request:', { contentId, expectedVersion })

  const request = getTrainingContentById(contentId).then(result => {
    syncCloudTrainingAccess(result && result.access)
    if (result && result.success === true && result.found === true && result.code === 'content_inactive') {
      removeContentCache(contentId)
      return {
        status: 'inactive',
        source: result.source || 'cloud',
        found: true,
        content: null,
        code: 'content_inactive',
        message: result.message || '该训练内容已下架。'
      }
    }
    if (result && result.success === true && result.found === false) {
      removeContentCache(contentId)
      return {
        status: 'notFound',
        source: result.source || 'cloud',
        found: false,
        content: null,
        code: result.code || 'content_not_found',
        message: result.message || '内容同步中或暂时无法获取。'
      }
    }
    if (result && result.success === true && result.found === true && result.content) {
      const normalized = normalizeTrainingItem(result.content)
      if (normalized.contentId !== contentId) {
        return {
          status: 'error',
          source: result.source || 'cloud',
          found: false,
          content: null,
          code: 'TRAINING_CONTENT_ID_MISMATCH',
          message: '云端返回的训练内容与当前请求不一致。'
        }
      }
      if (!normalized.content || !normalized.title || getContentVersion(normalized) < 1) {
        return {
          status: 'error',
          source: result.source || 'cloud',
          found: false,
          content: null,
          code: 'INVALID_TRAINING_CONTENT_RESPONSE',
          message: '训练正文同步异常，请稍后重试。'
        }
      }
      if (expectedVersion && getContentVersion(normalized) < expectedVersion) {
        return {
          status: 'error',
          source: result.source || 'cloud',
          found: false,
          content: null,
          code: 'TRAINING_CONTENT_VERSION_MISMATCH',
          message: '训练正文版本尚未同步，请稍后重试。'
        }
      }
      const saved = saveContentCache(normalized)
      return {
        status: 'ready',
        source: result.source || 'cloud',
        found: true,
        content: normalizeTrainingItem(saved || normalized)
      }
    }
    return {
      status: 'error',
      source: result && result.source || 'none',
      found: false,
      content: null,
      code: result && result.code || 'INVALID_TRAINING_CONTENT_RESPONSE',
      message: result && result.message || '训练内容读取失败，请稍后重试。'
    }
  }).catch(error => {
    syncCloudTrainingAccess(error && error.result && error.result.access)
    const code = semanticErrorCode(error)
    if (code === 'content_inactive') {
      removeContentCache(contentId)
      return { status: 'inactive', source: 'cloud', found: true, content: null, code, message: '该训练内容已下架。' }
    }
    if (code === 'membership_required') {
      return { status: 'accessDenied', source: 'cloud', found: true, content: null, code, message: '该训练为会员内容，开通会员后即可练习。' }
    }
    const fallback = cached || loadContentCache(contentId, expectedVersion)
    if (fallback) {
      return {
        status: 'ready',
        source: 'content_cache',
        found: true,
        fromCache: true,
        content: fallback,
        error,
        message: '网络异常，已显示上次成功加载的训练正文。'
      }
    }
    return {
      status: 'networkError',
      source: 'none',
      found: false,
      content: null,
      error,
      code: code || 'TRAINING_CONTENT_REQUEST_FAILED',
      message: '训练内容读取失败，请检查网络后重试。'
    }
  }).then(result => {
    if (pendingContentRequests.get(pendingKey) === request) pendingContentRequests.delete(pendingKey)
    return result
  })

  pendingContentRequests.set(pendingKey, request)
  return request
}

const loadRemoteTrainingContent = ensureTrainingContentById

module.exports = {
  fetchTrainingContentOverrides,
  formatContentTitle,
  normalizeTrainingItem,
  ensureTrainingContentById,
  getRemoteTrainingDebugState,
  loadRemoteTrainingContent,
  refreshRemoteTrainingContents,
  // 仅供自动化测试验证 LRU 与损坏缓存清理。
  __test__: {
    MAX_CONTENT_CACHE_ITEMS,
    loadContentCache,
    removeContentCache,
    saveContentCache,
    validateCachedContent
  }
}
