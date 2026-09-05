const DEFAULT_SHARE_TITLE = '杨勤口才训练 KEEP｜每天练一点，表达更自信'
const DEFAULT_SHARE_PATH = '/pages/training/training'
const FALLBACK_SHARE_IMAGE = '/images/yangqin-logo.jpg'
const SHARE_IMAGE_PATHS = {
  default: '/images/share/default-share.jpg',
  home: '/images/share/home-share.jpg',
  square: '/images/share/square-share.jpg',
  review: '/images/share/review-share.jpg',
  assessment: '/images/share/assessment-share.jpg',
  training: '/images/share/training-share.jpg',
  scheduleAdult: '/images/share/training-share.jpg',
  scheduleCollege: '/images/share/training-share.jpg'
}

const SHARE_TARGET_ROUTES = {
  training: { route: 'pages/training/training', isTab: true },
  review: { route: 'pages/review/review', isTab: true },
  square: { route: 'pages/square/square', isTab: true },
  mine: { route: 'pages/mine/mine', isTab: true },
  'weekly-schedule': { route: 'pages/weekly-schedule/weekly-schedule', isTab: false },
  'module-detail': { route: 'pages/module-detail/module-detail', isTab: false },
  'task-detail': { route: 'pages/task-detail/task-detail', isTab: false },
  'extra-training': { route: 'pages/extra-training/extra-training', isTab: false },
  'work-detail': { route: 'pages/work-detail/work-detail', isTab: false },
  'ai-evaluation': { route: 'pages/ai-evaluation/ai-evaluation', isTab: false },
  'my-works': { route: 'pages/my-works/my-works', isTab: false },
  'member-center': { route: 'pages/member-center/member-center', isTab: false }
}

function encodeQuery(params = {}) {
  return Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && String(params[key]) !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&')
}

function normalizeShareQuery(query) {
  if (!query) return {}
  if (typeof query === 'object') return query

  return String(query).split('&').reduce((result, pair) => {
    const parts = pair.split('=')
    if (!parts[0]) return result
    const key = decodeURIComponent(parts[0])
    result[key] = decodeURIComponent(parts.slice(1).join('=') || '')
    return result
  }, {})
}

function buildTimelineQuery(targetPage = 'training', params = {}) {
  return encodeQuery({ targetPage, ...params })
}

function getShareTargetParams(targetPage, query) {
  if (targetPage === 'weekly-schedule') {
    return { scheduleType: query.scheduleType === 'college' ? 'college' : 'adult' }
  }
  if (targetPage === 'module-detail') {
    return { moduleId: query.moduleId || query.module || 'reading' }
  }
  if (targetPage === 'task-detail') {
    return {
      moduleId: query.moduleId || query.module || query.category || query.moduleType || query.trainingType || 'reading',
      category: query.category || query.moduleId || query.module || '',
      day: Math.max(Number(query.day || 1), 1),
      contentId: query.contentId || query.taskId || ''
    }
  }
  if (targetPage === 'extra-training') {
    const aliases = { quote: 'dailyQuote', topic: 'randomTopic' }
    return { type: aliases[query.type] || query.type || 'dailyQuote' }
  }
  if (targetPage === 'work-detail') {
    return { workId: query.workId || query.id || '' }
  }
  return {}
}

function resolveShareTarget(rawQuery) {
  const query = normalizeShareQuery(rawQuery)
  const requestedTargetPage = String(query.targetPage || '')
  const valid = Boolean(SHARE_TARGET_ROUTES[requestedTargetPage])
  const targetPage = valid ? requestedTargetPage : 'training'
  const target = SHARE_TARGET_ROUTES[targetPage]
  const params = getShareTargetParams(targetPage, query)
  const paramQuery = encodeQuery(params)

  return {
    targetPage,
    requestedTargetPage,
    valid,
    route: target.route,
    url: `/${target.route}${paramQuery ? `?${paramQuery}` : ''}`,
    isTab: target.isTab
  }
}

function getShareImage(pageType = 'default') {
  return SHARE_IMAGE_PATHS[pageType] || SHARE_IMAGE_PATHS.default || FALLBACK_SHARE_IMAGE
}

function getDefaultShareMessage(options = {}) {
  const result = {
    title: options.title || DEFAULT_SHARE_TITLE,
    path: options.path || DEFAULT_SHARE_PATH
  }
  const imageUrl = options.imageUrl === undefined ? getShareImage(options.pageType) : options.imageUrl
  if (imageUrl) result.imageUrl = imageUrl
  return result
}

function getDefaultShareTimeline(options = {}) {
  const result = {
    title: options.title || DEFAULT_SHARE_TITLE,
    query: options.query === undefined
      ? buildTimelineQuery(options.targetPage || 'training', options.params || {})
      : options.query
  }
  const imageUrl = options.imageUrl === undefined ? getShareImage(options.pageType) : options.imageUrl
  if (imageUrl) result.imageUrl = imageUrl
  return result
}

function enableShareMenu() {
  if (typeof wx === 'undefined' || typeof wx.showShareMenu !== 'function') return
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
      fail(error) {
        // 部分微信版本、平台或审核状态不展示朋友圈入口，页面仍应正常使用。
        console.warn('[share-config] 分享菜单暂不可用:', error && error.errMsg ? error.errMsg : 'unknown')
      }
    })
  } catch (error) {
    console.warn('[share-config] 当前基础库不支持分享菜单:', error && error.message ? error.message : 'unknown')
  }
}

function disableShareMenu() {
  if (typeof wx === 'undefined' || typeof wx.hideShareMenu !== 'function') return
  try {
    wx.hideShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
      fail(error) {
        console.warn('[share-config] 隐藏分享菜单失败:', error && error.errMsg ? error.errMsg : 'unknown')
      }
    })
  } catch (error) {
    console.warn('[share-config] 当前基础库不支持隐藏分享菜单:', error && error.message ? error.message : 'unknown')
  }
}

module.exports = {
  DEFAULT_SHARE_PATH,
  DEFAULT_SHARE_TITLE,
  buildTimelineQuery,
  disableShareMenu,
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage,
  normalizeShareQuery,
  resolveShareTarget,
  SHARE_TARGET_ROUTES,
  SHARE_IMAGE_PATHS
}
