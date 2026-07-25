const CLASSES_KEY = 'classes'
const FAVORITE_FOLDERS_KEY = 'favoriteFolders'
const FAVORITE_WORKS_KEY = 'favoriteWorks'
const USER_INFO_KEY = 'userInfo'
const TRAINING_DRAFTS_KEY = 'trainingDrafts'
const EXTRA_DRAFTS_KEY = 'extraTrainingDrafts'
const TRAINING_SUBMISSIONS_KEY = 'trainingSubmissions'
const EXTRA_SUBMISSIONS_KEY = 'extraTrainingSubmissions'
const {
  cleanReadingDisplayTitle
} = require('./training-data')

// 当前班级、点评和收藏夹第一版使用本地 storage，仅用于开发原型。
// 正式上线时，应迁移到 CloudBase 数据库：
// classes: 班级表
// classMembers: 班级成员表
// submissions: 作品提交表
// teacherFeedbacks: 老师点评表
// favoriteFolders: 收藏夹表
// favoriteWorks: 收藏作品表
// 并使用 teacherOpenid / studentOpenid 做权限隔离，否则不同设备之间无法同步。

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDateTime(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getTimeValue(timeText) {
  if (!timeText) return 0
  const date = new Date(String(timeText).replace(/-/g, '/'))
  return date.getTime() || 0
}

function parseDurationSeconds(duration) {
  if (typeof duration === 'number') return Math.max(Math.floor(duration), 0)
  if (!duration) return 0

  const text = String(duration).trim()
  if (!text) return 0

  const secondMatch = text.match(/(\d+)\s*秒/)
  if (secondMatch) return Number(secondMatch[1] || 0)

  const minuteSecondMatch = text.match(/(\d+)\s*分(?:钟)?\s*(\d+)?\s*秒?/)
  if (minuteSecondMatch) {
    const minute = Number(minuteSecondMatch[1] || 0)
    const second = Number(minuteSecondMatch[2] || 0)
    return minute * 60 + second
  }

  const colonMatch = text.match(/^(\d{1,2}):(\d{1,2})$/)
  if (colonMatch) {
    return Number(colonMatch[1] || 0) * 60 + Number(colonMatch[2] || 0)
  }

  const numberMatch = text.match(/\d+/)
  return numberMatch ? Number(numberMatch[0]) : 0
}

function getStorageList(key) {
  const list = wx.getStorageSync(key) || []
  return Array.isArray(list) ? list : []
}

function saveStorageList(key, list) {
  wx.setStorageSync(key, Array.isArray(list) ? list : [])
}

function getUserInfo() {
  return wx.getStorageSync(USER_INFO_KEY) || {}
}

function saveUserInfo(userInfo) {
  wx.setStorageSync(USER_INFO_KEY, userInfo || {})
}

function getClasses() {
  return getStorageList(CLASSES_KEY)
}

function saveClasses(classes) {
  saveStorageList(CLASSES_KEY, classes)
}

function generateClassCode() {
  const classes = getClasses()
  let code = ''
  let count = 0

  do {
    code = `YQ${Math.floor(100000 + Math.random() * 900000)}`
    count += 1
  } while (classes.some(item => item.classCode === code) && count < 20)

  return code
}

function createClass(className) {
  const nextClass = {
    id: Date.now(),
    className,
    classCode: generateClassCode(),
    teacherName: '杨勤老师',
    createdAt: formatDateTime(),
    studentCount: 0,
    status: 'active'
  }
  const classes = [nextClass].concat(getClasses())

  saveClasses(classes)
  return nextClass
}

function getClassById(classId) {
  return getClasses().find(item => String(item.id) === String(classId)) || null
}

function getClassByCode(classCode) {
  const code = String(classCode || '').trim().toUpperCase()
  return getClasses().find(item => item.classCode === code) || null
}

function getCurrentClass() {
  const userInfo = getUserInfo()
  return userInfo.currentClass || null
}

function buildClassSubmissionPatch() {
  const userInfo = getUserInfo()
  const currentClass = userInfo.currentClass

  if (!currentClass) {
    return {
      studentName: userInfo.nickname || userInfo.nickName || '同学'
    }
  }

  return {
    studentName: userInfo.nickname || userInfo.nickName || '同学',
    classId: currentClass.classId,
    className: currentClass.className,
    classCode: currentClass.classCode,
    teacherName: currentClass.teacherName
  }
}

function getTrainingSubmissions() {
  return getStorageList(TRAINING_SUBMISSIONS_KEY)
}

function getExtraSubmissions() {
  return getStorageList(EXTRA_SUBMISSIONS_KEY)
}

function getWorkKey(work = {}) {
  return `${work._storageKey || work.storageKey || work.sourceType || 'work'}-${work.id || work.submissionId || ''}`
}

function hasTeacherFeedback(work = {}) {
  return !!(work.teacherFeedback || work.teacherFeedbackStatus === 'done')
}

function getTeacherFeedbackState(work = {}) {
  if (work.teacherFeedback || work.teacherFeedbackStatus === 'done' || work.teacherFeedbackRequestStatus === 'done') {
    return 'done'
  }

  if (
    work.teacherFeedbackRequestStatus === 'submitted' ||
    work.teacherReviewSubmitted === true ||
    work.teacherFeedbackStatus === 'pending'
  ) {
    return 'pending'
  }

  return 'none'
}

function getTeacherButtonText(work = {}) {
  const state = getTeacherFeedbackState(work)
  if (state === 'done') return '查看老师点评'
  if (state === 'pending') return '老师点评中'
  return '提交老师点评'
}

function getTeacherStatusText(work = {}) {
  const state = getTeacherFeedbackState(work)
  if (state === 'done') return '老师已点评'
  if (state === 'pending') return '老师点评中'
  return '老师未提交'
}

function getTeacherStatusClass(work = {}) {
  const state = getTeacherFeedbackState(work)
  if (state === 'done') return 'teacher-done-tag'
  if (state === 'pending') return 'teacher-pending-tag'
  return 'teacher-ready-tag'
}

function getSavedStatusText(work = {}) {
  return work.cloudUploaded || work.cloudId ? '已同步' : '已保存'
}

function getSavedStatusClass(work = {}) {
  return work.cloudUploaded || work.cloudId ? 'synced-tag' : 'saved-tag'
}

function normalizeSavedWork(work = {}) {
  const teacherState = getTeacherFeedbackState(work)

  return {
    ...work,
    submitted: true,
    isSubmitted: true,
    status: 'saved',
    savedStatus: work.savedStatus || (work.cloudUploaded || work.cloudId ? 'synced' : 'saved'),
    teacherFeedbackRequestStatus: work.teacherFeedbackRequestStatus || (teacherState === 'done' ? 'done' : teacherState === 'pending' ? 'submitted' : 'none'),
    teacherFeedbackSubmittedAt: work.teacherFeedbackSubmittedAt || '',
    teacherFeedbackCloudSync: typeof work.teacherFeedbackCloudSync === 'boolean' ? work.teacherFeedbackCloudSync : true,
    teacherFeedbackStatus: work.teacherFeedbackStatus || (teacherState === 'done' ? 'done' : teacherState === 'pending' ? 'pending' : ''),
    teacherFeedback: work.teacherFeedback || null,
    aiFeedbackAttemptCount: Number(work.aiFeedbackAttemptCount || 0),
    aiFeedbackGenerateCount: Number(work.aiFeedbackGenerateCount || 0),
    aiFeedbackGeneratedAt: work.aiFeedbackGeneratedAt || '',
    aiFeedbackLastError: work.aiFeedbackLastError || '',
    feedbackVersion: work.feedbackVersion || work.aiFeedbackVersion || '',
    feedbackMode: work.feedbackMode || work.aiFeedbackMode || '',
    feedbackType: work.feedbackType === 'deep' ? 'deep' : 'normal',
    transcript: work.transcript || '',
    speechText: work.speechText || work.transcript || '',
    hasTranscript: Boolean(work.hasTranscript || work.transcript || work.speechText),
    asrStatus: work.asrStatus || '',
    asrErrorMessage: work.asrErrorMessage || '',
    asrProvider: work.asrProvider || '',
    audioAnalysis: work.audioAnalysis || null,
    speechAnalysis: work.speechAnalysis || null,
    ruleAnalysis: work.ruleAnalysis || work.speechAnalysis || null,
    cloudFileID: work.cloudFileID || work.fileID || '',
    rawText: work.rawText || work.aiFeedbackRawText || '',
    aiFeedbackVersion: work.aiFeedbackVersion || '',
    aiFeedbackMode: work.aiFeedbackMode || '',
    aiFeedbackRawText: work.aiFeedbackRawText || '',
    aiFeedbackUsage: work.aiFeedbackUsage || work.tokenUsage || null,
    tokenUsage: work.tokenUsage || work.aiFeedbackUsage || null
  }
}

function getIdentityValue(item = {}) {
  if (item.cloudId) return `cloud:${item.cloudId}`
  return `id:${item.id || ''}`
}

function normalizeModuleTitle(title) {
  return String(title || '主训练').replace(/^21天/, '')
}

function normalizeWorkTitle(item) {
  const title = item.taskTitle || item.contentTitle || item.content || '训练作品'
  if (item.moduleId === 'reading' || String(item.moduleTitle || '').indexOf('朗读') > -1) {
    return cleanReadingDisplayTitle(title)
  }

  return title
}

function buildTrainingSubmissionFromDraft(draft = {}) {
  const createdAt = draft.createdAt || formatDateTime()
  const normalizedDraft = normalizeSavedWork(draft)
  const title = normalizedDraft.contentTitle || normalizedDraft.taskTitle || '训练作品'

  return normalizeSavedWork({
    id: normalizedDraft.id,
    sourceType: 'main',
    ...buildClassSubmissionPatch(),
    moduleId: normalizedDraft.moduleId || '',
    category: normalizedDraft.category || normalizedDraft.moduleId || '',
    moduleType: normalizedDraft.moduleType || normalizedDraft.moduleId || '',
    trainingType: normalizedDraft.trainingType || normalizedDraft.moduleId || '',
    moduleTitle: normalizedDraft.moduleTitle || '',
    day: normalizedDraft.day || '',
    contentId: normalizedDraft.contentId || '',
    taskId: normalizedDraft.taskId || normalizedDraft.contentId || '',
    taskTitle: normalizedDraft.taskTitle || title,
    contentTitle: title,
    trainingTitleSnapshot: normalizedDraft.trainingTitleSnapshot || '',
    trainingContentSnapshot: normalizedDraft.trainingContentSnapshot || '',
    trainingCategorySnapshot: normalizedDraft.trainingCategorySnapshot || '',
    trainingDaySnapshot: Number(normalizedDraft.trainingDaySnapshot || 0),
    // 主训练原文快照单独保存，不与额外训练 content 字段混用。
    content: '',
    promptText: '',
    materialSummary: normalizedDraft.materialSummary || title,
    materialText: '',
    requirement: normalizedDraft.requirement || '',
    type: normalizedDraft.type || normalizedDraft.workType || 'audio',
    workType: normalizedDraft.workType || normalizedDraft.type || 'audio',
    duration: normalizedDraft.duration || '',
    durationSeconds: normalizedDraft.durationSeconds || parseDurationSeconds(normalizedDraft.duration),
    targetSeconds: normalizedDraft.targetSeconds || 0,
    createdAt,
    submittedAt: normalizedDraft.submittedAt || createdAt,
    filePath: normalizedDraft.filePath || '',
    tempFilePath: normalizedDraft.tempFilePath || normalizedDraft.filePath || '',
    thumbPath: normalizedDraft.thumbPath || '',
    fileSize: normalizedDraft.fileSize || 0,
    isPublic: Boolean(normalizedDraft.isPublic),
    publicPermissionConfirmed: Boolean(normalizedDraft.publicPermissionConfirmed),
    aiFeedbackStatus: normalizedDraft.aiFeedbackStatus || '',
    aiFeedback: normalizedDraft.aiFeedback || null,
    aiFeedbackSource: normalizedDraft.aiFeedbackSource || '',
    aiFeedbackModel: normalizedDraft.aiFeedbackModel || '',
    aiFeedbackError: Boolean(normalizedDraft.aiFeedbackError),
    aiFeedbackErrorMessage: normalizedDraft.aiFeedbackErrorMessage || '',
    aiFeedbackLastError: normalizedDraft.aiFeedbackLastError || '',
    aiFeedbackBlockedReason: normalizedDraft.aiFeedbackBlockedReason || '',
    aiFeedbackAttemptCount: Number(normalizedDraft.aiFeedbackAttemptCount || 0),
    aiFeedbackGenerateCount: Number(normalizedDraft.aiFeedbackGenerateCount || 0),
    aiFeedbackGeneratedAt: normalizedDraft.aiFeedbackGeneratedAt || '',
    feedbackVersion: normalizedDraft.feedbackVersion || normalizedDraft.aiFeedbackVersion || '',
    feedbackMode: normalizedDraft.feedbackMode || normalizedDraft.aiFeedbackMode || '',
    feedbackType: normalizedDraft.feedbackType === 'deep' ? 'deep' : 'normal',
    transcript: normalizedDraft.transcript || '',
    speechText: normalizedDraft.speechText || normalizedDraft.transcript || '',
    hasTranscript: Boolean(normalizedDraft.hasTranscript || normalizedDraft.transcript || normalizedDraft.speechText),
    asrStatus: normalizedDraft.asrStatus || '',
    asrErrorMessage: normalizedDraft.asrErrorMessage || '',
    asrProvider: normalizedDraft.asrProvider || '',
    audioAnalysis: normalizedDraft.audioAnalysis || null,
    speechAnalysis: normalizedDraft.speechAnalysis || null,
    ruleAnalysis: normalizedDraft.ruleAnalysis || normalizedDraft.speechAnalysis || null,
    rawText: normalizedDraft.rawText || normalizedDraft.aiFeedbackRawText || '',
    aiFeedbackVersion: normalizedDraft.aiFeedbackVersion || '',
    aiFeedbackMode: normalizedDraft.aiFeedbackMode || '',
    aiFeedbackRawText: normalizedDraft.aiFeedbackRawText || '',
    aiFeedbackUsage: normalizedDraft.aiFeedbackUsage || null,
    tokenUsage: normalizedDraft.tokenUsage || normalizedDraft.aiFeedbackUsage || null,
    cloudId: normalizedDraft.cloudId || '',
    cloudFileID: normalizedDraft.cloudFileID || normalizedDraft.fileID || '',
    fileID: normalizedDraft.fileID || '',
    cloudUploaded: typeof normalizedDraft.cloudUploaded === 'boolean' ? normalizedDraft.cloudUploaded : false,
    cloudError: normalizedDraft.cloudError || ''
  })
}

function buildExtraSubmissionFromDraft(draft = {}) {
  const createdAt = draft.createdAt || formatDateTime()
  const normalizedDraft = normalizeSavedWork(draft)

  return normalizeSavedWork({
    id: normalizedDraft.id,
    sourceType: 'extra',
    ...buildClassSubmissionPatch(),
    extraType: normalizedDraft.extraType || '',
    extraTitle: normalizedDraft.extraTitle || '额外训练',
    taskTitle: normalizedDraft.extraTitle || '额外训练',
    contentTitle: normalizedDraft.content || normalizedDraft.extraTitle || '额外训练',
    content: normalizedDraft.content || '',
    promptText: normalizedDraft.promptText || normalizedDraft.content || '',
    requirement: normalizedDraft.requirement || '',
    type: normalizedDraft.type || normalizedDraft.workType || 'audio',
    workType: normalizedDraft.workType || normalizedDraft.type || 'audio',
    duration: normalizedDraft.duration || '',
    durationSeconds: normalizedDraft.durationSeconds || parseDurationSeconds(normalizedDraft.duration),
    targetSeconds: Number(normalizedDraft.targetSeconds || 0),
    createdAt,
    submittedAt: normalizedDraft.submittedAt || createdAt,
    filePath: normalizedDraft.filePath || '',
    tempFilePath: normalizedDraft.tempFilePath || normalizedDraft.filePath || '',
    thumbPath: normalizedDraft.thumbPath || '',
    fileSize: normalizedDraft.fileSize || 0,
    isPublic: Boolean(normalizedDraft.isPublic),
    publicPermissionConfirmed: Boolean(normalizedDraft.publicPermissionConfirmed),
    aiFeedbackStatus: normalizedDraft.aiFeedbackStatus || '',
    aiFeedback: normalizedDraft.aiFeedback || null,
    aiFeedbackSource: normalizedDraft.aiFeedbackSource || '',
    aiFeedbackModel: normalizedDraft.aiFeedbackModel || '',
    aiFeedbackError: Boolean(normalizedDraft.aiFeedbackError),
    aiFeedbackErrorMessage: normalizedDraft.aiFeedbackErrorMessage || '',
    aiFeedbackLastError: normalizedDraft.aiFeedbackLastError || '',
    aiFeedbackBlockedReason: normalizedDraft.aiFeedbackBlockedReason || '',
    aiFeedbackAttemptCount: Number(normalizedDraft.aiFeedbackAttemptCount || 0),
    aiFeedbackGenerateCount: Number(normalizedDraft.aiFeedbackGenerateCount || 0),
    aiFeedbackGeneratedAt: normalizedDraft.aiFeedbackGeneratedAt || '',
    feedbackVersion: normalizedDraft.feedbackVersion || normalizedDraft.aiFeedbackVersion || '',
    feedbackMode: normalizedDraft.feedbackMode || normalizedDraft.aiFeedbackMode || '',
    feedbackType: normalizedDraft.feedbackType === 'deep' ? 'deep' : 'normal',
    transcript: normalizedDraft.transcript || '',
    speechText: normalizedDraft.speechText || normalizedDraft.transcript || '',
    hasTranscript: Boolean(normalizedDraft.hasTranscript || normalizedDraft.transcript || normalizedDraft.speechText),
    asrStatus: normalizedDraft.asrStatus || '',
    asrErrorMessage: normalizedDraft.asrErrorMessage || '',
    asrProvider: normalizedDraft.asrProvider || '',
    audioAnalysis: normalizedDraft.audioAnalysis || null,
    speechAnalysis: normalizedDraft.speechAnalysis || null,
    ruleAnalysis: normalizedDraft.ruleAnalysis || normalizedDraft.speechAnalysis || null,
    rawText: normalizedDraft.rawText || normalizedDraft.aiFeedbackRawText || '',
    aiFeedbackVersion: normalizedDraft.aiFeedbackVersion || '',
    aiFeedbackMode: normalizedDraft.aiFeedbackMode || '',
    aiFeedbackRawText: normalizedDraft.aiFeedbackRawText || '',
    aiFeedbackUsage: normalizedDraft.aiFeedbackUsage || null,
    tokenUsage: normalizedDraft.tokenUsage || normalizedDraft.aiFeedbackUsage || null,
    cloudId: normalizedDraft.cloudId || '',
    cloudFileID: normalizedDraft.cloudFileID || normalizedDraft.fileID || '',
    fileID: normalizedDraft.fileID || '',
    cloudUploaded: typeof normalizedDraft.cloudUploaded === 'boolean' ? normalizedDraft.cloudUploaded : false,
    cloudError: normalizedDraft.cloudError || ''
  })
}

function getDraftStorageKey(sourceType = 'main') {
  return sourceType === 'extra' ? EXTRA_DRAFTS_KEY : TRAINING_DRAFTS_KEY
}

function getSubmissionStorageKey(sourceType = 'main') {
  return sourceType === 'extra' ? EXTRA_SUBMISSIONS_KEY : TRAINING_SUBMISSIONS_KEY
}

function buildSubmissionFromDraft(sourceType, draft) {
  return sourceType === 'extra'
    ? buildExtraSubmissionFromDraft(draft)
    : buildTrainingSubmissionFromDraft(draft)
}

function ensureSavedWorks(sourceType = 'main') {
  const draftKey = getDraftStorageKey(sourceType)
  const submissionKey = getSubmissionStorageKey(sourceType)
  const draftList = getStorageList(draftKey)
  const submissionList = getStorageList(submissionKey)
  const nextDrafts = draftList.map(normalizeSavedWork)
  const nextSubmissions = submissionList.map(normalizeSavedWork)
  const submissionMap = {}

  nextSubmissions.forEach(item => {
    submissionMap[getIdentityValue(item)] = item
  })

  nextDrafts.forEach(item => {
    const identity = getIdentityValue(item)
    if (!submissionMap[identity]) {
      nextSubmissions.unshift(buildSubmissionFromDraft(sourceType, item))
      submissionMap[identity] = true
    }
  })

  if (JSON.stringify(nextDrafts) !== JSON.stringify(draftList)) {
    saveStorageList(draftKey, nextDrafts)
  }

  if (JSON.stringify(nextSubmissions) !== JSON.stringify(submissionList)) {
    saveStorageList(submissionKey, nextSubmissions)
  }

  return {
    drafts: nextDrafts,
    submissions: nextSubmissions
  }
}

function upsertWork(list, work) {
  const identity = getIdentityValue(work)
  const nextWork = normalizeSavedWork(work)
  return [nextWork].concat(list.filter(item => getIdentityValue(item) !== identity))
}

function saveWorkWithSubmission(sourceType, draft, submission) {
  const draftKey = getDraftStorageKey(sourceType)
  const submissionKey = getSubmissionStorageKey(sourceType)
  const nextDraft = normalizeSavedWork(draft)
  const nextSubmission = normalizeSavedWork(submission)

  saveStorageList(draftKey, upsertWork(getStorageList(draftKey), nextDraft))
  saveStorageList(submissionKey, upsertWork(getStorageList(submissionKey), nextSubmission))

  return {
    draft: nextDraft,
    submission: nextSubmission
  }
}

function patchWorkInStorages(sourceType, id, patch, cloudId = '') {
  const keys = [getDraftStorageKey(sourceType), getSubmissionStorageKey(sourceType)]

  keys.forEach(storageKey => {
    const list = getStorageList(storageKey)
    const nextList = list.map(item => (
      String(item.id) === String(id) || (cloudId && String(item.cloudId || '') === String(cloudId))
        ? {
          ...item,
          ...patch
        }
        : item
    ))

    saveStorageList(storageKey, nextList)
  })
}

function buildSubmittedWork(item, sourceType, index) {
  const isExtra = sourceType === 'extra'
  const storageKey = isExtra ? EXTRA_SUBMISSIONS_KEY : TRAINING_SUBMISSIONS_KEY
  const moduleTitle = normalizeModuleTitle(item.moduleTitle)
  const work = {
    ...item,
    id: item.id || Date.now() + index,
    sourceType,
    _storageKey: storageKey,
    sourceText: isExtra ? '额外训练' : '主训练',
    displayType: item.type === 'video' ? '录像作品' : '录音作品',
    displayActionText: item.type === 'video' ? '查看' : '播放',
    displayTitle: isExtra
      ? (item.extraTitle || item.taskTitle || '额外训练')
      : `${moduleTitle}${item.day ? ` Day ${item.day}` : ''}`,
    displaySubtitle: isExtra ? (item.taskTitle || item.content || '训练作品') : normalizeWorkTitle(item),
    displayDuration: item.duration || '暂无',
    displayCreatedAt: item.createdAt || '暂无',
    studentName: item.studentName || '同学',
    hasTeacherFeedback: hasTeacherFeedback(item),
    sortTime: getTimeValue(item.createdAt)
  }

  return {
    ...work,
    key: getWorkKey(work)
  }
}

function getAllSubmittedWorks() {
  ensureSavedWorks('main')
  ensureSavedWorks('extra')

  return getTrainingSubmissions()
    .map((item, index) => buildSubmittedWork(item, 'main', index))
    .concat(getExtraSubmissions().map((item, index) => buildSubmittedWork(item, 'extra', index)))
    .sort((a, b) => b.sortTime - a.sortTime)
}

function updateSubmissionById(storageKey, id, patch) {
  const list = getStorageList(storageKey)
  const nextList = list.map(item => (
    Number(item.id) === Number(id)
      ? {
        ...item,
        ...patch
      }
      : item
  ))

  saveStorageList(storageKey, nextList)
}

function getFavoriteFolders() {
  const folders = getStorageList(FAVORITE_FOLDERS_KEY)

  if (folders.length > 0) return folders

  const defaultFolder = {
    id: Date.now(),
    name: '默认收藏夹',
    desc: '收藏重点训练作品',
    createdAt: formatDateTime(),
    isDefault: true
  }

  saveStorageList(FAVORITE_FOLDERS_KEY, [defaultFolder])
  return [defaultFolder]
}

function saveFavoriteFolders(folders) {
  saveStorageList(FAVORITE_FOLDERS_KEY, folders)
}

function getFavoriteWorks() {
  return getStorageList(FAVORITE_WORKS_KEY)
}

function saveFavoriteWorks(works) {
  saveStorageList(FAVORITE_WORKS_KEY, works)
}

function getDefaultFavoriteFolder() {
  const folders = getFavoriteFolders()
  return folders.find(item => item.isDefault || item.name === '默认收藏夹') || folders[0]
}

function isWorkFavorited(work, folderId) {
  return getFavoriteWorks().some(item => (
    String(item.submissionId) === String(work.id) &&
    String(item.folderId) === String(folderId) &&
    String(item.sourceType) === String(work.sourceType === 'extra' ? 'extra' : 'training')
  ))
}

function buildFavoriteWork(work, folder) {
  return {
    id: Date.now(),
    folderId: folder.id,
    folderName: folder.name,
    submissionId: work.id,
    sourceType: work.sourceType === 'extra' ? 'extra' : 'training',
    moduleId: work.moduleId || '',
    moduleTitle: work.moduleTitle || work.extraTitle || '',
    day: work.day || '',
    taskTitle: work.taskTitle || work.content || '训练作品',
    workType: work.type || 'audio',
    duration: work.duration || '',
    createdAt: formatDateTime(),
    submittedAt: work.createdAt || '',
    studentName: work.studentName || '同学',
    classId: work.classId || '',
    className: work.className || '',
    aiFeedbackStatus: work.aiFeedbackStatus || '',
    teacherFeedbackStatus: work.teacherFeedbackStatus || '',
    teacherFeedback: work.teacherFeedback || null,
    filePath: work.filePath || '',
    thumbPath: work.thumbPath || '',
    note: ''
  }
}

function addWorkToDefaultFavorite(work) {
  const folder = getDefaultFavoriteFolder()

  if (isWorkFavorited(work, folder.id)) {
    return {
      success: false,
      duplicated: true,
      folder
    }
  }

  const favorite = buildFavoriteWork(work, folder)
  saveFavoriteWorks([favorite].concat(getFavoriteWorks()))

  return {
    success: true,
    favorite,
    folder
  }
}

module.exports = {
  CLASSES_KEY,
  FAVORITE_FOLDERS_KEY,
  FAVORITE_WORKS_KEY,
  USER_INFO_KEY,
  TRAINING_SUBMISSIONS_KEY,
  EXTRA_SUBMISSIONS_KEY,
  TRAINING_DRAFTS_KEY,
  EXTRA_DRAFTS_KEY,
  formatDateTime,
  parseDurationSeconds,
  getStorageList,
  saveStorageList,
  getUserInfo,
  saveUserInfo,
  getClasses,
  saveClasses,
  createClass,
  getClassById,
  getClassByCode,
  getCurrentClass,
  buildClassSubmissionPatch,
  getAllSubmittedWorks,
  updateSubmissionById,
  hasTeacherFeedback,
  getTeacherFeedbackState,
  getTeacherButtonText,
  getTeacherStatusText,
  getTeacherStatusClass,
  getSavedStatusText,
  getSavedStatusClass,
  normalizeSavedWork,
  ensureSavedWorks,
  saveWorkWithSubmission,
  patchWorkInStorages,
  getFavoriteFolders,
  saveFavoriteFolders,
  getFavoriteWorks,
  saveFavoriteWorks,
  addWorkToDefaultFavorite
}
