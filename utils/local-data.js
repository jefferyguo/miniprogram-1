const CLASSES_KEY = 'classes'
const FAVORITE_FOLDERS_KEY = 'favoriteFolders'
const FAVORITE_WORKS_KEY = 'favoriteWorks'
const USER_INFO_KEY = 'userInfo'
const TRAINING_SUBMISSIONS_KEY = 'trainingSubmissions'
const EXTRA_SUBMISSIONS_KEY = 'extraTrainingSubmissions'

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

function buildSubmittedWork(item, sourceType, index) {
  const isExtra = sourceType === 'extra'
  const storageKey = isExtra ? EXTRA_SUBMISSIONS_KEY : TRAINING_SUBMISSIONS_KEY
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
      : `${item.moduleTitle || '主训练'}${item.day ? ` Day ${item.day}` : ''}`,
    displaySubtitle: item.taskTitle || item.content || '训练作品',
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
  formatDateTime,
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
  getFavoriteFolders,
  saveFavoriteFolders,
  getFavoriteWorks,
  saveFavoriteWorks,
  addWorkToDefaultFavorite
}
