const { getTrainingContentById, getTrainingContents } = require('./cloud-api')
const { getCurrentAccessStatus } = require('./access-control')
const {
  clearCloudTrainingContents,
  formatContentTitle,
  getTaskByModuleAndContentId,
  isTrainingContentComplete,
  setCloudTrainingContents,
  splitTitleAndAuthor,
  upsertCloudTrainingContent
} = require('./training-data')

const lastLoadedAt = new Map()
const pendingRequests = new Map()
const pendingContentRequests = new Map()

function getModuleIdByCategory(category = '') {
  return String(category || '').trim() === 'retelling'
    ? 'retell'
    : String(category || '').trim()
}

function getCompleteCachedContent(contentId, category = '') {
  const moduleId = getModuleIdByCategory(category)
  const task = moduleId && contentId
    ? getTaskByModuleAndContentId(moduleId, contentId)
    : null
  return isTrainingContentComplete(task) ? task : null
}

function getRemoteTrainingDebugState(options = {}) {
  const category = String(options.category || '').trim()
  const contentId = String(options.contentId || '').trim()
  return {
    categoryLoading: pendingRequests.has(category || '*'),
    contentLoading: contentId
      ? Array.from(pendingContentRequests.keys()).some(key => key.includes(`:${contentId}:`))
      : false,
    cacheHit: Boolean(getCompleteCachedContent(contentId, category))
  }
}

function normalizeTrainingItem(item = {}) {
  const parts = splitTitleAndAuthor(item.title || item.contentTitle || item.displayTitle || '')
  const hasAuthor = Object.prototype.hasOwnProperty.call(item, 'author')
  const author = hasAuthor ? (String(item.author || '').trim() || parts.author) : parts.author
  const title = parts.title || item.title || item.contentTitle || ''
  return {
    ...item,
    title,
    author,
    displayTitle: formatContentTitle({ title, author }),
    content: String(item.content || item.material || item.promptText || '').trim()
  }
}

function mergeTrainingContents(localItems = [], remoteItems = []) {
  const map = new Map(localItems.map(item => [item.contentId, normalizeTrainingItem(item)]))
  remoteItems.map(normalizeTrainingItem).forEach(item => {
    if (!item.contentId) return
    map.set(item.contentId, {
      ...(map.get(item.contentId) || {}),
      ...item,
      displayTitle: formatContentTitle(item)
    })
  })
  return Array.from(map.values())
}

function fetchTrainingContentOverrides(category = '') {
  const access = getCurrentAccessStatus()
  const pageSize = 50
  const contents = []

  function loadPage(page) {
    return getTrainingContents(access.membershipType || 'free', {
      ...(category ? { category } : {}),
      page,
      pageSize
    }).then(result => {
      const list = Array.isArray(result.contents)
        ? result.contents
        : (Array.isArray(result.data) ? result.data : [])
      contents.push(...list.map(normalizeTrainingItem))
      if (result.source === 'cloud' && result.hasMore === true && page < 100) {
        return loadPage(page + 1)
      }
      return {
        success: result.success === true,
        source: result.source || (contents.length ? 'cloud' : 'local_fallback'),
        contents,
        message: result.message || ''
      }
    })
  }

  return loadPage(1)
}

// 云端有内容时合并进本地模块；确认空集合时回退本地，瞬时失败保留上次成功缓存。
function refreshRemoteTrainingContents(options = {}) {
  const force = options.force === true
  const category = String(options.category || '').trim()
  const cacheKey = category || '*'
  const pendingRequest = pendingRequests.get(cacheKey)
  const loadedAt = Number(lastLoadedAt.get(cacheKey) || 0)
  // force 只绕过已完成缓存，不能绕过同分类的在途请求。
  if (pendingRequest) return pendingRequest
  if (!force && loadedAt && Date.now() - loadedAt < 60 * 1000) {
    return Promise.resolve({ source: 'cache' })
  }

  const request = fetchTrainingContentOverrides(category)
    .then(result => {
      const list = Array.isArray(result.contents) ? result.contents : []
      const useCloudContents = result.success === true && result.source === 'cloud' && list.length > 0

      if (useCloudContents) {
        setCloudTrainingContents(list, { category })
        lastLoadedAt.set(cacheKey, Date.now())
        return { source: 'cloud', count: list.length }
      }
      const message = String(result.message || '')
      const confirmedEmpty = result.success === true && result.source === 'local_fallback' && /\bempty\b/i.test(message)
      if (confirmedEmpty) {
        clearCloudTrainingContents(category)
        lastLoadedAt.set(cacheKey, Date.now())
      }
      return {
        source: 'local_fallback',
        count: 0,
        error: !confirmedEmpty,
        message: message || 'use local training data'
      }
    })
    .catch(error => {
      // 短暂网络失败不能清掉上一条已经成功写入的完整正文缓存。
      console.warn('[remote-training] 云端训练读取失败，已回退本地训练:', error && error.message ? error.message : error)
      return { source: 'local_fallback', count: 0, error: true }
    })
    .then(result => {
      if (pendingRequests.get(cacheKey) === request) {
        pendingRequests.delete(cacheKey)
      }
      return result
    })

  pendingRequests.set(cacheKey, request)
  return request
}

function ensureTrainingContentById(options = {}) {
  const contentId = String(options.contentId || '').trim()
  const category = String(options.category || '').trim()
  const day = Number(options.day || 0)
  const allowArchived = options.allowArchived === true
  const expectedActive = options.expectedActive === true
  if (!contentId) {
    return Promise.resolve({
      status: 'notFound',
      source: 'local',
      found: false,
      content: null,
      message: 'contentId 不能为空'
    })
  }

  const cachedContent = getCompleteCachedContent(contentId, category)
  if (cachedContent) {
    return Promise.resolve({
      status: 'ready',
      source: 'cache',
      found: true,
      fromCache: true,
      content: cachedContent
    })
  }

  const cacheKey = `${category || '*'}:${contentId}:${allowArchived ? 'history' : 'active'}`
  const pendingRequest = pendingContentRequests.get(cacheKey)
  if (pendingRequest) return pendingRequest

  const categoryRequest = pendingRequests.get(category || '*')
  console.log('[remote-training][ensure-by-id] request:', {
    contentId,
    category,
    day,
    expectedActive,
    awaitingCategoryRequest: Boolean(categoryRequest)
  })

  const request = getTrainingContentById(contentId, category, {
    day,
    includeArchived: allowArchived,
    allowLegacyCurrentFallback: !allowArchived
  })
    .then(async result => {
      if (result && result.success && result.content && isTrainingContentComplete(result.content)) {
        const returnedContentId = String(result.content.contentId || '').trim()
        if (returnedContentId !== contentId) {
          return {
            status: 'error',
            source: result.source || 'cloud',
            code: 'TRAINING_CONTENT_ID_MISMATCH',
            found: false,
            content: null,
            message: '云端返回的训练内容与当前请求不一致。'
          }
        }
        if (result.archived === true && !allowArchived) {
          return {
            status: 'notFound',
            source: result.source || 'cloud',
            found: false,
            archived: true,
            content: null,
            message: '该训练内容已下架。'
          }
        }
        const moduleId = getModuleIdByCategory(category)
        const localIndexTask = getTaskByModuleAndContentId(moduleId, contentId)
        const cacheContent = result.legacyFallback === true
          ? {
            ...result.content,
            contentId,
            requestedContentId: contentId,
            sourceContentId: result.sourceContentId || result.content.sourceContentId || '',
            legacyFallback: true,
            day: Number(localIndexTask && localIndexTask.day || day || result.content.day || 0),
            title: localIndexTask && localIndexTask.title || result.content.title,
            contentTitle: localIndexTask && (localIndexTask.contentTitle || localIndexTask.title) || result.content.contentTitle || result.content.title,
            author: localIndexTask && localIndexTask.author || result.content.author || '',
            membershipLevel: localIndexTask && localIndexTask.membershipLevel || result.content.membershipLevel
          }
          : result.content
        upsertCloudTrainingContent(cacheContent)
        console.log('[remote-training][ensure-by-id] ready:', {
          contentId,
          returnedContentId,
          sourceContentId: cacheContent.sourceContentId || '',
          contentLength: String(cacheContent.content || cacheContent.material || cacheContent.promptText || '').length,
          source: result.source || 'cloud',
          legacyFallback: result.legacyFallback === true
        })
        return {
          status: 'ready',
          source: result.source || 'cloud',
          found: true,
          archived: result.archived === true,
          legacyFallback: result.legacyFallback === true,
          content: cacheContent
        }
      }

      if (result && result.success && result.source === 'cloud' && result.found === false) {
        const activeCategoryRequest = categoryRequest || pendingRequests.get(category || '*')
        if (activeCategoryRequest) {
          await activeCategoryRequest
          const contentAfterCategoryLoad = getCompleteCachedContent(contentId, category)
          if (contentAfterCategoryLoad) {
            return {
              status: 'ready',
              source: 'category-cache',
              found: true,
              fromCache: true,
              content: contentAfterCategoryLoad
            }
          }
        }

        if (
          expectedActive &&
          /-v\d+-day-\d+$/i.test(contentId) &&
          result.legacyFallbackAttempted !== true
        ) {
          return {
            status: 'error',
            source: 'cloud',
            code: 'TRAINING_CONTENT_VERSION_MISMATCH',
            found: false,
            content: null,
            message: '当前训练索引已更新，但云端完整正文尚未同步。'
          }
        }
        return {
          status: 'notFound',
          source: 'cloud',
          found: false,
          content: null,
          message: result.message || '该训练内容暂不存在或已下架。'
        }
      }

      return {
        status: 'error',
        source: result && result.source || 'local_fallback',
        found: false,
        content: null,
        code: result && result.code || 'INVALID_TRAINING_CONTENT_RESPONSE',
        message: result && result.message || '完整训练内容加载失败，请检查网络后重新加载。'
      }
    })
    .catch(error => ({
      status: 'error',
      source: 'none',
      found: false,
      content: null,
      error,
      code: error && (error.code || error.errCode) || 'TRAINING_CONTENT_REQUEST_FAILED',
      message: error && (error.message || error.errMsg) || '完整训练内容加载失败，请检查网络后重新加载。'
    }))
    .then(result => {
      if (pendingContentRequests.get(cacheKey) === request) {
        pendingContentRequests.delete(cacheKey)
      }
      return result
    })

  pendingContentRequests.set(cacheKey, request)
  return request
}

const loadRemoteTrainingContent = ensureTrainingContentById

module.exports = {
  fetchTrainingContentOverrides,
  formatContentTitle,
  mergeTrainingContents,
  normalizeTrainingItem,
  ensureTrainingContentById,
  getRemoteTrainingDebugState,
  loadRemoteTrainingContent,
  refreshRemoteTrainingContents
}
