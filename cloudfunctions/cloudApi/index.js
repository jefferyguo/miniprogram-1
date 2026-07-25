// 部署方式：
// 微信开发者工具中右键 cloudfunctions/cloudApi
// 选择“上传并部署：云端安装依赖”
// 部署完成后，在 mine 页面点击“云端连通测试”。

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const { MEMBERSHIP_PRODUCTS, getMembershipProduct } = require('./membership-products')
const {
  DEFAULT_FORBIDDEN_WORDS,
  findForbiddenMatch,
  normalizeText,
  validateCommentContent
} = require('./comment-moderation')
const {
  compareCurrentTrainingRecords,
  findLegacyCurrentTrainingRecord,
  getTrainingDay,
  hasTrainingBody,
  isCurrentTrainingRecord,
  isRequestedVersionedTrainingContent,
  normalizeCategory: normalizeLegacyTrainingCategory,
  selectPreferredCurrentTrainingRecords
} = require('./training-content-compat')
const {
  FREE_DAILY_AI_LIMIT,
  FREE_MONTHLY_AI_LIMIT,
  MONTHLY_MEMBER_DAILY_AI_LIMIT,
  MONTHLY_MEMBER_MONTHLY_AI_LIMIT,
  YEARLY_MEMBER_DAILY_AI_LIMIT,
  YEARLY_MEMBER_MONTHLY_AI_LIMIT,
  MEMBER_DAILY_AI_LIMIT
} = require('./ai-usage-config')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const COLLECTIONS = {
  users: 'users',
  phoneEntitlements: 'phoneEntitlements',
  students: 'students',
  entitlements: 'entitlements',
  leads: 'leads',
  orders: 'orders',
  classes: 'classes',
  classMembers: 'classMembers',
  submissions: 'submissions',
  squareLikes: 'squareLikes',
  squareComments: 'squareComments',
  commentForbiddenWords: 'commentForbiddenWords',
  teacherFeedbacks: 'teacherFeedbacks',
  aiUsage: 'aiUsage',
  admins: 'admins',
  auditLogs: 'auditLogs',
  weeklySchedules: 'weeklySchedules',
  appContentConfigs: 'appContentConfigs',
  trainingContents: 'trainingContents',
  virtualPaymentOrders: 'virtualPaymentOrders'
}

const CONTENT_CONFIG_SECTIONS = ['home', 'training', 'recitation', 'topics', 'coursePreview', 'membership', 'about', 'square', 'profile', 'notice', 'ai']
const CONTENT_CONFIG_TYPES = ['text', 'rich_text', 'list', 'notice', 'button_text', 'modal_text', 'rule_text', 'topic', 'recitation', 'course_preview']
const TRAINING_TYPES = ['reading', 'speaking', 'retelling', 'impromptu', 'hosting', 'mandarin', 'speech', 'leaderSpeech']
const MEMBERSHIP_TYPES = ['free', 'monthly', 'yearly', 'admin']
const CONTENT_STATUSES = ['active', 'disabled', 'deleted']
const TRAINING_CONFIG_CATEGORIES = ['reading', 'retelling', 'topic', 'mandarin', 'speech', 'leaderSpeech', 'dailyQuote', 'dailyTopic', 'tongueTwister']
const TRAINING_CONFIG_STATUSES = ['published', 'draft', 'disabled', 'deleted', 'active', 'archived', 'inactive']
const TRAINING_CONTENT_MEMBERSHIP_LEVELS = ['free', 'member']
const TRAINING_REPLACEMENT_CATEGORIES = ['reading', 'retelling', 'speech', 'leaderSpeech']
const TRAINING_CONTENT_STYLE_FONT_SIZES = ['small', 'normal', 'large', 'xlarge']
const TRAINING_CONTENT_STYLE_COLORS = ['default', 'green', 'red', 'blue', 'gold']
const DEFAULT_TRAINING_CONTENT_STYLE = {
  fontSize: 'normal',
  color: 'default',
  bold: false
}
const DEFAULT_TRAINING_CONTENT_RICH_STYLE = {
  ranges: []
}
const PUBLIC_ACTIONS = new Set(['getPublicWeeklySchedule'])
const WEEKLY_SCHEDULE_SHARE_PATHS = {
  adult: 'schedule-share/weekly-schedule-share-adult.json',
  college: 'schedule-share/weekly-schedule-share-college.json'
}

const PACKAGE_NAMES = {
  offline_course: '线下课学员权限',
  mini_21_reading: '朗读训练基础包',
  mini_21_retell: '复述训练基础包',
  mini_21_topic: '话题训练基础包',
  mini_21_mandarin: '普通话训练基础包',
  mini_21_all: '四类21天训练包',
  advanced_all: '进阶训练包',
  vip_all: '全内容会员'
}

function now() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function today() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function getUsageWeek(dateText) {
  const parts = String(dateText || '').split('-').map(Number)
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function addDays(dateText, days) {
  const parts = String(dateText || '').split('-').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateText
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(days || 0)))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function maskPhone(phone) {
  const p = normalizePhone(phone)
  if (!p) return ''
  if (p.length < 7) return p
  return `${p.slice(0, 3)}****${p.slice(-4)}`
}

function getAvatarText(nickname) {
  const name = String(nickname || '同学').trim()
  if (!name) return '同'
  const first = name.slice(0, 1)
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
}

function success(data = {}) {
  return {
    success: true,
    ...data
  }
}

function fail(code, message, extra = {}) {
  return {
    success: false,
    code,
    message,
    ...extra
  }
}

function getAdminOpenids() {
  return String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

async function safeGetOne(collectionName, where) {
  const res = await db.collection(collectionName).where(where).limit(1).get()
  return res.data && res.data.length ? res.data[0] : null
}

async function safeGetById(collectionName, id) {
  if (!id) return null
  try {
    const res = await db.collection(collectionName).doc(id).get()
    return res.data || null
  } catch (error) {
    return null
  }
}

function sanitizeAdmin(admin = {}, includeOpenid = true) {
  return {
    _id: admin._id || '',
    openid: includeOpenid ? (admin.openid || '') : '',
    openidSuffix: admin.openid ? String(admin.openid).slice(-6) : '',
    nickname: admin.nickname || '管理员',
    phone: admin.phone || '',
    phoneMasked: admin.phone ? maskPhone(admin.phone) : '',
    role: admin.role || '',
    status: admin.status || '',
    permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
    source: admin.source || '',
    createdAt: admin.createdAt || '',
    createdBy: admin.createdBy || '',
    updatedAt: admin.updatedAt || '',
    remark: admin.remark || ''
  }
}

function sanitizePayloadSummary(payload = {}) {
  const summary = {}

  Object.keys(payload || {}).forEach(key => {
    const value = payload[key]
    if (key.toLowerCase().includes('phone')) {
      summary[key] = maskPhone(value)
      return
    }

    if (key.toLowerCase().includes('openid')) {
      summary[key] = value ? `***${String(value).slice(-6)}` : ''
      return
    }

    if (['name', 'realName', 'nickname', 'role', 'packageCode', 'packageName', 'status', 'source', 'remark', 'expireAt', 'className', 'membershipType', 'membershipStatus', 'membershipEndAt'].includes(key)) {
      summary[key] = value
    }
  })

  return summary
}

async function getActiveSuperAdmins() {
  const res = await db.collection(COLLECTIONS.admins)
    .where({
      role: 'super_admin',
      status: 'active'
    })
    .limit(100)
    .get()

  return res.data || []
}

async function getAdminProfileByOpenid(openid) {
  if (!openid) {
    return {
      isAdmin: false,
      role: '',
      admin: null,
      source: 'none'
    }
  }

  const admin = await safeGetOne(COLLECTIONS.admins, {
    openid,
    status: 'active'
  })

  if (admin) {
    return {
      isAdmin: true,
      role: admin.role || 'admin',
      admin: sanitizeAdmin(admin),
      source: 'admins_collection'
    }
  }

  const membershipAdmin = await safeGetOne(COLLECTIONS.users, {
    openid,
    isAdmin: true,
    status: 'active'
  })

  if (
    membershipAdmin &&
    membershipAdmin.phoneBound === true &&
    membershipAdmin.membershipType === 'admin' &&
    membershipAdmin.membershipStatus === 'active' &&
    !isExpired(membershipAdmin.membershipEndAt)
  ) {
    return {
      isAdmin: true,
      role: 'admin',
      admin: sanitizeAdmin({
        ...membershipAdmin,
        role: 'admin',
        permissions: ['*'],
        source: 'phone_entitlement'
      }),
      source: 'phone_entitlement'
    }
  }

  if (getAdminOpenids().includes(openid)) {
    return {
      isAdmin: true,
      role: 'super_admin',
      admin: sanitizeAdmin({
        openid,
        nickname: '环境变量超级管理员',
        role: 'super_admin',
        status: 'active',
        permissions: ['*'],
        source: 'env_bootstrap'
      }),
      source: 'env_bootstrap'
    }
  }

  return {
    isAdmin: false,
    role: '',
    admin: null,
    source: 'none'
  }
}

function roleAllowed(role, requiredRoles = ['super_admin', 'admin']) {
  if (role === 'super_admin') return true
  return requiredRoles.includes(role)
}

async function requireAdmin(openid, requiredRoles = ['super_admin', 'admin']) {
  const profile = await getAdminProfileByOpenid(openid)

  if (!profile.isAdmin || !roleAllowed(profile.role, requiredRoles)) {
    return {
      ok: false,
      code: 'not_admin',
      message: '当前账号没有管理员权限。',
      profile
    }
  }

  return {
    ok: true,
    profile
  }
}

async function writeAuditLog(action, operatorProfile, data = {}) {
  try {
    await db.collection(COLLECTIONS.auditLogs).add({
      data: {
        action,
        operatorOpenid: data.operatorOpenid || (operatorProfile && operatorProfile.admin && operatorProfile.admin.openid) || '',
        operatorRole: data.operatorRole || (operatorProfile && operatorProfile.role) || '',
        operatorSource: (operatorProfile && operatorProfile.source) || '',
        targetType: data.targetType || '',
        targetId: data.targetId || '',
        targetOpenid: data.targetOpenid || '',
        targetOpenidSuffix: data.targetOpenid ? String(data.targetOpenid).slice(-6) : '',
        targetPhoneMasked: data.targetPhone ? maskPhone(data.targetPhone) : (data.targetPhoneMasked || ''),
        payloadSummary: sanitizePayloadSummary(data.payloadSummary || {}),
        createdAt: now()
      }
    })
  } catch (err) {
    console.warn('[cloudApi] writeAuditLog failed:', err)
  }
}

function isExpired(expireAt) {
  if (!expireAt) return false
  const raw = String(expireAt)
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw} 23:59:59` : raw
  const expire = new Date(normalized.replace(/-/g, '/'))
  if (!expire.getTime()) return false
  return expire.getTime() < Date.now()
}

function normalizeScheduleType(value) {
  return String(value || '').toLowerCase() === 'college' ? 'college' : 'adult'
}

function sanitizeCourse(course = {}) {
  const startTime = String(course.startTime || '').trim()
  const endTime = String(course.endTime || '').trim()
  const time = startTime || endTime
    ? [startTime, endTime].filter(Boolean).join('-')
    : String(course.time || '').trim()
  const courseName = String(course.courseName || course.courseTitle || '').trim()
  const targetAudience = String(course.targetAudience || course.audience || '').trim()
  const content = String(course.content || course.description || '').trim()
  const remark = String(course.remark || course.note || '').trim()

  return {
    ...course,
    date: String(course.date || '').trim(),
    weekday: String(course.weekday || '').trim(),
    startTime,
    endTime,
    time,
    courseName,
    targetAudience,
    content,
    remark,
    // 保留旧字段别名，兼容已发布课表和旧客户端。
    courseTitle: courseName,
    audience: targetAudience,
    description: content,
    note: remark
  }
}

function sanitizeSchedulePayload(schedule = {}) {
  const status = schedule.status === 'published' ? 'published' : 'draft'
  const courses = Array.isArray(schedule.courses)
    ? schedule.courses.map(sanitizeCourse).filter(item => item.courseName || item.date || item.time)
    : []

  return {
    title: String(schedule.title || '本周课表').trim() || '本周课表',
    weekLabel: String(schedule.weekLabel || '').trim(),
    startDate: String(schedule.startDate || '').trim(),
    endDate: String(schedule.endDate || '').trim(),
    status,
    scheduleType: normalizeScheduleType(schedule.scheduleType),
    summary: String(schedule.summary || '').trim(),
    marqueeText: String(schedule.marqueeText || '').trim(),
    posterFileID: String(schedule.posterFileID || '').trim(),
    posterUrl: String(schedule.posterUrl || '').trim(),
    posterGeneratedAt: String(schedule.posterGeneratedAt || '').trim(),
    miniProgramQrFileID: String(schedule.miniProgramQrFileID || '').trim(),
    miniProgramQrUrl: String(schedule.miniProgramQrUrl || '').trim(),
    courses
  }
}

function sanitizeScheduleForClient(schedule = {}) {
  if (!schedule) return null

  return {
    _id: schedule._id || '',
    title: schedule.title || '本周课表',
    weekLabel: schedule.weekLabel || '',
    startDate: schedule.startDate || '',
    endDate: schedule.endDate || '',
    status: schedule.status || '',
    scheduleType: normalizeScheduleType(schedule.scheduleType),
    summary: schedule.summary || '',
    marqueeText: schedule.marqueeText || '',
    posterFileID: schedule.posterFileID || '',
    posterUrl: schedule.posterUrl || '',
    posterGeneratedAt: schedule.posterGeneratedAt || '',
    miniProgramQrFileID: schedule.miniProgramQrFileID || '',
    miniProgramQrUrl: schedule.miniProgramQrUrl || '',
    shareSnapshotFileID: schedule.shareSnapshotFileID || '',
    shareSnapshotUrl: schedule.shareSnapshotUrl || '',
    shareSnapshotPath: schedule.shareSnapshotPath || '',
    shareSnapshotGeneratedAt: schedule.shareSnapshotGeneratedAt || '',
    scheduleDisplayType: schedule.scheduleDisplayType || '',
    courses: Array.isArray(schedule.courses) ? schedule.courses.map(sanitizeCourse) : [],
    updatedAt: schedule.updatedAt || '',
    createdAt: schedule.createdAt || ''
  }
}

function sanitizePublicSchedule(schedule = {}) {
  if (!schedule) return null

  return {
    title: String(schedule.title || '本周课表').trim() || '本周课表',
    weekLabel: String(schedule.weekLabel || '').trim(),
    startDate: String(schedule.startDate || '').trim(),
    endDate: String(schedule.endDate || '').trim(),
    scheduleType: normalizeScheduleType(schedule.scheduleType),
    summary: String(schedule.summary || '').trim(),
    marqueeText: String(schedule.marqueeText || '').trim(),
    shareSnapshotUrl: String(schedule.shareSnapshotUrl || '').trim(),
    shareSnapshotPath: String(schedule.shareSnapshotPath || WEEKLY_SCHEDULE_SHARE_PATHS[normalizeScheduleType(schedule.scheduleType)] || '').trim(),
    shareSnapshotGeneratedAt: String(schedule.shareSnapshotGeneratedAt || '').trim(),
    scheduleDisplayType: String(schedule.scheduleDisplayType || '').trim(),
    courses: Array.isArray(schedule.courses)
      ? schedule.courses.map(course => {
        const item = sanitizeCourse(course)
        return {
          date: item.date,
          weekday: item.weekday,
          startTime: item.startTime,
          endTime: item.endTime,
          time: item.time,
          courseName: item.courseName,
          courseTitle: item.courseTitle,
          targetAudience: item.targetAudience,
          audience: item.audience,
          content: item.content,
          description: item.description,
          remark: item.remark,
          note: item.note
        }
      })
      : []
  }
}

function buildWeeklyScheduleShareSnapshot(schedule = {}) {
  const publicSchedule = sanitizePublicSchedule(schedule)
  const scheduleType = normalizeScheduleType(publicSchedule && publicSchedule.scheduleType)

  return {
    version: 1,
    scheduleType,
    title: publicSchedule && publicSchedule.title ? publicSchedule.title : getScheduleShareDefaultTitle(scheduleType),
    weekLabel: publicSchedule && publicSchedule.weekLabel || '',
    startDate: publicSchedule && publicSchedule.startDate || '',
    endDate: publicSchedule && publicSchedule.endDate || '',
    summary: publicSchedule && publicSchedule.summary || '',
    marqueeText: publicSchedule && publicSchedule.marqueeText || '',
    updatedAt: Date.now(),
    courses: publicSchedule && Array.isArray(publicSchedule.courses) ? publicSchedule.courses : []
  }
}

function getScheduleShareDefaultTitle(scheduleType) {
  return normalizeScheduleType(scheduleType) === 'college' ? '大学生课表' : '成人课表'
}

async function uploadWeeklyScheduleShareSnapshot(scheduleType, snapshot) {
  const normalizedType = normalizeScheduleType(scheduleType)
  const cloudPath = WEEKLY_SCHEDULE_SHARE_PATHS[normalizedType]
  const fileContent = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8')

  console.log('[weeklyScheduleShareSnapshot] upload start:', {
    scheduleType: normalizedType,
    cloudPath,
    coursesCount: Array.isArray(snapshot.courses) ? snapshot.courses.length : 0
  })

  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent
  })

  const fileID = uploadRes.fileID || ''
  let shareSnapshotUrl = ''

  if (fileID) {
    try {
      const tempRes = await cloud.getTempFileURL({
        fileList: [fileID]
      })
      const fileInfo = tempRes && Array.isArray(tempRes.fileList) ? tempRes.fileList[0] : null
      shareSnapshotUrl = fileInfo && (fileInfo.tempFileURL || fileInfo.download_url || fileInfo.url) || ''
    } catch (error) {
      // 快照文件已上传成功；URL 可由前端固定公开地址兜底，临时 URL 失败不阻断发布。
      console.warn('[weeklyScheduleShareSnapshot] get temp url failed:', error && error.message || error)
    }
  }

  console.log('[weeklyScheduleShareSnapshot] upload success:', {
    scheduleType: normalizedType,
    cloudPath,
    hasFileID: Boolean(fileID),
    hasUrl: Boolean(shareSnapshotUrl)
  })

  return {
    shareSnapshotFileID: fileID,
    shareSnapshotUrl,
    shareSnapshotPath: cloudPath,
    shareSnapshotGeneratedAt: now()
  }
}

async function generateWeeklyScheduleShareSnapshot(schedule = {}) {
  const scheduleType = normalizeScheduleType(schedule.scheduleType)
  const snapshot = buildWeeklyScheduleShareSnapshot({
    ...schedule,
    scheduleType,
    status: 'published'
  })
  const uploaded = await uploadWeeklyScheduleShareSnapshot(scheduleType, snapshot)
  return {
    snapshot,
    ...uploaded
  }
}

function getFirstWorkMediaValue(work = {}, fields = []) {
  for (const field of fields) {
    const value = String(work[field] || '').trim()
    if (value) return value
  }
  return ''
}

function inferPublicWorkType(work = {}) {
  const explicitType = String(work.workType || work.mediaType || work.submitType || work.type || '').toLowerCase()
  if (explicitType.includes('video')) return 'video'
  if (explicitType.includes('audio') || explicitType.includes('voice') || explicitType.includes('record')) return 'audio'

  const videoPath = getFirstWorkMediaValue(work, [
    'videoUrl', 'videoURL', 'videoFileID', 'videoFileId', 'videoPath'
  ])
  const anyPath = getFirstWorkMediaValue(work, [
    'fileID', 'fileId', 'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId',
    'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL', 'filePath', 'audioPath'
  ])
  if (videoPath || work.thumbPath || /\.(mp4|mov|m4v|avi)(\?|$)/i.test(anyPath)) return 'video'
  return 'audio'
}

function normalizePublicWorkMedia(work = {}) {
  const workType = inferPublicWorkType(work)
  const commonFileID = getFirstWorkMediaValue(work, [
    'fileID', 'fileId', 'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId'
  ])
  let audioFileID = getFirstWorkMediaValue(work, ['audioFileID', 'audioFileId'])
  let videoFileID = getFirstWorkMediaValue(work, ['videoFileID', 'videoFileId'])
  let audioUrl = getFirstWorkMediaValue(work, [
    'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL', 'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL'
  ])
  let videoUrl = getFirstWorkMediaValue(work, [
    'videoUrl', 'videoURL', 'videoFileUrl', 'videoFileURL', 'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL'
  ])
  const legacyPath = getFirstWorkMediaValue(work, [
    workType === 'video' ? 'videoPath' : 'audioPath', 'filePath', 'tempFilePath', 'recordPath'
  ])

  if (workType === 'video' && !videoFileID) videoFileID = commonFileID
  if (workType === 'audio' && !audioFileID) audioFileID = commonFileID

  if (/^cloud:\/\//i.test(audioUrl)) {
    if (!audioFileID) audioFileID = audioUrl
    audioUrl = ''
  }
  if (/^cloud:\/\//i.test(videoUrl)) {
    if (!videoFileID) videoFileID = videoUrl
    videoUrl = ''
  }
  if (audioUrl && !/^https?:\/\//i.test(audioUrl)) audioUrl = ''
  if (videoUrl && !/^https?:\/\//i.test(videoUrl)) videoUrl = ''

  if (/^cloud:\/\//i.test(legacyPath)) {
    if (workType === 'video' && !videoFileID) videoFileID = legacyPath
    if (workType === 'audio' && !audioFileID) audioFileID = legacyPath
  } else if (/^https?:\/\//i.test(legacyPath)) {
    if (workType === 'video' && !videoUrl) videoUrl = legacyPath
    if (workType === 'audio' && !audioUrl) audioUrl = legacyPath
  }

  const fileID = workType === 'video' ? videoFileID : audioFileID
  const mediaUrl = workType === 'video' ? videoUrl : audioUrl
  return {
    workType,
    fileID,
    mediaUrl,
    mediaPath: mediaUrl || fileID || legacyPath,
    audioFileID: workType === 'audio' ? audioFileID : '',
    audioUrl: workType === 'audio' ? audioUrl : '',
    videoFileID: workType === 'video' ? videoFileID : '',
    videoUrl: workType === 'video' ? videoUrl : ''
  }
}

function getSquareViewerIdentity(viewer = '') {
  if (typeof viewer === 'string') return { openid: viewer, userId: '', phone: '' }
  return {
    openid: String(viewer.openid || ''),
    userId: String(viewer.userId || viewer.id || ''),
    phone: normalizePhone(viewer.phone)
  }
}

function isSquareWorkOwner(work = {}, viewer = '') {
  const identity = getSquareViewerIdentity(viewer)
  const ownerOpenids = [
    work.ownerOpenid,
    work.userOpenid,
    work.openid,
    work._openid,
    work.authorOpenid,
    work.publicOpenid
  ].map(value => String(value || '')).filter(Boolean)
  if (identity.openid && ownerOpenids.includes(identity.openid)) return true

  const ownerUserIds = [work.ownerUserId, work.userId, work.authorUserId]
    .map(value => String(value || ''))
    .filter(Boolean)
  if (identity.userId && ownerUserIds.includes(identity.userId)) return true

  const ownerPhones = [work.ownerPhone, work.userPhone, work.phone]
    .map(normalizePhone)
    .filter(Boolean)
  return Boolean(identity.phone && ownerPhones.includes(identity.phone))
}

function sanitizePublicWork(work = {}, viewer = '', options = {}) {
  const media = normalizePublicWorkMedia(work)
  const workType = media.workType
  const legacyLikeCount = typeof work.likes === 'number' ? work.likes : 0
  const moduleId = String(work.moduleId || work.category || work.moduleType || work.trainingType || '').trim()
  const contentId = String(work.contentId || work.taskId || '').trim()

  const data = {
    _id: work._id || '',
    id: work.id || work._id || '',
    sourceType: work.sourceType || 'main',
    moduleId,
    category: work.category || moduleId,
    moduleType: work.moduleType || moduleId,
    trainingType: work.trainingType || moduleId,
    moduleTitle: work.moduleTitle || '',
    day: Number(work.day || 0),
    contentId,
    taskId: work.taskId || contentId,
    title: work.title || work.taskTitle || work.contentTitle || '',
    taskTitle: work.taskTitle || '',
    contentTitle: work.contentTitle || work.taskTitle || '',
    extraType: work.extraType || '',
    extraTitle: work.extraTitle || '',
    workType,
    mediaType: workType,
    submitType: work.submitType || work.mediaType || workType,
    type: workType,
    fileID: media.fileID,
    filePath: media.mediaPath,
    audioFileID: media.audioFileID,
    audioUrl: media.audioUrl,
    videoFileID: media.videoFileID,
    videoUrl: media.videoUrl,
    coverFileID: work.coverFileID || work.coverFileId || '',
    coverUrl: work.coverUrl || '',
    thumbPath: work.thumbPath || '',
    duration: work.duration || '',
    durationSeconds: Number(work.durationSeconds || 0),
    publicNickname: work.publicNickname || '同学',
    authorName: work.publicNickname || '同学',
    publicAvatarText: work.publicAvatarText || getAvatarText(work.publicNickname || '同学'),
    publicAt: work.publicAt || '',
    createdAt: work.createdAt || '',
    submittedAt: work.submittedAt || '',
    isPublic: work.isPublic === true,
    isMine: isSquareWorkOwner(work, viewer),
    likeCount: Math.max(Number(work.likeCount == null ? legacyLikeCount : work.likeCount) || 0, 0),
    commentCount: Math.max(Number(work.commentCount || 0) || 0, 0),
    likedByMe: false,
    hasTrainingSnapshot: Boolean(work.trainingContentSnapshot)
  }

  if (options.includeTrainingSnapshot === true) {
    data.trainingTitleSnapshot = work.trainingTitleSnapshot || ''
    data.trainingContentSnapshot = work.trainingContentSnapshot || ''
    data.trainingCategorySnapshot = work.trainingCategorySnapshot || ''
    data.trainingDaySnapshot = Number(work.trainingDaySnapshot || 0)
  }

  return data
}

function dateRangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false
  return startA <= endB && startB <= endA
}

async function archiveOtherPublishedSchedules(exceptId, operatorOpenid, range = {}) {
  const res = await db.collection(COLLECTIONS.weeklySchedules)
    .where({ status: 'published' })
    .limit(100)
    .get()

  const list = res.data || []
  const scheduleType = normalizeScheduleType(range.scheduleType)
  for (const item of list) {
    if (exceptId && item._id === exceptId) continue
    if (normalizeScheduleType(item.scheduleType) !== scheduleType) continue
    if (!dateRangesOverlap(range.startDate, range.endDate, item.startDate, item.endDate)) continue
    await db.collection(COLLECTIONS.weeklySchedules).doc(item._id).update({
      data: {
        status: 'archived',
        archivedAt: now(),
        archivedBy: operatorOpenid || '',
        updatedAt: now()
      }
    })
  }
}

async function upsertUser(openid, data = {}) {
  const user = await safeGetOne(COLLECTIONS.users, { openid })
  const incomingNickname = String(data.nickname || '').trim()
  const useIncomingNickname = incomingNickname && !(incomingNickname === '同学' && user && user.nickname)
  const nickname = useIncomingNickname ? incomingNickname : ((user && user.nickname) || '同学')
  const phone = data.phone || (user && user.phone) || ''
  const phoneBound = (data.phoneBound === true || (user && user.phoneBound === true)) && /^1\d{10}$/.test(normalizePhone(phone))
  const payload = {
    openid,
    nickname,
    nicknameSource: data.nicknameSource || (user && user.nicknameSource) || (useIncomingNickname && nickname !== '同学' ? 'wechat' : 'default'),
    avatarUrl: data.avatarUrl || (user && user.avatarUrl) || '',
    avatarText: getAvatarText(nickname),
    phone,
    phoneMasked: data.phoneMasked || (user && user.phoneMasked) || maskPhone(phone),
    phoneBound,
    phoneBoundAt: data.phoneBoundAt || (user && user.phoneBoundAt) || '',
    profileCompleted: typeof data.profileCompleted === 'boolean'
      ? data.profileCompleted
      : Boolean(user && user.profileCompleted),
    isLogin: phoneBound,
    membershipType: data.membershipType || (user && user.membershipType) || 'free',
    membershipStatus: data.membershipStatus || (user && user.membershipStatus) || 'active',
    membershipStartAt: data.membershipStartAt || (user && user.membershipStartAt) || '',
    membershipEndAt: data.membershipEndAt == null
      ? ((user && user.membershipEndAt) || null)
      : data.membershipEndAt,
    role: data.role || (user && user.role) || 'user',
    isAdmin: data.isAdmin === true || (user && user.isAdmin === true),
    aiDailyLimit: data.aiDailyLimit == null
      ? ((user && user.aiDailyLimit) == null ? FREE_DAILY_AI_LIMIT : user.aiDailyLimit)
      : data.aiDailyLimit,
    aiMonthlyLimit: data.aiMonthlyLimit == null
      ? ((user && user.aiMonthlyLimit) == null ? FREE_MONTHLY_AI_LIMIT : user.aiMonthlyLimit)
      : data.aiMonthlyLimit,
    status: 'active',
    lastLoginAt: now(),
    updatedAt: now()
  }

  if (user) {
    await db.collection(COLLECTIONS.users).doc(user._id).update({
      data: {
        ...payload,
        loginCount: _.inc(1)
      }
    })

    return {
      ...user,
      ...payload,
      loginCount: Number(user.loginCount || 0) + 1
    }
  }

  const created = {
    ...payload,
    firstLoginAt: now(),
    loginCount: 1,
    createdAt: now()
  }
  const addRes = await db.collection(COLLECTIONS.users).add({
    data: created
  })

  return {
    _id: addRes._id,
    ...created
  }
}

async function getActiveEntitlements(phone, openid) {
  const targetPhone = normalizePhone(phone)
  const targetOpenid = openid || ''
  const conditions = []

  if (targetPhone) conditions.push({ phone: targetPhone })
  if (targetOpenid) conditions.push({ openid: targetOpenid })
  if (!conditions.length) return []

  const res = await db.collection(COLLECTIONS.entitlements)
    .where({
      status: 'active'
    })
    .limit(100)
    .get()

  return (res.data || []).filter(item => {
    const samePhone = targetPhone && normalizePhone(item.phone) === targetPhone
    const sameOpenid = targetOpenid && item.openid === targetOpenid
    return (samePhone || sameOpenid) && !isExpired(item.expireAt)
  })
}

function getPackages(entitlements) {
  return Array.from(new Set((entitlements || []).map(item => item.packageCode).filter(Boolean)))
}

function hasAdvancedAccess(packages) {
  return packages.includes('advanced_all') || packages.includes('vip_all')
}

function normalizeMembershipType(value, fallback = 'free') {
  const type = String(value || '').toLowerCase()
  if (type === 'admin') return 'admin'
  if (type === 'yearly' || type === 'year' || type === 'annual') return 'yearly'
  if (type === 'monthly' || type === 'month') return 'monthly'
  if (type === 'free') return 'free'
  return fallback
}

function getMembershipLimits(membershipType) {
  if (membershipType === 'admin') {
    return { aiDailyLimit: -1, aiMonthlyLimit: -1 }
  }
  if (membershipType === 'monthly') {
    return {
      aiDailyLimit: MONTHLY_MEMBER_DAILY_AI_LIMIT,
      aiMonthlyLimit: MONTHLY_MEMBER_MONTHLY_AI_LIMIT
    }
  }
  if (membershipType === 'yearly') {
    return {
      aiDailyLimit: YEARLY_MEMBER_DAILY_AI_LIMIT,
      aiMonthlyLimit: YEARLY_MEMBER_MONTHLY_AI_LIMIT
    }
  }
  return {
    aiDailyLimit: FREE_DAILY_AI_LIMIT,
    aiMonthlyLimit: FREE_MONTHLY_AI_LIMIT
  }
}

function buildMembershipProfile(value, startAt = now()) {
  const membershipType = normalizeMembershipType(value, 'free')
  const limits = getMembershipLimits(membershipType)
  const membershipEndAt = membershipType === 'monthly'
    ? addDays(today(), 90)
    : membershipType === 'yearly'
      ? addDays(today(), 365)
      : null

  return {
    membershipType,
    membershipStatus: 'active',
    membershipStartAt: startAt,
    membershipEndAt,
    role: membershipType === 'admin' ? 'admin' : 'user',
    isAdmin: membershipType === 'admin',
    ...limits
  }
}

function isActiveMembershipRecord(record = {}) {
  if (record.membershipStatus !== 'active') return false
  if (record.membershipType === 'admin') return true
  return !isExpired(record.membershipEndAt)
}

async function getPhoneEntitlement(phone) {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) return null

  let entitlement = null
  try {
    entitlement = await safeGetOne(COLLECTIONS.phoneEntitlements, {
      phone: normalizedPhone
    })
  } catch (error) {
    console.warn('[cloudApi] phoneEntitlements unavailable:', error.message || error)
    return null
  }
  if (!entitlement || ['disabled', 'deleted'].includes(entitlement.status)) return null
  if (entitlement.membershipStatus !== 'active') return null

  if (entitlement.membershipType !== 'admin' && isExpired(entitlement.membershipEndAt)) {
    await db.collection(COLLECTIONS.phoneEntitlements).doc(entitlement._id).update({
      data: {
        membershipStatus: 'expired',
        updatedAt: now()
      }
    })
    return null
  }

  return entitlement
}

async function listPhoneEntitlements(limit) {
  try {
    return await db.collection(COLLECTIONS.phoneEntitlements).orderBy('updatedAt', 'desc').limit(limit).get()
  } catch (error) {
    console.warn('[cloudApi] phoneEntitlements list unavailable:', error.message || error)
    return { data: [] }
  }
}

async function resolvePhoneMembership(phone) {
  const entitlement = await getPhoneEntitlement(phone)
  if (!entitlement) return buildMembershipProfile('free')

  const membershipType = normalizeMembershipType(entitlement.membershipType, 'free')
  return {
    ...buildMembershipProfile(membershipType, entitlement.membershipStartAt || entitlement.createdAt || now()),
    membershipStatus: entitlement.membershipStatus || 'active',
    membershipEndAt: membershipType === 'admin'
      ? null
      : (entitlement.membershipEndAt || null)
  }
}

function getMembershipType(user, entitlements, packages) {
  const userType = normalizeMembershipType(user && user.membershipType, 'free')
  if (user && user.phoneBound === true && isActiveMembershipRecord(user) && userType !== 'free') {
    return userType
  }

  const entitlementType = (entitlements || [])
    .map(item => item.membershipType || item.memberType)
    .find(Boolean)
  if (hasAdvancedAccess(packages)) {
    return normalizeMembershipType(entitlementType, 'monthly')
  }

  return 'free'
}

function getAiLimit(packages, membershipType = 'free') {
  if (membershipType === 'admin') return -1
  if (membershipType === 'yearly') return YEARLY_MEMBER_DAILY_AI_LIMIT
  if (membershipType === 'monthly') return MONTHLY_MEMBER_DAILY_AI_LIMIT
  if (!hasAdvancedAccess(packages)) return FREE_DAILY_AI_LIMIT
  return MEMBER_DAILY_AI_LIMIT
}

async function getCurrentAccess(openid, phone = '') {
  let user = openid ? await safeGetOne(COLLECTIONS.users, { openid }) : null

  if (!phone && user && user.phone) {
    phone = user.phone
  }

  const normalizedPhone = normalizePhone(phone)
  let student = null
  if (normalizedPhone) {
    student = await safeGetOne(COLLECTIONS.students, {
      phone: normalizedPhone,
      status: 'active'
    })
  }

  const entitlements = await getActiveEntitlements(normalizedPhone, openid)
  const packages = getPackages(entitlements)
  const phoneMembership = normalizedPhone ? await resolvePhoneMembership(normalizedPhone) : null
  const directMembership = user && user.phoneBound === true && phoneMembership && phoneMembership.membershipType !== 'free'
    ? phoneMembership
    : null
  const membershipType = !(user && user.phoneBound === true)
    ? 'free'
    : directMembership
      ? directMembership.membershipType
      : getMembershipType(user, entitlements, packages)
  const membershipProfile = directMembership || (
    user && isActiveMembershipRecord(user)
      ? {
        membershipType,
        membershipStatus: user.membershipStatus,
        membershipStartAt: user.membershipStartAt || '',
        membershipEndAt: user.membershipEndAt || null,
        role: user.role || 'user',
        isAdmin: user.isAdmin === true,
        ...getMembershipLimits(membershipType)
      }
      : buildMembershipProfile(membershipType)
  )
  const hasMembershipAccess = Boolean(user && user.phoneBound === true) && (
    ['monthly', 'yearly', 'admin'].includes(membershipType) || hasAdvancedAccess(packages)
  )

  return {
    openid,
    phone: normalizedPhone,
    user,
    student,
    entitlements,
    packages,
    membershipType,
    membershipStatus: membershipProfile.membershipStatus,
    membershipStartAt: membershipProfile.membershipStartAt,
    membershipEndAt: membershipProfile.membershipEndAt,
    role: membershipProfile.role,
    isAdmin: membershipProfile.isAdmin,
    phoneBound: Boolean(normalizedPhone && user && user.phoneBound === true),
    hasAdvancedAccess: hasMembershipAccess,
    aiLimit: membershipProfile.aiDailyLimit,
    aiDailyLimit: membershipProfile.aiDailyLimit,
    aiMonthlyLimit: membershipProfile.aiMonthlyLimit
  }
}

async function recordLeadInternal(data) {
  const phone = normalizePhone(data.phone)
  if (!phone) return ''

  const old = await safeGetOne(COLLECTIONS.leads, { phone })
  const payload = {
    phone,
    phoneMasked: maskPhone(phone),
    openid: data.openid || '',
    nickname: data.nickname || '同学',
    source: data.source || 'online_visitor',
    status: 'new',
    lastAction: data.lastAction || '',
    updatedAt: now()
  }

  if (old) {
    await db.collection(COLLECTIONS.leads).doc(old._id).update({
      data: payload
    })
    return old._id
  }

  const addRes = await db.collection(COLLECTIONS.leads).add({
    data: {
      ...payload,
      createdAt: now()
    }
  })
  return addRes._id
}

async function healthCheck(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const user = await upsertUser(openid, {
    nickname: event.nickname || '同学'
  })

  return success({
    action: 'healthCheck',
    openid,
    env: wxContext.ENV || '',
    user,
    testRecord: {
      openid,
      action: 'healthCheck',
      createdAt: now(),
      env: wxContext.ENV || ''
    }
  })
}

async function getMe(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const user = await upsertUser(openid, {
    nickname: event.nickname || '同学'
  })
  const access = await getCurrentAccess(openid, user.phone || '')

  return success({
    openid,
    user,
    access
  })
}

async function getAdminProfile(event, wxContext) {
  const profile = await getAdminProfileByOpenid(wxContext.OPENID || '')

  return success({
    openid: wxContext.OPENID || '',
    isAdmin: profile.isAdmin,
    role: profile.role,
    admin: profile.admin,
    source: profile.source
  })
}

async function initSuperAdmin(event, wxContext) {
  const openid = wxContext.OPENID || ''

  if (!getAdminOpenids().includes(openid)) {
    return fail('not_bootstrap_admin', '当前 openId 不在 ADMIN_OPENIDS 中，不能初始化超级管理员。')
  }

  const activeSuperAdmins = await getActiveSuperAdmins()
  const existedSuperAdmin = activeSuperAdmins[0] || null
  const operatorProfile = await getAdminProfileByOpenid(openid)

  if (existedSuperAdmin) {
    return success({
      admin: sanitizeAdmin(existedSuperAdmin),
      initialized: false,
      message: '已存在 active super_admin，不重复初始化。'
    })
  }

  const payload = {
    openid,
    nickname: event.nickname || '超级管理员',
    phone: normalizePhone(event.phone || ''),
    role: 'super_admin',
    status: 'active',
    permissions: ['*'],
    createdAt: now(),
    createdBy: openid,
    updatedAt: now(),
    remark: event.remark || '通过 ADMIN_OPENIDS 初始化'
  }
  const addRes = await db.collection(COLLECTIONS.admins).add({
    data: payload
  })
  const admin = {
    _id: addRes._id,
    ...payload
  }

  await writeAuditLog('initSuperAdmin', operatorProfile, {
    operatorOpenid: openid,
    operatorRole: 'super_admin',
    targetType: 'admin',
    targetId: addRes._id,
    targetOpenid: openid,
    payloadSummary: payload
  })

  return success({
    admin: sanitizeAdmin(admin),
    initialized: true
  })
}

async function adminListAdmins(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const limit = Math.min(Number(event.limit || 100), 100)
  const res = await db.collection(COLLECTIONS.admins)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()

  return success({
    admins: (res.data || []).map(item => sanitizeAdmin(item, false)),
    profile: admin.profile
  })
}

async function adminAddAdmin(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const openid = String(event.openid || '').trim()
  const role = String(event.role || '').trim()
  const allowedRoles = ['admin', 'teacher', 'reviewer']

  if (!openid) return fail('missing_openid', '请填写管理员 openId。')
  if (!allowedRoles.includes(role)) {
    return fail('invalid_admin_role', '角色只能是 admin / teacher / reviewer。')
  }

  const old = await safeGetOne(COLLECTIONS.admins, { openid })
  const payload = {
    openid,
    nickname: event.nickname || '管理员',
    phone: normalizePhone(event.phone || ''),
    role,
    status: 'active',
    permissions: Array.isArray(event.permissions) ? event.permissions : [],
    updatedAt: now(),
    remark: event.remark || ''
  }

  if (old) {
    if (old.role === 'super_admin') {
      return fail('cannot_update_super_admin', '不能通过此接口修改超级管理员。')
    }

    await db.collection(COLLECTIONS.admins).doc(old._id).update({
      data: payload
    })
    const nextAdmin = sanitizeAdmin({
      ...old,
      ...payload
    }, false)

    await writeAuditLog('adminAddAdmin', admin.profile, {
      targetType: 'admin',
      targetId: old._id,
      targetOpenid: openid,
      targetPhone: payload.phone,
      payloadSummary: payload
    })

    return success({
      admin: nextAdmin,
      updated: true
    })
  }

  const addPayload = {
    ...payload,
    createdAt: now(),
    createdBy: wxContext.OPENID
  }
  const addRes = await db.collection(COLLECTIONS.admins).add({
    data: addPayload
  })
  const created = sanitizeAdmin({
    _id: addRes._id,
    ...addPayload
  }, false)

  await writeAuditLog('adminAddAdmin', admin.profile, {
    targetType: 'admin',
    targetId: addRes._id,
    targetOpenid: openid,
    targetPhone: payload.phone,
    payloadSummary: addPayload
  })

  return success({
    admin: created,
    created: true
  })
}

async function adminDisableAdmin(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const id = event.id || ''
  const openid = String(event.openid || '').trim()

  if (!id && !openid) return fail('missing_admin_id', '缺少管理员 ID 或 openId。')

  const target = id
    ? await safeGetOne(COLLECTIONS.admins, { _id: id })
    : await safeGetOne(COLLECTIONS.admins, { openid })

  if (!target) return fail('admin_not_found', '没有找到管理员。')
  if (target.openid === wxContext.OPENID) return fail('cannot_disable_self', '不能禁用自己。')

  if (target.role === 'super_admin' && target.status === 'active') {
    const activeSuperAdmins = await getActiveSuperAdmins()
    if (activeSuperAdmins.length <= 1) {
      return fail('cannot_disable_last_super_admin', '不能禁用最后一个超级管理员。')
    }
  }

  await db.collection(COLLECTIONS.admins).doc(target._id).update({
    data: {
      status: 'disabled',
      disabledAt: now(),
      disabledBy: wxContext.OPENID,
      updatedAt: now()
    }
  })

  await writeAuditLog('adminDisableAdmin', admin.profile, {
    targetType: 'admin',
    targetId: target._id,
    targetOpenid: target.openid,
    targetPhone: target.phone,
    payloadSummary: {
      openid: target.openid,
      role: target.role,
      status: 'disabled',
      nickname: target.nickname
    }
  })

  return success({
    id: target._id,
    disabled: true
  })
}

async function adminUpdateAdminRole(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const openid = String(event.openid || '').trim()
  const role = String(event.role || '').trim()
  const allowedRoles = ['admin', 'teacher', 'reviewer']

  if (!openid) return fail('missing_openid', '请填写管理员 openId。')
  if (!allowedRoles.includes(role)) {
    return fail('invalid_admin_role', '第一版不支持通过此接口设置 super_admin。')
  }

  const target = await safeGetOne(COLLECTIONS.admins, { openid })
  if (!target) return fail('admin_not_found', '没有找到管理员。')
  if (target.openid === wxContext.OPENID) return fail('cannot_update_self_role', '不能修改自己的管理员角色。')
  if (target.role === 'super_admin') return fail('cannot_update_super_admin', '不能通过此接口修改超级管理员。')

  await db.collection(COLLECTIONS.admins).doc(target._id).update({
    data: {
      role,
      updatedAt: now(),
      updatedBy: wxContext.OPENID
    }
  })

  await writeAuditLog('adminUpdateAdminRole', admin.profile, {
    targetType: 'admin',
    targetId: target._id,
    targetOpenid: target.openid,
    targetPhone: target.phone,
    payloadSummary: {
      openid: target.openid,
      role,
      nickname: target.nickname
    }
  })

  return success({
    id: target._id,
    role
  })
}

async function adminAuditLogs(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const limit = Math.min(Number(event.limit || 100), 100)
  const res = await db.collection(COLLECTIONS.auditLogs)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()

  return success({
    logs: res.data || [],
    profile: admin.profile
  })
}

function sanitizeUserProfile(user = {}) {
  return {
    openid: user.openid || '',
    nickname: user.nickname || '同学',
    avatarUrl: user.avatarUrl || '',
    avatarText: user.avatarText || getAvatarText(user.nickname || '同学'),
    profileCompleted: user.profileCompleted === true,
    isLogin: user.phoneBound === true,
    phone: user.phone || '',
    phoneMasked: user.phoneMasked || maskPhone(user.phone || ''),
    phoneBound: user.phoneBound === true,
    phoneBoundAt: user.phoneBoundAt || '',
    membershipType: user.membershipType || 'free',
    membershipStatus: user.membershipStatus || 'active',
    membershipStartAt: user.membershipStartAt || '',
    membershipEndAt: user.membershipEndAt || null,
    role: user.role || 'user',
    isAdmin: user.isAdmin === true,
    aiDailyLimit: Number(user.aiDailyLimit == null ? FREE_DAILY_AI_LIMIT : user.aiDailyLimit),
    aiMonthlyLimit: Number(user.aiMonthlyLimit == null ? FREE_MONTHLY_AI_LIMIT : user.aiMonthlyLimit)
  }
}

async function syncAdminMembershipForUser(user, membershipProfile) {
  if (!user || !user.openid) return

  const oldAdmin = await safeGetOne(COLLECTIONS.admins, { openid: user.openid })
  if (membershipProfile.membershipType === 'admin') {
    const payload = {
      openid: user.openid,
      nickname: user.nickname || '管理员',
      phone: user.phone || '',
      role: oldAdmin && oldAdmin.role === 'super_admin' ? 'super_admin' : 'admin',
      status: 'active',
      permissions: ['*'],
      source: oldAdmin && oldAdmin.role === 'super_admin' ? (oldAdmin.source || 'admins_collection') : 'phone_entitlement',
      updatedAt: now(),
      remark: oldAdmin && oldAdmin.remark ? oldAdmin.remark : '手机号身份授权'
    }

    if (oldAdmin) {
      await db.collection(COLLECTIONS.admins).doc(oldAdmin._id).update({ data: payload })
    } else {
      await db.collection(COLLECTIONS.admins).add({
        data: {
          ...payload,
          createdAt: now(),
          createdBy: 'phone_entitlement'
        }
      })
    }
    return
  }

  if (oldAdmin && oldAdmin.source === 'phone_entitlement' && oldAdmin.status === 'active') {
    await db.collection(COLLECTIONS.admins).doc(oldAdmin._id).update({
      data: {
        status: 'inactive',
        disabledAt: now(),
        updatedAt: now()
      }
    })
  }
}

async function bindPhoneInternal(phoneValue, event, wxContext) {
  const openid = wxContext.OPENID || ''
  const phone = normalizePhone(phoneValue)
  if (!openid) return fail('missing_openid', '未获取到微信身份，请稍后重试。')
  if (!/^1\d{10}$/.test(phone)) return fail('invalid_phone', '手机号格式不正确。')

  const user = await upsertUser(openid, {
    nickname: event.nickname || '同学'
  })
  const membershipProfile = await resolvePhoneMembership(phone)
  const phoneBoundAt = user.phoneBoundAt || now()
  const userPatch = {
    phone,
    phoneMasked: maskPhone(phone),
    phoneBound: true,
    phoneBoundAt,
    isLogin: true,
    membershipType: membershipProfile.membershipType,
    membershipStatus: membershipProfile.membershipStatus,
    membershipStartAt: membershipProfile.membershipStartAt,
    membershipEndAt: membershipProfile.membershipEndAt,
    role: membershipProfile.role,
    isAdmin: membershipProfile.isAdmin,
    aiDailyLimit: membershipProfile.aiDailyLimit,
    aiMonthlyLimit: membershipProfile.aiMonthlyLimit,
    updatedAt: now()
  }

  await db.collection(COLLECTIONS.users).doc(user._id).update({ data: userPatch })
  const nextUser = { ...user, ...userPatch }

  const student = await safeGetOne(COLLECTIONS.students, { phone, status: 'active' })
  if (student && !student.openid) {
    await db.collection(COLLECTIONS.students).doc(student._id).update({
      data: { openid, boundAt: now(), updatedAt: now() }
    })
  }

  const oldEntitlements = await getActiveEntitlements(phone, openid)
  for (const item of oldEntitlements) {
    if (!item.openid) {
      await db.collection(COLLECTIONS.entitlements).doc(item._id).update({
        data: { openid, updatedAt: now() }
      })
    }
  }

  await syncAdminMembershipForUser(nextUser, membershipProfile)

  if (!student && membershipProfile.membershipType === 'free') {
    await recordLeadInternal({
      phone,
      openid,
      nickname: nextUser.nickname || '同学',
      source: 'phone_auth_free_user',
      lastAction: 'bind_phone_free'
    })
  }

  console.log('[cloudApi] phone bound:', {
    phoneMasked: maskPhone(phone),
    membershipType: membershipProfile.membershipType,
    isAdmin: membershipProfile.isAdmin
  })

  return success({
    phone,
    phoneMasked: maskPhone(phone),
    membershipType: membershipProfile.membershipType,
    membershipStatus: membershipProfile.membershipStatus,
    membershipEndAt: membershipProfile.membershipEndAt,
    role: membershipProfile.role,
    isAdmin: membershipProfile.isAdmin,
    aiDailyLimit: membershipProfile.aiDailyLimit,
    aiMonthlyLimit: membershipProfile.aiMonthlyLimit,
    userProfile: sanitizeUserProfile(nextUser),
    membershipProfile,
    packages: getPackages(oldEntitlements),
    hasAdvancedAccess: ['monthly', 'yearly', 'admin'].includes(membershipProfile.membershipType) || hasAdvancedAccess(getPackages(oldEntitlements))
  })
}

async function bindPhoneByCode(event, wxContext) {
  const code = String(event.code || '').trim()
  if (!code) return fail('PHONE_CODE_REQUIRED', '缺少手机号授权凭证，请重新授权。', {
    debugCode: 'PHONE_CODE_REQUIRED'
  })

  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    const phoneInfo = result.phoneInfo || result.phone_info || (result.result && result.result.phoneInfo) || {}
    const phone = phoneInfo.purePhoneNumber || phoneInfo.phoneNumber || ''
    if (!phone) return fail('PHONE_NUMBER_EMPTY', '暂未获取到手机号，请重新授权。', {
      debugCode: 'PHONE_NUMBER_EMPTY'
    })
    return await bindPhoneInternal(phone, event, wxContext)
  } catch (error) {
    const debugCode = String(error.errCode || error.code || 'PHONE_AUTH_FAILED')
    console.error('[cloudApi] bindPhoneByCode failed:', {
      debugCode,
      message: error.message || '手机号授权失败'
    })
    return fail(debugCode, '当前暂无法获取手机号，请联系周老师绑定手机号。', { debugCode })
  }
}

async function bindPhoneAndGetAccess(event, wxContext) {
  return bindPhoneInternal(event.phone, event, wxContext)
}

async function adminCreateStudent(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const phone = normalizePhone(event.phone)
  if (!/^1\d{10}$/.test(phone)) {
    return fail('invalid_phone', '手机号格式不正确。')
  }

  const old = await safeGetOne(COLLECTIONS.students, { phone })
  const payload = {
    phone,
    phoneMasked: maskPhone(phone),
    realName: event.realName || event.name || '未命名学员',
    classId: event.classId || '',
    className: event.className || '',
    status: 'active',
    source: event.source || 'offline',
    remark: event.remark || '',
    updatedAt: now(),
    updatedBy: wxContext.OPENID
  }

  if (old) {
    await db.collection(COLLECTIONS.students).doc(old._id).update({
      data: payload
    })
    await writeAuditLog('adminCreateStudent', admin.profile, {
      targetType: 'student',
      targetId: old._id,
      targetOpenid: old.openid || '',
      targetPhone: phone,
      payloadSummary: payload
    })

    return success({
      id: old._id,
      updated: true,
      student: {
        ...old,
        ...payload
      }
    })
  }

  const addRes = await db.collection(COLLECTIONS.students).add({
    data: {
      ...payload,
      openid: event.openid || '',
      createdAt: now(),
      createdBy: wxContext.OPENID
    }
  })

  await writeAuditLog('adminCreateStudent', admin.profile, {
    targetType: 'student',
    targetId: addRes._id,
    targetOpenid: event.openid || '',
    targetPhone: phone,
    payloadSummary: payload
  })

  return success({
    id: addRes._id,
    created: true
  })
}

async function adminGrantEntitlement(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const phone = normalizePhone(event.phone)
  if (!/^1\d{10}$/.test(phone)) {
    return fail('invalid_phone', '手机号格式不正确。')
  }

  const packageCode = event.packageCode || ''
  if (!PACKAGE_NAMES[packageCode]) {
    return fail('invalid_package', '权限包类型不正确。')
  }

  const student = await safeGetOne(COLLECTIONS.students, { phone })
  const payload = {
    phone,
    phoneMasked: maskPhone(phone),
    openid: (student && student.openid) || event.openid || '',
    packageCode,
    packageName: PACKAGE_NAMES[packageCode],
    status: 'active',
    startAt: event.startAt || now().slice(0, 10),
    expireAt: event.expireAt || '',
    membershipType: hasAdvancedAccess([packageCode])
      ? normalizeMembershipType(event.membershipType, 'monthly')
      : 'free',
    membershipStatus: 'active',
    membershipStartAt: event.startAt || now().slice(0, 10),
    membershipEndAt: event.expireAt || '',
    source: event.source || 'admin',
    remark: event.remark || '',
    createdAt: now(),
    createdBy: wxContext.OPENID,
    updatedAt: now()
  }

  const addRes = await db.collection(COLLECTIONS.entitlements).add({
    data: payload
  })

  await db.collection(COLLECTIONS.orders).add({
    data: {
      phone,
      phoneMasked: maskPhone(phone),
      openid: payload.openid,
      packageCode,
      packageName: PACKAGE_NAMES[packageCode],
      amount: Number(event.amount || 0),
      payMethod: event.payMethod || 'manual',
      status: 'paid',
      createdBy: wxContext.OPENID,
      createdAt: now(),
      remark: event.remark || ''
    }
  })

  await writeAuditLog('adminGrantEntitlement', admin.profile, {
    targetType: 'entitlement',
    targetId: addRes._id,
    targetOpenid: payload.openid,
    targetPhone: phone,
    payloadSummary: payload
  })

  return success({
    id: addRes._id,
    entitlement: payload
  })
}

const MEMBERSHIP_LABELS = {
  free: '普通',
  monthly: '季度会员',
  yearly: '年度会员',
  admin: '管理员'
}

function normalizeDateOnly(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const parts = text.split('-').map(Number)
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() + 1 !== parts[1] ||
    date.getUTCDate() !== parts[2]
  ) return ''
  return text
}

function getEntitlementMembershipStatus(entitlement = {}) {
  if (entitlement.status === 'disabled' || entitlement.status === 'deleted') return 'inactive'
  if (
    ['monthly', 'yearly'].includes(entitlement.membershipType) &&
    isExpired(entitlement.membershipEndAt)
  ) return 'expired'
  return 'active'
}

async function syncPhoneEntitlementUsers(phoneValue, entitlement = {}) {
  const phone = normalizePhone(phoneValue)
  if (!phone) return

  const membershipStatus = getEntitlementMembershipStatus(entitlement)
  const canActivate = entitlement.status === 'active' && membershipStatus === 'active'
  const effectiveProfile = canActivate
    ? {
      membershipType: normalizeMembershipType(entitlement.membershipType, 'free'),
      membershipStatus: 'active',
      membershipStartAt: entitlement.membershipStartAt || '',
      membershipEndAt: entitlement.membershipEndAt || null,
      role: entitlement.role || (entitlement.membershipType === 'admin' ? 'admin' : 'user'),
      isAdmin: entitlement.membershipType === 'admin' || entitlement.isAdmin === true,
      ...getMembershipLimits(normalizeMembershipType(entitlement.membershipType, 'free'))
    }
    : {
      ...buildMembershipProfile('free'),
      membershipStatus: membershipStatus === 'expired' ? 'expired' : 'inactive',
      membershipStartAt: '',
      membershipEndAt: null
    }

  const usersRes = await db.collection(COLLECTIONS.users).where({ phone }).limit(100).get()
  for (const user of usersRes.data || []) {
    const userPatch = {
      membershipType: effectiveProfile.membershipType,
      membershipStatus: effectiveProfile.membershipStatus,
      membershipStartAt: effectiveProfile.membershipStartAt,
      membershipEndAt: effectiveProfile.membershipEndAt,
      role: effectiveProfile.role,
      isAdmin: effectiveProfile.isAdmin,
      aiDailyLimit: effectiveProfile.aiDailyLimit,
      aiMonthlyLimit: effectiveProfile.aiMonthlyLimit,
      updatedAt: now()
    }
    await db.collection(COLLECTIONS.users).doc(user._id).update({ data: userPatch })
    await syncAdminMembershipForUser({ ...user, ...userPatch }, effectiveProfile)
  }
}

function normalizePhoneEntitlementRecord(item = {}) {
  const membershipType = normalizeMembershipType(item.membershipType, 'free')
  const status = ['active', 'disabled', 'deleted'].includes(item.status) ? item.status : 'active'
  const membershipStatus = status === 'active'
    ? getEntitlementMembershipStatus({ ...item, membershipType, status })
    : 'inactive'
  return {
    ...item,
    phone: normalizePhone(item.phone),
    phoneMasked: item.phoneMasked || maskPhone(item.phone),
    name: item.name || item.realName || '',
    className: item.className || '',
    membershipType,
    membershipLabel: MEMBERSHIP_LABELS[membershipType],
    membershipStatus,
    role: membershipType === 'admin' ? 'admin' : 'user',
    isAdmin: membershipType === 'admin',
    status,
    aiDailyLimit: getMembershipLimits(membershipType).aiDailyLimit,
    aiMonthlyLimit: getMembershipLimits(membershipType).aiMonthlyLimit
  }
}

async function getLegacyPhoneEntitlements() {
  try {
    const [studentsRes, entitlementsRes] = await Promise.all([
      db.collection(COLLECTIONS.students).limit(100).get(),
      db.collection(COLLECTIONS.entitlements).limit(100).get()
    ])
    const students = studentsRes.data || []
    const studentMap = new Map(students.map(item => [normalizePhone(item.phone), item]))
    const legacyMap = new Map()

    for (const item of entitlementsRes.data || []) {
      const phone = normalizePhone(item.phone)
      if (!phone || legacyMap.has(phone)) continue
      const student = studentMap.get(phone) || {}
      const membershipType = ['vip_all', 'advanced_all'].includes(item.packageCode) ? 'monthly' : 'free'
      legacyMap.set(phone, normalizePhoneEntitlementRecord({
        _id: '',
        name: student.realName || student.name || '',
        phone,
        phoneMasked: maskPhone(phone),
        className: student.className || '',
        remark: item.remark || student.remark || '',
        membershipType,
        membershipStartAt: item.startAt || item.createdAt || '',
        membershipEndAt: membershipType === 'free' ? null : (item.expireAt || null),
        status: item.status === 'active' ? 'active' : 'disabled',
        updatedAt: item.updatedAt || item.createdAt || '',
        source: 'legacy',
        isLegacy: true
      }))
    }

    for (const student of students) {
      const phone = normalizePhone(student.phone)
      if (!phone || legacyMap.has(phone)) continue
      legacyMap.set(phone, normalizePhoneEntitlementRecord({
        _id: '',
        name: student.realName || student.name || '',
        phone,
        phoneMasked: maskPhone(phone),
        className: student.className || '',
        remark: student.remark || '',
        membershipType: 'free',
        membershipStartAt: student.createdAt || '',
        membershipEndAt: null,
        status: student.status === 'inactive' ? 'disabled' : 'active',
        updatedAt: student.updatedAt || student.createdAt || '',
        source: 'legacy',
        isLegacy: true
      }))
    }
    return Array.from(legacyMap.values())
  } catch (error) {
    console.warn('[cloudApi] legacy phone entitlement read failed:', error.message || error)
    return []
  }
}

async function adminListPhoneEntitlements(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const keyword = String(event.keyword || (event.data && event.data.keyword) || '').trim().toLowerCase()
  const currentRes = await listPhoneEntitlements(100)
  const legacyRecords = await getLegacyPhoneEntitlements()
  const legacyByPhone = new Map(legacyRecords.map(item => [item.phone, item]))
  const normalizedCurrent = (currentRes.data || [])
    .map(normalizePhoneEntitlementRecord)
    .map(item => {
      const legacy = legacyByPhone.get(item.phone) || {}
      return {
        ...item,
        name: item.name || legacy.name || '',
        className: item.className || legacy.className || '',
        remark: item.remark || legacy.remark || ''
      }
    })
  const current = normalizedCurrent.filter(item => item.status !== 'deleted')
  const currentPhones = new Set(normalizedCurrent.map(item => item.phone))
  const legacy = legacyRecords.filter(item => !currentPhones.has(item.phone))
  const list = current.concat(legacy)
    .filter(item => {
      if (!keyword) return true
      return [item.name, item.phone, item.phoneMasked, item.className, item.remark]
        .some(value => String(value || '').toLowerCase().includes(keyword))
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  return success({ list })
}

async function adminSavePhoneEntitlement(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  const id = String(input.id || '').trim()
  const phone = normalizePhone(input.phone)
  const membershipType = normalizeMembershipType(input.membershipType, '')
  if (!/^1\d{10}$/.test(phone)) return fail('invalid_phone', '手机号格式不正确。')
  if (!['free', 'monthly', 'yearly', 'admin'].includes(membershipType)) {
    return fail('invalid_membership_type', '身份类型只能是普通、季度会员、年度会员或管理员。')
  }

  const oldById = id ? await safeGetById(COLLECTIONS.phoneEntitlements, id) : null
  if (id && !oldById) return fail('entitlement_not_found', '手机号身份记录不存在。')
  if (oldById && normalizePhone(oldById.phone) !== phone) {
    return fail('phone_change_not_allowed', '编辑时暂不支持修改手机号，请删除后重新创建。')
  }
  const oldByPhone = await safeGetOne(COLLECTIONS.phoneEntitlements, { phone })
  if (oldByPhone && oldById && oldByPhone._id !== oldById._id) {
    return fail('phone_already_exists', '该手机号已存在身份档案。')
  }
  const old = oldById || oldByPhone

  const rawEndAt = String(input.membershipEndAt || '').trim()
  const submittedEndAt = normalizeDateOnly(rawEndAt)
  if (rawEndAt && !submittedEndAt) return fail('invalid_membership_end_at', '到期日期格式不正确。')

  const resetStartAt = !old || normalizeMembershipType(old.membershipType, 'free') !== membershipType
  const profile = buildMembershipProfile(membershipType, resetStartAt ? now() : (old.membershipStartAt || now()))
  if (['monthly', 'yearly'].includes(membershipType) && submittedEndAt) {
    profile.membershipEndAt = submittedEndAt
  }
  if (['free', 'admin'].includes(membershipType)) profile.membershipEndAt = null

  const status = old && ['active', 'disabled'].includes(old.status) ? old.status : 'active'
  profile.membershipStatus = status === 'active'
    ? getEntitlementMembershipStatus({ ...profile, status })
    : 'inactive'
  const payload = {
    name: String(input.name || input.realName || (old && old.name) || '').trim(),
    phone,
    phoneMasked: maskPhone(phone),
    className: String(input.className || '').trim(),
    remark: String(input.remark || '').trim(),
    membershipLabel: MEMBERSHIP_LABELS[membershipType],
    ...profile,
    status,
    updatedAt: now(),
    createdBy: old && old.createdBy ? old.createdBy : wxContext.OPENID,
    updatedBy: wxContext.OPENID
  }
  let savedId = old && old._id

  if (old) {
    await db.collection(COLLECTIONS.phoneEntitlements).doc(old._id).update({ data: payload })
  } else {
    const addRes = await db.collection(COLLECTIONS.phoneEntitlements).add({
      data: { ...payload, createdAt: now() }
    })
    savedId = addRes._id
  }

  const saved = { _id: savedId, ...payload }
  await syncPhoneEntitlementUsers(phone, saved)
  await writeAuditLog('adminSavePhoneEntitlement', admin.profile, {
    targetType: 'phoneEntitlement',
    targetId: savedId,
    targetPhone: phone,
    payloadSummary: {
      name: payload.name,
      className: payload.className,
      membershipType,
      membershipStatus: profile.membershipStatus,
      membershipEndAt: profile.membershipEndAt,
      status,
      remark: payload.remark
    }
  })

  return success({ id: savedId, entitlement: normalizePhoneEntitlementRecord(saved) })
}

async function getManagedPhoneEntitlement(input = {}) {
  const id = String(input.id || '').trim()
  if (id) return safeGetById(COLLECTIONS.phoneEntitlements, id)
  const phone = normalizePhone(input.phone)
  return phone ? safeGetOne(COLLECTIONS.phoneEntitlements, { phone }) : null
}

async function updatePhoneEntitlementStatus(event, wxContext, nextStatus, action) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  const target = await getManagedPhoneEntitlement(input)
  if (!target) return fail('entitlement_not_found', '手机号身份记录不存在，请先保存为新档案。')

  const membershipStatus = nextStatus === 'active'
    ? getEntitlementMembershipStatus({ ...target, status: 'active' })
    : 'inactive'
  const updateData = {
    status: nextStatus,
    membershipStatus,
    updatedAt: now(),
    updatedBy: wxContext.OPENID
  }
  if (nextStatus === 'disabled') {
    updateData.disabledAt = now()
    updateData.disabledBy = wxContext.OPENID
  }
  if (nextStatus === 'deleted') {
    updateData.deletedAt = now()
    updateData.deletedBy = wxContext.OPENID
  }
  if (nextStatus === 'active') {
    updateData.enabledAt = now()
    updateData.enabledBy = wxContext.OPENID
  }

  await db.collection(COLLECTIONS.phoneEntitlements).doc(target._id).update({ data: updateData })
  const next = normalizePhoneEntitlementRecord({ ...target, ...updateData })
  await syncPhoneEntitlementUsers(target.phone, next)
  await writeAuditLog(action, admin.profile, {
    targetType: 'phoneEntitlement',
    targetId: target._id,
    targetPhone: target.phone,
    payloadSummary: { status: nextStatus, membershipStatus }
  })
  return success({ id: target._id, entitlement: next })
}

async function adminDisablePhoneEntitlement(event, wxContext) {
  return updatePhoneEntitlementStatus(event, wxContext, 'disabled', 'adminDisablePhoneEntitlement')
}

async function adminEnablePhoneEntitlement(event, wxContext) {
  return updatePhoneEntitlementStatus(event, wxContext, 'active', 'adminEnablePhoneEntitlement')
}

async function adminDeletePhoneEntitlement(event, wxContext) {
  return updatePhoneEntitlementStatus(event, wxContext, 'deleted', 'adminDeletePhoneEntitlement')
}

async function adminListData(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const limit = Math.min(Number(event.limit || 50), 100)
  const [students, entitlements, leads, orders, phoneEntitlements] = await Promise.all([
    db.collection(COLLECTIONS.students).orderBy('createdAt', 'desc').limit(limit).get(),
    db.collection(COLLECTIONS.entitlements).orderBy('createdAt', 'desc').limit(limit).get(),
    db.collection(COLLECTIONS.leads).orderBy('createdAt', 'desc').limit(limit).get(),
    db.collection(COLLECTIONS.orders).orderBy('createdAt', 'desc').limit(limit).get(),
    listPhoneEntitlements(limit)
  ])

  return success({
    students: students.data || [],
    entitlements: entitlements.data || [],
    phoneEntitlements: phoneEntitlements.data || [],
    leads: leads.data || [],
    orders: orders.data || [],
    profile: admin.profile
  })
}

async function adminDisableEntitlement(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const id = event.id || ''
  if (!id) return fail('missing_id', '缺少权限记录 ID。')

  await db.collection(COLLECTIONS.entitlements).doc(id).update({
    data: {
      status: 'inactive',
      membershipStatus: 'inactive',
      disabledAt: now(),
      disabledBy: wxContext.OPENID
    }
  })

  await writeAuditLog('adminDisableEntitlement', admin.profile, {
    targetType: 'entitlement',
    targetId: id,
    payloadSummary: {
      status: 'inactive'
    }
  })

  return success({
    id,
    disabled: true
  })
}

async function submitWorkRecord(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const access = await getCurrentAccess(openid)
  if (!access.phoneBound) {
    return fail('phone_required', '提交训练作品需要先绑定手机号。')
  }
  const currentUser = await safeGetOne(COLLECTIONS.users, { openid })
  const work = event.work || {}
  const media = normalizePublicWorkMedia(work)
  const publishedAt = work.isPublic === true ? (work.publishedAt || work.publicAt || now()) : ''
  const moduleId = String(work.moduleId || work.category || work.moduleType || work.trainingType || '').trim()
  const contentId = String(work.contentId || work.taskId || '').trim()
  const sourceType = work.sourceType || 'main'
  const isExtraWork = sourceType === 'extra'
  const payload = {
    ...work,
    openid,
    ownerOpenid: openid,
    authorOpenid: openid,
    authorUserId: currentUser && (currentUser._id || currentUser.id) || '',
    authorPhone: currentUser && currentUser.phone || '',
    sourceType,
    moduleId,
    category: work.category || moduleId,
    moduleType: work.moduleType || moduleId,
    trainingType: work.trainingType || moduleId,
    moduleTitle: work.moduleTitle || '',
    day: Number(work.day || 0),
    contentId,
    taskId: work.taskId || contentId,
    title: work.title || work.taskTitle || work.contentTitle || '',
    taskTitle: work.taskTitle || '',
    contentTitle: work.contentTitle || work.taskTitle || '',
    trainingTitleSnapshot: work.trainingTitleSnapshot || '',
    trainingContentSnapshot: work.trainingContentSnapshot || '',
    trainingCategorySnapshot: work.trainingCategorySnapshot || '',
    trainingDaySnapshot: Number(work.trainingDaySnapshot || 0),
    content: isExtraWork ? (work.content || '') : '',
    promptText: isExtraWork ? (work.promptText || work.content || '') : '',
    materialSummary: work.materialSummary || work.contentTitle || work.taskTitle || work.title || '',
    materialText: isExtraWork ? (work.materialText || work.content || work.promptText || '') : '',
    workType: media.workType,
    mediaType: media.workType,
    submitType: work.submitType || work.mediaType || media.workType,
    type: media.workType,
    fileID: media.fileID,
    filePath: media.mediaUrl || '',
    audioFileID: media.audioFileID,
    audioUrl: media.audioUrl,
    videoFileID: media.videoFileID,
    videoUrl: media.videoUrl,
    coverFileID: work.coverFileID || work.coverFileId || '',
    coverUrl: work.coverUrl || '',
    localFilePath: work.localFilePath || '',
    duration: work.duration || '',
    durationSeconds: Number(work.durationSeconds || 0),
    isPublic: work.isPublic === true,
    publicStatus: work.isPublic === true ? 'published' : (work.publicStatus || 'unpublished'),
    squareStatus: work.isPublic === true ? 'active' : (work.squareStatus || 'unpublished'),
    publicAt: publishedAt,
    publishedAt,
    unpublishedAt: work.unpublishedAt || '',
    publicNickname: work.publicNickname || work.studentName || '同学',
    publicAvatarText: work.publicAvatarText || getAvatarText(work.publicNickname || work.studentName || '同学'),
    // 新作品从 0 开始计数，旧作品由读取层兼容缺失字段。
    likeCount: Math.max(Number(work.likeCount || 0) || 0, 0),
    commentCount: Math.max(Number(work.commentCount || 0) || 0, 0),
    createdAt: work.createdAt || now(),
    submittedAt: now(),
    updatedAt: now()
  }

  const addRes = await db.collection(COLLECTIONS.submissions).add({
    data: payload
  })

  // 当前版本广场与我的作品共用 submissions，自关联字段为后续拆分广场集合预留稳定关系。
  const relationPatch = {
    squareWorkId: addRes._id,
    sourceWorkId: addRes._id,
    submissionId: addRes._id,
    updatedAt: now()
  }
  await db.collection(COLLECTIONS.submissions).doc(addRes._id).update({ data: relationPatch })

  return success({
    id: addRes._id,
    submission: {
      _id: addRes._id,
      ...payload,
      ...relationPatch
    }
  })
}

async function getMyWorks(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const access = await getCurrentAccess(openid)
  if (!access.phoneBound) {
    return fail('phone_required', '查看训练记录需要先绑定手机号。')
  }
  const limit = Math.min(Number(event.limit || 50), 100)

  const res = await db.collection(COLLECTIONS.submissions)
    .where({ ownerOpenid: openid })
    .orderBy('submittedAt', 'desc')
    .limit(limit)
    .get()

  return success({
    works: (res.data || []).filter(item => item.status !== 'deleted')
  })
}

function getSquareWorkId(value) {
  return String(value || '').trim()
}

async function getPublicSquareWork(workId) {
  const id = getSquareWorkId(workId)
  if (!id) return null
  const work = await safeGetById(COLLECTIONS.submissions, id)
  return work &&
    work.isPublic === true &&
    work.status !== 'deleted' &&
    !['deleted', 'unpublished'].includes(work.publicStatus)
    ? work
    : null
}

async function countSquareRecords(collectionName, workId) {
  const result = await db.collection(collectionName).where({
    workId,
    status: 'active'
  }).count()
  return Math.max(Number(result.total || 0), 0)
}

async function updateSquareWorkCount(workId, field, count) {
  await db.collection(COLLECTIONS.submissions).doc(workId).update({
    data: {
      [field]: Math.max(Number(count || 0), 0),
      updatedAt: now()
    }
  })
}

function buildSquareLikeDocumentId(workId, openid) {
  const digest = crypto.createHash('sha256').update(`${workId}:${openid}`, 'utf8').digest('hex')
  return `sl_${digest.slice(0, 28)}`
}

async function getSquareInteractionUser(openid) {
  if (!openid) return { ok: false, code: 'LOGIN_REQUIRED', message: '请先登录并绑定手机号。' }
  const access = await getCurrentAccess(openid)
  const user = await safeGetOne(COLLECTIONS.users, { openid })
  const phone = normalizePhone(user && user.phone)
  if (!access.phoneBound || !user || user.phoneBound !== true || !phone) {
    return { ok: false, code: 'PHONE_REQUIRED', message: '请先登录并绑定手机号。' }
  }
  return {
    ok: true,
    user,
    phone,
    nickname: String(user.nickname || user.nickName || '同学').trim() || '同学',
    avatarUrl: String(user.avatarUrl || user.avatarURL || '').trim()
  }
}

async function getCurrentWorkViewer(openid) {
  const currentUser = openid ? await safeGetOne(COLLECTIONS.users, { openid }) : null
  return {
    openid,
    userId: currentUser && (currentUser._id || currentUser.id) || '',
    phone: currentUser && currentUser.phone || ''
  }
}

function getSourceWorkId(work = {}, fallbackId = '') {
  return String(work.sourceWorkId || work.submissionId || work.originalWorkId || fallbackId || '')
}

async function findLinkedSquareWorks(workId, work = {}) {
  const records = new Map()
  const directIds = [work.squareWorkId, work._id, work.id]
    .map(value => String(value || ''))
    .filter(Boolean)
  for (const id of directIds) {
    const item = await safeGetById(COLLECTIONS.submissions, id)
    if (item) records.set(item._id, item)
  }

  // 只按明确关系字段查找，绝不使用标题、昵称或时间做模糊关联。
  for (const field of ['sourceWorkId', 'submissionId', 'originalWorkId']) {
    try {
      const result = await db.collection(COLLECTIONS.submissions)
        .where({ [field]: workId })
        .limit(20)
        .get()
      ;(result.data || []).forEach(item => records.set(item._id, item))
    } catch (error) {
      console.warn('[square-link] linked work query failed', { field, errMsg: error.message || String(error) })
    }
  }
  return Array.from(records.values())
}

async function getSquareLikeStatusMap(workIds, openid) {
  const ids = Array.from(new Set((Array.isArray(workIds) ? workIds : [])
    .map(getSquareWorkId)
    .filter(Boolean)))
    .slice(0, 100)
  const statusMap = ids.reduce((result, id) => {
    result[id] = false
    return result
  }, {})
  if (!openid || !ids.length) return statusMap

  // CloudBase in 查询单次数量有限，分批读取当前用户的有效点赞。
  for (let index = 0; index < ids.length; index += 10) {
    const chunk = ids.slice(index, index + 10)
    const result = await db.collection(COLLECTIONS.squareLikes).where({
      workId: _.in(chunk),
      userOpenid: openid,
      status: 'active'
    }).limit(100).get()
    ;(result.data || []).forEach(item => {
      if (statusMap[item.workId] !== undefined) statusMap[item.workId] = true
    })
  }
  return statusMap
}

async function toggleSquareLike(event, wxContext) {
  const workId = getSquareWorkId(event.workId)
  if (!workId) return fail('WORK_ID_REQUIRED', '缺少作品 ID。')
  const work = await getPublicSquareWork(workId)
  if (!work) return fail('SQUARE_WORK_NOT_FOUND', '作品不存在或已取消公开。')

  const identity = await getSquareInteractionUser(wxContext.OPENID || '')
  if (!identity.ok) return fail(identity.code, identity.message)

  // 确定性文档 ID 从存储层保证每个用户对每个作品最多只有一条点赞记录。
  const likeId = buildSquareLikeDocumentId(workId, wxContext.OPENID)
  const old = await safeGetById(COLLECTIONS.squareLikes, likeId)
  const liked = !old || old.status !== 'active'
  const timestamp = now()
  await db.collection(COLLECTIONS.squareLikes).doc(likeId).set({
    data: {
      workId,
      userOpenid: wxContext.OPENID,
      userId: identity.user._id || '',
      phone: identity.phone,
      nickname: identity.nickname,
      status: liked ? 'active' : 'canceled',
      createdAt: old && old.createdAt || timestamp,
      updatedAt: timestamp
    }
  })

  const likeCount = await countSquareRecords(COLLECTIONS.squareLikes, workId)
  await updateSquareWorkCount(workId, 'likeCount', likeCount)
  return success({ liked, likeCount })
}

async function getSquareLikeStatusBatch(event, wxContext) {
  const data = await getSquareLikeStatusMap(event.workIds, wxContext.OPENID || '')
  return success({ data })
}

function sanitizeSquareComment(comment = {}, currentOpenid = '') {
  const nickname = String(comment.nickname || '同学').trim() || '同学'
  return {
    _id: comment._id || '',
    id: comment._id || comment.id || '',
    workId: comment.workId || '',
    nickname,
    avatarUrl: comment.avatarUrl || '',
    avatarText: getAvatarText(nickname),
    content: comment.content || '',
    createdAt: comment.createdAt || '',
    updatedAt: comment.updatedAt || '',
    isMine: Boolean(currentOpenid && comment.userOpenid === currentOpenid)
  }
}

async function listSquareComments(event, wxContext) {
  const workId = getSquareWorkId(event.workId)
  if (!workId) return fail('WORK_ID_REQUIRED', '缺少作品 ID。')
  // 只允许读取仍处于公开状态的作品评论。
  const work = await getPublicSquareWork(workId)
  if (!work) return fail('SQUARE_WORK_NOT_FOUND', '作品不存在或已取消公开。')
  const page = Math.max(Number(event.page || 1), 1)
  const pageSize = Math.min(Math.max(Number(event.pageSize || 50), 1), 50)
  const skip = (page - 1) * pageSize
  const where = { workId, status: 'active' }
  const [countResult, listResult] = await Promise.all([
    db.collection(COLLECTIONS.squareComments).where(where).count(),
    db.collection(COLLECTIONS.squareComments).where(where)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get()
  ])
  return success({
    data: (listResult.data || []).map(item => sanitizeSquareComment(item, wxContext.OPENID || '')),
    total: Math.max(Number(countResult.total || 0), 0),
    page,
    pageSize
  })
}

async function getActiveForbiddenWords() {
  const list = []
  const pageSize = 100
  for (let page = 0; page < 10; page += 1) {
    const result = await db.collection(COLLECTIONS.commentForbiddenWords)
      .where({ status: 'active' })
      .skip(page * pageSize)
      .limit(pageSize)
      .get()
    const items = result.data || []
    list.push(...items)
    if (items.length < pageSize) break
  }
  return list
}

async function checkForbiddenWords(content) {
  const rules = await getActiveForbiddenWords()
  const matched = findForbiddenMatch(content, rules)
  if (!matched) return { blocked: false }
  return {
    blocked: true,
    ruleId: matched._id || '',
    category: matched.category || 'other',
    action: matched.action || 'block'
  }
}

async function addSquareComment(event, wxContext) {
  const workId = getSquareWorkId(event.workId)
  const validation = validateCommentContent(event.content)
  const content = validation.content
  if (!workId) return fail('WORK_ID_REQUIRED', '缺少作品 ID。')
  if (!validation.valid) return fail(validation.code, validation.message)
  const work = await getPublicSquareWork(workId)
  if (!work) return fail('SQUARE_WORK_NOT_FOUND', '作品不存在或已取消公开。')

  const identity = await getSquareInteractionUser(wxContext.OPENID || '')
  if (!identity.ok) return fail(identity.code, identity.message)
  const forbiddenResult = await checkForbiddenWords(content)
  if (forbiddenResult.blocked) {
    console.warn('[square-comment] forbidden content blocked', {
      ruleId: forbiddenResult.ruleId,
      category: forbiddenResult.category,
      action: forbiddenResult.action
    })
    return fail(
      'COMMENT_FORBIDDEN_WORD',
      '评论包含不适合公开展示的内容，请修改后再发布。'
    )
  }

  const timestamp = now()
  const payload = {
    workId,
    userOpenid: wxContext.OPENID,
    userId: identity.user._id || '',
    phone: identity.phone,
    nickname: identity.nickname,
    avatarUrl: identity.avatarUrl,
    content,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const addResult = await db.collection(COLLECTIONS.squareComments).add({ data: payload })
  const commentCount = await countSquareRecords(COLLECTIONS.squareComments, workId)
  await updateSquareWorkCount(workId, 'commentCount', commentCount)
  return success({
    comment: sanitizeSquareComment({ _id: addResult._id, ...payload }, wxContext.OPENID),
    commentCount
  })
}

async function deleteSquareComment(event, wxContext) {
  const commentId = String(event.commentId || '').trim()
  const openid = wxContext.OPENID || ''
  if (!commentId) return fail('COMMENT_ID_REQUIRED', '缺少评论 ID。')
  if (!openid) return fail('LOGIN_REQUIRED', '请先登录。')
  const comment = await safeGetById(COLLECTIONS.squareComments, commentId)
  if (!comment || comment.status !== 'active') return fail('COMMENT_NOT_FOUND', '评论不存在或已删除。')

  const isOwner = comment.userOpenid === openid
  let admin = null
  if (!isOwner) {
    admin = await requireAdmin(openid, ['super_admin', 'admin'])
    if (!admin.ok) return fail('COMMENT_DELETE_FORBIDDEN', '只能删除自己的评论。')
  }
  await db.collection(COLLECTIONS.squareComments).doc(commentId).update({
    data: {
      status: 'deleted',
      deletedAt: now(),
      deletedBy: openid,
      updatedAt: now()
    }
  })
  const commentCount = await countSquareRecords(COLLECTIONS.squareComments, comment.workId)
  await updateSquareWorkCount(comment.workId, 'commentCount', commentCount)
  return success({ commentCount })
}

function sanitizeForbiddenWord(item = {}) {
  return {
    _id: item._id || '',
    id: item._id || item.id || '',
    word: item.word || '',
    normalizedWord: item.normalizedWord || '',
    category: item.category || 'other',
    level: item.level || 'medium',
    action: item.action || 'block',
    status: item.status || 'active',
    remark: item.remark || '',
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || ''
  }
}

async function adminListForbiddenWords(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)
  const { page, pageSize, skip } = getAdminWebPagination(event)
  const condition = buildAdminWebCondition(
    event,
    ['category', 'status'],
    ['word', 'normalizedWord', 'remark']
  )
  const hasCondition = Object.keys(condition || {}).length > 0
  const createQuery = () => {
    const base = hasCondition
      ? db.collection(COLLECTIONS.commentForbiddenWords).where(condition)
      : db.collection(COLLECTIONS.commentForbiddenWords)
    return base.orderBy('updatedAt', 'desc')
  }
  const countQuery = hasCondition
    ? db.collection(COLLECTIONS.commentForbiddenWords).where(condition)
    : db.collection(COLLECTIONS.commentForbiddenWords)
  const [countResult, listResult] = await Promise.all([
    countQuery.count(),
    createQuery().skip(skip).limit(pageSize).get()
  ])
  return success({
    data: (listResult.data || []).map(sanitizeForbiddenWord),
    total: Number(countResult.total || 0),
    page,
    pageSize
  })
}

async function adminUpsertForbiddenWord(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)
  const input = event.data && typeof event.data === 'object' ? event.data : event
  const id = String(input.id || input._id || '').trim()
  const old = id ? await safeGetById(COLLECTIONS.commentForbiddenWords, id) : null
  if (id && !old) return fail('FORBIDDEN_WORD_NOT_FOUND', '违禁词不存在。')
  const word = String(input.word == null ? old && old.word || '' : input.word).trim()
  const normalizedWord = normalizeText(word)
  if (!word || !normalizedWord) return fail('FORBIDDEN_WORD_REQUIRED', '违禁词不能为空。')

  const category = String(input.category || old && old.category || 'other')
  const level = String(input.level || old && old.level || 'medium')
  const action = String(input.action || old && old.action || 'block')
  const status = String(input.status || old && old.status || 'active')
  if (!['politics', 'vulgar', 'contact', 'ad', 'abuse', 'other'].includes(category)) {
    return fail('FORBIDDEN_WORD_CATEGORY_INVALID', '违禁词分类不正确。')
  }
  if (!['low', 'medium', 'high'].includes(level)) return fail('FORBIDDEN_WORD_LEVEL_INVALID', '风险等级不正确。')
  if (!['block', 'review'].includes(action)) return fail('FORBIDDEN_WORD_ACTION_INVALID', '处理方式不正确。')
  if (!['active', 'disabled', 'deleted'].includes(status)) return fail('FORBIDDEN_WORD_STATUS_INVALID', '状态不正确。')

  const duplicated = await safeGetOne(COLLECTIONS.commentForbiddenWords, { normalizedWord })
  if (duplicated && duplicated._id !== id && duplicated.status !== 'deleted') {
    return fail('FORBIDDEN_WORD_DUPLICATED', '归一化后相同的违禁词已存在。')
  }
  const timestamp = now()
  const payload = {
    word,
    normalizedWord,
    category,
    level,
    action,
    status,
    remark: String(input.remark == null ? old && old.remark || '' : input.remark).trim(),
    updatedBy: wxContext.OPENID,
    updatedAt: timestamp
  }
  let savedId = id
  if (old) {
    await db.collection(COLLECTIONS.commentForbiddenWords).doc(id).update({ data: payload })
  } else {
    const result = await db.collection(COLLECTIONS.commentForbiddenWords).add({
      data: {
        ...payload,
        createdBy: wxContext.OPENID,
        createdAt: timestamp
      }
    })
    savedId = result._id
  }
  await writeAuditLog('adminUpsertForbiddenWord', admin.profile, {
    targetType: 'commentForbiddenWord',
    targetId: savedId,
    payloadSummary: { category, level, action, status, remark: payload.remark }
  })
  return success({ data: sanitizeForbiddenWord(await safeGetById(COLLECTIONS.commentForbiddenWords, savedId)) })
}

async function adminUpdateForbiddenWordStatus(event, wxContext, status) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)
  const id = String(event.id || '').trim()
  if (!id) return fail('FORBIDDEN_WORD_ID_REQUIRED', '缺少违禁词 ID。')
  const old = await safeGetById(COLLECTIONS.commentForbiddenWords, id)
  if (!old) return fail('FORBIDDEN_WORD_NOT_FOUND', '违禁词不存在。')
  await db.collection(COLLECTIONS.commentForbiddenWords).doc(id).update({
    data: { status, updatedBy: wxContext.OPENID, updatedAt: now() }
  })
  const auditAction = {
    active: 'adminEnableForbiddenWord',
    disabled: 'adminDisableForbiddenWord',
    deleted: 'adminDeleteForbiddenWord'
  }[status] || 'adminUpdateForbiddenWordStatus'
  await writeAuditLog(auditAction, admin.profile, {
    targetType: 'commentForbiddenWord',
    targetId: id,
    payloadSummary: { status }
  })
  return success({ data: sanitizeForbiddenWord(await safeGetById(COLLECTIONS.commentForbiddenWords, id)) })
}

function adminEnableForbiddenWord(event, wxContext) {
  return adminUpdateForbiddenWordStatus(event, wxContext, 'active')
}

function adminDisableForbiddenWord(event, wxContext) {
  return adminUpdateForbiddenWordStatus(event, wxContext, 'disabled')
}

function adminDeleteForbiddenWord(event, wxContext) {
  return adminUpdateForbiddenWordStatus(event, wxContext, 'deleted')
}

async function adminInitForbiddenWords(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)
  let created = 0
  let skipped = 0
  for (const seed of DEFAULT_FORBIDDEN_WORDS) {
    const normalizedWord = normalizeText(seed.word)
    const old = await safeGetOne(COLLECTIONS.commentForbiddenWords, { normalizedWord })
    if (old) {
      skipped += 1
      continue
    }
    await db.collection(COLLECTIONS.commentForbiddenWords).add({
      data: {
        ...seed,
        normalizedWord,
        status: 'active',
        remark: '系统建议初始词，可由管理员调整',
        createdBy: wxContext.OPENID,
        updatedBy: wxContext.OPENID,
        createdAt: now(),
        updatedAt: now()
      }
    })
    created += 1
  }
  await writeAuditLog('adminInitForbiddenWords', admin.profile, {
    targetType: 'commentForbiddenWord',
    targetId: 'default-rules',
    payloadSummary: { created, skipped }
  })
  return success({ created, skipped, total: DEFAULT_FORBIDDEN_WORDS.length })
}

async function getSquareWorks(event, wxContext) {
  const limit = Math.min(Number(event.limit || 50), 100)
  const filter = event.filter || 'all'
  const where = { isPublic: true }

  if (['reading', 'retell', 'topic', 'mandarin'].includes(filter)) {
    where.moduleId = filter
  }

  console.log('[cloudApi] getSquareWorks query:', {
    where,
    limit,
    orderBy: 'publicAt desc'
  })

  const res = await db.collection(COLLECTIONS.submissions)
    .where(where)
    .orderBy('publicAt', 'desc')
    .limit(limit)
    .get()

  const currentOpenid = wxContext.OPENID || ''
  const currentUser = currentOpenid ? await safeGetOne(COLLECTIONS.users, { openid: currentOpenid }) : null
  const viewer = {
    openid: currentOpenid,
    userId: currentUser && (currentUser._id || currentUser.id) || '',
    phone: currentUser && currentUser.phone || ''
  }
  let works = (res.data || [])
    .filter(item => item.status !== 'deleted' && !['deleted', 'unpublished'].includes(item.publicStatus))
    .map(item => sanitizePublicWork(item, viewer))
  if (filter === 'audio' || filter === 'video') {
    works = works.filter(item => item.workType === filter)
  }
  if (filter === 'randomTopic' || filter === 'tongueTwister') {
    works = works.filter(item => item.extraType === filter)
  }

  try {
    const likeStatusMap = await getSquareLikeStatusMap(
      works.map(item => item._id),
      wxContext.OPENID || ''
    )
    works = works.map(item => ({
      ...item,
      likedByMe: Boolean(likeStatusMap[item._id])
    }))
  } catch (error) {
    // 新集合尚未创建时广场仍可正常浏览，互动状态默认未点赞。
    console.warn('[cloudApi] squareLikes unavailable:', error.message || error)
  }

  return success({
    // 广场只返回公开展示字段，不暴露 openid、转写文本或 AI 分析等数据。
    works
  })
}

async function deleteMySquareWork(event, wxContext) {
  const openid = String(wxContext.OPENID || '')
  const workId = getSquareWorkId(event.workId)
  if (!openid) return fail('LOGIN_REQUIRED', '请先登录。')
  if (!workId) return fail('WORK_ID_REQUIRED', '缺少作品 ID。')

  const work = await safeGetById(COLLECTIONS.submissions, workId)
  if (!work) return fail('WORK_NOT_FOUND', '作品不存在。')

  const [viewer, adminProfile] = await Promise.all([
    getCurrentWorkViewer(openid),
    getAdminProfileByOpenid(openid)
  ])
  const isOwner = isSquareWorkOwner(work, viewer)
  if (!isOwner && !adminProfile.isAdmin) {
    return fail('FORBIDDEN', '只能删除自己发布的作品。')
  }

  const timestamp = now()
  const sourceWorkId = getSourceWorkId(work, workId)
  const isSeparateSquareRecord = sourceWorkId && sourceWorkId !== workId
  await db.collection(COLLECTIONS.submissions).doc(workId).update({
    data: {
      status: isSeparateSquareRecord ? 'deleted' : 'active',
      squareStatus: 'deleted',
      isPublic: false,
      publicStatus: 'deleted',
      deletedAt: timestamp,
      unpublicAt: timestamp,
      unpublishedAt: timestamp,
      updatedAt: timestamp
    }
  })

  if (isSeparateSquareRecord) {
    const sourceWork = await safeGetById(COLLECTIONS.submissions, sourceWorkId)
    if (sourceWork && (isSquareWorkOwner(sourceWork, viewer) || adminProfile.isAdmin)) {
      await db.collection(COLLECTIONS.submissions).doc(sourceWorkId).update({
        data: {
          isPublic: false,
          publicStatus: 'deleted',
          squareStatus: 'deleted',
          squareWorkId: workId,
          unpublishedAt: timestamp,
          unpublicAt: timestamp,
          updatedAt: timestamp
        }
      })
    } else {
      console.warn('[square-link] source work not found or ownership mismatch', {
        workId,
        sourceWorkIdExists: Boolean(sourceWorkId)
      })
    }
  }

  if (adminProfile.isAdmin && !isOwner) {
    await writeAuditLog('deleteMySquareWork', adminProfile, {
      targetType: 'submission',
      targetId: workId,
      targetOpenid: work.ownerOpenid || work.userOpenid || work.openid || work.authorOpenid || '',
      payloadSummary: { status: 'deleted' }
    })
  }
  return success({
    id: workId,
    workId,
    sourceWorkId,
    publicStatus: 'deleted',
    deleted: true
  })
}

async function deleteMyWork(event, wxContext) {
  const openid = String(wxContext.OPENID || '')
  const workId = getSquareWorkId(event.workId)
  if (!openid) return fail('LOGIN_REQUIRED', '请先登录。')
  if (!workId) return fail('WORK_ID_REQUIRED', '缺少作品 ID。')
  const work = await safeGetById(COLLECTIONS.submissions, workId)
  if (!work) return fail('WORK_NOT_FOUND', '作品不存在。')
  const viewer = await getCurrentWorkViewer(openid)
  if (!isSquareWorkOwner(work, viewer)) return fail('FORBIDDEN', '只能删除自己的作品。')

  const timestamp = now()
  const wasPublic = work.isPublic === true || work.publicStatus === 'published'
  await db.collection(COLLECTIONS.submissions).doc(workId).update({
    data: {
      status: 'deleted',
      squareStatus: 'deleted',
      isPublic: false,
      publicStatus: 'deleted',
      deletedAt: timestamp,
      unpublishedAt: timestamp,
      unpublicAt: timestamp,
      updatedAt: timestamp
    }
  })

  const linkedWorks = await findLinkedSquareWorks(workId, work)
  for (const linked of linkedWorks) {
    if (linked._id === workId || !isSquareWorkOwner(linked, viewer)) continue
    await db.collection(COLLECTIONS.submissions).doc(linked._id).update({
      data: {
        status: 'deleted',
        squareStatus: 'deleted',
        isPublic: false,
        publicStatus: 'deleted',
        deletedAt: timestamp,
        unpublishedAt: timestamp,
        unpublicAt: timestamp,
        updatedAt: timestamp
      }
    })
  }
  return success({ workId, wasPublic, publicStatus: 'deleted' })
}

async function unpublishMyWorkFromSquare(event, wxContext) {
  const openid = String(wxContext.OPENID || '')
  const workId = getSquareWorkId(event.workId)
  if (!openid) return fail('LOGIN_REQUIRED', '请先登录。')
  if (!workId) return fail('WORK_ID_REQUIRED', '缺少作品 ID。')
  const work = await safeGetById(COLLECTIONS.submissions, workId)
  if (!work) return fail('WORK_NOT_FOUND', '作品不存在。')
  const viewer = await getCurrentWorkViewer(openid)
  if (!isSquareWorkOwner(work, viewer)) return fail('FORBIDDEN', '只能下架自己的作品。')

  const timestamp = now()
  const patch = {
    isPublic: false,
    publicStatus: 'unpublished',
    squareStatus: 'unpublished',
    unpublishedAt: timestamp,
    unpublicAt: timestamp,
    updatedAt: timestamp
  }
  await db.collection(COLLECTIONS.submissions).doc(workId).update({ data: patch })
  const linkedWorks = await findLinkedSquareWorks(workId, work)
  for (const linked of linkedWorks) {
    if (linked._id === workId || !isSquareWorkOwner(linked, viewer)) continue
    await db.collection(COLLECTIONS.submissions).doc(linked._id).update({ data: patch })
  }
  return success({
    workId,
    squareWorkId: String(work.squareWorkId || workId),
    publicStatus: 'unpublished'
  })
}

async function getSquareWorkDetail(event, wxContext) {
  const workId = getSquareWorkId(event.squareWorkId || event.workId)
  if (!workId) return fail('WORK_ID_REQUIRED', '缺少作品 ID。')
  let work = await safeGetById(COLLECTIONS.submissions, workId)
  if (work && work.squareWorkId && work.squareWorkId !== work._id) {
    work = await safeGetById(COLLECTIONS.submissions, work.squareWorkId) || work
  }
  if (!work) return fail('WORK_NOT_FOUND', '作品不存在。')

  const viewer = await getCurrentWorkViewer(wxContext.OPENID || '')
  const isOwner = isSquareWorkOwner(work, viewer)
  const available = work.isPublic === true &&
    work.status !== 'deleted' &&
    !['deleted', 'unpublished'].includes(work.publicStatus)
  if (!available && !isOwner) return fail('WORK_NOT_AVAILABLE', '该作品暂不可查看。')

  const data = sanitizePublicWork(work, viewer, { includeTrainingSnapshot: true })
  data.dayNumber = Number(work.day || 0)
  data.squareWorkId = work._id
  data.publicStatus = work.publicStatus || (work.isPublic ? 'published' : 'unpublished')
  data.available = available
  data.visibility = available ? 'public' : 'private'
  data.thumbTempFilePath = /^https?:\/\//i.test(String(work.thumbTempFilePath || ''))
    ? work.thumbTempFilePath
    : ''
  try {
    const statusMap = await getSquareLikeStatusMap([work._id], wxContext.OPENID || '')
    data.likedByMe = Boolean(statusMap[work._id])
  } catch (error) {
    data.likedByMe = false
  }
  return success({ data })
}

async function updateWorkAiFeedback(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const access = await getCurrentAccess(openid)
  if (!access.phoneBound) {
    return fail('phone_required', '生成 AI 点评需要先绑定手机号。')
  }
  const id = event.id || ''
  const patch = event.feedbackPatch || {}

  if (!id) return fail('missing_id', '缺少作品 ID。')

  const work = await safeGetOne(COLLECTIONS.submissions, {
    _id: id,
    ownerOpenid: openid
  })
  if (!work) return fail('not_found', '没有找到作品，或你没有权限更新该作品。')

  const allowedPatch = {
    aiFeedbackStatus: patch.aiFeedbackStatus || '',
    aiFeedback: patch.aiFeedback || null,
    aiFeedbackSource: patch.aiFeedbackSource || '',
    aiFeedbackModel: patch.aiFeedbackModel || '',
    aiFeedbackVersion: patch.aiFeedbackVersion || patch.feedbackVersion || '',
    aiFeedbackMode: patch.aiFeedbackMode || patch.feedbackMode || '',
    feedbackVersion: patch.feedbackVersion || patch.aiFeedbackVersion || '',
    feedbackMode: patch.feedbackMode || patch.aiFeedbackMode || '',
    feedbackType: patch.feedbackType === 'deep' ? 'deep' : 'normal',
    transcript: patch.transcript || '',
    speechText: patch.speechText || patch.transcript || '',
    hasTranscript: Boolean(patch.hasTranscript || patch.transcript || patch.speechText),
    asrStatus: patch.asrStatus || '',
    asrErrorMessage: patch.asrErrorMessage || '',
    asrProvider: patch.asrProvider || '',
    audioAnalysis: patch.audioAnalysis || null,
    speechAnalysis: patch.speechAnalysis || patch.ruleAnalysis || null,
    ruleAnalysis: patch.ruleAnalysis || patch.speechAnalysis || null,
    tokenUsage: patch.tokenUsage || patch.aiFeedbackUsage || null,
    aiFeedbackUsage: patch.aiFeedbackUsage || patch.tokenUsage || null,
    aiFeedbackGeneratedAt: patch.aiFeedbackGeneratedAt || now(),
    aiFeedbackError: Boolean(patch.aiFeedbackError),
    aiFeedbackErrorMessage: patch.aiFeedbackErrorMessage || '',
    updatedAt: now()
  }

  await db.collection(COLLECTIONS.submissions).doc(id).update({ data: allowedPatch })

  return success({ id, updated: true })
}

async function updateWorkPublicStatus(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const id = event.id || ''
  const isPublic = event.isPublic === true
  const asAdmin = event.asAdmin === true
  const mediaPatch = event.mediaPatch && typeof event.mediaPatch === 'object' ? event.mediaPatch : {}

  if (!id) return fail('missing_id', '缺少作品 ID。')

  let admin = null
  if (asAdmin) {
    admin = await requireAdmin(openid, ['super_admin', 'admin'])
    if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })
  } else {
    const access = await getCurrentAccess(openid)
    if (!access.phoneBound) {
      return fail('phone_required', '发布广场需要先绑定手机号。')
    }
  }

  const work = await safeGetById(COLLECTIONS.submissions, id)

  if (!work) {
    return fail('not_found', '没有找到作品，或你没有权限修改该作品。')
  }

  const viewer = await getCurrentWorkViewer(openid)
  if (!asAdmin && !isSquareWorkOwner(work, viewer)) {
    return fail('FORBIDDEN', '只能修改自己的作品。')
  }

  const timestamp = now()
  const nextModuleId = String(mediaPatch.moduleId || mediaPatch.category || mediaPatch.moduleType || mediaPatch.trainingType || work.moduleId || work.category || work.moduleType || work.trainingType || '').trim()
  const nextContentId = String(mediaPatch.contentId || mediaPatch.taskId || work.contentId || work.taskId || '').trim()
  const nextSourceType = mediaPatch.sourceType || work.sourceType || 'main'
  const isExtraWork = nextSourceType === 'extra'
  const updateData = {
    isPublic,
    sourceType: nextSourceType,
    status: isPublic ? 'active' : (work.status || 'active'),
    publicStatus: isPublic ? 'published' : 'unpublished',
    squareStatus: isPublic ? 'active' : 'unpublished',
    squareWorkId: work.squareWorkId || id,
    sourceWorkId: work.sourceWorkId || work.submissionId || id,
    submissionId: work.submissionId || work.sourceWorkId || id,
    authorOpenid: work.authorOpenid || openid,
    authorUserId: work.authorUserId || viewer.userId || '',
    authorPhone: work.authorPhone || viewer.phone || '',
    moduleId: nextModuleId,
    category: mediaPatch.category || work.category || nextModuleId,
    moduleType: mediaPatch.moduleType || work.moduleType || nextModuleId,
    trainingType: mediaPatch.trainingType || work.trainingType || nextModuleId,
    day: Number(mediaPatch.day == null ? (work.day || 0) : mediaPatch.day) || 0,
    contentId: nextContentId,
    taskId: mediaPatch.taskId || work.taskId || nextContentId,
    trainingTitleSnapshot: mediaPatch.trainingTitleSnapshot || work.trainingTitleSnapshot || '',
    trainingContentSnapshot: mediaPatch.trainingContentSnapshot || work.trainingContentSnapshot || '',
    trainingCategorySnapshot: mediaPatch.trainingCategorySnapshot || work.trainingCategorySnapshot || '',
    trainingDaySnapshot: Number(
      mediaPatch.trainingDaySnapshot == null
        ? (work.trainingDaySnapshot || 0)
        : mediaPatch.trainingDaySnapshot
    ),
    content: isExtraWork ? (mediaPatch.content == null ? (work.content || '') : mediaPatch.content) : '',
    promptText: isExtraWork ? (mediaPatch.promptText == null ? (work.promptText || work.content || '') : mediaPatch.promptText) : '',
    materialSummary: mediaPatch.materialSummary || work.materialSummary || mediaPatch.contentTitle || work.contentTitle || work.taskTitle || work.title || '',
    materialText: isExtraWork ? (mediaPatch.materialText || work.materialText || work.content || work.promptText || '') : '',
    publicAt: isPublic ? timestamp : (work.publicAt || ''),
    publishedAt: isPublic ? timestamp : (work.publishedAt || work.publicAt || ''),
    unpublicAt: isPublic ? '' : timestamp,
    unpublishedAt: isPublic ? '' : timestamp,
    deletedAt: isPublic ? '' : (work.deletedAt || ''),
    updatedAt: timestamp
  }

  if (isPublic && Object.keys(mediaPatch).length) {
    const media = normalizePublicWorkMedia({ ...work, ...mediaPatch })
    updateData.workType = media.workType
    updateData.mediaType = media.workType
    updateData.submitType = mediaPatch.submitType || mediaPatch.mediaType || media.workType
    updateData.type = media.workType
    updateData.fileID = media.fileID
    updateData.cloudFileID = media.fileID
    updateData.filePath = media.mediaUrl || ''
    updateData.audioFileID = media.audioFileID
    updateData.audioUrl = media.audioUrl
    updateData.videoFileID = media.videoFileID
    updateData.videoUrl = media.videoUrl
    updateData.coverFileID = String(mediaPatch.coverFileID || mediaPatch.coverFileId || work.coverFileID || '')
    updateData.coverUrl = String(mediaPatch.coverUrl || work.coverUrl || '')
    if (mediaPatch.duration !== undefined) updateData.duration = mediaPatch.duration || ''
    if (mediaPatch.taskTitle !== undefined) updateData.taskTitle = mediaPatch.taskTitle || ''
    if (mediaPatch.contentTitle !== undefined) updateData.contentTitle = mediaPatch.contentTitle || mediaPatch.taskTitle || ''
    if (mediaPatch.title !== undefined) updateData.title = mediaPatch.title || ''
  }

  await db.collection(COLLECTIONS.submissions).doc(id).update({ data: updateData })

  if (asAdmin) {
    await writeAuditLog('updateWorkPublicStatus', admin.profile, {
      targetType: 'submission',
      targetId: id,
      targetOpenid: work.ownerOpenid || work.openid || '',
      payloadSummary: {
        status: isPublic ? 'public' : 'private'
      }
    })
  }

  return success({
    id,
    isPublic
  })
}

async function getCurrentWeeklySchedule(event = {}) {
  const date = today()
  const scheduleType = normalizeScheduleType(event.scheduleType)
  const res = await db.collection(COLLECTIONS.weeklySchedules)
    .where({ status: 'published' })
    .limit(100)
    .get()

  const list = (res.data || [])
    .filter(item => normalizeScheduleType(item.scheduleType) === scheduleType)
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const current = list.find(item => item.startDate <= date && item.endDate >= date)
  const futureLimit = addDays(date, 14)
  const upcoming = list
    .filter(item => item.startDate > date && item.startDate <= futureLimit)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0]
  const target = current || upcoming || null
  const scheduleDisplayType = current ? 'current' : upcoming ? 'upcoming' : 'none'

  if (target) target.scheduleDisplayType = scheduleDisplayType

  return success({
    schedule: sanitizeScheduleForClient(target),
    scheduleDisplayType,
    scheduleType
  })
}

// 朋友圈单页模式使用的匿名公开接口：不读取用户身份，只返回已发布课表的展示字段。
async function getPublicWeeklySchedule(event = {}) {
  const date = today()
  const scheduleType = normalizeScheduleType(event.scheduleType)
  const res = await db.collection(COLLECTIONS.weeklySchedules)
    .where({ status: 'published' })
    .limit(100)
    .get()

  const list = (res.data || [])
    .filter(item => normalizeScheduleType(item.scheduleType) === scheduleType)
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const current = list.find(item => item.startDate <= date && item.endDate >= date)
  const futureLimit = addDays(date, 14)
  const upcoming = list
    .filter(item => item.startDate > date && item.startDate <= futureLimit)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0]
  const target = current || upcoming || null
  const scheduleDisplayType = current ? 'current' : upcoming ? 'upcoming' : 'none'

  if (target) target.scheduleDisplayType = scheduleDisplayType

  console.log('[getPublicWeeklySchedule] result:', {
    scheduleType,
    resultCount: list.length,
    coursesCount: target && Array.isArray(target.courses) ? target.courses.length : 0
  })

  return success({
    schedule: sanitizePublicSchedule(target),
    scheduleDisplayType,
    scheduleType
  })
}

async function handlePublicAction(action, event) {
  console.log('[cloudApi] public action:', action)

  try {
    if (action === 'getPublicWeeklySchedule') {
      return await getPublicWeeklySchedule(event)
    }
    return fail('PUBLIC_ACTION_NOT_FOUND', '公开接口不存在。')
  } catch (error) {
    const code = String(error && (error.code || error.errCode) || 'PUBLIC_ACTION_ERROR')
    const message = String(error && (error.message || error.errMsg) || '公开接口调用失败')
    console.error('[getPublicWeeklySchedule] error:', { code, message })
    return fail('PUBLIC_WEEKLY_SCHEDULE_QUERY_FAILED', '公开课表读取失败，请稍后重试。', {
      debugCode: code,
      debugMessage: message
    })
  }
}

async function adminGetWeeklySchedule(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const id = event.id || ''
  const scheduleType = normalizeScheduleType(event.scheduleType)
  let schedule = null

  if (id) {
    schedule = await safeGetOne(COLLECTIONS.weeklySchedules, { _id: id })
    if (schedule && normalizeScheduleType(schedule.scheduleType) !== scheduleType) schedule = null
  } else {
    const res = await db.collection(COLLECTIONS.weeklySchedules)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get()
    schedule = (res.data || []).find(item => normalizeScheduleType(item.scheduleType) === scheduleType) || null
  }

  return success({
    schedule: sanitizeScheduleForClient(schedule),
    scheduleType,
    profile: admin.profile
  })
}

async function adminListWeeklySchedules(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const limit = Math.min(Number(event.limit || 20), 50)
  const scheduleType = normalizeScheduleType(event.scheduleType)
  const res = await db.collection(COLLECTIONS.weeklySchedules)
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get()

  return success({
    schedules: (res.data || [])
      .filter(item => normalizeScheduleType(item.scheduleType) === scheduleType)
      .slice(0, limit)
      .map(sanitizeScheduleForClient),
    scheduleType,
    profile: admin.profile
  })
}

async function adminSaveWeeklySchedule(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const source = event.schedule || {}
  const payload = sanitizeSchedulePayload(source)
  const id = source._id || event.id || ''

  if (id) {
    const existing = await safeGetOne(COLLECTIONS.weeklySchedules, { _id: id })
    if (!existing) return fail('schedule_not_found', '课表记录不存在。')
    if (normalizeScheduleType(existing.scheduleType) !== payload.scheduleType) {
      return fail('schedule_type_mismatch', '课表类型不一致，不能跨类型修改。')
    }
  }

  if (payload.status === 'published') {
    if (!payload.startDate || !payload.endDate) {
      return fail('missing_week_range', '发布课表需要填写开始日期和结束日期。')
    }
  }

  let scheduleId = id
  let savePayload = {
    ...payload,
    updatedAt: now(),
    updatedBy: wxContext.OPENID
  }

  if (payload.status === 'published') {
    const snapshotMeta = await generateWeeklyScheduleShareSnapshot(savePayload)
    savePayload = {
      ...savePayload,
      shareSnapshotFileID: snapshotMeta.shareSnapshotFileID,
      shareSnapshotUrl: snapshotMeta.shareSnapshotUrl,
      shareSnapshotPath: snapshotMeta.shareSnapshotPath,
      shareSnapshotGeneratedAt: snapshotMeta.shareSnapshotGeneratedAt
    }

    await archiveOtherPublishedSchedules(id, wxContext.OPENID, {
      startDate: payload.startDate,
      endDate: payload.endDate,
      scheduleType: payload.scheduleType
    })
  }

  if (id) {
    await db.collection(COLLECTIONS.weeklySchedules).doc(id).update({
      data: savePayload
    })
  } else {
    const addRes = await db.collection(COLLECTIONS.weeklySchedules).add({
      data: {
        ...savePayload,
        createdAt: now(),
        createdBy: wxContext.OPENID
      }
    })
    scheduleId = addRes._id
  }

  const saved = await safeGetOne(COLLECTIONS.weeklySchedules, { _id: scheduleId })

  await writeAuditLog('adminSaveWeeklySchedule', admin.profile, {
    targetType: 'weeklySchedule',
    targetId: scheduleId,
    payloadSummary: {
      status: payload.status,
      scheduleType: payload.scheduleType,
      className: payload.weekLabel,
      remark: payload.title
    }
  })

  return success({
    id: scheduleId,
    schedule: sanitizeScheduleForClient(saved),
    shareSnapshotFileID: saved && saved.shareSnapshotFileID || '',
    shareSnapshotUrl: saved && saved.shareSnapshotUrl || '',
    shareSnapshotPath: saved && saved.shareSnapshotPath || '',
    shareSnapshotGeneratedAt: saved && saved.shareSnapshotGeneratedAt || '',
    profile: admin.profile
  })
}

async function adminArchiveWeeklySchedule(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const id = event.id || ''
  const scheduleType = normalizeScheduleType(event.scheduleType)
  if (!id) return fail('missing_schedule_id', '缺少课表 ID。')

  const target = await safeGetOne(COLLECTIONS.weeklySchedules, { _id: id })
  if (!target) return fail('schedule_not_found', '课表记录不存在。')
  if (normalizeScheduleType(target.scheduleType) !== scheduleType) {
    return fail('schedule_type_mismatch', '课表类型不一致，不能跨类型归档。')
  }

  await db.collection(COLLECTIONS.weeklySchedules).doc(id).update({
    data: {
      status: 'archived',
      archivedAt: now(),
      archivedBy: wxContext.OPENID,
      updatedAt: now()
    }
  })

  await writeAuditLog('adminArchiveWeeklySchedule', admin.profile, {
    targetType: 'weeklySchedule',
    targetId: id,
    payloadSummary: {
      status: 'archived',
      scheduleType
    }
  })

  return success({
    id,
    archived: true,
    scheduleType,
    profile: admin.profile
  })
}

async function getMonthlyAiUsage(key, month) {
  const res = await db.collection(COLLECTIONS.aiUsage).where({ key }).limit(100).get()
  return (res.data || [])
    .filter(item => String(item.date || '').startsWith(month))
    .reduce((sum, item) => sum + Number(item.count || 0), 0)
}

async function checkAiUsage(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const type = event.type || 'training_feedback'
  const access = await getCurrentAccess(openid, event.phone || '')
  if (!access.phoneBound) {
    return fail('phone_required', '生成 AI 点评需要先绑定手机号。')
  }
  const limit = access.aiDailyLimit
  const monthlyLimit = access.aiMonthlyLimit
  const date = today()
  const month = date.slice(0, 7)
  const key = openid || event.anonymousId || 'anonymous'
  const usage = await safeGetOne(COLLECTIONS.aiUsage, { date, key })
  const used = usage ? Number(usage.count || 0) : 0
  const monthlyUsed = await getMonthlyAiUsage(key, month)
  const dailyAllowed = limit === -1 || used < limit
  const monthlyAllowed = monthlyLimit === -1 || monthlyUsed < monthlyLimit

  return success({
    type,
    date,
    limit,
    used,
    remaining: limit === -1 ? -1 : Math.max(0, limit - used),
    monthlyLimit,
    monthlyUsed,
    monthlyRemaining: monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - monthlyUsed),
    allowed: dailyAllowed && monthlyAllowed,
    reason: !monthlyAllowed ? 'monthly_limit_reached' : (!dailyAllowed ? 'daily_limit_reached' : 'ok'),
    isMember: ['monthly', 'yearly', 'admin'].includes(access.membershipType),
    isUnlimited: limit === -1 || monthlyLimit === -1,
    membershipType: access.membershipType,
    packages: access.packages
  })
}

async function recordAiUsage(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const type = event.type || 'training_feedback'
  const access = await getCurrentAccess(openid, event.phone || '')
  if (!access.phoneBound) {
    return fail('phone_required', '生成 AI 点评需要先绑定手机号。')
  }
  const limit = access.aiDailyLimit
  const monthlyLimit = access.aiMonthlyLimit
  const date = today()
  const key = openid || event.anonymousId || 'anonymous'
  const old = await safeGetOne(COLLECTIONS.aiUsage, { date, key })
  const usageDate = date
  const usageMonth = date.slice(0, 7)
  const usageWeek = getUsageWeek(date)
  const record = {
    type,
    createdAt: now(),
    workId: event.workId || '',
    reportId: event.reportId || '',
    source: event.source || '',
    feedbackType: event.feedbackType || (type === 'expression_report' ? 'deep' : 'normal'),
    model: event.model || '',
    estimatedInputTokens: Number(event.estimatedInputTokens || 0),
    estimatedOutputTokens: Number(event.estimatedOutputTokens || 0),
    tokenUsage: event.tokenUsage || null,
    asrDurationSeconds: Number(event.asrDurationSeconds || 0),
    isMember: access.aiLimit > FREE_DAILY_AI_LIMIT,
    membershipType: access.membershipType || 'free',
    usageDate,
    usageMonth,
    usageWeek
  }
  const monthlyUsed = await getMonthlyAiUsage(key, usageMonth)

  if (monthlyLimit !== -1 && monthlyUsed >= monthlyLimit) {
    return fail('monthly_limit_reached', '本月 AI 次数已用完。', {
      monthlyLimit,
      monthlyUsed,
      monthlyRemaining: 0,
      membershipType: access.membershipType
    })
  }

  if (old) {
    const used = Number(old.count || 0)
    if (limit !== -1 && used >= limit) {
      return fail('daily_limit_reached', '今日 AI 次数已用完。', {
        limit,
        used,
        remaining: 0,
        membershipType: access.membershipType
      })
    }

    await db.collection(COLLECTIONS.aiUsage).doc(old._id).update({
      data: {
        count: _.inc(1),
        records: _.push(record),
        updatedAt: now()
      }
    })

    return success({
      limit,
      used: used + 1,
      remaining: limit === -1 ? -1 : Math.max(0, limit - used - 1),
      monthlyLimit,
      monthlyUsed: monthlyUsed + 1,
      monthlyRemaining: monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - monthlyUsed - 1),
      membershipType: access.membershipType
    })
  }

  await db.collection(COLLECTIONS.aiUsage).add({
    data: {
      date,
      key,
      openid,
      anonymousId: event.anonymousId || '',
      count: 1,
      records: [record],
      createdAt: now(),
      updatedAt: now()
    }
  })

  return success({
    limit,
    used: 1,
    remaining: limit === -1 ? -1 : Math.max(0, limit - 1),
    monthlyLimit,
    monthlyUsed: monthlyUsed + 1,
    monthlyRemaining: monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - monthlyUsed - 1),
    membershipType: access.membershipType
  })
}

// 网页后台只允许通过独立同步 token 调用 adminWeb* action，不复用或绕过小程序 wxContext 管理员身份。
function validateAdminWebToken(event = {}) {
  const expected = String(process.env.DASHBOARD_ADMIN_SYNC_TOKEN || '')
  if (!expected) {
    return fail('DASHBOARD_TOKEN_NOT_CONFIGURED', '后台同步 token 未配置')
  }
  const received = String(event.dashboardToken || '')
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  const matched = expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  if (!matched) {
    return fail('UNAUTHORIZED', '无权限访问后台接口')
  }
  return null
}

function getAdminWebPagination(event = {}) {
  const page = Math.max(Number(event.page || 1), 1)
  const pageSize = Math.min(Math.max(Number(event.pageSize || 100), 1), 500)
  return { page, pageSize, skip: (page - 1) * pageSize }
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildAdminWebCondition(event = {}, filterFields = [], keywordFields = []) {
  const base = {}
  filterFields.forEach(field => {
    const value = String(event[field] || '').trim()
    if (value) base[field] = value
  })

  const keyword = String(event.keyword || '').trim()
  if (!keyword || !keywordFields.length) return base
  const keywordCondition = _.or(keywordFields.map(field => ({
    [field]: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
  })))
  return Object.keys(base).length ? _.and([base, keywordCondition]) : keywordCondition
}

async function adminWebListCollection(collectionName, event = {}, options = {}) {
  const { page, pageSize, skip } = getAdminWebPagination(event)
  const condition = buildAdminWebCondition(event, options.filterFields || [], options.keywordFields || [])
  const hasCondition = Object.keys(condition || {}).length > 0
  const createQuery = () => {
    let query = hasCondition
      ? db.collection(collectionName).where(condition)
      : db.collection(collectionName)
    ;(options.orderBy || []).forEach(([field, direction]) => {
      query = query.orderBy(field, direction)
    })
    return query
  }
  const countQuery = hasCondition
    ? db.collection(collectionName).where(condition)
    : db.collection(collectionName)
  const [countResult, listResult] = await Promise.all([
    countQuery.count(),
    createQuery().skip(skip).limit(pageSize).get()
  ])
  return success({
    data: listResult.data || [],
    total: Number(countResult.total || 0),
    page,
    pageSize
  })
}

async function adminWebListPhoneEntitlements(event) {
  return adminWebListCollection(COLLECTIONS.phoneEntitlements, event, {
    filterFields: ['status', 'membershipType'],
    keywordFields: ['name', 'phone', 'phoneMasked', 'className'],
    orderBy: [['updatedAt', 'desc']]
  })
}

async function adminWebListUsers(event) {
  return adminWebListCollection(COLLECTIONS.users, event, {
    filterFields: ['status', 'membershipType'],
    keywordFields: ['nickname', 'phone', 'phoneMasked'],
    orderBy: [['lastVisitAt', 'desc'], ['updatedAt', 'desc']]
  })
}

async function adminWebListAiUsage(event) {
  return adminWebListCollection(COLLECTIONS.aiUsage, event, {
    filterFields: ['date'],
    keywordFields: ['key', 'openid'],
    orderBy: [['date', 'desc'], ['updatedAt', 'desc']]
  })
}

async function adminWebListSubmissions(event) {
  return adminWebListCollection(COLLECTIONS.submissions, event, {
    filterFields: ['isPublic', 'workType', 'aiFeedbackStatus'],
    keywordFields: ['publicNickname', 'taskTitle', 'moduleTitle'],
    orderBy: [['submittedAt', 'desc'], ['createdAt', 'desc']]
  })
}

async function adminWebListWeeklySchedules(event) {
  return adminWebListCollection(COLLECTIONS.weeklySchedules, event, {
    filterFields: ['status'],
    keywordFields: ['title', 'weekLabel'],
    orderBy: [['updatedAt', 'desc']]
  })
}

function normalizeConfigContent(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (Array.isArray(value)) return { items: value }
  return { text: String(value || '') }
}

function normalizeContentConfigInput(input = {}, old = {}) {
  const section = String(input.section || old.section || 'home').trim()
  const type = String(input.type || old.type || 'text').trim()
  const status = String(input.status || old.status || 'active').trim()
  if (!CONTENT_CONFIG_SECTIONS.includes(section)) throw new Error('内容所属模块不正确')
  if (!CONTENT_CONFIG_TYPES.includes(type)) throw new Error('内容类型不正确')
  if (!CONTENT_STATUSES.includes(status)) throw new Error('内容状态不正确')
  const key = String(input.key || old.key || '').trim()
  const title = String(input.title || old.title || '').trim()
  if (!key || !title) throw new Error('key 和标题不能为空')
  return {
    key,
    title,
    section,
    type,
    content: normalizeConfigContent(input.content === undefined ? old.content : input.content),
    status,
    visible: input.visible === undefined ? old.visible !== false : input.visible === true,
    sortOrder: Number(input.sortOrder == null ? (old.sortOrder || 0) : input.sortOrder) || 0,
    updatedBy: 'dashboard_web',
    updatedAt: now()
  }
}

async function adminWebListContentConfigs(event) {
  return adminWebListCollection(COLLECTIONS.appContentConfigs, event, {
    filterFields: ['section', 'type', 'status'],
    keywordFields: ['key', 'title'],
    orderBy: [['sortOrder', 'asc'], ['updatedAt', 'desc']]
  })
}

async function adminWebUpsertContentConfig(event) {
  const input = event.data || event
  const id = String(input.id || input._id || '').trim()
  const old = id ? await safeGetById(COLLECTIONS.appContentConfigs, id) : null
  if (id && !old) return fail('CONTENT_CONFIG_NOT_FOUND', '内容配置不存在')
  let payload
  try {
    payload = normalizeContentConfigInput(input, old || {})
  } catch (error) {
    return fail('INVALID_CONTENT_CONFIG', error.message)
  }
  const sameKey = await safeGetOne(COLLECTIONS.appContentConfigs, { key: payload.key })
  if (sameKey && sameKey._id !== id && sameKey.status !== 'deleted') {
    return fail('CONTENT_CONFIG_KEY_EXISTS', '内容配置 key 已存在')
  }
  let savedId = id
  if (id) {
    await db.collection(COLLECTIONS.appContentConfigs).doc(id).update({ data: payload })
  } else {
    const result = await db.collection(COLLECTIONS.appContentConfigs).add({
      data: { ...payload, createdAt: now() }
    })
    savedId = result._id
  }
  return success({ data: await safeGetById(COLLECTIONS.appContentConfigs, savedId) })
}

async function updateAdminWebContentConfigStatus(event, status, visible) {
  const input = event.data || event
  const id = String(input.id || input._id || '').trim()
  if (!id) return fail('MISSING_ID', '缺少内容配置 ID')
  const old = await safeGetById(COLLECTIONS.appContentConfigs, id)
  if (!old) return fail('CONTENT_CONFIG_NOT_FOUND', '内容配置不存在')
  await db.collection(COLLECTIONS.appContentConfigs).doc(id).update({
    data: { status, visible, updatedBy: 'dashboard_web', updatedAt: now() }
  })
  return success({ data: await safeGetById(COLLECTIONS.appContentConfigs, id) })
}

function adminWebEnableContentConfig(event) {
  return updateAdminWebContentConfigStatus(event, 'active', true)
}

function adminWebDisableContentConfig(event) {
  return updateAdminWebContentConfigStatus(event, 'disabled', false)
}

function adminWebDeleteContentConfig(event) {
  return updateAdminWebContentConfigStatus(event, 'deleted', false)
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)
}

function normalizeTrainingContentInput(input = {}, old = {}) {
  const trainingType = String(input.trainingType || old.trainingType || 'speaking').trim()
  const membershipLevel = normalizeTrainingConfigMembershipLevel(input.membershipLevel || old.membershipLevel || 'free')
  const status = String(input.status || old.status || 'active').trim()
  if (!TRAINING_TYPES.includes(trainingType)) throw new Error('训练类型不正确')
  if (!TRAINING_CONTENT_MEMBERSHIP_LEVELS.includes(membershipLevel)) throw new Error('会员权限不正确')
  if (!CONTENT_STATUSES.includes(status)) throw new Error('训练状态不正确')
  const dayNumber = Math.max(Number(input.dayNumber == null ? old.dayNumber : input.dayNumber) || 0, 0)
  const title = String(input.title || old.title || '').trim()
  const promptText = String(input.promptText == null ? (old.promptText || '') : input.promptText).trim()
  if (!dayNumber || !title) throw new Error('训练天数和标题不能为空')
  return {
    dayNumber,
    title,
    category: String(input.category || old.category || '当众讲话').trim(),
    trainingType,
    targetAudience: String(input.targetAudience || old.targetAudience || '通用').trim(),
    level: String(input.level || old.level || '基础').trim(),
    promptText,
    guideText: String(input.guideText == null ? (old.guideText || '') : input.guideText).trim(),
    exampleText: String(input.exampleText == null ? (old.exampleText || '') : input.exampleText).trim(),
    requirements: normalizeTextList(input.requirements === undefined ? old.requirements : input.requirements),
    aiReviewFocus: normalizeTextList(input.aiReviewFocus === undefined ? old.aiReviewFocus : input.aiReviewFocus),
    membershipLevel,
    contentStyle: normalizeTrainingContentStyle(input.contentStyle || old.contentStyle),
    contentRichStyle: normalizeTrainingContentRichStyle(input.contentRichStyle || old.contentRichStyle || DEFAULT_TRAINING_CONTENT_RICH_STYLE, promptText.length),
    unlockDay: Math.max(Number(input.unlockDay == null ? (old.unlockDay || dayNumber) : input.unlockDay) || dayNumber, 1),
    status,
    visible: input.visible === undefined ? old.visible !== false : input.visible === true,
    sortOrder: Number(input.sortOrder == null ? (old.sortOrder || dayNumber) : input.sortOrder) || dayNumber,
    updatedBy: 'dashboard_web',
    updatedAt: now()
  }
}

async function adminWebListTrainingContents(event) {
  return adminWebListCollection(COLLECTIONS.trainingContents, event, {
    filterFields: ['category', 'trainingType', 'membershipLevel', 'status'],
    keywordFields: ['title', 'promptText'],
    orderBy: [['dayNumber', 'asc'], ['sortOrder', 'asc']]
  })
}

async function adminWebUpsertTrainingContent(event) {
  const input = event.data || event
  const id = String(input.id || input._id || '').trim()
  const old = id ? await safeGetById(COLLECTIONS.trainingContents, id) : null
  if (id && !old) return fail('TRAINING_CONTENT_NOT_FOUND', '训练内容不存在')
  let payload
  try {
    payload = normalizeTrainingContentInput(input, old || {})
  } catch (error) {
    return fail('INVALID_TRAINING_CONTENT', error.message)
  }
  let savedId = id
  if (id) {
    await db.collection(COLLECTIONS.trainingContents).doc(id).update({ data: payload })
  } else {
    const result = await db.collection(COLLECTIONS.trainingContents).add({
      data: { ...payload, createdAt: now() }
    })
    savedId = result._id
  }
  return success({ data: await safeGetById(COLLECTIONS.trainingContents, savedId) })
}

async function updateAdminWebTrainingContentStatus(event, status, visible) {
  const input = event.data || event
  const id = String(input.id || input._id || '').trim()
  if (!id) return fail('MISSING_ID', '缺少训练内容 ID')
  const old = await safeGetById(COLLECTIONS.trainingContents, id)
  if (!old) return fail('TRAINING_CONTENT_NOT_FOUND', '训练内容不存在')
  await db.collection(COLLECTIONS.trainingContents).doc(id).update({
    data: { status, visible, updatedBy: 'dashboard_web', updatedAt: now() }
  })
  return success({ data: await safeGetById(COLLECTIONS.trainingContents, id) })
}

function adminWebEnableTrainingContent(event) {
  return updateAdminWebTrainingContentStatus(event, 'active', true)
}

function adminWebDisableTrainingContent(event) {
  return updateAdminWebTrainingContentStatus(event, 'disabled', false)
}

function adminWebDeleteTrainingContent(event) {
  return updateAdminWebTrainingContentStatus(event, 'deleted', false)
}

function isCollectionMissingError(error) {
  const text = `${error && (error.code || error.errCode) || ''} ${error && (error.message || error.errMsg) || ''}`
  return /collection.*not.*exist|collection.*not.*found|DATABASE_COLLECTION_NOT_EXIST|-502005/i.test(text)
}

function normalizeTrainingConfigCategory(value) {
  const category = String(value || '').trim()
  if (!TRAINING_CONFIG_CATEGORIES.includes(category)) {
    throw new Error('训练内容分类不正确')
  }
  return category
}

function normalizeTrainingConfigStatus(value) {
  const status = String(value || 'published').trim()
  if (!TRAINING_CONFIG_STATUSES.includes(status)) {
    throw new Error('训练内容状态不正确')
  }
  return status
}

function normalizeTrainingContentStyle(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  const fontSize = TRAINING_CONTENT_STYLE_FONT_SIZES.includes(String(source.fontSize || '').trim())
    ? String(source.fontSize || '').trim()
    : DEFAULT_TRAINING_CONTENT_STYLE.fontSize
  const color = TRAINING_CONTENT_STYLE_COLORS.includes(String(source.color || '').trim())
    ? String(source.color || '').trim()
    : DEFAULT_TRAINING_CONTENT_STYLE.color

  return {
    fontSize,
    color,
    bold: source.bold === true
  }
}

function normalizeTrainingContentRichStyle(value = {}, contentLength) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  const maxLength = Number.isFinite(contentLength) ? Math.max(contentLength, 0) : Infinity
  const ranges = Array.isArray(source.ranges) ? source.ranges : []

  return {
    ranges: ranges
      .map(item => {
        const start = Math.max(Number(item && item.start || 0), 0)
        const end = Math.max(Number(item && item.end || 0), 0)
        const clampedStart = Number.isFinite(maxLength) ? Math.min(start, maxLength) : start
        const clampedEnd = Number.isFinite(maxLength) ? Math.min(end, maxLength) : end
        return {
          start: clampedStart,
          end: clampedEnd,
          ...normalizeTrainingContentStyle(item)
        }
      })
      .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end)
  }
}

function sanitizeTrainingConfigItem(item = {}) {
  const content = item.content || item.material || item.promptText || ''
  return {
    _id: item._id || '',
    contentId: item.contentId || '',
    category: item.category || '',
    categoryName: item.categoryName || '',
    day: Number(item.day || item.dayNumber || 0),
    title: item.title || '',
    author: item.author || '',
    articleCategory: item.articleCategory || '',
    cover: item.cover || item.coverUrl || '',
    sourceFileID: item.sourceFileID || '',
    content,
    contentStyle: normalizeTrainingContentStyle(item.contentStyle),
    contentRichStyle: normalizeTrainingContentRichStyle(item.contentRichStyle, String(content || '').length),
    status: item.status || '',
    active: item.active !== false,
    visible: item.visible !== false,
    contentVersion: item.contentVersion || '',
    sourceContentId: item.sourceContentId || '',
    isCustom: item.isCustom === true,
    sortOrder: Number(item.sortOrder || item.day || item.dayNumber || 0),
    membershipLevel: normalizeTrainingConfigMembershipLevel(item.membershipLevel),
    updatedAt: item.updatedAt || '',
    createdAt: item.createdAt || '',
    createdBy: item.createdBy || '',
    updatedBy: item.updatedBy || '',
    deletedAt: item.deletedAt || '',
    deletedBy: item.deletedBy || '',
    archivedAt: item.archivedAt || '',
    archivedBy: item.archivedBy || '',
    isDeletedTombstone: item.isDeletedTombstone === true
  }
}

function isActiveTrainingConfigItem(item = {}) {
  return isCurrentTrainingRecord(item)
}

function normalizeTrainingConfigMembershipLevel(value, fallback = 'free') {
  const level = String(value || '').trim()
  if (level === 'member') return 'member'
  if (['monthly', 'yearly', 'admin'].includes(level)) return 'member'
  if (level === 'free') return 'free'
  return fallback
}

function buildTrainingConfigInput(input = {}, old = {}) {
  const contentId = String(input.contentId || old.contentId || '').trim()
  const category = normalizeTrainingConfigCategory(input.category || old.category)
  const title = String(input.title || '').trim()
  const author = String(input.author || '').trim()
  const articleCategory = String(input.articleCategory || old.articleCategory || '').trim()
  const cover = String(input.cover || input.coverUrl || old.cover || old.coverUrl || '').trim()
  const sourceFileID = String(input.sourceFileID || old.sourceFileID || '').trim()
  const content = String(input.content || '').trim()
  const isCustom = input.isCustom === true || old.isCustom === true
  const day = Number(input.day == null ? (old.day || old.dayNumber || 0) : input.day) || 0
  const sortOrder = Number(input.sortOrder == null ? (old.sortOrder || day || 0) : input.sortOrder) || 0
  const membershipLevel = normalizeTrainingConfigMembershipLevel(
    input.membershipLevel || old.membershipLevel || (isCustom ? 'member' : 'free'),
    isCustom ? 'member' : 'free'
  )
  if (!contentId) throw new Error('contentId 不能为空')
  if (!title) throw new Error('标题不能为空')
  if (!content) throw new Error('内容不能为空')
  const status = normalizeTrainingConfigStatus(input.status || old.status || 'published')
  const active = ['published', 'active'].includes(status)
  return {
    contentId,
    category,
    categoryName: String(input.categoryName || old.categoryName || '').trim(),
    day,
    sortOrder,
    title,
    author,
    articleCategory,
    cover,
    sourceFileID,
    content,
    contentStyle: normalizeTrainingContentStyle(input.contentStyle || old.contentStyle),
    contentRichStyle: normalizeTrainingContentRichStyle(input.contentRichStyle || old.contentRichStyle || DEFAULT_TRAINING_CONTENT_RICH_STYLE, content.length),
    isCustom,
    membershipLevel,
    status,
    active,
    visible: active,
    updatedAt: db.serverDate()
  }
}

async function adminListTrainingContents(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const category = String(event.category || '').trim()
  if (category && !TRAINING_CONFIG_CATEGORIES.includes(category)) {
    return fail('INVALID_TRAINING_CONTENT_CATEGORY', '训练内容分类不正确')
  }

  try {
    const page = Math.max(Number(event.page || 1), 1)
    const pageSize = Math.min(Math.max(Number(event.pageSize || 40), 1), 80)
    const query = category
      ? db.collection(COLLECTIONS.trainingContents).where({ category })
      : db.collection(COLLECTIONS.trainingContents)
    const response = await query.skip((page - 1) * pageSize).limit(pageSize).get()
    const rows = response.data || []
    const allContents = rows
      .map(sanitizeTrainingConfigItem)
      .sort((a, b) => {
        const categoryDiff = TRAINING_CONFIG_CATEGORIES.indexOf(a.category) - TRAINING_CONFIG_CATEGORIES.indexOf(b.category)
        if (categoryDiff) return categoryDiff
        const dayDiff = Number(a.day || 0) - Number(b.day || 0)
        if (dayDiff) return dayDiff
        const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
        if (sortDiff) return sortDiff
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN')
      })
    const contents = allContents.filter(isActiveTrainingConfigItem)
    const archivedContents = allContents.filter(item => ['archived', 'inactive', 'disabled'].includes(item.status) || item.active === false)
    const deletedContents = allContents.filter(item => item.status === 'deleted')
    return success({
      contents,
      data: contents,
      archivedContents,
      deletedContents,
      deletedContentIds: deletedContents.map(item => item.contentId).filter(Boolean),
      page,
      pageSize,
      hasMore: rows.length === pageSize,
      profile: admin.profile
    })
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return success({
        contents: [],
        data: [],
        page: 1,
        pageSize: Number(event.pageSize || 40),
        hasMore: false,
        profile: admin.profile,
        message: 'trainingContents collection missing, use local defaults'
      })
    }
    console.error('[adminListTrainingContents] error:', {
      code: error && (error.code || error.errCode) || '',
      message: error && (error.message || error.errMsg) || ''
    })
    return fail('TRAINING_CONTENTS_QUERY_FAILED', '训练内容读取失败')
  }
}

async function adminSaveTrainingContent(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  let payload
  try {
    payload = buildTrainingConfigInput(input)
  } catch (error) {
    return fail('INVALID_TRAINING_CONTENT', error.message)
  }

  const existing = await safeGetOne(COLLECTIONS.trainingContents, {
    contentId: payload.contentId,
    category: payload.category
  })
  const data = {
    ...payload,
    updatedBy: wxContext.OPENID || ''
  }

  let savedId = existing && existing._id
  if (savedId) {
    await db.collection(COLLECTIONS.trainingContents).doc(savedId).update({ data })
  } else {
    const result = await db.collection(COLLECTIONS.trainingContents).add({
      data: {
        ...data,
        createdAt: db.serverDate(),
        createdBy: wxContext.OPENID || ''
      }
    })
    savedId = result._id
  }

  const saved = await safeGetById(COLLECTIONS.trainingContents, savedId)
  return success({
    content: sanitizeTrainingConfigItem(saved || data),
    data: sanitizeTrainingConfigItem(saved || data),
    profile: admin.profile
  })
}

async function adminDeleteTrainingContent(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  const contentId = String(input.contentId || '').trim()
  const category = String(input.category || '').trim()
  if (!contentId) return fail('INVALID_TRAINING_CONTENT', 'contentId 不能为空')
  if (!TRAINING_CONFIG_CATEGORIES.includes(category)) {
    return fail('INVALID_TRAINING_CONTENT_CATEGORY', '训练内容分类不正确')
  }

  const old = await safeGetOne(COLLECTIONS.trainingContents, { contentId, category })
  const tombstone = {
    contentId,
    category,
    categoryName: String(input.categoryName || (old && old.categoryName) || '').trim(),
    day: Number(input.day == null ? (old && (old.day || old.dayNumber || 0)) : input.day) || 0,
    sortOrder: Number(input.sortOrder == null ? (old && (old.sortOrder || old.day || old.dayNumber || 0)) : input.sortOrder) || 0,
    title: String(input.title || (old && old.title) || '').trim(),
    author: String(input.author || (old && old.author) || '').trim(),
    content: String(input.content || (old && (old.content || old.material || old.promptText)) || '').trim(),
    membershipLevel: normalizeTrainingConfigMembershipLevel((old && old.membershipLevel) || input.membershipLevel),
    isCustom: input.isCustom === true || (old && old.isCustom === true),
    status: 'deleted',
    visible: false,
    isDeletedTombstone: !old,
    updatedAt: db.serverDate(),
    updatedBy: wxContext.OPENID || '',
    deletedAt: db.serverDate(),
    deletedBy: wxContext.OPENID || ''
  }

  let savedId = old && old._id
  if (savedId) {
    await db.collection(COLLECTIONS.trainingContents).doc(savedId).update({ data: tombstone })
  } else {
    const result = await db.collection(COLLECTIONS.trainingContents).add({
      data: {
        ...tombstone,
        createdAt: db.serverDate(),
        createdBy: wxContext.OPENID || ''
      }
    })
    savedId = result._id
  }

  const saved = await safeGetById(COLLECTIONS.trainingContents, savedId)
  return success({
    content: sanitizeTrainingConfigItem(saved || tombstone),
    data: sanitizeTrainingConfigItem(saved || tombstone),
    profile: admin.profile
  })
}

function normalizeReplacementTrainingContentItem(item = {}, category, index) {
  const day = Number(item.day || item.dayNumber || index + 1)
  const sourceContentId = String(item.sourceContentId || item.contentId || `${category}-day-${day}`).trim()
  const contentId = String(item.contentVersion === 'v4' || /-v4-day-/i.test(item.contentId || '')
    ? item.contentId
    : `${category}-v4-day-${day}`).trim()
  const title = String(item.title || item.contentTitle || '').trim()
  const author = String(item.author || '').trim()
  const content = String(item.content || item.material || item.promptText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
  const membershipLevel = day <= 21 ? 'free' : 'member'

  if (!day || day < 1) throw new Error(`${category} 第 ${index + 1} 条 day 不正确`)
  if (!contentId) throw new Error(`${category} Day ${day} contentId 不能为空`)
  if (!title) throw new Error(`${category} Day ${day} 标题不能为空`)
  if (!content) throw new Error(`${category} Day ${day} 内容不能为空`)

  return {
    contentId,
    sourceContentId,
    contentVersion: 'v4',
    category,
    categoryName: {
      reading: '朗读训练',
      retelling: '复述训练',
      speech: '演讲训练',
      leaderSpeech: '领导发言'
    }[category] || '',
    day,
    dayNumber: day,
    sortOrder: Number(item.sortOrder || day),
    title,
    author,
    content,
    material: content,
    promptText: content,
    isCustom: false,
    membershipLevel,
    contentStyle: normalizeTrainingContentStyle(item.contentStyle),
    contentRichStyle: normalizeTrainingContentRichStyle(item.contentRichStyle, content.length),
    active: true,
    status: 'published',
    visible: true
  }
}

async function runInChunks(items, size, worker) {
  for (let index = 0; index < items.length; index += size) {
    const chunk = items.slice(index, index + size)
    await Promise.all(chunk.map(worker))
  }
}

async function adminReplaceTrainingContentsBatch(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const data = event.data || {}
  const categories = Array.isArray(event.categories) && event.categories.length
    ? event.categories.map(item => String(item || '').trim())
    : Object.keys(data).filter(category => TRAINING_REPLACEMENT_CATEGORIES.includes(category))
  const invalidCategory = categories.find(category => !TRAINING_REPLACEMENT_CATEGORIES.includes(category))
  if (invalidCategory) {
    return fail('INVALID_REPLACEMENT_CATEGORY', '批量替换包含不支持的训练分类。')
  }
  if (!categories.length) return fail('EMPTY_REPLACEMENT_CATEGORIES', '请选择需要替换的训练分类。')

  const summary = {
    categories: {},
    upserted: 0,
    created: 0,
    updated: 0,
    softDeleted: 0,
    archived: 0
  }

  for (const category of categories) {
    const incoming = Array.isArray(data[category]) ? data[category] : []
    if (!incoming.length) {
      return fail('EMPTY_REPLACEMENT_CONTENTS', `${category} 替换内容不能为空。`)
    }

    let normalized
    try {
      normalized = incoming.map((item, index) => normalizeReplacementTrainingContentItem(item, category, index))
    } catch (error) {
      return fail('INVALID_REPLACEMENT_CONTENT', error.message)
    }

    const contentIds = new Set()
    for (const item of normalized) {
      if (contentIds.has(item.contentId)) {
        return fail('DUPLICATED_REPLACEMENT_CONTENT_ID', `${category} 存在重复 contentId：${item.contentId}`)
      }
      contentIds.add(item.contentId)
    }

    const existingRes = await db.collection(COLLECTIONS.trainingContents)
      .where({ category })
      .limit(1000)
      .get()
    const existingList = existingRes.data || []
    const existingMap = new Map()
    existingList.filter(item => item.contentId).forEach(item => {
      if (!existingMap.has(item.contentId) || isActiveTrainingConfigItem(item)) {
        existingMap.set(item.contentId, item)
      }
    })
    const categorySummary = {
      incoming: normalized.length,
      upserted: 0,
      created: 0,
      updated: 0,
      softDeleted: 0,
      archived: 0
    }

    await runInChunks(normalized, 25, async item => {
      const old = existingMap.get(item.contentId)
      const payload = {
        ...item,
        updatedAt: db.serverDate(),
        updatedBy: wxContext.OPENID || ''
      }

      if (old && old._id) {
        await db.collection(COLLECTIONS.trainingContents).doc(old._id).update({ data: payload })
        categorySummary.updated += 1
      } else {
        await db.collection(COLLECTIONS.trainingContents).add({
          data: {
            ...payload,
            createdAt: db.serverDate(),
            createdBy: wxContext.OPENID || ''
          }
        })
        categorySummary.created += 1
      }
      categorySummary.upserted += 1
    })

    const staleItems = existingList.filter(item => {
      if (!item._id) return false
      const canonical = item.contentId && existingMap.get(item.contentId)
      const isCanonicalIncoming = Boolean(
        item.contentId &&
        contentIds.has(item.contentId) &&
        canonical &&
        canonical._id === item._id
      )
      if (isCanonicalIncoming) return false
      return item.status !== 'archived' || item.active !== false || item.visible !== false
    })

    await runInChunks(staleItems, 25, async item => {
      await db.collection(COLLECTIONS.trainingContents).doc(item._id).update({
        data: {
          active: false,
          status: 'archived',
          visible: false,
          archivedAt: item.archivedAt || db.serverDate(),
          archivedBy: item.archivedBy || wxContext.OPENID || '',
          updatedAt: db.serverDate(),
          updatedBy: wxContext.OPENID || ''
        }
      })
      categorySummary.archived += 1
    })

    summary.categories[category] = categorySummary
    summary.upserted += categorySummary.upserted
    summary.created += categorySummary.created
    summary.updated += categorySummary.updated
    summary.softDeleted += categorySummary.softDeleted
    summary.archived += categorySummary.archived
  }

  await writeAuditLog('adminReplaceTrainingContentsBatch', admin.profile, {
    targetType: 'trainingContents',
    targetId: categories.join(','),
    payloadSummary: summary
  })

  return success({
    summary,
    profile: admin.profile
  })
}

async function getAppContentConfigs(event) {
  const where = { status: 'active', visible: true }
  if (event.section) where.section = String(event.section)
  if (event.type) where.type = String(event.type)
  let query = db.collection(COLLECTIONS.appContentConfigs).where(where)
    .orderBy('sortOrder', 'asc')
    .orderBy('updatedAt', 'desc')
  const result = await query.limit(500).get()
  return success({ data: result.data || [] })
}

function allowedMembershipLevels(type) {
  if (type === 'admin') return ['free', 'member', 'monthly', 'yearly', 'admin']
  if (type === 'yearly') return ['free', 'member', 'monthly', 'yearly']
  if (type === 'monthly') return ['free', 'member', 'monthly']
  return ['free']
}

function trainingContentsFallback(message, membershipType = 'free') {
  return success({
    source: 'local_fallback',
    contents: [],
    // 保留 data 字段，兼容尚未更新的前端版本。
    data: [],
    message,
    membershipType
  })
}

function normalizeTrainingContentForClient(item = {}) {
  if (item.contentId && TRAINING_CONFIG_CATEGORIES.includes(item.category)) {
    return sanitizeTrainingConfigItem(item)
  }
  return item
}

function normalizeTrainingLookupCategory(value) {
  const category = String(value || '').trim()
  if (category === 'retell') return 'retelling'
  return category
}

function getTrainingRecordMembershipLevel(item = {}) {
  const fallback = getTrainingDay(item) > 21 ? 'member' : 'free'
  return normalizeTrainingConfigMembershipLevel(item.membershipLevel, fallback)
}

async function fetchAllTrainingContentRecords(category = '') {
  const records = []
  const pageSize = 100
  for (let page = 0; page < 20; page += 1) {
    const query = category
      ? db.collection(COLLECTIONS.trainingContents).where({ category })
      : db.collection(COLLECTIONS.trainingContents)
    const result = await query.skip(page * pageSize).limit(pageSize).get()
    const rows = Array.isArray(result.data) ? result.data : []
    records.push(...rows)
    if (rows.length < pageSize) break
  }
  return records
}

async function getTrainingContentById(event, wxContext) {
  const contentId = String(event.contentId || '').trim()
  const requestedCategory = normalizeTrainingLookupCategory(event.category)
  const includeArchived = event.includeArchived === true
  const requestedDay = Number(event.day || 0)
  const allowLegacyCurrentFallback = !includeArchived && event.allowLegacyCurrentFallback === true
  const legacyFallbackEligible = allowLegacyCurrentFallback && isRequestedVersionedTrainingContent(
    contentId,
    requestedCategory,
    requestedDay
  )
  if (!contentId) return fail('INVALID_TRAINING_CONTENT', 'contentId 不能为空')

  console.log('[getTrainingContentById] request:', {
    contentId,
    category: requestedCategory,
    day: requestedDay,
    includeArchived,
    allowLegacyCurrentFallback,
    legacyFallbackEligible
  })

  try {
    const result = await db.collection(COLLECTIONS.trainingContents)
      .where({ contentId })
      .limit(20)
      .get()
    const exactRecords = Array.isArray(result.data) ? result.data : []
    const exactCategoryRecords = requestedCategory
      ? exactRecords.filter(item => normalizeTrainingLookupCategory(item.category) === requestedCategory)
      : exactRecords
    const exactCandidates = exactCategoryRecords
      .filter(hasTrainingBody)
      .filter(item => includeArchived || isCurrentTrainingRecord(item))
      .sort((a, b) => {
        const activeDiff = Number(isCurrentTrainingRecord(b)) - Number(isCurrentTrainingRecord(a))
        if (activeDiff) return activeDiff
        return compareCurrentTrainingRecords(a, b)
      })
    let item = exactCandidates[0] || null
    let legacyFallback = false

    // 当前训练迁移期才允许按准确 category + day 借用旧正文；历史原文永远不走此分支。
    if (!item && !exactCategoryRecords.length && legacyFallbackEligible) {
      const categoryRecords = await fetchAllTrainingContentRecords(requestedCategory)
      item = findLegacyCurrentTrainingRecord(categoryRecords, {
        requestedContentId: contentId,
        category: requestedCategory,
        day: requestedDay
      })
      legacyFallback = Boolean(item)
    }

    if (!item) {
      console.log('[getTrainingContentById] result:', {
        contentId,
        category: requestedCategory,
        includeArchived,
        legacyFallbackAttempted: legacyFallbackEligible,
        exactRecordExists: exactCategoryRecords.length > 0,
        found: false
      })
      return success({
        source: 'cloud',
        found: false,
        content: null,
        requestedContentId: contentId,
        legacyFallback: false,
        legacyFallbackAttempted: legacyFallbackEligible,
        exactRecordExists: exactCategoryRecords.length > 0,
        message: includeArchived
          ? '该作品对应的历史训练内容暂不可查看。'
          : '该训练内容暂不存在或已下架。'
      })
    }

    const access = await getCurrentAccess(wxContext.OPENID || '')
    const effectiveMembership = access.phoneBound ? normalizeMembershipType(access.membershipType, 'free') : 'free'
    const membershipLevel = getTrainingRecordMembershipLevel(item)
    if (!allowedMembershipLevels(effectiveMembership).includes(membershipLevel)) {
      return fail('TRAINING_CONTENT_ACCESS_DENIED', '当前训练内容需要会员权限。')
    }

    const sanitizedContent = sanitizeTrainingConfigItem(item)
    const sourceContentId = legacyFallback ? String(sanitizedContent.contentId || '').trim() : ''
    const content = legacyFallback
      ? {
        ...sanitizedContent,
        contentId,
        requestedContentId: contentId,
        sourceContentId,
        legacyFallback: true,
        membershipLevel
      }
      : {
        ...sanitizedContent,
        membershipLevel
      }
    const archived = !isCurrentTrainingRecord(item)
    console.log('[getTrainingContentById] result:', {
      contentId,
      category: requestedCategory,
      includeArchived,
      found: true,
      returnedContentId: content.contentId || '',
      sourceContentId,
      contentLength: String(content.content || '').length,
      archived,
      legacyFallback
    })
    return success({
      source: 'cloud',
      found: true,
      archived,
      legacyFallback,
      legacyFallbackAttempted: legacyFallbackEligible,
      requestedContentId: contentId,
      sourceContentId,
      content
    })
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return success({
        source: 'local_fallback',
        found: false,
        content: null,
        requestedContentId: contentId,
        legacyFallback: false,
        legacyFallbackAttempted: legacyFallbackEligible,
        message: '该作品对应的历史训练内容暂不可查看。'
      })
    }
    console.error('[getTrainingContentById] failed:', {
      contentId,
      category: requestedCategory,
      code: error && (error.code || error.errCode) || '',
      message: error && (error.message || error.errMsg) || ''
    })
    throw error
  }
}

async function getTrainingContents(event, wxContext) {
  let effectiveMembership = 'free'

  try {
    // 会员等级只信任当前 openid 对应的已绑定用户，不能使用客户端传入的手机号或会员声明提权。
    const access = await getCurrentAccess(wxContext.OPENID || '')
    effectiveMembership = access.phoneBound ? normalizeMembershipType(access.membershipType, 'free') : 'free'
    const allowedLevels = allowedMembershipLevels(effectiveMembership)
    const requestedLevel = String(event.membershipLevel || '').trim()
    if (requestedLevel && !MEMBERSHIP_TYPES.includes(requestedLevel)) {
      return fail('INVALID_MEMBERSHIP_LEVEL', '会员权限筛选不正确')
    }
    if (requestedLevel && !allowedLevels.includes(requestedLevel)) {
      return trainingContentsFallback('trainingContents unavailable for current access, use local fallback', effectiveMembership)
    }
    const requestedCategory = normalizeLegacyTrainingCategory(event.category)
    const requestedTrainingType = String(event.trainingType || '').trim()
    const page = Math.max(Number(event.page || 1), 1)
    const pageSize = Math.min(Math.max(Number(event.pageSize || 50), 1), 80)
    const offset = (page - 1) * pageSize
    const rawContents = await fetchAllTrainingContentRecords(requestedCategory)
    const preferredContents = selectPreferredCurrentTrainingRecords(rawContents)
    const allContents = preferredContents
      .filter(item => {
        if (requestedCategory && normalizeLegacyTrainingCategory(item.category) !== requestedCategory) return false
        if (requestedTrainingType && item.trainingType !== requestedTrainingType) return false

        const membershipLevel = getTrainingRecordMembershipLevel(item)
        if (requestedLevel && membershipLevel !== requestedLevel) return false
        return allowedLevels.includes(membershipLevel)
      })
      .map(item => ({
        ...normalizeTrainingContentForClient(item),
        membershipLevel: getTrainingRecordMembershipLevel(item)
      }))
      .sort((a, b) => {
        const dayDiff = Number(a.day || a.dayNumber || 0) - Number(b.day || b.dayNumber || 0)
        if (dayDiff) return dayDiff
        return Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
      })
    const contents = allContents.slice(offset, offset + pageSize)

    if (!rawContents.length && page === 1) {
      return trainingContentsFallback('trainingContents empty, use local fallback', effectiveMembership)
    }

    console.log('[getTrainingContents] result:', {
      category: requestedCategory,
      rawCount: rawContents.length,
      currentCount: preferredContents.length,
      accessibleCount: allContents.length,
      returnedCount: contents.length,
      page,
      pageSize
    })

    return success({
      source: 'cloud',
      contents,
      // 保留 data 字段，兼容尚未更新的前端版本。
      data: contents,
      message: '',
      membershipType: effectiveMembership,
      total: allContents.length,
      page,
      pageSize,
      hasMore: offset + contents.length < allContents.length
    })
  } catch (error) {
    console.warn('[getTrainingContents] cloud contents unavailable, use local fallback:', {
      code: error && (error.code || error.errCode) || '',
      message: error && (error.message || error.errMsg) || 'unknown error'
    })
    return trainingContentsFallback('trainingContents unavailable, use local fallback', effectiveMembership)
  }
}

let wechatAccessTokenCache = {
  appId: '',
  token: '',
  expireAt: 0
}

function getVirtualPaymentConfig() {
  const envText = String(process.env.VIRTUAL_PAY_ENV || '').trim()
  const currencyType = String(process.env.VIRTUAL_PAY_CURRENCY_TYPE || '').trim()
  const envConfigured = envText === '0' || envText === '1'
  const config = {
    offerId: String(process.env.VIRTUAL_PAY_OFFER_ID || '').trim(),
    appKey: String(process.env.VIRTUAL_PAY_APP_KEY || '').trim(),
    appSecret: String(process.env.WECHAT_MINIPROGRAM_APP_SECRET || '').trim(),
    // 仅在环境变量合法时转换为数字，避免把字符串 "0" / "1" 传给虚拟支付参数。
    env: envConfigured ? Number(envText) : null,
    envText,
    envConfigured,
    currencyType
  }
  let configurationError = null
  if (!config.offerId) {
    configurationError = { code: 'VIRTUAL_PAY_OFFER_ID_MISSING', message: '缺少 VIRTUAL_PAY_OFFER_ID' }
  } else if (!config.appKey) {
    configurationError = { code: 'VIRTUAL_PAY_APP_KEY_MISSING', message: '缺少 VIRTUAL_PAY_APP_KEY' }
  } else if (!envText) {
    configurationError = { code: 'VIRTUAL_PAY_ENV_MISSING', message: '缺少 VIRTUAL_PAY_ENV' }
  } else if (!envConfigured) {
    configurationError = { code: 'VIRTUAL_PAY_ENV_INVALID', message: 'VIRTUAL_PAY_ENV 只能是 0 或 1' }
  } else if (!currencyType) {
    configurationError = { code: 'VIRTUAL_PAY_CURRENCY_TYPE_MISSING', message: '缺少 VIRTUAL_PAY_CURRENCY_TYPE' }
  } else if (currencyType !== 'CNY') {
    configurationError = { code: 'VIRTUAL_PAY_CURRENCY_TYPE_INVALID', message: 'VIRTUAL_PAY_CURRENCY_TYPE 必须是 CNY' }
  } else if (!config.appSecret) {
    configurationError = { code: 'WECHAT_MINIPROGRAM_APP_SECRET_MISSING', message: '缺少 WECHAT_MINIPROGRAM_APP_SECRET' }
  }
  return {
    ...config,
    configured: !configurationError,
    configurationError,
    missing: configurationError ? [configurationError.code] : []
  }
}

function logVirtualPaymentServer(message, data = {}) {
  // 严格白名单输出，禁止在云函数日志中出现密钥、签名、openid、手机号或完整支付参数。
  console.log(`[virtual-payment-server] ${message}`, {
    action: data.action || '',
    productId: data.productId || '',
    membershipType: data.membershipType || '',
    priceFen: Number(data.priceFen || 0),
    env: typeof data.env === 'number' ? data.env : null,
    envRaw: data.envRaw == null ? '' : String(data.envRaw),
    envNumber: typeof data.envNumber === 'number' ? data.envNumber : null,
    offerIdExists: data.offerIdExists === true,
    appKeyExists: data.appKeyExists === true,
    appSecretExists: data.appSecretExists === true,
    currencyType: data.currencyType || '',
    orderNo: data.orderNo || '',
    payParamKeys: Array.isArray(data.payParamKeys) ? data.payParamKeys : [],
    signDataKeys: Array.isArray(data.signDataKeys) ? data.signDataKeys : [],
    payParamsEnv: typeof data.payParamsEnv === 'number' ? data.payParamsEnv : null,
    payParamsOfferIdExists: data.payParamsOfferIdExists === true,
    payParamsGoodsIdExists: data.payParamsGoodsIdExists === true,
    payParamsProductIdExists: data.payParamsProductIdExists === true,
    goodsIdField: data.goodsIdField || '',
    goodsId: data.goodsId || '',
    buyQuantity: data.buyQuantity == null ? '' : Number(data.buyQuantity),
    hasPaySig: data.hasPaySig === true,
    hasSignature: data.hasSignature === true,
    hasSign: data.hasSign === true,
    success: data.success === true,
    code: data.code || '',
    message: data.message || '',
    status: data.status || '',
    providerStatus: data.providerStatus == null ? '' : Number(data.providerStatus)
  })
}

function hmacSha256Hex(key, text) {
  return crypto.createHmac('sha256', key).update(text, 'utf8').digest('hex')
}

function makeVirtualPaymentOrderNo() {
  // 微信要求 8-32 个字符，且只能使用数字、字母和指定符号。
  return `VP${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString('hex').toUpperCase()}`
}

function requestWechatJson(url, options = {}, body = '') {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) }
    if (body) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(body)
    }
    const request = https.request(url, {
      method: options.method || 'GET',
      headers
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`微信接口返回 HTTP ${response.statusCode}`))
          return
        }
        if (!text.trim()) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (error) {
          reject(new Error('微信接口返回内容无法解析'))
        }
      })
    })
    request.setTimeout(12000, () => request.destroy(new Error('微信接口请求超时')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

async function exchangeLoginCodeForSession(loginCode, appId, appSecret) {
  const url = 'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(appSecret)}` +
    `&js_code=${encodeURIComponent(loginCode)}` +
    '&grant_type=authorization_code'
  const result = await requestWechatJson(url)
  if (result.errcode || !result.openid || !result.session_key) {
    throw new Error(result.errmsg || '无法获取虚拟支付用户会话')
  }
  return result
}

async function getWechatAccessToken(appId, appSecret) {
  if (
    wechatAccessTokenCache.appId === appId &&
    wechatAccessTokenCache.token &&
    wechatAccessTokenCache.expireAt > Date.now() + 120000
  ) return wechatAccessTokenCache.token

  const url = 'https://api.weixin.qq.com/cgi-bin/token' +
    `?grant_type=client_credential&appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(appSecret)}`
  const result = await requestWechatJson(url)
  if (result.errcode || !result.access_token) {
    throw new Error(result.errmsg || '无法获取微信接口调用凭证')
  }
  wechatAccessTokenCache = {
    appId,
    token: result.access_token,
    expireAt: Date.now() + Math.max(Number(result.expires_in || 7200) - 120, 60) * 1000
  }
  return result.access_token
}

async function listMembershipProducts() {
  const payment = getVirtualPaymentConfig()
  let orderStoreConfigured = true
  if (payment.configured) {
    try {
      await db.collection(COLLECTIONS.virtualPaymentOrders).limit(1).get()
    } catch (error) {
      orderStoreConfigured = false
    }
  }
  const paymentConfigured = payment.configured && orderStoreConfigured
  const configurationError = payment.configurationError || (!orderStoreConfigured
    ? {
      code: 'VIRTUAL_PAYMENT_ORDER_STORE_UNAVAILABLE',
      message: 'virtualPaymentOrders 集合不可用'
    }
    : null)
  return success({
    products: MEMBERSHIP_PRODUCTS.map(item => ({ ...item })),
    paymentConfigured,
    configurationCode: configurationError && configurationError.code || '',
    configurationMessage: configurationError && configurationError.message || ''
  })
}

async function createVirtualPaymentOrder(event, wxContext) {
  const productId = String(event.productId || '').trim()
  const product = getMembershipProduct(productId)
  const config = getVirtualPaymentConfig()
  const logContext = {
    action: 'createVirtualPaymentOrder',
    productId,
    membershipType: product && product.membershipType,
    priceFen: product && product.priceFen,
    env: config.env,
    offerIdExists: Boolean(config.offerId),
    appKeyExists: Boolean(config.appKey),
    appSecretExists: Boolean(config.appSecret),
    currencyType: config.currencyType
  }
  const failCreateOrder = (code, message) => {
    logVirtualPaymentServer('create order result', {
      ...logContext,
      success: false,
      code,
      message
    })
    return fail(code, message)
  }

  logVirtualPaymentServer('create order start', logContext)
  if (!product) {
    return failCreateOrder(
      'INVALID_MEMBERSHIP_PRODUCT',
      '会员商品不存在，请检查当前环境是否已发布 quarterly_membership / yearly_membership。'
    )
  }

  const openid = wxContext.OPENID || ''
  const appId = wxContext.APPID || ''
  if (!openid || !appId) return failCreateOrder('MISSING_WECHAT_IDENTITY', '未获取到微信身份，请稍后重试。')

  if (!config.configured) {
    const configurationError = config.configurationError || {
      code: 'VIRTUAL_PAYMENT_NOT_CONFIGURED',
      message: '会员支付能力配置中，请稍后再试。'
    }
    return failCreateOrder(configurationError.code, configurationError.message)
  }

  const user = await safeGetOne(COLLECTIONS.users, { openid })
  const phone = normalizePhone(user && user.phone)
  if (!user || user.phoneBound !== true || !/^1\d{10}$/.test(phone)) {
    return failCreateOrder('PHONE_REQUIRED', '请先登录并绑定手机号，再购买会员。')
  }
  const currentMembership = normalizeMembershipType(user.membershipType, 'free')
  if (currentMembership === 'admin') return failCreateOrder('ADMIN_PURCHASE_NOT_ALLOWED', '管理员无需购买会员。')
  if (currentMembership === 'yearly' && product.membershipType === 'monthly') {
    return failCreateOrder('MEMBERSHIP_DOWNGRADE_NOT_ALLOWED', '年度会员有效期内暂不支持购买季卡。')
  }

  const loginCode = String(event.loginCode || '').trim()
  if (!loginCode) return failCreateOrder('VIRTUAL_PAYMENT_LOGIN_CODE_REQUIRED', '支付登录态已失效，请重新发起购买。')

  let session
  try {
    session = await exchangeLoginCodeForSession(loginCode, appId, config.appSecret)
  } catch (error) {
    return failCreateOrder('VIRTUAL_PAYMENT_SESSION_FAILED', '支付登录态校验失败，请重新发起购买。')
  }
  if (session.openid !== openid) {
    return failCreateOrder('VIRTUAL_PAYMENT_IDENTITY_MISMATCH', '支付身份校验失败。')
  }

  const orderNo = makeVirtualPaymentOrderNo()
  const attach = JSON.stringify({ orderNo, productId: product.productId })
  const signDataPayload = {
    offerId: config.offerId,
    buyQuantity: 1,
    env: config.env,
    currencyType: config.currencyType,
    productId: product.productId,
    goodsPrice: product.priceFen,
    outTradeNo: orderNo,
    attach
  }
  const signData = JSON.stringify(signDataPayload)
  // 官方签名：paySig 使用支付 AppKey；signature 使用当前用户有效 session_key。
  const paySig = hmacSha256Hex(config.appKey, `requestVirtualPayment&${signData}`)
  const signature = hmacSha256Hex(session.session_key, signData)
  const createdAt = now()
  const orderData = {
    orderNo,
    openid,
    phone,
    phoneMasked: maskPhone(phone),
    appId,
    productId: product.productId,
    membershipType: product.membershipType,
    priceFen: product.priceFen,
    durationDays: product.durationDays,
    status: 'pending',
    fulfillmentState: 'idle',
    paymentProvider: 'wechat_virtual_payment',
    virtualPayParams: { mode: 'short_series_goods', signData },
    transactionId: '',
    paidAt: '',
    fulfilledAt: '',
    providerNotifiedAt: '',
    failReason: '',
    createdAt,
    updatedAt: createdAt
  }
  try {
    await db.collection(COLLECTIONS.virtualPaymentOrders).add({ data: orderData })
  } catch (error) {
    return failCreateOrder('VIRTUAL_PAYMENT_ORDER_STORE_UNAVAILABLE', '会员支付订单服务尚未配置，请稍后再试。')
  }

  const paymentParams = {
    signData,
    paySig,
    signature,
    mode: 'short_series_goods'
  }
  logVirtualPaymentServer('pay params summary', {
    ...logContext,
    orderNo,
    envRaw: config.envText,
    envNumber: Number(config.env),
    goodsIdField: 'productId',
    goodsId: signDataPayload.productId,
    payParamKeys: Object.keys(paymentParams).sort(),
    signDataKeys: Object.keys(signDataPayload).sort(),
    payParamsEnv: signDataPayload.env,
    payParamsOfferIdExists: Boolean(signDataPayload.offerId),
    payParamsGoodsIdExists: Boolean(signDataPayload.goodsId),
    payParamsProductIdExists: Boolean(signDataPayload.productId),
    buyQuantity: signDataPayload.buyQuantity,
    hasSign: Boolean(paymentParams.sign),
    hasPaySig: Boolean(paymentParams.paySig),
    hasSignature: Boolean(paymentParams.signature)
  })
  logVirtualPaymentServer('create order result', {
    ...logContext,
    orderNo,
    payParamKeys: Object.keys(paymentParams).sort(),
    hasPaySig: Boolean(paySig),
    hasSignature: Boolean(signature),
    success: true,
    status: 'pending'
  })
  return success({
    orderNo,
    status: 'pending',
    paymentParams
  })
}

async function queryVirtualPaymentOrderFromWechat(order, config) {
  const body = JSON.stringify({
    openid: order.openid,
    env: config.env,
    order_id: order.orderNo
  })
  const paySig = hmacSha256Hex(config.appKey, `/xpay/query_order&${body}`)
  const accessToken = await getWechatAccessToken(order.appId, config.appSecret)
  const url = 'https://api.weixin.qq.com/xpay/query_order' +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&pay_sig=${encodeURIComponent(paySig)}`
  const result = await requestWechatJson(url, { method: 'POST' }, body)
  if (Number(result.errcode || 0) !== 0) {
    const error = new Error(result.errmsg || '微信订单查询失败')
    error.code = `WECHAT_QUERY_${Number(result.errcode || 0)}`
    throw error
  }
  return result.order || null
}

async function notifyVirtualPaymentGoodsProvided(order, config) {
  if (order.providerNotifiedAt) return true
  const accessToken = await getWechatAccessToken(order.appId, config.appSecret)
  const url = 'https://api.weixin.qq.com/xpay/notify_provide_goods' +
    `?access_token=${encodeURIComponent(accessToken)}`
  const body = JSON.stringify({ order_id: order.orderNo, env: config.env })
  const result = await requestWechatJson(url, { method: 'POST' }, body)
  if (Number(result.errcode || 0) !== 0) {
    throw new Error(result.errmsg || '微信发货确认失败')
  }
  await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
    data: { providerNotifiedAt: now(), providerNotifyError: '', updatedAt: now() }
  })
  return true
}

async function fulfillMembershipOrder(order) {
  if (!order || !order._id) return fail('ORDER_NOT_FOUND', '支付订单不存在。')
  if (order.status === 'fulfilled' && order.fulfilledAt) {
    return success({ status: 'fulfilled', orderNo: order.orderNo, fulfilledAt: order.fulfilledAt })
  }

  // 通过条件更新抢占发放锁；并发确认同一订单时只允许一个请求真正延长会员期限。
  const lockResult = await db.collection(COLLECTIONS.virtualPaymentOrders).where({
    _id: order._id,
    fulfillmentState: 'idle'
  }).update({
    data: { fulfillmentState: 'processing', fulfillmentLockAt: now(), updatedAt: now() }
  })
  if (!lockResult.stats || Number(lockResult.stats.updated || 0) !== 1) {
    const latest = await safeGetById(COLLECTIONS.virtualPaymentOrders, order._id)
    return success({
      status: latest && latest.status === 'fulfilled' ? 'fulfilled' : 'pending',
      orderNo: order.orderNo,
      fulfilledAt: (latest && latest.fulfilledAt) || ''
    })
  }

  try {
    const product = getMembershipProduct(order.productId)
    if (!product || product.membershipType !== order.membershipType) {
      throw new Error('订单商品配置不一致')
    }
    if (Number(order.priceFen) !== product.priceFen || Number(order.durationDays) !== product.durationDays) {
      throw new Error('订单商品价格或有效期与服务端配置不一致')
    }
    const phone = normalizePhone(order.phone)
    if (!/^1\d{10}$/.test(phone)) throw new Error('订单手机号无效')

    const old = await safeGetOne(COLLECTIONS.phoneEntitlements, { phone })
    const oldType = normalizeMembershipType(old && old.membershipType, 'free')
    const keepYearly = oldType === 'yearly' && product.membershipType === 'monthly'
    const membershipType = oldType === 'admin' ? 'admin' : (keepYearly ? 'yearly' : product.membershipType)
    const oldEndAt = normalizeDateOnly(old && old.membershipEndAt)
    const baseDate = oldEndAt && !isExpired(oldEndAt) ? oldEndAt : today()
    const membershipEndAt = membershipType === 'admin' ? null : addDays(baseDate, product.durationDays)
    const limits = getMembershipLimits(membershipType)
    const entitlementData = {
      name: (old && old.name) || '',
      phone,
      phoneMasked: maskPhone(phone),
      className: (old && old.className) || '',
      remark: (old && old.remark) || '小程序虚拟支付开通',
      membershipType,
      membershipLabel: MEMBERSHIP_LABELS[membershipType],
      membershipStatus: 'active',
      membershipStartAt: (old && old.membershipStartAt) || today(),
      membershipEndAt,
      role: membershipType === 'admin' ? 'admin' : 'user',
      isAdmin: membershipType === 'admin',
      aiDailyLimit: limits.aiDailyLimit,
      aiMonthlyLimit: limits.aiMonthlyLimit,
      status: 'active',
      source: 'wechat_virtual_payment',
      latestPaymentOrderNo: order.orderNo,
      updatedAt: now(),
      updatedBy: 'virtual_payment'
    }

    let entitlementId = old && old._id
    if (old) {
      await db.collection(COLLECTIONS.phoneEntitlements).doc(old._id).update({ data: entitlementData })
    } else {
      const result = await db.collection(COLLECTIONS.phoneEntitlements).add({
        data: { ...entitlementData, createdAt: now(), createdBy: 'virtual_payment' }
      })
      entitlementId = result._id
    }
    await syncPhoneEntitlementUsers(phone, { _id: entitlementId, ...entitlementData })

    const fulfilledAt = now()
    await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
      data: {
        status: 'fulfilled',
        fulfillmentState: 'completed',
        membershipEndAt,
        fulfilledAt,
        failReason: '',
        updatedAt: fulfilledAt
      }
    })
    return success({ status: 'fulfilled', orderNo: order.orderNo, fulfilledAt, membershipType, membershipEndAt })
  } catch (error) {
    await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
      data: {
        status: 'paid',
        fulfillmentState: 'idle',
        failReason: error.message || '会员权益发放失败',
        updatedAt: now()
      }
    })
    throw error
  }
}

async function confirmVirtualPaymentOrder(event, wxContext) {
  const orderNo = String(event.orderNo || '').trim()
  const openid = wxContext.OPENID || ''
  const confirmLogContext = { action: 'confirmVirtualPaymentOrder', orderNo }
  logVirtualPaymentServer('confirm order start', confirmLogContext)
  if (!orderNo || !openid) {
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: false,
      code: 'ORDER_NOT_FOUND',
      message: '支付订单不存在。',
      status: 'error'
    })
    return fail('ORDER_NOT_FOUND', '支付订单不存在。')
  }
  let order = await safeGetOne(COLLECTIONS.virtualPaymentOrders, { orderNo, openid })
  if (!order) {
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: false,
      code: 'ORDER_NOT_FOUND',
      message: '支付订单不存在。',
      status: 'error'
    })
    return fail('ORDER_NOT_FOUND', '支付订单不存在。')
  }

  const config = getVirtualPaymentConfig()
  Object.assign(confirmLogContext, {
    productId: order.productId,
    membershipType: order.membershipType,
    priceFen: order.priceFen,
    env: config.env,
    offerIdExists: Boolean(config.offerId),
    appKeyExists: Boolean(config.appKey),
    appSecretExists: Boolean(config.appSecret),
    currencyType: config.currencyType
  })
  if (!config.configured) {
    const configurationError = config.configurationError || {
      code: 'VIRTUAL_PAYMENT_NOT_CONFIGURED',
      message: '会员支付能力配置中，请稍后再试。'
    }
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: false,
      code: configurationError.code,
      message: configurationError.message,
      status: 'error'
    })
    return fail(configurationError.code, configurationError.message)
  }

  if (order.status === 'fulfilled') {
    if (!order.providerNotifiedAt) {
      try { await notifyVirtualPaymentGoodsProvided(order, config) } catch (error) {
        await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
          data: { providerNotifyError: error.message || '微信发货确认失败', updatedAt: now() }
        })
      }
    }
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: true,
      status: 'fulfilled'
    })
    return success({ status: 'fulfilled', orderNo, membershipEndAt: order.membershipEndAt || '' })
  }

  let providerOrder
  try {
    providerOrder = await queryVirtualPaymentOrderFromWechat(order, config)
  } catch (error) {
    await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
      data: { failReason: error.message || '微信订单查询失败', updatedAt: now() }
    })
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: true,
      code: error.code || 'WECHAT_ORDER_QUERY_FAILED',
      message: error.message || '微信订单查询失败',
      status: 'pending'
    })
    return success({
      status: 'pending',
      orderNo,
      code: error.code || 'WECHAT_ORDER_QUERY_FAILED',
      message: error.message || '微信订单查询失败'
    })
  }
  if (!providerOrder) {
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: true,
      code: 'WECHAT_ORDER_NOT_READY',
      message: '微信订单暂未返回结果',
      status: 'pending'
    })
    return success({ status: 'pending', orderNo, message: '支付结果确认中，请稍后刷新会员状态。' })
  }

  const providerStatus = Number(providerOrder.status)
  logVirtualPaymentServer('confirm provider result', {
    ...confirmLogContext,
    success: true,
    status: 'received',
    providerStatus
  })
  if ([2, 3, 4].includes(providerStatus)) {
    const paidAt = Number(providerOrder.paid_time || 0) > 0
      ? new Date(Number(providerOrder.paid_time) * 1000).toISOString()
      : now()
    const transactionId = String(providerOrder.wxpay_order_id || providerOrder.channel_order_id || providerOrder.wx_order_id || '')
    await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
      data: {
        status: 'paid',
        providerOrderStatus: providerStatus,
        providerOrderId: String(providerOrder.wx_order_id || ''),
        transactionId,
        paidAt,
        failReason: '',
        updatedAt: now()
      }
    })
    order = { ...order, status: 'paid', providerOrderStatus: providerStatus, transactionId, paidAt }
    const fulfilled = await fulfillMembershipOrder(order)
    const latest = await safeGetById(COLLECTIONS.virtualPaymentOrders, order._id)
    try { await notifyVirtualPaymentGoodsProvided(latest || order, config) } catch (error) {
      await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
        data: { providerNotifyError: error.message || '微信发货确认失败', updatedAt: now() }
      })
    }
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: fulfilled && fulfilled.success !== false,
      status: fulfilled && fulfilled.status || 'pending',
      providerStatus
    })
    return fulfilled
  }

  if ([5, 6, 8].includes(providerStatus)) {
    await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
      data: { status: 'cancelled', providerOrderStatus: providerStatus, updatedAt: now() }
    })
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: true,
      status: 'cancelled',
      providerStatus
    })
    return success({ status: 'cancelled', orderNo, message: '支付已取消或订单已关闭。' })
  }
  if (providerStatus === 7) {
    await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
      data: { status: 'failed', providerOrderStatus: providerStatus, failReason: '微信订单处理失败', updatedAt: now() }
    })
    logVirtualPaymentServer('confirm order result', {
      ...confirmLogContext,
      success: true,
      code: 'WECHAT_ORDER_FAILED',
      message: '微信订单处理失败',
      status: 'failed',
      providerStatus
    })
    return success({
      status: 'failed',
      orderNo,
      code: 'WECHAT_ORDER_FAILED',
      message: '微信订单处理失败'
    })
  }

  await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
    data: { status: 'pending', providerOrderStatus: providerStatus, updatedAt: now() }
  })
  logVirtualPaymentServer('confirm order result', {
    ...confirmLogContext,
    success: true,
    status: 'pending',
    providerStatus
  })
  return success({ status: 'pending', orderNo, message: '支付结果确认中，请稍后刷新会员状态。' })
}

async function reportVirtualPaymentResult(event, wxContext) {
  const orderNo = String(event.orderNo || '').trim()
  const clientStatus = event.status === 'cancelled' ? 'cancelled' : 'failed'
  const order = await safeGetOne(COLLECTIONS.virtualPaymentOrders, { orderNo, openid: wxContext.OPENID || '' })
  if (!order) return fail('ORDER_NOT_FOUND', '支付订单不存在。')
  if (['paid', 'fulfilled'].includes(order.status)) {
    return success({ status: order.status, orderNo })
  }
  await db.collection(COLLECTIONS.virtualPaymentOrders).doc(order._id).update({
    data: {
      status: clientStatus,
      clientPaymentResult: clientStatus,
      failReason: String(event.reason || '').slice(0, 200),
      updatedAt: now()
    }
  })
  return success({ status: clientStatus, orderNo })
}

function handleVirtualPaymentNotify() {
  // TODO：如后续启用 xpay_goods_deliver_notify 推送，应在 CloudBase 消息推送入口完成来源校验后再调用内部发放函数。
  // 当前版本已使用微信 query_order 服务端轮询确认，不接受小程序客户端伪造支付通知。
  return fail('VIRTUAL_PAYMENT_CALLBACK_NOT_CONFIGURED', '虚拟支付回调尚未配置，请使用服务端订单查询确认。')
}

exports.main = async (event = {}, context) => {
  const action = event.action || ''

  // 公开接口在任何 openId、管理员、手机号或会员判断之前直接处理。
  if (PUBLIC_ACTIONS.has(action)) {
    return handlePublicAction(action, event)
  }

  const wxContext = cloud.getWXContext()

  console.log('[cloudApi] action:', action, 'hasOpenid:', Boolean(wxContext.OPENID))

  try {
    if (action.startsWith('adminWeb')) {
      const tokenError = validateAdminWebToken(event)
      if (tokenError) return tokenError
    }
    switch (action) {
      case 'healthCheck':
        return await healthCheck(event, wxContext)
      case 'getMe':
        return await getMe(event, wxContext)
      case 'getAdminProfile':
        return await getAdminProfile(event, wxContext)
      case 'initSuperAdmin':
        return await initSuperAdmin(event, wxContext)
      case 'adminListAdmins':
        return await adminListAdmins(event, wxContext)
      case 'adminAddAdmin':
        return await adminAddAdmin(event, wxContext)
      case 'adminDisableAdmin':
        return await adminDisableAdmin(event, wxContext)
      case 'adminUpdateAdminRole':
        return await adminUpdateAdminRole(event, wxContext)
      case 'adminAuditLogs':
        return await adminAuditLogs(event, wxContext)
      case 'bindPhoneAndGetAccess':
        return await bindPhoneAndGetAccess(event, wxContext)
      case 'bindPhoneByCode':
        return await bindPhoneByCode(event, wxContext)
      case 'adminCreateStudent':
        return await adminCreateStudent(event, wxContext)
      case 'adminGrantEntitlement':
        return await adminGrantEntitlement(event, wxContext)
      case 'adminListPhoneEntitlements':
        return await adminListPhoneEntitlements(event, wxContext)
      case 'adminSavePhoneEntitlement':
        return await adminSavePhoneEntitlement(event, wxContext)
      case 'adminDisablePhoneEntitlement':
        return await adminDisablePhoneEntitlement(event, wxContext)
      case 'adminEnablePhoneEntitlement':
        return await adminEnablePhoneEntitlement(event, wxContext)
      case 'adminDeletePhoneEntitlement':
        return await adminDeletePhoneEntitlement(event, wxContext)
      case 'adminListData':
        return await adminListData(event, wxContext)
      case 'adminDisableEntitlement':
        return await adminDisableEntitlement(event, wxContext)
      case 'submitWorkRecord':
        return await submitWorkRecord(event, wxContext)
      case 'getMyWorks':
        return await getMyWorks(event, wxContext)
      case 'getSquareWorks':
        return await getSquareWorks(event, wxContext)
      case 'deleteMySquareWork':
        return await deleteMySquareWork(event, wxContext)
      case 'deleteMyWork':
        return await deleteMyWork(event, wxContext)
      case 'unpublishMyWorkFromSquare':
        return await unpublishMyWorkFromSquare(event, wxContext)
      case 'getSquareWorkDetail':
        return await getSquareWorkDetail(event, wxContext)
      case 'toggleSquareLike':
        return await toggleSquareLike(event, wxContext)
      case 'getSquareLikeStatusBatch':
        return await getSquareLikeStatusBatch(event, wxContext)
      case 'listSquareComments':
        return await listSquareComments(event, wxContext)
      case 'addSquareComment':
        return await addSquareComment(event, wxContext)
      case 'deleteSquareComment':
        return await deleteSquareComment(event, wxContext)
      case 'adminListForbiddenWords':
        return await adminListForbiddenWords(event, wxContext)
      case 'adminUpsertForbiddenWord':
        return await adminUpsertForbiddenWord(event, wxContext)
      case 'adminEnableForbiddenWord':
        return await adminEnableForbiddenWord(event, wxContext)
      case 'adminDisableForbiddenWord':
        return await adminDisableForbiddenWord(event, wxContext)
      case 'adminDeleteForbiddenWord':
        return await adminDeleteForbiddenWord(event, wxContext)
      case 'adminInitForbiddenWords':
        return await adminInitForbiddenWords(event, wxContext)
      case 'updateWorkPublicStatus':
        return await updateWorkPublicStatus(event, wxContext)
      case 'updateWorkAiFeedback':
        return await updateWorkAiFeedback(event, wxContext)
      case 'getCurrentWeeklySchedule':
        return await getCurrentWeeklySchedule(event, wxContext)
      case 'adminGetWeeklySchedule':
        return await adminGetWeeklySchedule(event, wxContext)
      case 'adminListWeeklySchedules':
        return await adminListWeeklySchedules(event, wxContext)
      case 'adminSaveWeeklySchedule':
        return await adminSaveWeeklySchedule(event, wxContext)
      case 'adminArchiveWeeklySchedule':
        return await adminArchiveWeeklySchedule(event, wxContext)
      case 'adminListTrainingContents':
        return await adminListTrainingContents(event, wxContext)
      case 'adminSaveTrainingContent':
        return await adminSaveTrainingContent(event, wxContext)
      case 'adminDeleteTrainingContent':
        return await adminDeleteTrainingContent(event, wxContext)
      case 'adminReplaceTrainingContentsBatch':
        return await adminReplaceTrainingContentsBatch(event, wxContext)
      case 'checkAiUsage':
        return await checkAiUsage(event, wxContext)
      case 'recordAiUsage':
        return await recordAiUsage(event, wxContext)
      case 'listMembershipProducts':
        return await listMembershipProducts()
      case 'createVirtualPaymentOrder':
        return await createVirtualPaymentOrder(event, wxContext)
      case 'confirmVirtualPaymentOrder':
        return await confirmVirtualPaymentOrder(event, wxContext)
      case 'reportVirtualPaymentResult':
        return await reportVirtualPaymentResult(event, wxContext)
      case 'fulfillMembershipOrder':
        return fail('FORBIDDEN_INTERNAL_ACTION', '会员权益发放只能由服务端支付确认流程调用。')
      case 'handleVirtualPaymentNotify':
        return handleVirtualPaymentNotify()
      case 'adminWebListPhoneEntitlements':
        return await adminWebListPhoneEntitlements(event)
      case 'adminWebListUsers':
        return await adminWebListUsers(event)
      case 'adminWebListAiUsage':
        return await adminWebListAiUsage(event)
      case 'adminWebListSubmissions':
        return await adminWebListSubmissions(event)
      case 'adminWebListWeeklySchedules':
        return await adminWebListWeeklySchedules(event)
      case 'adminWebListContentConfigs':
        return await adminWebListContentConfigs(event)
      case 'adminWebUpsertContentConfig':
        return await adminWebUpsertContentConfig(event)
      case 'adminWebEnableContentConfig':
        return await adminWebEnableContentConfig(event)
      case 'adminWebDisableContentConfig':
        return await adminWebDisableContentConfig(event)
      case 'adminWebDeleteContentConfig':
        return await adminWebDeleteContentConfig(event)
      case 'adminWebListTrainingContents':
        return await adminWebListTrainingContents(event)
      case 'adminWebUpsertTrainingContent':
        return await adminWebUpsertTrainingContent(event)
      case 'adminWebEnableTrainingContent':
        return await adminWebEnableTrainingContent(event)
      case 'adminWebDisableTrainingContent':
        return await adminWebDisableTrainingContent(event)
      case 'adminWebDeleteTrainingContent':
        return await adminWebDeleteTrainingContent(event)
      case 'getAppContentConfigs':
        return await getAppContentConfigs(event)
      case 'getTrainingContents':
        return await getTrainingContents(event, wxContext)
      case 'getTrainingContentById':
      case 'getTrainingContentByContentId':
        return await getTrainingContentById(event, wxContext)
      default:
        return fail('unknown_action', `未知 action：${action}`)
    }
  } catch (err) {
    console.error('[cloudApi] error:', err)
    return fail('server_error', err.message || '云函数执行失败', {
      stack: err.stack || ''
    })
  }
}
