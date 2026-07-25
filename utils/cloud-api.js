function sanitizeLogData(data = {}) {
  if (Array.isArray(data)) return data.map(item => sanitizeLogData(item))
  if (!data || typeof data !== 'object') return data

  return Object.keys(data || {}).reduce((result, key) => {
    const value = data[key]
    const lowerKey = key.toLowerCase()
    if (
      lowerKey === 'code' ||
      lowerKey.includes('token') ||
      lowerKey.includes('signature') ||
      lowerKey === 'paysig' ||
      lowerKey === 'signdata' ||
      lowerKey === 'virtualpayparams'
    ) {
      result[key] = value ? '[hidden]' : ''
    } else if (lowerKey.includes('phone')) {
      const phone = String(value || '').replace(/\D/g, '')
      result[key] = phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : ''
    } else {
      result[key] = value && typeof value === 'object' ? sanitizeLogData(value) : value
    }
    return result
  }, {})
}

function callCloudApi(action, data = {}, options = {}) {
  const showLog = options.showLog !== false

  if (!wx.cloud) {
    const err = new Error('wx.cloud 不可用')
    console.warn('[cloud-api] wx.cloud 不可用')
    return Promise.reject(err)
  }

  if (showLog) {
    console.log('[cloud-api] call:', action, sanitizeLogData(data))
  }

  return wx.cloud.callFunction({
    name: 'cloudApi',
    data: {
      action,
      ...data
    }
  }).then(res => {
    const result = res.result || {}

    if (showLog) {
      console.log('[cloud-api] result:', action, sanitizeLogData(result))
    }

    if (!result.success) {
      const err = new Error(result.message || result.code || '云函数调用失败')
      err.code = result.code
      err.result = result
      throw err
    }

    return result
  }).catch(err => {
    console.warn('[cloud-api] fail:', action, err)
    throw err
  })
}

function healthCheck() {
  return callCloudApi('healthCheck')
}

function getMe() {
  return callCloudApi('getMe')
}

function getAdminProfile() {
  return callCloudApi('getAdminProfile')
}

function initSuperAdmin(data = {}) {
  return callCloudApi('initSuperAdmin', data)
}

function adminListAdmins(limit = 100) {
  return callCloudApi('adminListAdmins', { limit })
}

function adminAddAdmin(data) {
  return callCloudApi('adminAddAdmin', data)
}

function adminDisableAdmin(data) {
  return callCloudApi('adminDisableAdmin', data)
}

function adminUpdateAdminRole(data) {
  return callCloudApi('adminUpdateAdminRole', data)
}

function adminAuditLogs(limit = 100) {
  return callCloudApi('adminAuditLogs', { limit })
}

function bindPhoneAndGetAccess(phone, nickname = '同学') {
  return callCloudApi('bindPhoneAndGetAccess', {
    phone,
    nickname
  })
}

function bindPhoneByCode(code, nickname = '同学') {
  return callCloudApi('bindPhoneByCode', {
    code,
    nickname
  }, {
    // 手机号授权 code 为一次性敏感凭证，不写入前端调试日志。
    showLog: false
  })
}

function adminCreateStudent(data) {
  return callCloudApi('adminCreateStudent', data)
}

function adminGrantEntitlement(data) {
  return callCloudApi('adminGrantEntitlement', data)
}

function adminListPhoneEntitlements(keyword = '') {
  return callCloudApi('adminListPhoneEntitlements', { keyword })
}

function adminSavePhoneEntitlement(data) {
  return callCloudApi('adminSavePhoneEntitlement', { data })
}

function adminDisablePhoneEntitlement(data) {
  return callCloudApi('adminDisablePhoneEntitlement', { data })
}

function adminEnablePhoneEntitlement(data) {
  return callCloudApi('adminEnablePhoneEntitlement', { data })
}

function adminDeletePhoneEntitlement(data) {
  return callCloudApi('adminDeletePhoneEntitlement', { data })
}

function adminListData() {
  return callCloudApi('adminListData')
}

function adminDisableEntitlement(id) {
  return callCloudApi('adminDisableEntitlement', { id })
}

function submitWorkRecord(work) {
  return callCloudApi('submitWorkRecord', { work })
}

function getMyWorks(limit = 50) {
  return callCloudApi('getMyWorks', { limit })
}

function getSquareWorks(filter = 'all', limit = 50) {
  return callCloudApi('getSquareWorks', {
    filter,
    limit
  })
}

function deleteMySquareWork(workId) {
  return callCloudApi('deleteMySquareWork', { workId })
}

function deleteMyWork(workId) {
  return callCloudApi('deleteMyWork', { workId })
}

function unpublishMyWorkFromSquare(workId) {
  return callCloudApi('unpublishMyWorkFromSquare', { workId })
}

function getSquareWorkDetail(workId) {
  return callCloudApi('getSquareWorkDetail', { workId })
}

function toggleSquareLike(workId) {
  return callCloudApi('toggleSquareLike', { workId })
}

function getSquareLikeStatusBatch(workIds = []) {
  return callCloudApi('getSquareLikeStatusBatch', { workIds })
}

function listSquareComments(workId, page = 1, pageSize = 50) {
  return callCloudApi('listSquareComments', { workId, page, pageSize })
}

function addSquareComment(workId, content) {
  return callCloudApi('addSquareComment', { workId, content }, { showLog: false })
}

function deleteSquareComment(commentId) {
  return callCloudApi('deleteSquareComment', { commentId })
}

function adminListForbiddenWords(filters = {}) {
  return callCloudApi('adminListForbiddenWords', filters)
}

function adminUpsertForbiddenWord(data) {
  return callCloudApi('adminUpsertForbiddenWord', { data })
}

function adminEnableForbiddenWord(id) {
  return callCloudApi('adminEnableForbiddenWord', { id })
}

function adminDisableForbiddenWord(id) {
  return callCloudApi('adminDisableForbiddenWord', { id })
}

function adminDeleteForbiddenWord(id) {
  return callCloudApi('adminDeleteForbiddenWord', { id })
}

function adminInitForbiddenWords() {
  return callCloudApi('adminInitForbiddenWords')
}

function updateWorkPublicStatus(id, isPublic, mediaPatch = {}) {
  return callCloudApi('updateWorkPublicStatus', {
    id,
    isPublic,
    mediaPatch
  })
}

function updateWorkAiFeedback(id, feedbackPatch = {}) {
  return callCloudApi('updateWorkAiFeedback', {
    id,
    feedbackPatch
  }, {
    showLog: false
  })
}

function getCurrentWeeklySchedule(scheduleType = 'adult') {
  return callCloudApi('getCurrentWeeklySchedule', { scheduleType }, {
    showLog: false
  })
}

function getPublicWeeklySchedule(input = 'adult') {
  const scheduleType = typeof input === 'object'
    ? (input.scheduleType === 'college' ? 'college' : 'adult')
    : (input === 'college' ? 'college' : 'adult')
  return callCloudApi('getPublicWeeklySchedule', { scheduleType }, {
    showLog: false
  })
}

function getAppContentConfigs(section = '', type = '') {
  return callCloudApi('getAppContentConfigs', {
    section,
    type
  }, {
    showLog: false
  })
}

function getTrainingContents(membershipType = 'free', filters = {}) {
  return callCloudApi('getTrainingContents', {
    membershipType,
    ...filters
  }, {
    showLog: false
  })
}

function getTrainingContentById(contentId, category = '', options = {}) {
  const includeArchived = options.includeArchived === true
  const day = Number(options.day || 0)
  const allowLegacyCurrentFallback = !includeArchived && options.allowLegacyCurrentFallback === true
  console.log('[cloud-api][training-content-by-id] request:', {
    action: 'getTrainingContentById',
    contentId,
    category,
    day,
    includeArchived,
    allowLegacyCurrentFallback
  })
  return callCloudApi('getTrainingContentById', {
    contentId,
    category,
    day,
    includeArchived,
    allowLegacyCurrentFallback
  }, {
    showLog: false
  }).then(result => {
    const content = result && result.content
    console.log('[cloud-api][training-content-by-id] result:', {
      success: result && result.success === true,
      code: result && result.code || '',
      found: result && result.found === true,
      returnedContentId: content && content.contentId || '',
      sourceContentId: result && result.sourceContentId || content && content.sourceContentId || '',
      contentLength: content
        ? String(content.content || content.material || content.promptText || '').length
        : 0,
      source: result && result.source || '',
      legacyFallback: result && result.legacyFallback === true
    })
    return result
  })
}

function adminGetWeeklySchedule(id = '', scheduleType = 'adult') {
  return callCloudApi('adminGetWeeklySchedule', { id, scheduleType })
}

function adminListWeeklySchedules(limit = 20, scheduleType = 'adult') {
  return callCloudApi('adminListWeeklySchedules', { limit, scheduleType })
}

function adminSaveWeeklySchedule(schedule) {
  return callCloudApi('adminSaveWeeklySchedule', { schedule })
}

function adminArchiveWeeklySchedule(id, scheduleType = 'adult') {
  return callCloudApi('adminArchiveWeeklySchedule', { id, scheduleType })
}

function adminListTrainingContents(category = '') {
  const contents = []
  const archivedContents = []
  const deletedContents = []
  const pageSize = 40

  function loadPage(page) {
    return callCloudApi('adminListTrainingContents', { category, page, pageSize }, { showLog: false })
      .then(result => {
        contents.push(...(result.contents || result.data || []))
        archivedContents.push(...(result.archivedContents || []))
        deletedContents.push(...(result.deletedContents || []))
        if (result.hasMore === true && page < 100) return loadPage(page + 1)
        return {
          ...result,
          contents,
          data: contents,
          total: contents.length,
          archivedContents,
          archivedTotal: archivedContents.length,
          deletedContents,
          deletedContentIds: deletedContents.map(item => item.contentId).filter(Boolean),
          hasMore: false
        }
      })
  }

  return loadPage(1)
}

function adminSaveTrainingContent(data = {}) {
  return callCloudApi('adminSaveTrainingContent', data, {
    showLog: false
  })
}

function adminDeleteTrainingContent(data = {}) {
  return callCloudApi('adminDeleteTrainingContent', data, {
    showLog: false
  })
}

function adminReplaceTrainingContentsBatch(data = {}) {
  return callCloudApi('adminReplaceTrainingContentsBatch', data, {
    showLog: false
  })
}

function checkAiUsage(type, extra = {}) {
  return callCloudApi('checkAiUsage', {
    type,
    ...extra
  })
}

function recordAiUsage(type, extra = {}) {
  return callCloudApi('recordAiUsage', {
    type,
    ...extra
  })
}

function listMembershipProducts() {
  return callCloudApi('listMembershipProducts', {}, { showLog: false })
}

function createVirtualPaymentOrder(productId, loginCode) {
  return callCloudApi('createVirtualPaymentOrder', { productId, loginCode }, { showLog: false })
}

function confirmVirtualPaymentOrder(orderNo) {
  return callCloudApi('confirmVirtualPaymentOrder', { orderNo }, { showLog: false })
}

function reportVirtualPaymentResult(orderNo, status, reason = '') {
  return callCloudApi('reportVirtualPaymentResult', { orderNo, status, reason }, { showLog: false })
}

module.exports = {
  callCloudApi,
  healthCheck,
  getMe,
  getAdminProfile,
  initSuperAdmin,
  adminListAdmins,
  adminAddAdmin,
  adminDisableAdmin,
  adminUpdateAdminRole,
  adminAuditLogs,
  bindPhoneAndGetAccess,
  bindPhoneByCode,
  adminCreateStudent,
  adminGrantEntitlement,
  adminListPhoneEntitlements,
  adminSavePhoneEntitlement,
  adminDisablePhoneEntitlement,
  adminEnablePhoneEntitlement,
  adminDeletePhoneEntitlement,
  adminListData,
  adminDisableEntitlement,
  submitWorkRecord,
  getMyWorks,
  getSquareWorks,
  deleteMySquareWork,
  deleteMyWork,
  unpublishMyWorkFromSquare,
  getSquareWorkDetail,
  toggleSquareLike,
  getSquareLikeStatusBatch,
  listSquareComments,
  addSquareComment,
  deleteSquareComment,
  adminListForbiddenWords,
  adminUpsertForbiddenWord,
  adminEnableForbiddenWord,
  adminDisableForbiddenWord,
  adminDeleteForbiddenWord,
  adminInitForbiddenWords,
  updateWorkPublicStatus,
  updateWorkAiFeedback,
  getCurrentWeeklySchedule,
  getPublicWeeklySchedule,
  getAppContentConfigs,
  getTrainingContents,
  getTrainingContentById,
  adminGetWeeklySchedule,
  adminListWeeklySchedules,
  adminSaveWeeklySchedule,
  adminArchiveWeeklySchedule,
  adminListTrainingContents,
  adminSaveTrainingContent,
  adminDeleteTrainingContent,
  adminReplaceTrainingContentsBatch,
  checkAiUsage,
  recordAiUsage,
  listMembershipProducts,
  createVirtualPaymentOrder,
  confirmVirtualPaymentOrder,
  reportVirtualPaymentResult
}
