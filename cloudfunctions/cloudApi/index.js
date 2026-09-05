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
  getTrainingDay,
  hasTrainingBody,
  isCurrentTrainingRecord,
  isPermanentTrainingContentId,
  normalizeCategory: normalizeLegacyTrainingCategory,
  requirePermanentTrainingContentId,
  selectPreferredCurrentTrainingRecords
} = require('./training-content-compat')
const {
  canAccessTrainingContent,
  compareTrainingPosition,
  computeModuleAccessPolicy,
  resolveSingleItemPolicy,
  toDisplayTrainingPosition
} = require('./training-access-policy')
const {
  planActiveSequence,
  toWritableTrainingContentData,
  verifyActiveSequence
} = require('./training-content-admin-plan')
const {
  addDateDays,
  buildRegistrationProjection,
  getDateRange,
  getISOWeekNumber,
  getWeekRange
} = require('./registration-report-utils')
const { createUserMembershipAdminService } = require('./user-membership-admin-service')
const { buildOperationsPdf } = require('./operations-report-pdf')
const { isVideoWorkRecord } = require('./video-share-policy')
const {
  buildPublicSquareCondition,
  collectVisibleSquarePage,
  collectVisibleSquareRecords,
  formatUtcStorageDateTime,
  querySquareStats
} = require('./square-stats')
const {
  classifyMembership: classifyAdminMembership,
  formatShanghaiDate: formatShanghaiAdminDate,
  parseTimestamp: parseAdminTimestamp
} = require('./user-membership-admin-utils')
const {
  PHONE_BINDING_LOCK_KIND,
  PREAUTH_KIND,
  buildPreRegistrationClaim,
  derivePreauthStatus,
  getPreauthorizationDocumentId,
  mergeClaimedMembership,
  mergeMaturedDeferredMembership,
  normalizePhone: normalizeEntitlementPhone,
  redactPhoneNumbers,
  resolveTrustedBoundPhone
} = require('./pre-registration-entitlement-utils')
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
  trainingContentModules: 'trainingContentModules',
  trainingContentRevisions: 'trainingContentRevisions',
  virtualPaymentOrders: 'virtualPaymentOrders',
  userRegistrationReports: 'userRegistrationReports'
}

const CONTENT_CONFIG_SECTIONS = ['home', 'training', 'recitation', 'topics', 'coursePreview', 'membership', 'about', 'square', 'profile', 'notice', 'ai']
const CONTENT_CONFIG_TYPES = ['text', 'rich_text', 'list', 'notice', 'button_text', 'modal_text', 'rule_text', 'topic', 'recitation', 'course_preview']
const TRAINING_TYPES = ['reading', 'speaking', 'retelling', 'impromptu', 'hosting', 'mandarin', 'speech', 'leaderSpeech']
const MEMBERSHIP_TYPES = ['free', 'monthly', 'yearly', 'admin']
const CONTENT_STATUSES = ['active', 'disabled', 'deleted']
const TRAINING_CONFIG_CATEGORIES = ['reading', 'retell', 'retelling', 'topic', 'mandarin', 'speech', 'leaderSpeech', 'dailyQuote', 'dailyTopic', 'tongueTwister']
const TRAINING_CATALOG_MODULES = new Set(['reading', 'retell', 'topic', 'mandarin', 'speech', 'leaderSpeech'])
const TRAINING_CONFIG_STATUSES = ['published', 'draft', 'disabled', 'deleted', 'active', 'archived', 'inactive']
const TRAINING_CONTENT_MEMBERSHIP_LEVELS = ['free', 'member']
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
const SERVER_USERNAME_PREFIX = '口才学员'
const SERVER_USERNAME_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const PLACEHOLDER_NICKNAMES = new Set(['', '同学', '微信用户', '默认用户', '游客', '未登录用户'])
const PUBLIC_ACTIONS = new Set(['getPublicWeeklySchedule', 'getTrainingCatalogByModule'])
const WEEKLY_SCHEDULE_SHARE_PATHS = {
  adult: 'schedule-share/weekly-schedule-share-adult.json',
  college: 'schedule-share/weekly-schedule-share-college.json'
}


const userMembershipAdminService = createUserMembershipAdminService({
  db,
  _,
  cloud,
  collections: COLLECTIONS,
  requireAdmin,
  fail,
  success,
  now,
  maskPhone,
  normalizePhone,
  getMembershipLimits,
  writeAuditLog,
  buildOperationsPdf,
  reconcileBoundPhoneUser
})

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

function preauthorizationNow() {
  return formatShanghaiAdminDate(Date.now(), true)
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
  return normalizeEntitlementPhone(phone)
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

function isValidStoredNickname(value) {
  const nickname = String(value || '').trim()
  return Boolean(nickname && !PLACEHOLDER_NICKNAMES.has(nickname) && Array.from(nickname).length <= 16)
}

function createServerRandomUsername() {
  const bytes = crypto.randomBytes(6)
  let suffix = ''
  for (let index = 0; index < bytes.length; index += 1) {
    suffix += SERVER_USERNAME_ALPHABET[bytes[index] % SERVER_USERNAME_ALPHABET.length]
  }
  return `${SERVER_USERNAME_PREFIX}${suffix}`
}

async function createUniqueServerUsername(collectionProvider = db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const nickname = createServerRandomUsername()
    const result = await collectionProvider.collection(COLLECTIONS.users)
      .where({ nickname })
      .limit(1)
      .get()
    if (!result.data || !result.data.length) return nickname
  }
  throw Object.assign(new Error('暂时无法生成唯一用户名，请重试。'), {
    code: 'USERNAME_GENERATION_FAILED'
  })
}

function getStableUserDocumentId(openid) {
  const digest = crypto.createHash('sha256').update(String(openid || ''), 'utf8').digest('hex')
  return `user_${digest.slice(0, 32)}`
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

    if (['name', 'realName', 'nickname', 'role', 'packageCode', 'packageName', 'status', 'source', 'remark', 'expireAt', 'className', 'membershipType', 'membershipStatus', 'membershipEndAt', 'contentId', 'moduleId', 'contentVersion'].includes(key)) {
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
  const timestamp = parseAdminTimestamp(expireAt, { endOfDay: true })
  return Number.isFinite(timestamp) && timestamp < Date.now()
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
  if (!['active', 'scheduled'].includes(String(record.membershipStatus || 'active'))) return false
  if (record.membershipType === 'admin') return true
  const startDate = normalizeDateOnly(record.membershipStartAt)
  return (!startDate || startDate <= formatShanghaiAdminDate(Date.now())) && !isExpired(record.membershipEndAt)
}

function isScheduledMembershipRecord(record = {}) {
  const membershipType = normalizeMembershipType(record.membershipType, 'free')
  const startDate = normalizeDateOnly(record.membershipStartAt)
  return ['monthly', 'yearly'].includes(membershipType) &&
    ['active', 'scheduled'].includes(String(record.membershipStatus || 'active')) &&
    Boolean(startDate && startDate > formatShanghaiAdminDate(Date.now())) &&
    !isExpired(record.membershipEndAt)
}

function isDirectPhoneEntitlement(record = {}) {
  return record.historyArchive !== true &&
    String(record.entitlementKind || '') !== PREAUTH_KIND &&
    String(record.entitlementKind || '') !== PHONE_BINDING_LOCK_KIND
}

async function getPhoneEntitlement(phone) {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) return null

  let entitlements = []
  try {
    const [slot, result] = await Promise.all([
      safeGetById(COLLECTIONS.phoneEntitlements, getPreauthorizationDocumentId(normalizedPhone)),
      db.collection(COLLECTIONS.phoneEntitlements)
        .where(_.or([{ phone: normalizedPhone }, { phoneNormalized: normalizedPhone }]))
        .limit(20)
        .get()
    ])
    entitlements = (slot ? [slot] : []).concat(result.data || [])
      .filter((item, index, list) => list.findIndex(candidate => candidate._id === item._id) === index)
  } catch (error) {
    console.warn('[cloudApi] phoneEntitlements unavailable:', error.message || error)
    return null
  }
  const candidates = entitlements
    .filter(isDirectPhoneEntitlement)
    .filter(item => item.historyArchive !== true)
    .filter(item => !['disabled', 'deleted'].includes(String(item.status || 'active')))
    .filter(item => ['active', 'scheduled'].includes(String(item.membershipStatus || '')))
  const staleRecords = candidates.filter(item => item.membershipType !== 'admin' && isExpired(item.membershipEndAt))
  for (const stale of staleRecords) {
    await db.collection(COLLECTIONS.phoneEntitlements).doc(stale._id).update({
      data: { membershipStatus: 'expired', updatedAt: now() }
    })
  }
  const activeRecords = candidates
    .filter(item => item.membershipType === 'admin' || isActiveMembershipRecord(item))
    .sort((left, right) => {
      const leftAdmin = normalizeMembershipType(left.membershipType, 'free') === 'admin' ? 1 : 0
      const rightAdmin = normalizeMembershipType(right.membershipType, 'free') === 'admin' ? 1 : 0
      return rightAdmin - leftAdmin || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
    })
  if (!activeRecords.length) return null
  const merged = activeRecords.slice(1).reduce(
    (current, candidate) => mergeClaimedMembership(current, candidate, Date.now()),
    activeRecords[0]
  )
  return { ...activeRecords[0], ...merged }
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
  const requestedPhone = normalizePhone(phone)
  const trustedPhone = resolveTrustedBoundPhone(user || {})
  if (requestedPhone && requestedPhone !== trustedPhone) {
    console.warn('[cloudApi] ignored untrusted access phone:', {
      openidSuffix: openid ? String(openid).slice(-6) : '',
      requestedPhoneMasked: maskPhone(requestedPhone)
    })
  }
  phone = trustedPhone

  // 管理员身份以云端 admins/环境白名单为准，不依赖手机号或普通会员有效期。
  const adminProfile = await getAdminProfileByOpenid(openid)
  if (adminProfile.isAdmin) {
    return {
      openid,
      phone: trustedPhone,
      user,
      student: null,
      entitlements: [],
      packages: [],
      membershipType: 'admin',
      membershipStatus: 'active',
      membershipStartAt: '',
      membershipEndAt: null,
      role: adminProfile.role || 'admin',
      isAdmin: true,
      adminSource: adminProfile.source || '',
      phoneBound: Boolean(user && user.phoneBound === true && normalizePhone(user.phone)),
      hasAdvancedAccess: true,
      aiLimit: -1,
      aiDailyLimit: -1,
      aiMonthlyLimit: -1
    }
  }

  const shouldReconcilePreauthorization = user && trustedPhone && (
    isDeferredPreauthorizationDue(user) ||
    await hasPendingPreauthorizationForPhone(trustedPhone)
  )
  if (shouldReconcilePreauthorization) {
    try {
      const reconciliation = await reconcileBoundPhoneUser(user._id, trustedPhone)
      if (reconciliation && reconciliation.user) user = reconciliation.user
    } catch (error) {
      console.warn('[cloudApi] deferred preauthorization reconciliation failed:', {
        userIdSuffix: user._id ? String(user._id).slice(-6) : '',
        message: error.message || String(error)
      })
    }
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
    ? withMembershipLimits(mergeClaimedMembership(user, phoneMembership, Date.now()))
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
  const user = openid ? await safeGetOne(COLLECTIONS.users, { openid }) : null

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
  const user = openid ? await safeGetOne(COLLECTIONS.users, { openid }) : null
  const access = await getCurrentAccess(openid, user && user.phone || '')
  const effectiveUser = access.user || user

  return success({
    user: effectiveUser ? sanitizeUserProfile(effectiveUser) : null,
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
    _id: user._id || '',
    serverUserId: user._id || user.serverUserId || '',
    nickname: user.nickname || '同学',
    nicknameSource: user.nicknameSource || '',
    avatarUrl: user.avatarUrl || '',
    avatarSource: user.avatarSource || '',
    avatarText: user.avatarText || getAvatarText(user.nickname || '同学'),
    profileCompleted: user.profileCompleted === true,
    isLogin: user.phoneBound === true,
    phone: user.phone || '',
    phoneMasked: user.phoneMasked || maskPhone(user.phone || ''),
    phoneBound: user.phoneBound === true,
    phoneBoundAt: user.phoneBoundAt || '',
    phoneAuthorizedAt: user.phoneAuthorizedAt || '',
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

function getEffectivePhoneMembership(user, resolvedProfile) {
  const currentType = normalizeMembershipType(user && user.membershipType, 'free')
  if (user && currentType !== 'free' && (isActiveMembershipRecord(user) || isScheduledMembershipRecord(user))) {
    return {
      membershipType: currentType,
      membershipStatus: user.membershipStatus || 'active',
      membershipStartAt: user.membershipStartAt || '',
      membershipEndAt: currentType === 'admin' ? null : (user.membershipEndAt || null),
      role: user.role || (currentType === 'admin' ? 'admin' : 'user'),
      isAdmin: user.isAdmin === true || currentType === 'admin',
      ...getMembershipLimits(currentType)
    }
  }
  return resolvedProfile
}

function membershipAuditSnapshot(record = {}) {
  return {
    membershipType: normalizeMembershipType(record.membershipType, 'free'),
    membershipStatus: String(record.membershipStatus || ''),
    membershipStartAt: String(record.membershipStartAt || ''),
    membershipEndAt: record.membershipEndAt == null ? null : String(record.membershipEndAt),
    source: String(record.membershipSource || record.source || '')
  }
}

function sanitizePreauthorizationAuditText(value) {
  return redactPhoneNumbers(value, maskPhone)
}

function withMembershipLimits(membership = {}) {
  const membershipType = normalizeMembershipType(membership.membershipType, 'free')
  return {
    ...membership,
    membershipType,
    role: membership.role || (membershipType === 'admin' ? 'admin' : 'user'),
    isAdmin: membership.isAdmin === true || membershipType === 'admin',
    ...getMembershipLimits(membershipType)
  }
}

function isDeferredPreauthorizationDue(user = {}, nowValue = Date.now()) {
  if (user.preauthDeferred !== true) return false
  const startTimestamp = parseAdminTimestamp(user.preauthDeferredStartAt)
  const nowTimestamp = parseAdminTimestamp(nowValue)
  return Number.isFinite(startTimestamp) && Number.isFinite(nowTimestamp) && startTimestamp <= nowTimestamp
}

async function hasPendingPreauthorizationForPhone(phoneValue, nowValue = Date.now()) {
  const phone = normalizePhone(phoneValue)
  if (!phone) return false
  const entitlement = await safeGetById(
    COLLECTIONS.phoneEntitlements,
    getPreauthorizationDocumentId(phone)
  )
  return Boolean(
    entitlement &&
    String(entitlement.entitlementKind || '') === PREAUTH_KIND &&
    String(entitlement.status || 'active') === 'active' &&
    derivePreauthStatus(entitlement, nowValue) === 'pending'
  )
}

function buildPreauthorizationUserMetadata(preauthorization = {}, claimAt = '') {
  const claim = preauthorization.claim || {}
  const entitlement = preauthorization.entitlement || {}
  const deferred = claim.membershipApplied === false
  return {
    preauthEntitlementId: claim.entitlementId || entitlement._id || '',
    preauthCreatedAt: claim.createdAt || entitlement.createdAt || '',
    preauthClaimedAt: entitlement.claimedAt || claimAt,
    preauthNote: claim.note || entitlement.note || entitlement.remark || '',
    preauthDeferred: deferred,
    preauthDeferredStartAt: deferred
      ? (entitlement.authorizedMembershipStartAt || entitlement.membershipStartAt || '')
      : '',
    preauthDeferredEndAt: deferred
      ? (entitlement.authorizedMembershipEndAt || entitlement.membershipEndAt || '')
      : ''
  }
}

async function resolvePendingPreauthorizationInTransaction(transaction, options = {}) {
  const phone = normalizePhone(options.phone)
  const claimAt = options.claimAt || preauthorizationNow()
  const currentUser = options.currentUser || {}
  const userId = String(options.userId || currentUser._id || '')
  const openid = String(options.openid || currentUser.openid || '')
  const fallbackMembership = withMembershipLimits(options.fallbackMembership || buildMembershipProfile('free'))
  const entitlements = transaction.collection(COLLECTIONS.phoneEntitlements)
  const deterministicId = getPreauthorizationDocumentId(phone)
  const deterministicResult = await entitlements
    .where({ _id: deterministicId, entitlementKind: PREAUTH_KIND })
    .limit(1)
    .get()
  const result = await entitlements
    .where(_.and([
      _.or([{ phone }, { phoneNormalized: phone }]),
      { entitlementKind: PREAUTH_KIND }
    ]))
    .limit(20)
    .get()
  const sourceRecords = [
    ...((deterministicResult.data || []).filter(Boolean)),
    ...(result.data || [])
  ].filter((item, index, records) =>
    item.historyArchive !== true &&
    records.findIndex(record => String(record._id || '') === String(item._id || '')) === index
  )
  const candidates = sourceRecords
    .filter(item => String(item.preauthStatus || 'pending') === 'pending')
    .filter(item => String(item.status || 'active') === 'active')
    .sort((left, right) => {
      const leftExpired = derivePreauthStatus(left, claimAt) === 'expired' ? 1 : 0
      const rightExpired = derivePreauthStatus(right, claimAt) === 'expired' ? 1 : 0
      if (leftExpired !== rightExpired) return leftExpired - rightExpired
      return String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    })
  const entitlement = candidates[0] || null
  if (!entitlement) return { membership: fallbackMembership, claim: null, entitlement: null }

  const currentMembership = getEffectivePhoneMembership(currentUser, fallbackMembership)
  const claim = buildPreRegistrationClaim(entitlement, currentMembership, claimAt)
  if (!claim.claimed) {
    if (claim.status === 'expired' && claim.entitlementPatch) {
      await entitlements.doc(entitlement._id).update({ data: claim.entitlementPatch })
    }
    return {
      membership: fallbackMembership,
      claim,
      entitlement: { ...entitlement, ...(claim.entitlementPatch || {}) }
    }
  }

  const membership = withMembershipLimits(claim.membership)
  const entitlementPatch = {
    ...claim.entitlementPatch,
    authorizedMembershipType: entitlement.authorizedMembershipType || entitlement.membershipType,
    claimedUserId: userId,
    claimedOpenid: openid,
    claimSource: 'trusted_wechat_phone',
    claimCount: 1,
    updatedBy: 'system_phone_claim'
  }
  await entitlements.doc(entitlement._id).update({ data: entitlementPatch })
  for (const duplicate of candidates.slice(1)) {
    await entitlements.doc(duplicate._id).update({
      data: {
        preauthStatus: 'revoked',
        membershipStatus: 'revoked',
        status: 'disabled',
        revokedAt: claimAt,
        revokedBy: 'system_phone_claim',
        revokeReason: 'duplicate_pending_auto_reconciled',
        updatedAt: claimAt,
        updatedBy: 'system_phone_claim'
      }
    })
  }
  await transaction.collection(COLLECTIONS.auditLogs).add({
    data: {
      action: 'PREAUTH_CLAIM',
      operatorOpenid: '',
      operatorRole: 'system',
      operatorSource: 'trusted_wechat_phone',
      targetType: 'userMembership',
      targetId: userId,
      targetOpenidSuffix: openid ? openid.slice(-6) : '',
      targetPhoneMasked: maskPhone(phone),
      membershipChange: {
        actionLabel: '后台预授权领取',
        before: membershipAuditSnapshot(currentMembership),
        after: membershipAuditSnapshot({
          ...membership,
          membershipSource: 'admin_preauthorization_claimed'
        }),
        reason: sanitizePreauthorizationAuditText(entitlement.note || entitlement.remark || '')
      },
      preauthorization: {
        entitlementId: entitlement._id,
        activationMode: entitlement.activationMode || 'on_claim',
        createdAt: entitlement.createdAt || '',
        claimedAt: claimAt,
        createdBySuffix: entitlement.createdBy ? String(entitlement.createdBy).slice(-6) : ''
      },
      payloadSummary: {
        status: 'claimed',
        source: 'admin_preauthorization_claimed',
        remark: sanitizePreauthorizationAuditText(entitlement.note || entitlement.remark || '')
      },
      createdAt: claimAt
    }
  })
  return {
    membership,
    claim: {
      ...claim,
      entitlementId: entitlement._id,
      createdAt: entitlement.createdAt || '',
      note: String(entitlement.note || entitlement.remark || '')
    },
    entitlement: { ...entitlement, ...entitlementPatch }
  }
}

async function resolveMaturedDeferredPreauthorizationInTransaction(transaction, options = {}) {
  const phone = normalizePhone(options.phone)
  const activationAt = options.activationAt || preauthorizationNow()
  const activationTimestamp = parseAdminTimestamp(activationAt)
  const currentMembership = withMembershipLimits(options.currentMembership || buildMembershipProfile('free'))
  const entitlements = transaction.collection(COLLECTIONS.phoneEntitlements)
  const result = await entitlements
    .where(_.and([
      _.or([{ phone }, { phoneNormalized: phone }]),
      { entitlementKind: PREAUTH_KIND },
      { preauthStatus: 'claimed' },
      { deferredActivation: true }
    ]))
    .limit(20)
    .get()
  const deferred = (result.data || [])
    .sort((left, right) => String(left.membershipStartAt || '').localeCompare(String(right.membershipStartAt || '')))
  const matured = deferred.filter(item => classifyAdminMembership(item, activationTimestamp).isActiveMember)
  const expired = deferred.filter(item => {
    const endTimestamp = parseAdminTimestamp(item.membershipEndAt, { endOfDay: true })
    return Number.isFinite(endTimestamp) && endTimestamp < activationTimestamp
  })
  if (!matured.length && !expired.length) return null

  const membership = withMembershipLimits(
    mergeMaturedDeferredMembership(currentMembership, matured, activationTimestamp)
  )
  for (const entitlement of matured) {
    await entitlements.doc(entitlement._id).update({
      data: {
        deferredActivation: false,
        wasDeferredActivation: true,
        membershipStatus: 'active',
        activatedAt: activationAt,
        updatedAt: activationAt,
        updatedBy: 'system_deferred_activation'
      }
    })
  }
  for (const entitlement of expired) {
    await entitlements.doc(entitlement._id).update({
      data: {
        deferredActivation: false,
        wasDeferredActivation: true,
        membershipStatus: 'expired',
        activationSkippedAt: activationAt,
        updatedAt: activationAt,
        updatedBy: 'system_deferred_activation'
      }
    })
  }
  return {
    membership,
    entitlement: matured[0] || expired[0],
    activatedAt: activationAt,
    expiredWithoutActivation: matured.length === 0
  }
}

async function readPhoneBindingLockInTransaction(transaction, phone) {
  const id = getPreauthorizationDocumentId(phone)
  const result = await transaction.collection(COLLECTIONS.phoneEntitlements)
    .where({ _id: id })
    .limit(1)
    .get()
  return { id, record: result.data && result.data[0] || null }
}

async function persistPhoneBindingLockInTransaction(transaction, lock, phone, openid, operationAt) {
  const entitlements = transaction.collection(COLLECTIONS.phoneEntitlements)
  const lockData = {
    bindingLockAt: operationAt,
    bindingLockOwnerSuffix: openid ? String(openid).slice(-6) : '',
    bindingLockVersion: operationAt,
    updatedAt: operationAt
  }
  if (lock.record) {
    await entitlements.doc(lock.id).update({ data: lockData })
    return
  }
  await entitlements.doc(lock.id).set({
    data: {
      entitlementKind: PHONE_BINDING_LOCK_KIND,
      historyArchive: true,
      status: 'internal',
      phoneMasked: maskPhone(phone),
      createdAt: operationAt,
      createdBy: 'trusted_wechat_phone',
      ...lockData
    }
  })
}

async function upsertPhoneAuthenticatedUser(openid, phone, resolvedMembership) {
  if (!db || typeof db.runTransaction !== 'function') {
    throw Object.assign(new Error('当前云数据库版本不支持安全登录事务。'), {
      code: 'PHONE_LOGIN_TRANSACTION_UNAVAILABLE'
    })
  }

  return db.runTransaction(async transaction => {
    const users = transaction.collection(COLLECTIONS.users)
    const phoneBindingLock = await readPhoneBindingLockInTransaction(transaction, phone)
    const currentResult = await users.where({ openid }).limit(1).get()
    const currentUser = currentResult.data && currentResult.data[0] || null
    const currentPhone = normalizePhone(currentUser && (currentUser.phone || currentUser.phoneNormalized))
    if (currentUser && currentPhone && currentPhone !== phone) {
      throw Object.assign(new Error('当前账号已绑定其他手机号，如需换绑请联系管理员。'), {
        code: 'PHONE_REBIND_NOT_ALLOWED'
      })
    }
    const conflictResult = await users
      .where(_.or([{ phone }, { phoneNormalized: phone }]))
      .limit(20)
      .get()
    const conflict = (conflictResult.data || []).find(item => item.openid && item.openid !== openid)
    if (conflict) {
      throw Object.assign(new Error('该手机号已绑定其他账号。'), {
        code: 'PHONE_ALREADY_BOUND'
      })
    }

    const keepNickname = currentUser && isValidStoredNickname(currentUser.nickname)
    const nickname = keepNickname
      ? String(currentUser.nickname).trim()
      : await createUniqueServerUsername(transaction)
    const nicknameSource = keepNickname
      ? (currentUser.nicknameSource || 'custom')
      : 'random'
    const loginAt = now()
    const documentId = currentUser && currentUser._id || getStableUserDocumentId(openid)
    // 手机号身份创建是主链路；预登记权益领取在事务提交后 best-effort 协调，
    // 避免可选权益集合或审计写入异常阻断全新用户登录。
    const membership = getEffectivePhoneMembership(currentUser, resolvedMembership)
    await persistPhoneBindingLockInTransaction(
      transaction,
      phoneBindingLock,
      phone,
      openid,
      loginAt
    )
    const payload = {
      openid,
      phone,
      phoneNormalized: phone,
      phoneMasked: maskPhone(phone),
      phoneBound: true,
      phoneBoundAt: currentUser && currentUser.phoneBoundAt || loginAt,
      phoneAuthorizedAt: loginAt,
      nickname,
      nicknameSource,
      nicknameUpdatedAt: currentUser && currentUser.nicknameUpdatedAt || loginAt,
      avatarUrl: currentUser && currentUser.avatarUrl || '',
      avatarSource: currentUser && currentUser.avatarSource || 'default',
      avatarText: getAvatarText(nickname),
      profileCompleted: true,
      skippedProfileAuth: false,
      isLogin: true,
      membershipType: membership.membershipType,
      membershipStatus: membership.membershipStatus,
      membershipStartAt: membership.membershipStartAt,
      membershipEndAt: membership.membershipEndAt,
      role: membership.role,
      isAdmin: membership.isAdmin === true,
      aiDailyLimit: membership.aiDailyLimit,
      aiMonthlyLimit: membership.aiMonthlyLimit,
      status: 'active',
      registeredAt: currentUser && currentUser.registeredAt || loginAt,
      lastLoginAt: loginAt,
      updatedAt: loginAt,
      loginCount: Number(currentUser && currentUser.loginCount || 0) + 1
    }
    if (currentUser && currentUser._id) {
      await users.doc(currentUser._id).update({ data: payload })
      return {
        user: { ...currentUser, ...payload },
        claim: null,
        entitlement: null
      }
    }

    const created = {
      ...payload,
      firstLoginAt: loginAt,
      createdAt: loginAt
    }
    await users.doc(documentId).set({ data: created })
    return {
      user: { _id: documentId, ...created },
      claim: null,
      entitlement: null
    }
  })
}

async function reconcileBoundPhoneUser(userId, phoneValue) {
  const phone = normalizePhone(phoneValue)
  if (!userId || !/^1\d{10}$/.test(phone)) return { claimed: false, user: null, entitlement: null }
  return db.runTransaction(async transaction => {
    const users = transaction.collection(COLLECTIONS.users)
    const result = await users.doc(userId).get()
    const currentUser = result.data || null
    if (
      !currentUser ||
      currentUser.phoneBound !== true ||
      normalizePhone(currentUser.phone || currentUser.phoneNormalized) !== phone
    ) {
      return { claimed: false, user: currentUser, entitlement: null }
    }
    if (currentUser.isAdmin === true || normalizeMembershipType(currentUser.membershipType, 'free') === 'admin') {
      return { claimed: false, user: currentUser, entitlement: null }
    }
    const fallbackMembership = getEffectivePhoneMembership(currentUser, withMembershipLimits(currentUser))
    const preauthorization = await resolvePendingPreauthorizationInTransaction(transaction, {
      phone,
      openid: currentUser.openid || '',
      userId,
      currentUser,
      claimAt: preauthorizationNow(),
      fallbackMembership
    })
    if (!preauthorization.claim || !preauthorization.claim.claimed) {
      const matured = currentUser.preauthDeferred === true
        ? await resolveMaturedDeferredPreauthorizationInTransaction(transaction, {
            phone,
            currentMembership: fallbackMembership,
            activationAt: preauthorizationNow()
          })
        : null
      if (matured) {
        const membership = matured.membership
        const beforeIdentity = [
          normalizeMembershipType(fallbackMembership.membershipType, 'free'),
          normalizeDateOnly(fallbackMembership.membershipStartAt),
          normalizeDateOnly(fallbackMembership.membershipEndAt)
        ].join('|')
        const afterIdentity = [
          normalizeMembershipType(membership.membershipType, 'free'),
          normalizeDateOnly(membership.membershipStartAt),
          normalizeDateOnly(membership.membershipEndAt)
        ].join('|')
        const patch = {
          preauthDeferred: false,
          preauthDeferredStartAt: '',
          preauthDeferredEndAt: '',
          updatedAt: now()
        }
        if (matured.expiredWithoutActivation) {
          patch.preauthActivationSkippedAt = matured.activatedAt
        } else {
          Object.assign(patch, {
            membershipType: membership.membershipType,
            membershipStatus: membership.membershipStatus,
            membershipStartAt: membership.membershipStartAt,
            membershipEndAt: membership.membershipEndAt,
            role: membership.role,
            isAdmin: membership.isAdmin === true,
            aiDailyLimit: membership.aiDailyLimit,
            aiMonthlyLimit: membership.aiMonthlyLimit,
            preauthActivatedAt: matured.activatedAt
          })
          if (beforeIdentity !== afterIdentity) {
            patch.membershipSource = 'admin_preauthorization_claimed'
          }
        }
        await users.doc(userId).update({ data: patch })
        return {
          claimed: false,
          activated: !matured.expiredWithoutActivation,
          expiredWithoutActivation: matured.expiredWithoutActivation,
          user: { ...currentUser, ...patch },
          entitlement: matured.entitlement
        }
      }
      return {
        claimed: false,
        user: currentUser,
        entitlement: preauthorization.entitlement
      }
    }
    if (preauthorization.claim.membershipApplied === false) {
      const patch = {
        ...buildPreauthorizationUserMetadata(preauthorization, preauthorizationNow()),
        updatedAt: now()
      }
      await users.doc(userId).update({ data: patch })
      return {
        claimed: true,
        membershipApplied: false,
        user: { ...currentUser, ...patch },
        entitlement: preauthorization.entitlement
      }
    }
    const membership = preauthorization.membership
    const patch = {
      membershipType: membership.membershipType,
      membershipStatus: membership.membershipStatus,
      membershipStartAt: membership.membershipStartAt,
      membershipEndAt: membership.membershipEndAt,
      role: membership.role,
      isAdmin: membership.isAdmin === true,
      aiDailyLimit: membership.aiDailyLimit,
      aiMonthlyLimit: membership.aiMonthlyLimit,
      membershipSource: 'admin_preauthorization_claimed',
      preauthEntitlementId: preauthorization.claim.entitlementId,
      preauthCreatedAt: preauthorization.claim.createdAt,
      preauthClaimedAt: preauthorization.entitlement.claimedAt,
      preauthNote: preauthorization.claim.note,
      preauthDeferred: false,
      preauthDeferredStartAt: '',
      preauthDeferredEndAt: '',
      updatedAt: now()
    }
    await users.doc(userId).update({ data: patch })
    return {
      claimed: true,
      user: { ...currentUser, ...patch },
      entitlement: preauthorization.entitlement
    }
  })
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

  const phoneMembershipProfile = await resolvePhoneMembership(phone)
  const adminProfile = await getAdminProfileByOpenid(openid)
  const membershipProfile = adminProfile.isAdmin
    ? buildMembershipProfile('admin')
    : phoneMembershipProfile
  let nextUser
  let preauthorizationClaim = null
  try {
    const upsertResult = await upsertPhoneAuthenticatedUser(openid, phone, membershipProfile)
    nextUser = upsertResult.user
    preauthorizationClaim = upsertResult.claim || null
  } catch (error) {
    if (error && error.code === 'PHONE_ALREADY_BOUND') {
      console.warn('[cloudApi] phone login conflict:', { phoneMasked: maskPhone(phone) })
      return fail('PHONE_ALREADY_BOUND', '该手机号已绑定其他账号。', {
        debugCode: 'PHONE_ALREADY_BOUND'
      })
    }
    if (error && error.code === 'PHONE_REBIND_NOT_ALLOWED') {
      return fail(error.code, error.message, { debugCode: error.code })
    }
    throw error
  }
  let postTransactionReconciliation = null
  try {
    postTransactionReconciliation = await reconcileBoundPhoneUser(nextUser._id, phone)
  } catch (error) {
    // 用户身份已经安全落库；预登记权益协调失败留给后续 getMe/管理员读取重试。
    console.warn('[cloudApi] phone login entitlement reconciliation deferred:', {
      userIdSuffix: nextUser._id ? String(nextUser._id).slice(-6) : '',
      message: error && error.message || String(error)
    })
  }
  if (postTransactionReconciliation && postTransactionReconciliation.user) {
    nextUser = postTransactionReconciliation.user
  }
  if (postTransactionReconciliation && postTransactionReconciliation.claimed) {
    preauthorizationClaim = {
      claimed: true,
      entitlementId: postTransactionReconciliation.entitlement && postTransactionReconciliation.entitlement._id || '',
      status: 'claimed'
    }
  }
  const effectiveMembershipProfile = {
    membershipType: normalizeMembershipType(nextUser.membershipType, 'free'),
    membershipStatus: nextUser.membershipStatus || 'active',
    membershipStartAt: nextUser.membershipStartAt || '',
    membershipEndAt: nextUser.membershipEndAt == null ? null : nextUser.membershipEndAt,
    role: nextUser.role || 'user',
    isAdmin: nextUser.isAdmin === true,
    aiDailyLimit: nextUser.aiDailyLimit,
    aiMonthlyLimit: nextUser.aiMonthlyLimit
  }

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

  await syncAdminMembershipForUser(nextUser, effectiveMembershipProfile)

  if (!student && effectiveMembershipProfile.membershipType === 'free') {
    await recordLeadInternal({
      phone,
      openid,
      nickname: nextUser.nickname,
      source: 'phone_auth_free_user',
      lastAction: 'bind_phone_free'
    })
  }

  console.log('[cloudApi] phone bound:', {
    phoneMasked: maskPhone(phone),
    membershipType: effectiveMembershipProfile.membershipType,
    isAdmin: effectiveMembershipProfile.isAdmin
  })

  return success({
    phone,
    phoneMasked: maskPhone(phone),
    membershipType: effectiveMembershipProfile.membershipType,
    membershipStatus: effectiveMembershipProfile.membershipStatus,
    membershipEndAt: effectiveMembershipProfile.membershipEndAt,
    role: effectiveMembershipProfile.role,
    isAdmin: effectiveMembershipProfile.isAdmin,
    aiDailyLimit: effectiveMembershipProfile.aiDailyLimit,
    aiMonthlyLimit: effectiveMembershipProfile.aiMonthlyLimit,
    userProfile: sanitizeUserProfile(nextUser),
    membershipProfile: effectiveMembershipProfile,
    preauthorizationClaimed: Boolean(preauthorizationClaim && preauthorizationClaim.claimed),
    packages: getPackages(oldEntitlements),
    hasAdvancedAccess: isActiveMembershipRecord(nextUser) || effectiveMembershipProfile.membershipType === 'admin' || hasAdvancedAccess(getPackages(oldEntitlements))
  })
}

async function updateMyProfile(event, wxContext) {
  const openid = wxContext.OPENID || ''
  const user = openid ? await safeGetOne(COLLECTIONS.users, { openid }) : null
  const phone = normalizePhone(user && user.phone)
  if (!user || user.phoneBound !== true || !/^1\d{10}$/.test(phone)) {
    return fail('PHONE_LOGIN_REQUIRED', '请先完成手机号快捷登录。')
  }

  const profile = event.profile || {}
  const nickname = String(profile.nickname || profile.nickName || '').trim()
  if (!isValidStoredNickname(nickname)) {
    return fail('INVALID_NICKNAME', '请输入有效的用户名（1-16个字符）。')
  }
  const avatarUrl = String(profile.avatarUrl || '').trim()
  if (avatarUrl.length > 1024) return fail('INVALID_AVATAR_URL', '头像地址不正确。')

  const patch = {
    nickname,
    nicknameSource: 'custom',
    nicknameUpdatedAt: now(),
    avatarUrl: avatarUrl || user.avatarUrl || '',
    avatarSource: avatarUrl ? 'manual' : (user.avatarSource || 'default'),
    avatarText: getAvatarText(nickname),
    profileCompleted: true,
    updatedAt: now()
  }
  await db.collection(COLLECTIONS.users).doc(user._id).update({ data: patch })
  return success({
    user: sanitizeUserProfile({ ...user, ...patch })
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
  return fail('PHONE_CODE_REQUIRED', '请使用手机号快捷登录完成绑定。')
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
  return formatShanghaiAdminDate(value)
}

function getEntitlementMembershipStatus(entitlement = {}) {
  if (entitlement.status === 'disabled' || entitlement.status === 'deleted') return 'inactive'
  if (
    ['monthly', 'yearly'].includes(entitlement.membershipType) &&
    isExpired(entitlement.membershipEndAt)
  ) return 'expired'
  const startDate = normalizeDateOnly(entitlement.membershipStartAt)
  if (
    ['monthly', 'yearly'].includes(entitlement.membershipType) &&
    startDate && startDate > formatShanghaiAdminDate(Date.now())
  ) return 'scheduled'
  return 'active'
}

async function syncPhoneEntitlementUsers(phoneValue, entitlement = {}) {
  const phone = normalizePhone(phoneValue)
  if (!phone) return

  const membershipStatus = getEntitlementMembershipStatus(entitlement)
  const canActivate = entitlement.status === 'active' && ['active', 'scheduled'].includes(membershipStatus)
  const effectiveProfile = canActivate
    ? {
      membershipType: normalizeMembershipType(entitlement.membershipType, 'free'),
      membershipStatus,
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

  const usersRes = await db.collection(COLLECTIONS.users)
    .where(_.or([{ phone }, { phoneNormalized: phone }]))
    .limit(100)
    .get()
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
    .filter(isDirectPhoneEntitlement)
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
  if (oldById && !isDirectPhoneEntitlement(oldById)) {
    return fail('PREAUTH_REQUIRES_DEDICATED_ACTION', '预授权记录请在待注册授权页面管理。')
  }
  if (oldById && normalizePhone(oldById.phone) !== phone) {
    return fail('phone_change_not_allowed', '编辑时暂不支持修改手机号，请删除后重新创建。')
  }
  const oldByPhoneResult = await db.collection(COLLECTIONS.phoneEntitlements)
    .where(_.or([{ phone }, { phoneNormalized: phone }]))
    .limit(20)
    .get()
  const samePhoneRecords = oldByPhoneResult.data || []
  const pendingPreauthorization = samePhoneRecords.find(item =>
    String(item.entitlementKind || '') === PREAUTH_KIND &&
    derivePreauthStatus(item, Date.now()) === 'pending'
  )
  if (pendingPreauthorization) {
    return fail('PREAUTH_PENDING_REQUIRES_CLAIM', '该手机号仍是待注册授权，请先由用户完成可信手机号绑定。')
  }
  const oldByPhone = samePhoneRecords
    .filter(isDirectPhoneEntitlement)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null
  if (oldByPhone && oldById && oldByPhone._id !== oldById._id) {
    return fail('phone_already_exists', '该手机号已存在身份档案。')
  }
  const old = oldById || oldByPhone
  const rawEndAt = String(input.membershipEndAt || '').trim()
  const submittedEndAt = /^\d{4}-\d{2}-\d{2}$/.test(rawEndAt) ? normalizeDateOnly(rawEndAt) : ''
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
    phoneNormalized: phone,
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
  if (!phone) return null
  const result = await db.collection(COLLECTIONS.phoneEntitlements)
    .where(_.or([{ phone }, { phoneNormalized: phone }]))
    .limit(20)
    .get()
  return (result.data || [])
    .filter(isDirectPhoneEntitlement)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null
}

async function updatePhoneEntitlementStatus(event, wxContext, nextStatus, action) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  const target = await getManagedPhoneEntitlement(input)
  if (!target) return fail('entitlement_not_found', '手机号身份记录不存在，请先保存为新档案。')
  if (String(target.entitlementKind || '') === PREAUTH_KIND) {
    return fail(
      'PREAUTH_REQUIRES_DEDICATED_ACTION',
      String(target.preauthStatus || '') === 'claimed'
        ? '该记录来自已领取预授权，请在用户与会员管理中调整。'
        : '待注册授权请使用专用的编辑或撤销操作。'
    )
  }

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
  const canPublish = work.isPublic === true && !isVideoWorkRecord(work)
  const publishedAt = canPublish ? formatUtcStorageDateTime() : ''
  const moduleId = String(work.moduleId || work.category || work.moduleType || work.trainingType || '').trim()
  const contentId = String(work.contentId || work.taskId || '').trim()
  const sourceType = work.sourceType || 'main'
  const isExtraWork = sourceType === 'extra'
  if (!isExtraWork && !isPermanentTrainingContentId(contentId)) {
    return fail('INVALID_TRAINING_CONTENT_ID', '训练作品缺少有效的永久内容 ID，请刷新训练内容后重试。')
  }
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
    isPublic: canPublish,
    publicPermissionConfirmed: canPublish,
    publicStatus: canPublish ? 'published' : 'unpublished',
    squareStatus: canPublish ? 'active' : 'unpublished',
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
    !isVideoWorkRecord(work) &&
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
  // 广场评论功能已停用：学员端UI已隐藏，服务端拒绝所有新建请求。
  // 历史评论数据保留在 squareComments 集合中，不删除。
  return fail('COMMENT_FEATURE_DISABLED', '评论功能暂未开放')

  /* eslint-disable no-unreachable */
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
  const pageSize = Math.min(Math.max(Number(event.pageSize || 20), 1), 50)
  const cursor = event.cursor || '0'
  const filter = event.filter || 'all'
  const filters = [buildPublicSquareCondition(_)]

  if (['reading', 'retell', 'topic', 'mandarin'].includes(filter)) {
    filters.push({ moduleId: filter })
  }
  const where = filters.length === 1 ? filters[0] : _.and(filters)

  console.log('[cloudApi] getSquareWorks query:', {
    where,
    pageSize,
    cursor,
    orderBy: 'publicAt desc'
  })

  const visiblePage = await collectVisibleSquarePage(async (offset, batchSize) => {
    const page = await db.collection(COLLECTIONS.submissions)
      .where(where)
      .orderBy('publicAt', 'desc')
      .skip(offset)
      .limit(batchSize)
      .get()
    return page.data || []
  }, { pageSize, cursor, batchSize: 50 })

  const currentOpenid = wxContext.OPENID || ''
  const currentUser = currentOpenid ? await safeGetOne(COLLECTIONS.users, { openid: currentOpenid }) : null
  const viewer = {
    openid: currentOpenid,
    userId: currentUser && (currentUser._id || currentUser.id) || '',
    phone: currentUser && currentUser.phone || ''
  }
  const stats = await querySquareStats({
    collection: db.collection(COLLECTIONS.submissions),
    command: _,
    viewer
  })
  let works = visiblePage.records.map(item => sanitizePublicWork(item, viewer))
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
    works,
    stats,
    total: stats.publicCount,
    hasMore: visiblePage.hasMore,
    nextCursor: visiblePage.nextCursor
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

  const timestamp = formatUtcStorageDateTime()
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
  if (isVideoWorkRecord(work)) {
    return fail('VIDEO_SHARE_DISABLED', '视频训练作品暂不支持分享')
  }

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

  if (isPublic && isVideoWorkRecord({ ...work, ...mediaPatch })) {
    return fail('VIDEO_SHARE_DISABLED', '视频训练作品暂不支持分享')
  }

  const timestamp = formatUtcStorageDateTime()
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

// 训练目录属于公开轻量数据：不读取 openid、手机号或会员资料，不返回正文。
async function getTrainingCatalogByModule(event = {}) {
  const moduleId = normalizeLegacyTrainingCategory(event.moduleId || event.category)
  if (!TRAINING_CONFIG_CATEGORIES.includes(moduleId)) {
    return fail('INVALID_TRAINING_MODULE', '训练模块不正确')
  }

  const rawRecords = await fetchAllTrainingContentRecords(moduleId)
  const activeRecords = rawRecords.filter(isCurrentTrainingRecord)
  const invalidIds = activeRecords
    .map(item => String(item.contentId || '').trim())
    .filter(contentId => !isPermanentTrainingContentId(contentId))
  if (invalidIds.length) {
    console.warn('[getTrainingCatalogByModule] invalid permanent IDs:', {
      moduleId,
      invalidCount: invalidIds.length
    })
    return success({
      source: 'local_fallback',
      schemaVersion: 1,
      moduleId,
      contents: [],
      total: 0,
      message: 'cloud catalog contains legacy IDs, use local fallback'
    })
  }

  const contentIdCounts = new Map()
  activeRecords.forEach(item => {
    const contentId = String(item.contentId || '').trim()
    contentIdCounts.set(contentId, (contentIdCounts.get(contentId) || 0) + 1)
  })
  const duplicateIds = Array.from(contentIdCounts.entries()).filter(([, count]) => count > 1)
  if (duplicateIds.length) {
    return fail('DUPLICATE_PERMANENT_CONTENT_ID', '云端训练目录存在重复永久 ID')
  }

  const preferred = selectPreferredCurrentTrainingRecords(activeRecords)
  const policyItems = computeModuleAccessPolicy(preferred)
    .slice()
    .sort(compareTrainingPosition)
  const contents = policyItems.map((item, index) => {
    // 云端允许排序值留空位；公开目录继续返回连续 Day，保持小程序现有协议。
    const day = index + 1
    return {
      contentId: String(item.contentId || '').trim(),
      moduleId,
      day,
      sortOrder: day,
      title: String(item.title || '').trim(),
      status: 'active',
      contentVersion: getNumericTrainingContentVersion(item),
      membershipLevel: item.effectiveMembershipLevel,
      updatedAt: item.updatedAt || '',
      titleStyle: item.titleStyle || null
    }
  })

  const ids = new Set()
  const positions = new Set()
  for (let index = 0; index < contents.length; index += 1) {
    const item = contents[index]
    const expectedPosition = index + 1
    if (!isPermanentTrainingContentId(item.contentId) || ids.has(item.contentId)) {
      return fail('INVALID_TRAINING_CATALOG', '训练目录永久 ID 校验失败')
    }
    if (!item.title || item.day !== expectedPosition || item.sortOrder !== item.day || positions.has(item.day)) {
      return fail('INVALID_TRAINING_CATALOG', '训练目录顺序校验失败')
    }
    ids.add(item.contentId)
    positions.add(item.day)
  }

  const moduleVersion = await getTrainingModuleVersion(moduleId, preferred)
  console.log('[getTrainingCatalogByModule] result:', {
    moduleId,
    rawCount: rawRecords.length,
    activeCount: activeRecords.length,
    catalogCount: contents.length,
    moduleVersion
  })
  return success({
    source: contents.length ? 'cloud' : 'local_fallback',
    schemaVersion: 1,
    moduleId,
    moduleVersion,
    contents,
    total: contents.length,
    message: contents.length ? '' : 'trainingContents empty, use local fallback'
  })
}

async function handlePublicAction(action, event) {
  console.log('[cloudApi] public action:', action)

  try {
    if (action === 'getPublicWeeklySchedule') {
      return await getPublicWeeklySchedule(event)
    }
    if (action === 'getTrainingCatalogByModule') {
      return await getTrainingCatalogByModule(event)
    }
    return fail('PUBLIC_ACTION_NOT_FOUND', '公开接口不存在。')
  } catch (error) {
    const code = String(error && (error.code || error.errCode) || 'PUBLIC_ACTION_ERROR')
    const message = String(error && (error.message || error.errMsg) || '公开接口调用失败')
    console.error('[cloudApi] public action failed:', { action, code, message })
    return fail('PUBLIC_ACTION_QUERY_FAILED', '公开内容读取失败，请稍后重试。', {
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

async function adminWebListTrainingContents(event) {
  const { page, pageSize, skip } = getAdminWebPagination(event)
  const condition = buildAdminWebCondition(event, ['contentId', 'moduleId', 'status'], ['title', 'content'])
  const hasCondition = Object.keys(condition || {}).length > 0
  const createQuery = () => {
    let query = hasCondition
      ? db.collection(COLLECTIONS.trainingContents).where(condition)
      : db.collection(COLLECTIONS.trainingContents)
    return query.orderBy('moduleId', 'asc').orderBy('sortOrder', 'asc')
  }
  const countQuery = hasCondition
    ? db.collection(COLLECTIONS.trainingContents).where(condition)
    : db.collection(COLLECTIONS.trainingContents)
  const [countResult, listResult] = await Promise.all([
    countQuery.count(),
    createQuery().skip(skip).limit(pageSize).get()
  ])
  return success({
    data: (listResult.data || []).map(sanitizeTrainingConfigItem),
    total: Number(countResult.total || 0),
    page,
    pageSize
  })
}

async function legacyAdminWebUpsertTrainingContent(event) {
  const input = event.data || event
  let contentId = ''
  try {
    contentId = requirePermanentTrainingContentId(input.contentId || event.contentId || event.id)
  } catch (error) {
    return fail(error.code || 'INVALID_PERMANENT_CONTENT_ID', error.message)
  }

  const result = await db.collection(COLLECTIONS.trainingContents)
    .where({ contentId })
    .limit(2)
    .get()
  const matches = result.data || []
  if (matches.length > 1) {
    return fail('DUPLICATE_PERMANENT_CONTENT_ID', '云端存在重复永久 contentId，请先修复数据')
  }
  const existing = matches[0] || null
  if (!existing) {
    return fail(
      'TRAINING_CONTENT_INITIAL_IMPORT_REQUIRED',
      '六个主训练模块只能编辑已导入的永久内容；新增内容请使用受控导入流程。'
    )
  }
  const expectedContentVersion = Number(input.expectedContentVersion == null
    ? event.expectedContentVersion
    : input.expectedContentVersion)
  const currentVersion = existing ? getNumericTrainingContentVersion(existing) : 0
  if (!Number.isInteger(expectedContentVersion) || expectedContentVersion < 0) {
    return fail('EXPECTED_CONTENT_VERSION_REQUIRED', '发布前必须携带 expectedContentVersion')
  }
  if (expectedContentVersion !== currentVersion) {
    return fail('CONTENT_VERSION_CONFLICT', '文章已被其他管理员修改，请重新同步后再编辑。', {
      contentId,
      expectedContentVersion,
      currentVersion
    })
  }

  const moduleId = normalizeLegacyTrainingCategory(input.moduleId)
  const day = Number(input.day)
  const sortOrder = Number(input.sortOrder)
  const title = String(input.title || '').trim()
  const content = String(input.content || '').trim()
  const status = String(input.status || 'active').trim()
  if (!TRAINING_CATALOG_MODULES.has(moduleId)) {
    return fail('INVALID_TRAINING_CONTENT', '训练内容 moduleId 不正确')
  }
  if (!Number.isInteger(day) || day < 1 || !Number.isInteger(sortOrder) || sortOrder !== day) {
    return fail('INVALID_TRAINING_CONTENT', 'day 和 sortOrder 必须是相同的正整数')
  }
  if (!title || !content) {
    return fail('INVALID_TRAINING_CONTENT', '标题和正文不能为空')
  }
  if (!['active', 'inactive'].includes(status)) {
    return fail('INVALID_TRAINING_CONTENT', '训练状态只能是 active 或 inactive')
  }
  if (status !== 'active') {
    return fail(
      'TRAINING_CONTENT_STRUCTURE_CHANGE_REQUIRES_IMPORT',
      '六个主训练模块必须保持完整目录，不能在日常发布中下架内容。'
    )
  }
  if (existing) {
    const existingModuleId = normalizeLegacyTrainingCategory(existing.moduleId || existing.category)
    const existingDay = Number(existing.day || existing.sortOrder || 0)
    const existingSortOrder = Number(existing.sortOrder || existing.day || 0)
    if (existingModuleId !== moduleId || existingDay !== day || existingSortOrder !== sortOrder) {
      return fail('TRAINING_CONTENT_POSITION_IMMUTABLE', '已发布内容的 moduleId、day 和 sortOrder 不允许修改')
    }
  }

  const nextVersion = currentVersion + 1
  const moduleVersion = `${moduleId}-${Date.now().toString(36)}-${nextVersion}`
  const payload = {
    contentId,
    moduleId,
    category: moduleId,
    day,
    sortOrder,
    title,
    content,
    contentHash: getTrainingContentDigest(content),
    contentVersion: nextVersion,
    version: nextVersion,
    status,
    active: status === 'active',
    visible: status === 'active',
    moduleVersion,
    updateSource: 'dashboard_web',
    updatedBy: 'dashboard_web',
    updatedAt: db.serverDate()
  }
  const savedId = existing ? existing._id : contentId

  try {
    await db.runTransaction(async transaction => {
      const contents = transaction.collection(COLLECTIONS.trainingContents)
      if (existing) {
        const latestResult = await contents.doc(existing._id).get()
        const latest = latestResult.data || null
        const latestVersion = latest ? getNumericTrainingContentVersion(latest) : 0
        if (!latest || latestVersion !== expectedContentVersion) {
          throw Object.assign(new Error('文章已被其他管理员修改，请重新同步后再编辑。'), {
            code: 'CONTENT_VERSION_CONFLICT',
            currentVersion: latestVersion
          })
        }
        await transaction.collection(COLLECTIONS.trainingContentRevisions).add({
          data: {
            contentId,
            category: moduleId,
            previousVersion: currentVersion,
            nextVersion,
            before: sanitizeTrainingConfigItem(latest),
            after: sanitizeTrainingConfigItem({ ...latest, ...payload }),
            action: 'dashboard_web_update',
            updatedBy: 'dashboard_web',
            updatedAt: db.serverDate()
          }
        })
        await contents.doc(existing._id).update({ data: payload })
      } else {
        await contents.doc(contentId).set({
          data: {
            ...payload,
            createdBy: 'dashboard_web',
            createdAt: db.serverDate()
          }
        })
      }
      await transaction.collection(COLLECTIONS.trainingContentModules).doc(`module_${moduleId}`).set({
        data: {
          moduleId,
          moduleVersion,
          updatedBy: 'dashboard_web',
          updatedAt: db.serverDate()
        }
      })
    })
  } catch (error) {
    if (error && error.code === 'CONTENT_VERSION_CONFLICT') {
      return fail('CONTENT_VERSION_CONFLICT', error.message, {
        contentId,
        expectedContentVersion,
        currentVersion: error.currentVersion || currentVersion
      })
    }
    throw error
  }

  const saved = await safeGetById(COLLECTIONS.trainingContents, savedId)
  const normalized = sanitizeTrainingConfigItem(saved || {})
  const verification = {
    matched: normalized.contentId === contentId &&
      normalized.moduleId === moduleId &&
      normalized.day === day &&
      normalized.sortOrder === sortOrder &&
      normalized.title === title &&
      normalized.content === content &&
      normalized.contentVersion === nextVersion &&
      normalized.status === status,
    contentId,
    contentVersion: nextVersion,
    contentHash: getTrainingContentDigest(normalized.content)
  }
  if (!verification.matched) {
    return fail('TRAINING_CONTENT_VERIFY_FAILED', '训练内容写入后回读校验失败', { verification })
  }
  await writeAuditLog(existing ? 'dashboardWebUpdateTrainingContent' : 'dashboardWebCreateTrainingContent', {
    role: 'admin',
    source: 'dashboard_token',
    admin: { openid: 'dashboard_web' }
  }, {
    targetType: 'trainingContent',
    targetId: contentId,
    payloadSummary: {
      moduleId,
      status,
      contentVersion: nextVersion,
      source: 'dashboard_web'
    }
  })
  return success({ data: normalized, verification, moduleVersion })
}

function isCollectionMissingError(error) {
  const text = `${error && (error.code || error.errCode) || ''} ${error && (error.message || error.errMsg) || ''}`
  return /collection.*not.*exist|collection.*not.*found|DATABASE_COLLECTION_NOT_EXIST|-502005/i.test(text)
}

function normalizeTrainingConfigCategory(value) {
  const category = normalizeLegacyTrainingCategory(value)
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
  const content = item.content || item.material || item.promptText || item.text || item.trainingContent || ''
  const moduleId = normalizeLegacyTrainingCategory(item.moduleId || item.category)
  return {
    _id: item._id || '',
    contentId: item.contentId || '',
    moduleId,
    category: moduleId,
    categoryName: item.categoryName || '',
    day: Number(item.day || item.sortOrder || item.dayNumber || 0),
    title: item.title || '',
    author: item.author || '',
    articleCategory: item.articleCategory || '',
    cover: item.cover || item.coverUrl || '',
    sourceFileID: item.sourceFileID || '',
    content,
    contentStyle: normalizeTrainingContentStyle(item.contentStyle),
    contentRichStyle: normalizeTrainingContentRichStyle(item.contentRichStyle, String(content || '').length),
    richContentHtml: item.richContentHtml || '',
    richContentVersion: Number(item.richContentVersion || 0),
    titleStyle: item.titleStyle || null,
    contentStylePreset: item.contentStylePreset || '',
    status: item.status || '',
    active: item.active !== false,
    visible: item.visible !== false,
    contentVersion: getNumericTrainingContentVersion(item),
    version: getNumericTrainingContentVersion(item),
    moduleVersion: item.moduleVersion || '',
    contentHash: item.contentHash || '',
    richContentHash: item.richContentHash || '',
    sourceRevision: item.sourceRevision || '',
    sourceDocument: item.sourceDocument || '',
    sourceDocumentHash: item.sourceDocumentHash || '',
    origin: item.origin || '',
    updateSource: item.updateSource || '',
    isCustom: item.isCustom === true,
    sortOrder: Number(item.sortOrder || item.day || item.dayNumber || 0),
    membershipLevel: item.membershipLevel || '', // DB 缓存值；effectiveMembershipLevel 由 computeModuleAccessPolicy 计算
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

function getTrainingContentDigest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

function generatePermanentTrainingContentId() {
  return `tc_${crypto.randomBytes(16).toString('hex')}`
}

function getNumericTrainingContentVersion(item = {}) {
  const value = Number(item.version || item.contentVersion || 1)
  return Number.isFinite(value) && value > 0 ? value : 1
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
  const isExisting = Boolean(old && old._id)
  const contentId = requirePermanentTrainingContentId(input.contentId || old.contentId)
  const category = normalizeTrainingConfigCategory(
    isExisting ? (old.moduleId || old.category) : (input.moduleId || input.category)
  )
  const title = String(input.title == null ? (old.title || '') : input.title).trim()
  const author = String(input.author || '').trim()
  const articleCategory = String(input.articleCategory || old.articleCategory || '').trim()
  const cover = String(input.cover || input.coverUrl || old.cover || old.coverUrl || '').trim()
  const sourceFileID = String(input.sourceFileID || old.sourceFileID || '').trim()
  const content = String(input.content == null
    ? (old.content || old.material || old.promptText || '')
    : input.content).trim()
  const isCustom = input.isCustom === true || old.isCustom === true
  const position = Number(isExisting
    ? (old.sortOrder || old.day || 0)
    : (input.sortOrder || input.day || 0)) || 0
  const day = position
  const sortOrder = position
  // membershipLevel 在保存后由 recomputeCategoryMembershipLevels 统一计算
  const membershipLevel = input.membershipLevel || old.membershipLevel || ''
  if (!TRAINING_CONFIG_CATEGORIES.includes(category)) throw new Error('训练内容分类不正确')
  if (isExisting && String(input.contentId || contentId).trim() !== String(old.contentId || '').trim()) {
    throw new Error('永久 contentId 不允许修改')
  }
  if (!title) throw new Error('标题不能为空')
  if (!content) throw new Error('内容不能为空')
  const status = normalizeTrainingConfigStatus(input.status || old.status || 'published')
  const active = ['published', 'active'].includes(status)
  const richContentHtml = String(input.richContentHtml == null ? (old.richContentHtml || '') : input.richContentHtml).trim()
  return {
    contentId,
    moduleId: category,
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
    richContentHtml,
    richContentVersion: Number(input.richContentVersion || old.richContentVersion || 0),
    titleStyle: input.titleStyle || old.titleStyle || null,
    contentStylePreset: String(input.contentStylePreset || old.contentStylePreset || '').trim(),
    contentHash: getTrainingContentDigest(content),
    richContentHash: richContentHtml ? getTrainingContentDigest(richContentHtml) : '',
    sourceRevision: String(input.sourceRevision || old.sourceRevision || '').trim(),
    sourceDocument: String(input.sourceDocument || old.sourceDocument || '').trim(),
    sourceDocumentHash: String(input.sourceDocumentHash || old.sourceDocumentHash || '').trim(),
    origin: String(input.origin || old.origin || (old._id ? '' : 'admin_created')).trim() || 'admin_created',
    updateSource: 'admin',
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

  const category = normalizeLegacyTrainingCategory(event.category)
  if (category && !TRAINING_CONFIG_CATEGORIES.includes(category)) {
    return fail('INVALID_TRAINING_CONTENT_CATEGORY', '训练内容分类不正确')
  }

  try {
    const page = Math.max(Number(event.page || 1), 1)
    const pageSize = Math.min(Math.max(Number(event.pageSize || 40), 1), 80)
    const allRows = await fetchAllTrainingContentRecords(category)
    const sortedContents = allRows
      .map(sanitizeTrainingConfigItem)
      .sort((a, b) => {
        const categoryDiff = TRAINING_CONFIG_CATEGORIES.indexOf(a.category) - TRAINING_CONFIG_CATEGORIES.indexOf(b.category)
        if (categoryDiff) return categoryDiff
        const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
        if (sortDiff) return sortDiff
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN')
      })
    const allContents = sortedContents.slice((page - 1) * pageSize, page * pageSize)
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
      hasMore: page * pageSize < sortedContents.length,
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

// 保存/排序后，重新计算该分类所有 active 内容的 membershipLevel。
// 确保 DB 中存储的值与模块排序位置一致。
async function recomputeCategoryMembershipLevels(category) {
  try {
    const rawContents = await fetchAllTrainingContentRecords(category)
    const preferredContents = selectPreferredCurrentTrainingRecords(rawContents)
    const policyItems = computeModuleAccessPolicy(preferredContents)
    for (const item of policyItems) {
      const storedLevel = String(item.membershipLevel || '').trim()
      if (storedLevel && storedLevel === item.effectiveMembershipLevel) continue
      await db.collection(COLLECTIONS.trainingContents).doc(item._id).update({
        data: {
          membershipLevel: item.effectiveMembershipLevel
        }
      })
    }
  } catch (error) {
    console.warn('[recomputeCategoryMembershipLevels] non-fatal:', {
      category,
      code: error && (error.code || error.errCode) || '',
      message: error && (error.message || error.errMsg) || ''
    })
  }
}

async function legacyAdminSaveTrainingContent(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  const rawContentId = String(input.contentId || '').trim()
  if (rawContentId && !isPermanentTrainingContentId(rawContentId)) {
    return fail('INVALID_PERMANENT_CONTENT_ID', 'contentId 必须是 tc_<32位十六进制> 永久 ID')
  }
  const requestedContentId = rawContentId || generatePermanentTrainingContentId()
  const requestedCategory = normalizeLegacyTrainingCategory(input.moduleId || input.category)
  let existing = null
  if (rawContentId) {
    const existingResult = await db.collection(COLLECTIONS.trainingContents)
      .where({ contentId: requestedContentId })
      .limit(2)
      .get()
    const matches = existingResult.data || []
    if (matches.length > 1) {
      return fail('DUPLICATE_PERMANENT_CONTENT_ID', '云端存在重复永久 contentId，请先修复数据')
    }
    existing = matches[0] || null
    if (existing && requestedCategory && normalizeLegacyTrainingCategory(existing.moduleId || existing.category) !== requestedCategory) {
      return fail('TRAINING_CONTENT_MODULE_IMMUTABLE', '训练内容所属模块不允许修改')
    }
  }

  const effectiveCategory = normalizeLegacyTrainingCategory(
    existing && (existing.moduleId || existing.category) || requestedCategory
  )
  if (TRAINING_CATALOG_MODULES.has(effectiveCategory) && !existing) {
    return fail(
      'TRAINING_CONTENT_INITIAL_IMPORT_REQUIRED',
      '六个主训练模块只能编辑已导入的永久内容；新增内容请使用受控导入流程。'
    )
  }

  let payload
  try {
    payload = buildTrainingConfigInput({
      ...input,
      contentId: requestedContentId,
      moduleId: requestedCategory,
      category: requestedCategory
    }, existing || {})
  } catch (error) {
    return fail('INVALID_TRAINING_CONTENT', error.message)
  }
  if (TRAINING_CATALOG_MODULES.has(payload.category) && !isActiveTrainingConfigItem(payload)) {
    return fail(
      'TRAINING_CONTENT_STRUCTURE_CHANGE_REQUIRES_IMPORT',
      '六个主训练模块必须保持完整目录，不能在日常保存中下架内容。'
    )
  }

  const currentVersion = getNumericTrainingContentVersion(existing || {})
  if (existing && input.expectedVersion == null) {
    return fail('EXPECTED_CONTENT_VERSION_REQUIRED', '保存前必须携带当前 contentVersion，请重新加载后编辑。')
  }
  const expectedVersion = existing ? Number(input.expectedVersion) : 0
  if (existing && (!Number.isFinite(expectedVersion) || expectedVersion !== currentVersion)) {
    return fail('CONTENT_VERSION_CONFLICT', '文章已被其他管理员修改，请重新加载后再编辑。', {
      contentId: payload.contentId,
      expectedVersion,
      currentVersion
    })
  }

  const nextVersion = existing ? currentVersion + 1 : 1
  const moduleSequence = Date.now()
  const moduleVersion = `${payload.category}-${moduleSequence.toString(36)}-${nextVersion}`
  const data = {
    ...payload,
    version: nextVersion,
    contentVersion: nextVersion,
    moduleVersion,
    contentHash: getTrainingContentDigest(payload.content),
    updateSource: 'admin',
    updatedBy: wxContext.OPENID || ''
  }

  let savedId = existing && existing._id
  try {
    await db.runTransaction(async transaction => {
      const contents = transaction.collection(COLLECTIONS.trainingContents)
      if (savedId) {
        const latestResult = await contents.doc(savedId).get()
        const latest = latestResult.data || null
        const latestVersion = getNumericTrainingContentVersion(latest || {})
        if (!latest || latestVersion !== expectedVersion) {
          throw Object.assign(new Error('文章已被其他管理员修改，请重新加载后再编辑。'), {
            code: 'CONTENT_VERSION_CONFLICT',
            currentVersion: latestVersion
          })
        }
        await transaction.collection(COLLECTIONS.trainingContentRevisions).add({
          data: {
            contentId: payload.contentId,
            category: payload.category,
            previousVersion: latestVersion,
            nextVersion,
            before: sanitizeTrainingConfigItem(latest),
            after: sanitizeTrainingConfigItem(data),
            action: 'admin_update',
            updatedBy: wxContext.OPENID || '',
            updatedAt: db.serverDate()
          }
        })
        await contents.doc(savedId).update({ data })
      } else {
        const created = await contents.add({
          data: {
            ...data,
            createdAt: db.serverDate(),
            createdBy: wxContext.OPENID || ''
          }
        })
        savedId = created._id
      }

      const moduleDocId = `module_${payload.category}`
      await transaction.collection(COLLECTIONS.trainingContentModules).doc(moduleDocId).set({
        data: {
          moduleId: payload.category,
          moduleVersion,
          updatedAt: db.serverDate(),
          updatedBy: wxContext.OPENID || ''
        }
      })
    })
  } catch (error) {
    if (error && error.code === 'CONTENT_VERSION_CONFLICT') {
      return fail('CONTENT_VERSION_CONFLICT', error.message, {
        contentId: payload.contentId,
        expectedVersion,
        currentVersion: error.currentVersion || currentVersion
      })
    }
    throw error
  }

  const saved = await safeGetById(COLLECTIONS.trainingContents, savedId)
  const sanitizedSaved = sanitizeTrainingConfigItem(saved || data)
  const savedTitle = String(sanitizedSaved.title || '').trim()
  const savedContent = String(sanitizedSaved.content || '').trim()
  const savedStyle = normalizeTrainingContentStyle(sanitizedSaved.contentStyle)
  const expectedStyle = normalizeTrainingContentStyle(payload.contentStyle)
  const savedRichStyle = normalizeTrainingContentRichStyle(sanitizedSaved.contentRichStyle, savedContent.length)
  const expectedRichStyle = normalizeTrainingContentRichStyle(payload.contentRichStyle, payload.content.length)
  const verification = {
    matched: savedTitle === payload.title &&
      savedContent === payload.content &&
      JSON.stringify(savedStyle) === JSON.stringify(expectedStyle) &&
      JSON.stringify(savedRichStyle) === JSON.stringify(expectedRichStyle) &&
      Number(sanitizedSaved.sortOrder || 0) === Number(payload.sortOrder || 0) &&
      sanitizedSaved.contentId === payload.contentId &&
      sanitizedSaved.moduleId === payload.moduleId &&
      Number(sanitizedSaved.contentVersion || 0) === nextVersion,
    titleMatched: savedTitle === payload.title,
    contentMatched: savedContent === payload.content,
    contentStyleMatched: JSON.stringify(savedStyle) === JSON.stringify(expectedStyle),
    contentRichStyleMatched: JSON.stringify(savedRichStyle) === JSON.stringify(expectedRichStyle),
    sortOrderMatched: Number(sanitizedSaved.sortOrder || 0) === Number(payload.sortOrder || 0),
    permanentIdMatched: sanitizedSaved.contentId === payload.contentId,
    moduleMatched: sanitizedSaved.moduleId === payload.moduleId,
    contentVersionMatched: Number(sanitizedSaved.contentVersion || 0) === nextVersion,
    contentLength: savedContent.length,
    contentHash: getTrainingContentDigest(savedContent)
  }
  if (!verification.matched) {
    console.error('[adminSaveTrainingContent] persisted content mismatch:', {
      contentId: payload.contentId,
      category: payload.category,
      day: payload.day,
      titleMatched: verification.titleMatched,
      expectedContentLength: payload.content.length,
      savedContentLength: savedContent.length,
      expectedContentHash: getTrainingContentDigest(payload.content),
      savedContentHash: verification.contentHash
    })
    return fail('TRAINING_CONTENT_VERIFY_FAILED', '训练内容落库校验失败，请重试', { verification })
  }
  // 保存后异步重新计算该分类的会员权限（不阻塞返回）
  recomputeCategoryMembershipLevels(payload.category).catch(() => {})
  await writeAuditLog(existing ? 'adminUpdateTrainingContent' : 'adminCreateTrainingContent', admin.profile, {
    targetType: 'trainingContent',
    targetId: payload.contentId,
    payloadSummary: {
      moduleId: payload.moduleId,
      contentVersion: nextVersion,
      titleChanged: !existing || String(existing.title || '') !== payload.title,
      contentChanged: !existing || String(existing.content || '') !== payload.content
    }
  })

  return success({
    content: sanitizedSaved,
    data: sanitizedSaved,
    verification,
    moduleVersion,
    profile: admin.profile
  })
}

async function legacyAdminDeleteTrainingContent(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  let contentId = ''
  try {
    contentId = requirePermanentTrainingContentId(input.contentId)
  } catch (error) {
    return fail(error.code || 'INVALID_PERMANENT_CONTENT_ID', error.message)
  }
  const category = normalizeLegacyTrainingCategory(input.moduleId || input.category)
  if (!TRAINING_CONFIG_CATEGORIES.includes(category)) {
    return fail('INVALID_TRAINING_CONTENT_CATEGORY', '训练内容分类不正确')
  }
  if (TRAINING_CATALOG_MODULES.has(category)) {
    return fail(
      'TRAINING_CONTENT_STRUCTURE_CHANGE_REQUIRES_IMPORT',
      '六个主训练模块不能在日常管理中删除内容；请使用受控导入流程。'
    )
  }

  const oldResult = await db.collection(COLLECTIONS.trainingContents)
    .where({ contentId })
    .limit(2)
    .get()
  if ((oldResult.data || []).length > 1) {
    return fail('DUPLICATE_PERMANENT_CONTENT_ID', '云端存在重复永久 contentId，请先修复数据')
  }
  const old = (oldResult.data || [])[0] || null
  if (!old) return fail('TRAINING_CONTENT_NOT_FOUND', '训练内容不存在')
  if (normalizeLegacyTrainingCategory(old.moduleId || old.category) !== category) {
    return fail('TRAINING_CONTENT_MODULE_MISMATCH', '训练内容所属模块不一致')
  }

  const currentVersion = getNumericTrainingContentVersion(old)
  if (input.expectedVersion == null) {
    return fail('EXPECTED_CONTENT_VERSION_REQUIRED', '归档前必须携带当前 contentVersion。')
  }
  const expectedVersion = Number(input.expectedVersion)
  if (!Number.isFinite(expectedVersion) || expectedVersion !== currentVersion) {
    return fail('CONTENT_VERSION_CONFLICT', '文章已被其他管理员修改，请重新加载后再编辑。', {
      contentId,
      expectedVersion,
      currentVersion
    })
  }
  const nextVersion = currentVersion + 1
  const moduleVersion = `${category}-${Date.now().toString(36)}-${nextVersion}`
  const archived = {
    contentId,
    category,
    status: 'archived',
    active: false,
    visible: false,
    version: nextVersion,
    contentVersion: nextVersion,
    moduleVersion,
    updateSource: 'admin',
    archiveReason: String(input.archiveReason || 'admin_archive').trim(),
    updatedAt: db.serverDate(),
    updatedBy: wxContext.OPENID || '',
    archivedAt: db.serverDate(),
    archivedBy: wxContext.OPENID || ''
  }

  try {
    await db.runTransaction(async transaction => {
    const latestResult = await transaction.collection(COLLECTIONS.trainingContents).doc(old._id).get()
    const latest = latestResult.data || null
    const latestVersion = getNumericTrainingContentVersion(latest || {})
    if (!latest || latestVersion !== expectedVersion) {
      throw Object.assign(new Error('文章已被其他管理员修改，请重新加载后再编辑。'), {
        code: 'CONTENT_VERSION_CONFLICT'
      })
    }
    await transaction.collection(COLLECTIONS.trainingContentRevisions).add({
      data: {
        contentId,
        category,
        previousVersion: currentVersion,
        nextVersion,
        before: sanitizeTrainingConfigItem(latest),
        after: sanitizeTrainingConfigItem({ ...latest, ...archived }),
        action: 'admin_archive',
        updatedBy: wxContext.OPENID || '',
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection(COLLECTIONS.trainingContents).doc(old._id).update({ data: archived })
    await transaction.collection(COLLECTIONS.trainingContentModules).doc(`module_${category}`).set({
      data: {
        moduleId: category,
        moduleVersion,
        updatedAt: db.serverDate(),
        updatedBy: wxContext.OPENID || ''
      }
    })
    })
  } catch (error) {
    if (error && error.code === 'CONTENT_VERSION_CONFLICT') {
      return fail('CONTENT_VERSION_CONFLICT', error.message, {
        contentId,
        expectedVersion
      })
    }
    throw error
  }

  const saved = await safeGetById(COLLECTIONS.trainingContents, old._id)
  const sanitizedSaved = sanitizeTrainingConfigItem(saved || { ...old, ...archived })
  if (sanitizedSaved.status !== 'archived' || sanitizedSaved.active !== false || sanitizedSaved.contentVersion !== nextVersion) {
    return fail('TRAINING_CONTENT_ARCHIVE_VERIFY_FAILED', '训练内容归档校验失败，请重新加载确认')
  }
  await writeAuditLog('adminArchiveTrainingContent', admin.profile, {
    targetType: 'trainingContent',
    targetId: contentId,
    payloadSummary: { moduleId: category, previousVersion: currentVersion, contentVersion: nextVersion }
  })
  return success({
    content: sanitizedSaved,
    data: sanitizedSaved,
    moduleVersion,
    profile: admin.profile
  })
}

// 同一模块内的相邻排序必须一次提交，避免两次独立保存留下重复序号或半完成状态。
async function legacyAdminReorderTrainingContents(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })

  const input = event.data || event
  const category = normalizeLegacyTrainingCategory(input.category)
  if (!TRAINING_CONFIG_CATEGORIES.includes(category)) {
    return fail('INVALID_TRAINING_CONTENT_CATEGORY', '训练内容分类不正确')
  }
  if (TRAINING_CATALOG_MODULES.has(category)) {
    return fail(
      'TRAINING_CONTENT_STRUCTURE_CHANGE_REQUIRES_IMPORT',
      '六个主训练模块的 Day 顺序固定；请使用受控导入流程调整结构。'
    )
  }

  const requestedItems = Array.isArray(input.items) ? input.items : []
  if (requestedItems.length < 2 || requestedItems.length > 20) {
    return fail('INVALID_REORDER_ITEMS', '排序操作需要提交 2 至 20 条内容')
  }

  const normalizedItems = requestedItems.map(item => ({
    contentId: String(item && item.contentId || '').trim(),
    expectedVersion: Number(item && item.expectedVersion),
    sortOrder: Number(item && item.sortOrder)
  }))
  if (normalizedItems.some(item => !isPermanentTrainingContentId(item.contentId) || !Number.isFinite(item.expectedVersion) || item.expectedVersion < 1 || !Number.isFinite(item.sortOrder))) {
    return fail('INVALID_REORDER_ITEMS', '排序参数不完整，请刷新列表后重试')
  }
  if (new Set(normalizedItems.map(item => item.contentId)).size !== normalizedItems.length) {
    return fail('DUPLICATE_REORDER_CONTENT', '排序内容不能重复')
  }
  if (new Set(normalizedItems.map(item => item.sortOrder)).size !== normalizedItems.length) {
    return fail('DUPLICATE_REORDER_POSITION', '排序序号不能重复')
  }

  const records = []
  for (const item of normalizedItems) {
    const result = await db.collection(COLLECTIONS.trainingContents)
      .where({ contentId: item.contentId })
      .limit(2)
      .get()
    if ((result.data || []).length > 1) {
      return fail('DUPLICATE_PERMANENT_CONTENT_ID', `云端存在重复永久 contentId：${item.contentId}`)
    }
    const record = (result.data || [])[0] || null
    if (!record) {
      return fail('TRAINING_CONTENT_NOT_FOUND', `未找到训练内容：${item.contentId}`)
    }
    if (normalizeLegacyTrainingCategory(record.moduleId || record.category) !== category) {
      return fail('TRAINING_CONTENT_MODULE_MISMATCH', `训练内容所属模块不一致：${item.contentId}`)
    }
    records.push({ ...item, record })
  }

  const moduleVersion = `${category}-${Date.now().toString(36)}-reorder`
  try {
    await db.runTransaction(async transaction => {
      for (const item of records) {
        const contentRef = transaction.collection(COLLECTIONS.trainingContents).doc(item.record._id)
        const latestResult = await contentRef.get()
        const latest = latestResult.data || null
        const currentVersion = getNumericTrainingContentVersion(latest || {})
        if (!latest || currentVersion !== item.expectedVersion) {
          throw Object.assign(new Error('文章已被其他管理员修改，请重新加载后再排序。'), {
            code: 'CONTENT_VERSION_CONFLICT',
            contentId: item.contentId,
            currentVersion
          })
        }

        const nextVersion = currentVersion + 1
        const previousTitleStyle = latest.titleStyle && typeof latest.titleStyle === 'object'
          ? { ...latest.titleStyle }
          : {}
        if (item.sortOrder === 1) {
          previousTitleStyle.color = '#b91c1c'
        } else if (Number(latest.sortOrder || 0) === 1 || previousTitleStyle.color === '#b91c1c') {
          delete previousTitleStyle.color
        }
        const updateData = {
          day: item.sortOrder,
          sortOrder: item.sortOrder,
          titleStyle: Object.keys(previousTitleStyle).length ? previousTitleStyle : null,
          version: nextVersion,
          contentVersion: nextVersion,
          moduleVersion,
          updateSource: 'admin',
          updatedAt: db.serverDate(),
          updatedBy: wxContext.OPENID || ''
        }
        await transaction.collection(COLLECTIONS.trainingContentRevisions).add({
          data: {
            contentId: item.contentId,
            category,
            previousVersion: currentVersion,
            nextVersion,
            before: sanitizeTrainingConfigItem(latest),
            after: sanitizeTrainingConfigItem({ ...latest, ...updateData }),
            action: 'admin_reorder',
            updatedBy: wxContext.OPENID || '',
            updatedAt: db.serverDate()
          }
        })
        await contentRef.update({ data: updateData })
      }

      await transaction.collection(COLLECTIONS.trainingContentModules).doc(`module_${category}`).set({
        data: {
          moduleId: category,
          moduleVersion,
          updatedAt: db.serverDate(),
          updatedBy: wxContext.OPENID || ''
        }
      })
    })
  } catch (error) {
    if (error && error.code === 'CONTENT_VERSION_CONFLICT') {
      return fail('CONTENT_VERSION_CONFLICT', error.message, {
        contentId: error.contentId || '',
        currentVersion: error.currentVersion || 0
      })
    }
    throw error
  }

  const savedContents = []
  for (const item of records) {
    const saved = await safeGetById(COLLECTIONS.trainingContents, item.record._id)
    const normalized = sanitizeTrainingConfigItem(saved || {})
    if (!saved || Number(normalized.sortOrder) !== item.sortOrder || Number(normalized.day) !== item.sortOrder) {
      return fail('TRAINING_CONTENT_REORDER_VERIFY_FAILED', '排序落库校验失败，请重新加载确认')
    }
    savedContents.push(normalized)
  }

  // 排序后异步重新计算该分类的会员权限（不阻塞返回）
  recomputeCategoryMembershipLevels(category).catch(() => {})
  await writeAuditLog('adminReorderTrainingContents', admin.profile, {
    targetType: 'trainingContentModule',
    targetId: category,
    payloadSummary: { moduleId: category, contentIds: normalizedItems.map(item => item.contentId) }
  })

  return success({
    contents: savedContents,
    moduleVersion,
    profile: admin.profile
  })
}

const ADMIN_TRAINING_ACTIVE_STATUSES = new Set(['active', 'published'])
const ADMIN_TRAINING_STATUS_MAP = {
  active: 'active',
  published: 'active',
  inactive: 'inactive',
  disabled: 'inactive',
  draft: 'inactive',
  archived: 'archived',
  deleted: 'deleted'
}
// CloudBase 事务最多 100 个操作；预留模块锁、主记录校验、修订记录和模块写入。
const ADMIN_TRAINING_MAX_ATOMIC_AFFECTED = 96

function normalizeAdminTrainingStatus(value, fallback = 'active') {
  const status = ADMIN_TRAINING_STATUS_MAP[String(value || fallback).trim()]
  if (!status) throw Object.assign(new Error('训练内容状态只能是 active、inactive、archived 或 deleted'), {
    code: 'INVALID_TRAINING_CONTENT_STATUS'
  })
  return status
}

function isAdminTrainingActive(item = {}) {
  return item.active !== false && item.visible !== false && ADMIN_TRAINING_ACTIVE_STATUSES.has(String(item.status || '').trim())
}

function createAdminTrainingError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, ...detail })
}

function getAdminTrainingActor(actor = {}) {
  return {
    id: String(actor.id || '').trim() || 'dashboard_web',
    source: String(actor.source || '').trim() || 'dashboard_web',
    profile: actor.profile || null
  }
}

async function findUniqueTrainingContentById(contentId) {
  const result = await db.collection(COLLECTIONS.trainingContents).where({ contentId }).limit(2).get()
  const matches = result.data || []
  if (matches.length > 1) throw createAdminTrainingError('DUPLICATE_PERMANENT_CONTENT_ID', '云端存在重复永久 contentId，请先修复数据')
  return matches[0] || null
}

function buildAdminTrainingMutationPlan(records, input, actor) {
  const operation = String(input.operation || 'upsert').trim()
  const moduleId = normalizeLegacyTrainingCategory(input.moduleId || input.category)
  if (!TRAINING_CATALOG_MODULES.has(moduleId)) {
    throw createAdminTrainingError('INVALID_TRAINING_CONTENT_MODULE', '训练内容 moduleId 不正确')
  }

  const requestedId = String(input.contentId || input.id || '').trim()
  if (requestedId && !isPermanentTrainingContentId(requestedId)) {
    throw createAdminTrainingError('INVALID_PERMANENT_CONTENT_ID', 'contentId 必须是 tc_<32位十六进制> 永久 ID')
  }
  const contentId = requestedId || generatePermanentTrainingContentId()
  const byContentId = new Map()
  records.forEach(record => {
    const id = String(record.contentId || '').trim()
    if (!id) return
    if (byContentId.has(id)) throw createAdminTrainingError('DUPLICATE_PERMANENT_CONTENT_ID', `云端存在重复永久 contentId：${id}`)
    byContentId.set(id, record)
  })
  const existing = byContentId.get(contentId) || null
  if (existing && normalizeLegacyTrainingCategory(existing.moduleId || existing.category) !== moduleId) {
    throw createAdminTrainingError('TRAINING_CONTENT_MODULE_IMMUTABLE', '永久内容的 moduleId 不允许修改')
  }
  if (!existing && operation !== 'upsert') {
    throw createAdminTrainingError('TRAINING_CONTENT_NOT_FOUND', '训练内容不存在')
  }

  const currentVersion = existing ? getNumericTrainingContentVersion(existing) : 0
  const expectedVersion = Number(input.expectedContentVersion == null ? input.expectedVersion : input.expectedContentVersion)
  if (existing && (!Number.isInteger(expectedVersion) || expectedVersion !== currentVersion)) {
    throw createAdminTrainingError('CONTENT_VERSION_CONFLICT', '文章已被其他管理员修改，请重新加载后再操作。', {
      expectedVersion,
      currentVersion
    })
  }
  if (!existing && expectedVersion !== 0) {
    throw createAdminTrainingError('CONTENT_VERSION_CONFLICT', '新增内容 expectedContentVersion 必须为 0', {
      expectedVersion,
      currentVersion: 0
    })
  }

  let nextStatus = operation === 'delete'
    ? 'deleted'
    : operation === 'archive'
      ? 'archived'
      : normalizeAdminTrainingStatus(input.status, existing && existing.status || 'active')

  if (operation === 'reorder') {
    nextStatus = 'active'
    if (!existing || !isAdminTrainingActive(existing)) {
      throw createAdminTrainingError('TRAINING_CONTENT_NOT_ACTIVE', '只有已发布内容可以调整顺序')
    }
  }

  const title = String(input.title == null ? existing && existing.title || '' : input.title).trim()
  const content = String(input.content == null ? existing && (existing.content || existing.material || existing.promptText) || '' : input.content).trim()
  if (!title || !content) throw createAdminTrainingError('INVALID_TRAINING_CONTENT', '标题和正文不能为空')

  const oldPosition = existing ? Number(existing.sortOrder || existing.day || 0) : 0
  const activeCount = records.filter(record => isAdminTrainingActive(record) && record.contentId !== contentId).length
  const requestedPosition = Number(input.sortOrder || input.day || input.targetDay || oldPosition || activeCount + 1)
  if (!Number.isInteger(requestedPosition) || requestedPosition < 1) {
    throw createAdminTrainingError('INVALID_TRAINING_CONTENT_POSITION', 'Day 必须是正整数')
  }

  const normalizedPrimary = buildTrainingConfigInput({
    ...input,
    contentId,
    moduleId,
    category: moduleId,
    title,
    content,
    status: nextStatus
  }, existing || {})
  const primary = {
    ...(existing || {}),
    ...normalizedPrimary,
    contentId,
    moduleId,
    category: moduleId,
    title,
    content,
    contentHash: getTrainingContentDigest(content),
    status: nextStatus,
    active: nextStatus === 'active',
    visible: nextStatus === 'active',
    updateSource: actor.source,
    updatedBy: actor.id
  }
  const sequencePlan = planActiveSequence(records, primary, requestedPosition, nextStatus, operation)
  const orderedActive = sequencePlan.map(item => item.record)
  const updates = new Map()
  sequencePlan.forEach(item => {
    if (item.changed) {
      updates.set(item.record.contentId, {
        record: item.record,
        data: { day: item.day, sortOrder: item.sortOrder }
      })
    }
  })
  if (nextStatus !== 'active') {
    updates.set(contentId, {
      record: primary,
      data: {
        day: oldPosition || requestedPosition,
        sortOrder: oldPosition || requestedPosition,
        lastActiveDay: oldPosition || Number(existing && existing.lastActiveDay || 0) || requestedPosition
      }
    })
  }

  const affected = Array.from(updates.values())
  if (affected.length > ADMIN_TRAINING_MAX_ATOMIC_AFFECTED) {
    throw createAdminTrainingError(
      'TRAINING_CONTENT_ATOMIC_LIMIT',
      `本次操作会改动 ${affected.length} 条内容，超过 CloudBase 单事务安全上限 ${ADMIN_TRAINING_MAX_ATOMIC_AFFECTED}；为避免半完成状态，操作已取消。`
    )
  }

  return {
    operation,
    moduleId,
    contentId,
    existing,
    currentVersion,
    expectedVersion,
    nextStatus,
    primary,
    affected,
    orderedActive
  }
}

async function executeAdminTrainingMutation(input = {}, rawActor = {}) {
  const actor = getAdminTrainingActor(rawActor)
  const requestedModuleId = normalizeLegacyTrainingCategory(input.moduleId || input.category)
  if (!TRAINING_CONFIG_CATEGORIES.includes(requestedModuleId)) {
    throw createAdminTrainingError('INVALID_TRAINING_CONTENT_MODULE', '训练内容 moduleId 不正确')
  }
  const requestedContentId = String(input.contentId || input.id || '').trim()
  if (requestedContentId) {
    const globalMatch = await findUniqueTrainingContentById(requestedContentId)
    if (globalMatch && normalizeLegacyTrainingCategory(globalMatch.moduleId || globalMatch.category) !== requestedModuleId) {
      throw createAdminTrainingError('TRAINING_CONTENT_MODULE_IMMUTABLE', '永久内容的 moduleId 不允许修改')
    }
  }
  const records = await fetchAllTrainingContentRecords(requestedModuleId)
  const plan = buildAdminTrainingMutationPlan(records, input, actor)
  const moduleDocId = `module_${plan.moduleId}`
  const moduleBefore = await safeGetById(COLLECTIONS.trainingContentModules, moduleDocId)
  const expectedModuleVersion = String(moduleBefore && moduleBefore.moduleVersion || '')
  const nextModuleVersion = `${plan.moduleId}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
  const primaryNextVersion = plan.currentVersion + 1
  let primaryDocumentId = plan.existing && plan.existing._id || plan.contentId

  await db.runTransaction(async transaction => {
    const modules = transaction.collection(COLLECTIONS.trainingContentModules)
    const contents = transaction.collection(COLLECTIONS.trainingContents)
    const moduleResult = await modules.doc(moduleDocId).get()
    const latestModuleVersion = String(moduleResult.data && moduleResult.data.moduleVersion || '')
    if (latestModuleVersion !== expectedModuleVersion) {
      throw createAdminTrainingError('CONTENT_VERSION_CONFLICT', '模块内容已被其他管理员修改，请重新加载后再操作。')
    }

    if (plan.existing) {
      const latestResult = await contents.doc(plan.existing._id).get()
      const latest = latestResult.data || null
      const latestVersion = getNumericTrainingContentVersion(latest || {})
      if (!latest || latestVersion !== plan.expectedVersion) {
        throw createAdminTrainingError('CONTENT_VERSION_CONFLICT', '文章已被其他管理员修改，请重新加载后再操作。', {
          currentVersion: latestVersion
        })
      }
    }

    for (const change of plan.affected) {
      const isPrimary = change.record.contentId === plan.contentId
      const oldVersion = isPrimary ? plan.currentVersion : getNumericTrainingContentVersion(change.record)
      const data = toWritableTrainingContentData({
        ...(isPrimary ? plan.primary : {}),
        ...change.data,
        moduleId: plan.moduleId,
        category: plan.moduleId,
        moduleVersion: nextModuleVersion,
        version: oldVersion + 1,
        contentVersion: oldVersion + 1,
        updatedAt: db.serverDate(),
        updatedBy: actor.id,
        updateSource: actor.source
      })
      if (plan.operation === 'archive' && isPrimary) {
        data.archivedAt = db.serverDate()
        data.archivedBy = actor.id
      }
      if (plan.operation === 'delete' && isPrimary) {
        data.deletedAt = db.serverDate()
        data.deletedBy = actor.id
        data.isDeletedTombstone = true
      }
      const documentId = change.record._id || (isPrimary ? primaryDocumentId : '')
      if (!documentId) throw createAdminTrainingError('TRAINING_CONTENT_DOCUMENT_ID_MISSING', '训练内容文档 ID 缺失')
      if (isPrimary && !plan.existing) {
        await contents.doc(documentId).set({ data: { ...data, createdAt: db.serverDate(), createdBy: actor.id } })
      } else {
        await contents.doc(documentId).update({ data })
      }
    }

    await transaction.collection(COLLECTIONS.trainingContentRevisions).add({
      data: {
        contentId: plan.contentId,
        category: plan.moduleId,
        previousVersion: plan.currentVersion,
        nextVersion: primaryNextVersion,
        action: `admin_${plan.operation}`,
        affected: plan.affected.map(change => ({
          contentId: change.record.contentId,
          beforeDay: Number(change.record.sortOrder || change.record.day || 0),
          afterDay: Number(change.data.sortOrder || change.data.day || 0)
        })),
        updatedBy: actor.id,
        updatedAt: db.serverDate()
      }
    })
    await modules.doc(moduleDocId).set({
      data: {
        moduleId: plan.moduleId,
        moduleVersion: nextModuleVersion,
        updatedBy: actor.id,
        updatedAt: db.serverDate()
      }
    })
  })

  const savedContents = []
  for (const change of plan.affected) {
    const documentId = change.record._id || (change.record.contentId === plan.contentId ? primaryDocumentId : '')
    const saved = await safeGetById(COLLECTIONS.trainingContents, documentId)
    if (!saved) throw createAdminTrainingError('TRAINING_CONTENT_VERIFY_FAILED', '训练内容写入后回读失败')
    savedContents.push(sanitizeTrainingConfigItem(saved))
  }
  const savedPrimary = savedContents.find(item => item.contentId === plan.contentId)
  if (!savedPrimary || savedPrimary.status !== plan.nextStatus || savedPrimary.contentVersion !== primaryNextVersion) {
    throw createAdminTrainingError('TRAINING_CONTENT_VERIFY_FAILED', '训练内容写入后回读校验失败')
  }
  const activeReadback = (await fetchAllTrainingContentRecords(plan.moduleId))
    .filter(isAdminTrainingActive)
    .sort((left, right) => Number(left.sortOrder || left.day || 0) - Number(right.sortOrder || right.day || 0))
  const sequenceValid = verifyActiveSequence(activeReadback)
  if (!sequenceValid) throw createAdminTrainingError('TRAINING_CONTENT_SEQUENCE_VERIFY_FAILED', '训练内容 Day 连续性回读校验失败')
  const moduleReadback = await safeGetById(COLLECTIONS.trainingContentModules, moduleDocId)
  if (!moduleReadback || moduleReadback.moduleVersion !== nextModuleVersion) {
    throw createAdminTrainingError('TRAINING_CONTENT_CATALOG_VERIFY_FAILED', '训练目录版本回读校验失败')
  }
  await recomputeCategoryMembershipLevels(plan.moduleId)

  return {
    content: savedPrimary,
    data: savedPrimary,
    contents: savedContents,
    moduleVersion: nextModuleVersion,
    verification: {
      matched: true,
      sequenceValid: true,
      catalogMatched: true,
      contentId: plan.contentId,
      contentVersion: savedPrimary.contentVersion,
      affectedCount: savedContents.length
    }
  }
}

async function adminSaveTrainingContent(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })
  try {
    const result = await executeAdminTrainingMutation({ ...(event.data || event), operation: 'upsert' }, {
      id: wxContext.OPENID,
      source: 'admin',
      profile: admin.profile
    })
    await writeAuditLog('adminSaveTrainingContent', admin.profile, {
      targetType: 'trainingContent',
      targetId: result.data.contentId,
      payloadSummary: { moduleId: result.data.moduleId, contentVersion: result.data.contentVersion }
    })
    return success({ ...result, profile: admin.profile })
  } catch (error) {
    return fail(error.code || 'TRAINING_CONTENT_SAVE_FAILED', error.message, {
      currentVersion: error.currentVersion || 0
    })
  }
}

async function adminDeleteTrainingContent(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })
  const input = event.data || event
  const operation = input.operation === 'archive' ? 'archive' : 'delete'
  try {
    const result = await executeAdminTrainingMutation({ ...input, operation }, {
      id: wxContext.OPENID,
      source: 'admin',
      profile: admin.profile
    })
    await writeAuditLog(operation === 'archive' ? 'adminArchiveTrainingContent' : 'adminDeleteTrainingContent', admin.profile, {
      targetType: 'trainingContent',
      targetId: result.data.contentId,
      payloadSummary: { moduleId: result.data.moduleId, contentVersion: result.data.contentVersion }
    })
    return success({ ...result, profile: admin.profile })
  } catch (error) {
    return fail(error.code || 'TRAINING_CONTENT_DELETE_FAILED', error.message, {
      currentVersion: error.currentVersion || 0
    })
  }
}

async function adminReorderTrainingContents(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message, { profile: admin.profile })
  const input = event.data || event
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length !== 2) return fail('INVALID_REORDER_ITEMS', '上移或下移必须提交两条相邻内容')
  const first = items[0]
  const second = items[1]
  try {
    const firstRecord = await findUniqueTrainingContentById(String(first.contentId || ''))
    const secondRecord = await findUniqueTrainingContentById(String(second.contentId || ''))
    if (!firstRecord || !secondRecord) return fail('TRAINING_CONTENT_NOT_FOUND', '待排序内容不存在')
    if (getNumericTrainingContentVersion(secondRecord) !== Number(second.expectedVersion)) {
      return fail('CONTENT_VERSION_CONFLICT', '相邻内容已被其他管理员修改，请重新加载后再排序。', {
        contentId: secondRecord.contentId,
        currentVersion: getNumericTrainingContentVersion(secondRecord)
      })
    }
    const moduleId = normalizeLegacyTrainingCategory(input.moduleId || input.category || firstRecord.moduleId || firstRecord.category)
    const moduleRecords = (await fetchAllTrainingContentRecords(moduleId))
      .filter(isAdminTrainingActive)
      .sort((left, right) => Number(left.sortOrder || left.day || 0) - Number(right.sortOrder || right.day || 0))
    const firstIndex = moduleRecords.findIndex(item => item.contentId === firstRecord.contentId)
    const secondIndex = moduleRecords.findIndex(item => item.contentId === secondRecord.contentId)
    if (firstIndex < 0 || secondIndex < 0 || Math.abs(firstIndex - secondIndex) !== 1) {
      return fail('INVALID_REORDER_ITEMS', '只能交换相邻内容')
    }
    const result = await executeAdminTrainingMutation({
      ...firstRecord,
      moduleId,
      operation: 'reorder',
      day: Number(secondRecord.sortOrder),
      sortOrder: Number(secondRecord.sortOrder),
      expectedVersion: first.expectedVersion
    }, { id: wxContext.OPENID, source: 'admin', profile: admin.profile })
    return success({
      contents: result.contents,
      moduleVersion: result.moduleVersion,
      profile: admin.profile
    })
  } catch (error) {
    return fail(error.code || 'TRAINING_CONTENT_REORDER_FAILED', error.message, {
      currentVersion: error.currentVersion || 0
    })
  }
}

async function adminWebUpsertTrainingContent(event) {
  try {
    const input = event.data || event
    return success(await executeAdminTrainingMutation({ ...input, operation: 'upsert' }, {
      id: 'dashboard_web',
      source: 'dashboard_web'
    }))
  } catch (error) {
    return fail(error.code || 'TRAINING_CONTENT_SAVE_FAILED', error.message, {
      currentVersion: error.currentVersion || 0
    })
  }
}

async function adminWebSetTrainingContentStatus(event) {
  try {
    const input = event.data || event
    const status = normalizeAdminTrainingStatus(input.status)
    const operation = status === 'archived' ? 'archive' : 'upsert'
    return success(await executeAdminTrainingMutation({ ...input, status, operation }, {
      id: 'dashboard_web',
      source: 'dashboard_web'
    }))
  } catch (error) {
    return fail(error.code || 'TRAINING_CONTENT_STATUS_FAILED', error.message, {
      currentVersion: error.currentVersion || 0
    })
  }
}

async function adminWebDeleteTrainingContent(event) {
  try {
    const input = event.data || event
    return success(await executeAdminTrainingMutation({ ...input, operation: 'delete' }, {
      id: 'dashboard_web',
      source: 'dashboard_web'
    }))
  } catch (error) {
    return fail(error.code || 'TRAINING_CONTENT_DELETE_FAILED', error.message, {
      currentVersion: error.currentVersion || 0
    })
  }
}

async function adminWebReorderTrainingContents(event) {
  const input = event.data || event
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length !== 2) return fail('INVALID_REORDER_ITEMS', '上移或下移必须提交两条相邻内容')
  try {
    const firstRecord = await findUniqueTrainingContentById(String(items[0].contentId || ''))
    const secondRecord = await findUniqueTrainingContentById(String(items[1].contentId || ''))
    if (!firstRecord || !secondRecord) return fail('TRAINING_CONTENT_NOT_FOUND', '待排序内容不存在')
    const moduleId = normalizeLegacyTrainingCategory(input.moduleId || input.category)
    if (normalizeLegacyTrainingCategory(firstRecord.moduleId || firstRecord.category) !== moduleId || normalizeLegacyTrainingCategory(secondRecord.moduleId || secondRecord.category) !== moduleId) {
      return fail('TRAINING_CONTENT_MODULE_MISMATCH', '待排序内容所属模块不一致')
    }
    const moduleRecords = (await fetchAllTrainingContentRecords(moduleId))
      .filter(isAdminTrainingActive)
      .sort((left, right) => Number(left.sortOrder || left.day || 0) - Number(right.sortOrder || right.day || 0))
    const firstIndex = moduleRecords.findIndex(item => item.contentId === firstRecord.contentId)
    const secondIndex = moduleRecords.findIndex(item => item.contentId === secondRecord.contentId)
    if (firstIndex < 0 || secondIndex < 0 || Math.abs(firstIndex - secondIndex) !== 1) {
      return fail('INVALID_REORDER_ITEMS', '只能交换相邻内容')
    }
    if (getNumericTrainingContentVersion(secondRecord) !== Number(items[1].expectedVersion)) {
      return fail('CONTENT_VERSION_CONFLICT', '相邻内容已被其他管理员修改，请重新加载后再排序。', {
        contentId: secondRecord.contentId,
        currentVersion: getNumericTrainingContentVersion(secondRecord)
      })
    }
    const firstTarget = Number(secondRecord.sortOrder)
    // 使用一次通用重排即可完成相邻交换；第二条会作为受影响记录在同一事务中更新。
    return success(await executeAdminTrainingMutation({
      ...items[0],
      moduleId,
      operation: 'reorder',
      day: firstTarget,
      sortOrder: firstTarget,
      expectedVersion: items[0].expectedVersion
    }, { id: 'dashboard_web', source: 'dashboard_web' }))
  } catch (error) {
    return fail(error.code || 'TRAINING_CONTENT_REORDER_FAILED', error.message, {
      currentVersion: error.currentVersion || 0
    })
  }
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

function getTrainingAccessSummary(access = {}) {
  return {
    isAdmin: access.isAdmin === true,
    role: access.role || '',
    adminSource: access.adminSource || '',
    membershipType: normalizeMembershipType(access.membershipType, 'free'),
    membershipStatus: access.membershipStatus || 'active',
    membershipEndAt: access.membershipEndAt || null,
    phoneBound: access.phoneBound === true,
    hasAdvancedAccess: access.hasAdvancedAccess === true
  }
}

function stripLockedTrainingContent(item = {}) {
  return {
    _id: item._id || '',
    contentId: item.contentId || '',
    category: item.category || '',
    categoryName: item.categoryName || '',
    day: Number(item.day || item.sortOrder || item.dayNumber || 0),
    title: item.title || '',
    author: item.author || '',
    articleCategory: item.articleCategory || '',
    cover: item.cover || item.coverUrl || '',
    status: item.status || '',
    active: item.active !== false,
    visible: item.visible !== false,
    contentVersion: getNumericTrainingContentVersion(item),
    version: getNumericTrainingContentVersion(item),
    moduleVersion: item.moduleVersion || '',
    contentHash: item.contentHash || '',
    isCustom: item.isCustom === true,
    sortOrder: Number(item.sortOrder || item.day || item.dayNumber || 0),
    membershipLevel: resolveSingleItemPolicy(item).effectiveMembershipLevel,
    updatedAt: item.updatedAt || '',
    accessAllowed: false,
    accessReason: 'membership_required',
    requiresMembership: true
  }
}

function stripTrainingContentBody(item = {}) {
  const normalized = normalizeTrainingContentForClient(item)
  const {
    content,
    material,
    promptText,
    text,
    trainingContent,
    richContentHtml,
    ...lightweight
  } = normalized
  return lightweight
}

function resolveTrainingModuleVersion(category, records = []) {
  const digestInput = records
    .map(item => [
      String(item.contentId || '').trim(),
      getNumericTrainingContentVersion(item),
      Number(item.sortOrder || item.day || item.dayNumber || 0),
      String(item.status || '')
    ].join(':'))
    .sort()
    .join('|')
  return `${normalizeLegacyTrainingCategory(category) || 'all'}-${getTrainingContentDigest(digestInput).slice(0, 20)}`
}

async function getTrainingModuleVersion(category, records = []) {
  const normalizedCategory = normalizeLegacyTrainingCategory(category)
  if (normalizedCategory) {
    const metadata = await safeGetById(
      COLLECTIONS.trainingContentModules,
      `module_${normalizedCategory}`
    )
    if (metadata && metadata.moduleVersion) return String(metadata.moduleVersion)
  }
  return resolveTrainingModuleVersion(normalizedCategory, records)
}

function buildInactiveTrainingTombstones(records = [], currentRecords = []) {
  const currentContentIds = new Set(
    currentRecords.map(item => String(item.contentId || '').trim()).filter(isPermanentTrainingContentId)
  )
  const tombstoneMap = new Map()

  records.forEach(item => {
    const contentId = String(item.contentId || '').trim()
    if (!contentId || currentContentIds.has(contentId) || isCurrentTrainingRecord(item)) return
    tombstoneMap.set(contentId, {
      contentId,
      category: normalizeLegacyTrainingCategory(item.category),
      day: getTrainingDay(item),
      status: 'deleted',
      active: false,
      visible: false,
      isDeletedTombstone: true,
      membershipLevel: resolveSingleItemPolicy(item).effectiveMembershipLevel
    })
  })

  return Array.from(tombstoneMap.values())
}

function trainingContentsFallback(message, membershipType = 'free', access = null) {
  return success({
    source: 'local_fallback',
    contents: [],
    // 保留 data 字段，兼容尚未更新的前端版本。
    data: [],
    message,
    membershipType,
    access: access ? getTrainingAccessSummary(access) : null
  })
}

function normalizeTrainingContentForClient(item = {}) {
  if (item.contentId && TRAINING_CONFIG_CATEGORIES.includes(item.category)) {
    return sanitizeTrainingConfigItem(item)
  }
  return item
}

function normalizeTrainingLookupCategory(value) {
  return normalizeLegacyTrainingCategory(value)
}

async function resolveDetailItemPolicy(requestedContentId, requestedCategory, item, wxContext) {
  // 从该分类的所有 active 内容中计算目标文章在排序列表中的位置。
  // 无法获取列表时 fail-closed 为 member。
  try {
    const rawContents = await fetchAllTrainingContentRecords(requestedCategory)
    const preferredContents = selectPreferredCurrentTrainingRecords(rawContents)
    const policyItems = computeModuleAccessPolicy(preferredContents)
    const targetContentId = requirePermanentTrainingContentId(requestedContentId)
    const match = policyItems.find(p =>
      String(p.contentId || '').trim() === targetContentId
    )
    if (match) {
      return {
        policyPosition: match.policyPosition,
        effectiveMembershipLevel: match.effectiveMembershipLevel,
        requiresMembership: match.requiresMembership,
        accessPolicyVersion: match.accessPolicyVersion
      }
    }
  } catch (_) { /* fall through to fail-closed */ }
  return resolveSingleItemPolicy({})
}

async function fetchAllTrainingContentRecords(category = '') {
  const records = []
  const pageSize = 100
  const moduleId = normalizeLegacyTrainingCategory(category)
  for (let page = 0; page < 100; page += 1) {
    const query = category
      ? db.collection(COLLECTIONS.trainingContents).where({ moduleId })
      : db.collection(COLLECTIONS.trainingContents)
    const result = await query.orderBy('_id', 'asc').skip(page * pageSize).limit(pageSize).get()
    const rows = Array.isArray(result.data) ? result.data : []
    records.push(...rows)
    if (rows.length < pageSize) return records
  }
  throw Object.assign(new Error('trainingContents 超过安全分页上限'), { code: 'TRAINING_CONTENTS_PAGE_LIMIT' })
}

async function getTrainingContentById(event, wxContext) {
  let contentId = ''
  try {
    contentId = requirePermanentTrainingContentId(event.contentId)
  } catch (error) {
    return fail(error.code || 'INVALID_PERMANENT_CONTENT_ID', error.message)
  }

  console.log('[getTrainingContentById] request:', { contentId })

  try {
    const result = await db.collection(COLLECTIONS.trainingContents)
      .where({ contentId })
      .limit(2)
      .get()
    const matches = result.data || []
    if (matches.length > 1) {
      return fail('DUPLICATE_PERMANENT_CONTENT_ID', '云端存在重复永久 contentId，请稍后重试。')
    }
    const item = matches[0] || null
    // Verify exact match — never return a different article
    if (item && String(item.contentId || '').trim() !== contentId) {
      console.error('[getTrainingContentById] ID mismatch:', { requested: contentId, returned: item.contentId })
      return fail('TRAINING_CONTENT_ID_MISMATCH', '训练内容 ID 不一致，请刷新后重试')
    }

    if (!item) {
      return success({ source: 'cloud', found: false, code: 'content_not_found', contentId, content: null,
        message: '内容同步中或暂时无法获取。' })
    }

    if (!isCurrentTrainingRecord(item)) {
      return success({
        source: 'cloud',
        found: true,
        code: 'content_inactive',
        contentId,
        moduleId: normalizeLegacyTrainingCategory(item.moduleId || item.category),
        day: Number(item.day || item.sortOrder || 0),
        sortOrder: Number(item.sortOrder || item.day || 0),
        status: String(item.status || 'inactive'),
        content: null,
        message: '该训练内容已下架。'
      })
    }
    if (!hasTrainingBody(item)) {
      console.error('[getTrainingContentById] active content has empty body:', { contentId })
      return fail('TRAINING_CONTENT_BODY_EMPTY', '训练正文同步异常，请稍后重试。')
    }

    const access = await getCurrentAccess(wxContext.OPENID || '')
    const requestedModuleId = normalizeLegacyTrainingCategory(item.moduleId || item.category)
    const detailPolicy = await resolveDetailItemPolicy(contentId, requestedModuleId, item, wxContext)
    const membershipLevel = detailPolicy.effectiveMembershipLevel
    const accessResult = canAccessTrainingContent({ user: access.user, access, content: { ...item, ...detailPolicy } })

    if (!accessResult.allowed) {
      return fail(accessResult.reason === 'content_inactive' ? 'content_inactive' : 'membership_required',
        accessResult.reason === 'content_inactive' ? '该训练内容已下架。' : '该训练为会员内容，开通会员后即可练习。',
        { membershipLevel, policyPosition: detailPolicy.policyPosition, access: getTrainingAccessSummary(access) })
    }

    const content = { ...sanitizeTrainingConfigItem(item),
      day: toDisplayTrainingPosition(detailPolicy.policyPosition),
      sortOrder: toDisplayTrainingPosition(detailPolicy.policyPosition),
      membershipLevel,
      effectiveMembershipLevel: detailPolicy.effectiveMembershipLevel,
      policyPosition: detailPolicy.policyPosition, requiresMembership: detailPolicy.requiresMembership,
      accessPolicyVersion: detailPolicy.accessPolicyVersion }

    return success({ source: 'cloud', found: true, archived: false,
      content, access: getTrainingAccessSummary(access), accessResult })
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return success({
        source: 'local_fallback',
        found: false,
        code: 'content_not_found',
        content: null,
        requestedContentId: contentId,
        message: '内容同步中或暂时无法获取。'
      })
    }
    console.error('[getTrainingContentById] failed:', {
      contentId,
      code: error && (error.code || error.errCode) || '',
      message: error && (error.message || error.errMsg) || ''
    })
    return fail('TRAINING_CONTENT_QUERY_FAILED', '训练内容读取失败，请稍后重试。', {
      debugCode: error && (error.code || error.errCode) || '',
      debugMessage: error && (error.message || error.errMsg) || ''
    })
  }
}

async function getTrainingContents(event, wxContext) {
  let effectiveMembership = 'free'
  let currentAccess = null

  try {
    // 权益只信任当前 openid 的云端身份，客户端传入的会员声明不参与授权。
    const access = await getCurrentAccess(wxContext.OPENID || '')
    currentAccess = access
    effectiveMembership = normalizeMembershipType(access.membershipType, 'free')
    const requestedLevel = String(event.membershipLevel || '').trim()
    if (requestedLevel && !TRAINING_CONTENT_MEMBERSHIP_LEVELS.includes(requestedLevel)) {
      return fail('INVALID_MEMBERSHIP_LEVEL', '会员权限筛选不正确')
    }
    const requestedCategory = normalizeLegacyTrainingCategory(event.category)
    const requestedTrainingType = String(event.trainingType || '').trim()
    const page = Math.max(Number(event.page || 1), 1)
    const pageSize = Math.min(Math.max(Number(event.pageSize || 50), 1), 80)
    const offset = (page - 1) * pageSize
    const rawContents = await fetchAllTrainingContentRecords(requestedCategory)
    const preferredContents = selectPreferredCurrentTrainingRecords(rawContents)
    const tombstones = buildInactiveTrainingTombstones(rawContents, preferredContents)

    // —— 模块级权限计算：按 sortOrder 排序后的位置决定每篇的 effectiveMembershipLevel ——
    const policyItems = computeModuleAccessPolicy(preferredContents)

    const allContents = policyItems
      .filter(item => {
        if (requestedCategory && normalizeLegacyTrainingCategory(item.category) !== requestedCategory) return false
        if (requestedTrainingType && item.trainingType !== requestedTrainingType) return false
        if (requestedLevel && item.effectiveMembershipLevel !== requestedLevel) return false
        return true
      })
      .map(item => {
        const normalizedItem = {
          ...stripTrainingContentBody(item),
          contentId: String(item.contentId || '').trim(),
          // 学员端继续使用连续 Day；真实持久化排序值只在管理端展示。
          day: toDisplayTrainingPosition(item.policyPosition),
          sortOrder: toDisplayTrainingPosition(item.policyPosition),
          // 使用模块位置计算的 effectiveMembershipLevel，不使用存储的 membershipLevel
          membershipLevel: item.effectiveMembershipLevel,
          policyPosition: item.policyPosition,
          effectiveMembershipLevel: item.effectiveMembershipLevel,
          requiresMembership: item.requiresMembership,
          accessPolicyVersion: item.accessPolicyVersion
        }
        const accessResult = canAccessTrainingContent({
          user: access.user,
          access,
          content: normalizedItem
        })
        return accessResult.allowed
          ? {
            ...normalizedItem,
            accessAllowed: true,
            accessReason: accessResult.reason,
            requiresMembership: accessResult.requiresMembership
          }
          : stripLockedTrainingContent(normalizedItem)
      })
      .sort((a, b) => {
        return Number(a.policyPosition ?? a.sortOrder ?? 0) - Number(b.policyPosition ?? b.sortOrder ?? 0)
      })
    const contents = allContents.slice(offset, offset + pageSize)
    const moduleVersion = await getTrainingModuleVersion(requestedCategory, preferredContents)

    if (!rawContents.length && page === 1) {
      return trainingContentsFallback('trainingContents empty, use local fallback', effectiveMembership, access)
    }

    console.log('[getTrainingContents] result:', {
      category: requestedCategory,
      rawCount: rawContents.length,
      currentCount: preferredContents.length,
      accessibleCount: allContents.filter(item => item.accessAllowed === true).length,
      lockedCount: allContents.filter(item => item.accessAllowed === false).length,
      tombstoneCount: tombstones.length,
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
      moduleVersion,
      membershipType: effectiveMembership,
      access: getTrainingAccessSummary(access),
      tombstones: page === 1 ? tombstones : [],
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
    return trainingContentsFallback('trainingContents unavailable, use local fallback', effectiveMembership, currentAccess)
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

  try {
    const outcome = await db.runTransaction(async transaction => {
      const orders = transaction.collection(COLLECTIONS.virtualPaymentOrders)
      const users = transaction.collection(COLLECTIONS.users)
      const entitlements = transaction.collection(COLLECTIONS.phoneEntitlements)
      const orderResult = await orders.doc(order._id).get()
      const currentOrder = orderResult.data || null
      if (!currentOrder) throw Object.assign(new Error('支付订单不存在。'), { code: 'ORDER_NOT_FOUND' })
      if (currentOrder.status === 'fulfilled' && currentOrder.fulfilledAt) {
        return {
          status: 'fulfilled',
          orderNo: currentOrder.orderNo,
          fulfilledAt: currentOrder.fulfilledAt,
          membershipType: currentOrder.membershipType,
          membershipEndAt: currentOrder.membershipEndAt || ''
        }
      }
      if (currentOrder.status !== 'paid') {
        throw Object.assign(new Error('订单尚未确认支付，暂不能发放会员权益。'), {
          code: 'ORDER_NOT_PAID'
        })
      }

      const product = getMembershipProduct(currentOrder.productId)
      if (!product || product.membershipType !== currentOrder.membershipType) {
        throw Object.assign(new Error('订单商品配置不一致'), { code: 'ORDER_PRODUCT_MISMATCH' })
      }
      if (
        Number(currentOrder.priceFen) !== product.priceFen ||
        Number(currentOrder.durationDays) !== product.durationDays
      ) {
        throw Object.assign(new Error('订单商品价格或有效期与服务端配置不一致'), {
          code: 'ORDER_PRICE_MISMATCH'
        })
      }
      const phone = normalizePhone(currentOrder.phone)
      if (!/^1\d{10}$/.test(phone)) {
        throw Object.assign(new Error('订单手机号无效'), { code: 'ORDER_PHONE_INVALID' })
      }

      const userResult = await users.where({ openid: currentOrder.openid }).limit(1).get()
      const paymentUser = userResult.data && userResult.data[0] || null
      if (
        !paymentUser ||
        paymentUser.phoneBound !== true ||
        normalizePhone(paymentUser.phone) !== phone
      ) {
        throw Object.assign(new Error('订单手机号与当前可信绑定不一致，请联系管理员处理。'), {
          code: 'PAYMENT_PHONE_BINDING_MISMATCH'
        })
      }

      const entitlementResult = await entitlements
        .where(_.or([{ phone }, { phoneNormalized: phone }]))
        .limit(20)
        .get()
      const entitlementRecords = (entitlementResult.data || [])
        .filter(item => item.historyArchive !== true)
      const pendingPreauthorization = entitlementRecords.find(item =>
        String(item.entitlementKind || '') === PREAUTH_KIND &&
        derivePreauthStatus(item, Date.now()) === 'pending'
      )
      if (pendingPreauthorization) {
        throw Object.assign(new Error('待注册授权尚未完成安全领取，请稍后重试'), {
          code: 'PREAUTH_PENDING_REQUIRES_CLAIM'
        })
      }
      const directRecords = entitlementRecords.filter(isDirectPhoneEntitlement)
      const idempotentRecord = directRecords.find(item => item.latestPaymentOrderNo === currentOrder.orderNo) || null
      const old = idempotentRecord || directRecords
        .filter(item => !isScheduledMembershipRecord(item))
        .sort((left, right) => {
          const priority = item => {
            if (['disabled', 'deleted'].includes(String(item.status || 'active'))) return 0
            if (normalizeMembershipType(item.membershipType, 'free') === 'admin') return 6
            if (isActiveMembershipRecord(item)) return 5
            if (isScheduledMembershipRecord(item)) return 4
            if (String(item.preauthStatus || '') === 'claimed') return 2
            if (String(item.preauthStatus || '') === 'pending') return 1
            return String(item.status || 'active') === 'active' ? 3 : 0
          }
          const rank = priority(right) - priority(left)
          return rank || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
        })[0] || null

      const alreadyApplied = old && old.latestPaymentOrderNo === currentOrder.orderNo
      const activeMembershipRecords = [paymentUser]
        .concat(entitlementRecords)
        .filter(item => isActiveMembershipRecord(item))
      const currentMembership = activeMembershipRecords.slice(1).reduce(
        (current, candidate) => mergeClaimedMembership(current, candidate, Date.now()),
        activeMembershipRecords[0] || buildMembershipProfile('free')
      )
      const effectiveOldType = normalizeMembershipType(currentMembership.membershipType, 'free')
      const keepYearly = effectiveOldType === 'yearly' && product.membershipType === 'monthly'
      const membershipType = effectiveOldType === 'admin'
        ? 'admin'
        : (keepYearly ? 'yearly' : product.membershipType)
      const effectiveEndAt = normalizeDateOnly(currentMembership.membershipEndAt)
      const baseDate = effectiveEndAt && !isExpired(effectiveEndAt) ? effectiveEndAt : today()
      const membershipEndAt = alreadyApplied
        ? (effectiveEndAt || null)
        : (membershipType === 'admin' ? null : addDays(baseDate, product.durationDays))
      const effectiveStartAt = normalizeDateOnly(currentMembership.membershipStartAt)
      const membershipStartAt = membershipType === 'admin'
        ? (effectiveStartAt || today())
        : (effectiveStartAt && effectiveStartAt < today() ? effectiveStartAt : today())
      const limits = getMembershipLimits(membershipType)
      const fulfilledAt = now()
      const entitlementData = {
        name: (old && old.name) || paymentUser.nickname || '',
        phone,
        phoneNormalized: phone,
        phoneMasked: maskPhone(phone),
        className: (old && old.className) || '',
        remark: (old && old.remark) || '小程序虚拟支付开通',
        membershipType,
        membershipLabel: MEMBERSHIP_LABELS[membershipType],
        membershipStatus: 'active',
        membershipStartAt,
        membershipEndAt,
        role: membershipType === 'admin' ? 'admin' : 'user',
        isAdmin: membershipType === 'admin',
        aiDailyLimit: limits.aiDailyLimit,
        aiMonthlyLimit: limits.aiMonthlyLimit,
        status: 'active',
        source: 'wechat_virtual_payment',
        latestPaymentOrderNo: currentOrder.orderNo,
        updatedAt: fulfilledAt,
        updatedBy: 'virtual_payment'
      }

      if (!alreadyApplied) {
        if (old) {
          await entitlements.doc(old._id).update({ data: entitlementData })
        } else {
          await entitlements.add({
            data: { ...entitlementData, createdAt: fulfilledAt, createdBy: 'virtual_payment' }
          })
        }
      }
      await users.doc(paymentUser._id).update({
        data: {
          membershipType,
          membershipStatus: 'active',
          membershipStartAt,
          membershipEndAt,
          role: membershipType === 'admin' ? 'admin' : 'user',
          isAdmin: membershipType === 'admin',
          aiDailyLimit: limits.aiDailyLimit,
          aiMonthlyLimit: limits.aiMonthlyLimit,
          membershipSource: 'wechat_virtual_payment',
          latestPaymentOrderNo: currentOrder.orderNo,
          updatedAt: fulfilledAt
        }
      })
      await orders.doc(currentOrder._id).update({
        data: {
          status: 'fulfilled',
          fulfillmentState: 'completed',
          membershipEndAt,
          fulfilledAt,
          failReason: '',
          updatedAt: fulfilledAt
        }
      })
      return {
        status: 'fulfilled',
        orderNo: currentOrder.orderNo,
        fulfilledAt,
        membershipType,
        membershipEndAt
      }
    })
    return success(outcome)
  } catch (error) {
    try {
      await db.runTransaction(async transaction => {
        const orders = transaction.collection(COLLECTIONS.virtualPaymentOrders)
        const latestResult = await orders.doc(order._id).get()
        const latestOrder = latestResult.data || null
        // 另一个并发请求可能已经完成履约，失败回写不得把 fulfilled 倒退为 paid。
        if (!latestOrder || latestOrder.status === 'fulfilled') return
        await orders.doc(order._id).update({
          data: {
            status: 'paid',
            fulfillmentState: 'idle',
            fulfillmentErrorCode: error.code || 'MEMBERSHIP_FULFILLMENT_FAILED',
            failReason: error.message || '会员权益发放失败',
            updatedAt: now()
          }
        })
      })
    } catch (stateError) {
      console.warn('[virtual-payment-server] preserve fulfillment error state failed:', {
        code: stateError && stateError.code || '',
        message: stateError && stateError.message || ''
      })
    }
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

// ====== 新用户注册报表 ======

function buildRegistrationReport(total, phoneAuthorized, wechatCount, customCount, rangeLabel) {
  const phoneUnauthorized = Math.max(total - phoneAuthorized, 0)
  return {
    rangeLabel,
    total,
    phoneAuthorized,
    phoneUnauthorized,
    phoneAuthorizationRate: total > 0 ? Math.round((phoneAuthorized / total) * 1000) / 10 : 0,
    byNicknameSource: {
      wechat: wechatCount,
      custom: customCount,
      random: Math.max(total - wechatCount - customCount, 0)
    }
  }
}

function registrationRangeWhere(range) {
  return { registeredAt: _.gte(range.startAt).and(_.lt(range.endAt)) }
}

function registrationRangeAndField(range, field, value) {
  return { ...registrationRangeWhere(range), [field]: value }
}

async function queryRegistrationCounts(range) {
  const [total, phoneAuthorized, wechat, custom] = await Promise.all([
    db.collection(COLLECTIONS.users).where(registrationRangeWhere(range)).count(),
    db.collection(COLLECTIONS.users).where(registrationRangeAndField(range, 'phoneBound', true)).count(),
    db.collection(COLLECTIONS.users).where(registrationRangeAndField(range, 'nicknameSource', 'wechat')).count(),
    db.collection(COLLECTIONS.users).where(registrationRangeAndField(range, 'nicknameSource', 'custom')).count()
  ])
  return {
    total: Number(total.total || 0),
    phoneAuthorized: Number(phoneAuthorized.total || 0),
    wechat: Number(wechat.total || 0),
    custom: Number(custom.total || 0)
  }
}

function mapRegistrationUser(user, showFullPhone) {
  return {
    userId: String(user._id || '').slice(-8),
    nickname: user.nickname || '',
    nicknameSource: user.nicknameSource || 'default',
    phoneMasked: user.phoneMasked || '',
    phone: showFullPhone ? (user.phone || '') : '',
    hasPhone: user.phoneBound === true,
    registeredAt: user.registeredAt || user.createdAt || '',
    profileCompleted: user.profileCompleted === true
  }
}

async function adminGetDailyRegistrationReport(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)

  const date = String(event.date || '').trim()
  if (!date) return fail('INVALID_DATE', '日期不能为空')
  // 完整手机号仅 super_admin 可查看
  const showFullPhone = event.showFullPhone === true && admin.profile.role === 'super_admin'

  try {
    const range = getDateRange(date)
    const [counts, result] = await Promise.all([
      queryRegistrationCounts(range),
      db.collection(COLLECTIONS.users)
        .where(registrationRangeWhere(range))
        .field(buildRegistrationProjection(showFullPhone))
        .orderBy('registeredAt', 'desc')
        .limit(500)
        .get()
    ])
    const users = (result.data || []).map(user => mapRegistrationUser(user, showFullPhone))
    const report = buildRegistrationReport(
      counts.total,
      counts.phoneAuthorized,
      counts.wechat,
      counts.custom,
      date
    )

    return success({
      date,
      total: report.total,
      count: report.total,
      phoneAuthorized: report.phoneAuthorized,
      phoneUnauthorized: report.phoneUnauthorized,
      phoneAuthorizationRate: report.phoneAuthorizationRate,
      byNicknameSource: report.byNicknameSource,
      users,
      listTruncated: report.total > users.length,
      profile: admin.profile
    })
  } catch (error) {
    console.error('[adminGetDailyRegistrationReport] error:', {
      code: error && error.code || '',
      message: error && error.message || String(error)
    })
    return fail('REPORT_QUERY_FAILED', '注册报表查询失败')
  }
}

async function adminGetWeeklyRegistrationReport(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)

  const weekStart = String(event.weekStart || '').trim()
  if (!weekStart) return fail('INVALID_DATE', '周开始日期不能为空')
  const showFullPhone = event.showFullPhone === true && admin.profile.role === 'super_admin'

  try {
    const range = getWeekRange(weekStart)
    const dailyRanges = Array.from({ length: 7 }, (_, index) => {
      const date = addDateDays(weekStart, index)
      return { date, ...getDateRange(date) }
    })
    const [counts, result, prevResult, dailyCounts] = await Promise.all([
      queryRegistrationCounts(range),
      db.collection(COLLECTIONS.users)
        .where(registrationRangeWhere(range))
        .field(buildRegistrationProjection(showFullPhone))
        .orderBy('registeredAt', 'desc')
        .limit(500)
        .get(),
      db.collection(COLLECTIONS.users)
        .where({ registeredAt: _.gte(range.prevStartAt).and(_.lt(range.startAt)) })
        .count(),
      Promise.all(dailyRanges.map(dayRange =>
        db.collection(COLLECTIONS.users).where(registrationRangeWhere(dayRange)).count()
      ))
    ])
    const users = (result.data || []).map(user => mapRegistrationUser(user, showFullPhone))
    const prevWeekCount = Number(prevResult.total || 0)
    const weekOverWeekChange = prevWeekCount > 0
      ? Math.round(((counts.total - prevWeekCount) / prevWeekCount) * 1000) / 10
      : (counts.total > 0 ? 100 : 0)
    const dailyTrend = dailyRanges.map((dayRange, index) => ({
      date: dayRange.date,
      count: Number(dailyCounts[index].total || 0)
    }))
    const weekEnd = addDateDays(weekStart, 6)
    const report = buildRegistrationReport(
      counts.total,
      counts.phoneAuthorized,
      counts.wechat,
      counts.custom,
      `${weekStart} ~ ${weekEnd}`
    )
    const isoWeek = getISOWeekNumber(weekStart)

    return success({
      weekStart,
      weekEnd,
      weekLabel: `${weekStart} ~ ${weekEnd}`,
      isoWeek,
      total: report.total,
      count: report.total,
      phoneAuthorized: report.phoneAuthorized,
      phoneUnauthorized: report.phoneUnauthorized,
      phoneAuthorizationRate: report.phoneAuthorizationRate,
      byNicknameSource: report.byNicknameSource,
      prevWeekCount,
      weekOverWeekChange,
      dailyTrend,
      users,
      listTruncated: report.total > users.length,
      profile: admin.profile
    })
  } catch (error) {
    console.error('[adminGetWeeklyRegistrationReport] error:', {
      code: error && error.code || '',
      message: error && error.message || String(error)
    })
    return fail('REPORT_QUERY_FAILED', '周报查询失败')
  }
}

async function adminRegenerateRegistrationReport(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)

  const date = String(event.date || '').trim()
  const type = String(event.type || 'daily').trim()
  if (!date) return fail('INVALID_DATE', '日期不能为空')
  if (!['daily', 'weekly'].includes(type)) return fail('INVALID_TYPE', 'type 必须为 daily 或 weekly')

  try {
    let reportData
    let reportId

    if (type === 'daily') {
      const result = await adminGetDailyRegistrationReport(
        { ...event, date, showFullPhone: false }, wxContext
      )
      if (!result.success) return result
      reportData = result
      reportId = `daily:${date}`
    } else {
      const result = await adminGetWeeklyRegistrationReport(
        { ...event, weekStart: date, showFullPhone: false }, wxContext
      )
      if (!result.success) return result
      reportData = result
      reportId = `weekly:${getISOWeekNumber(date)}`
    }

    const snapshot = {
      reportId,
      reportType: type,
      date,
      statistics: {
        total: reportData.total || 0,
        phoneAuthorized: reportData.phoneAuthorized || 0,
        phoneUnauthorized: reportData.phoneUnauthorized || 0,
        phoneAuthorizationRate: reportData.phoneAuthorizationRate || 0,
        byNicknameSource: reportData.byNicknameSource || {}
      },
      userIds: (reportData.users || []).map(u => u.userId),
      generatedAt: now(),
      reportVersion: 1,
      generatedBy: wxContext.OPENID || ''
    }

    const existing = await safeGetOne(COLLECTIONS.userRegistrationReports, { reportId })
    if (existing) {
      await db.collection(COLLECTIONS.userRegistrationReports).doc(existing._id).update({
        data: {
          ...snapshot,
          reportVersion: (existing.reportVersion || 1) + 1,
          createdAt: existing.createdAt || snapshot.generatedAt
        }
      })
    } else {
      await db.collection(COLLECTIONS.userRegistrationReports).add({
        data: { ...snapshot, createdAt: snapshot.generatedAt }
      })
    }

    return success({
      reportId,
      regenerated: true,
      snapshot,
      profile: admin.profile
    })
  } catch (error) {
    console.error('[adminRegenerateRegistrationReport] error:', error && error.message)
    return fail('REPORT_GENERATION_FAILED', '报表生成失败')
  }
}

async function adminExportRegistrationReport(event, wxContext) {
  const admin = await requireAdmin(wxContext.OPENID, ['super_admin', 'admin'])
  if (!admin.ok) return fail(admin.code, admin.message)

  const date = String(event.date || '').trim()
  const type = String(event.type || 'daily').trim()
  if (!date) return fail('INVALID_DATE', '日期不能为空')

  try {
    let report
    if (type === 'daily') {
      report = await adminGetDailyRegistrationReport({ date, showFullPhone: false }, wxContext)
    } else {
      report = await adminGetWeeklyRegistrationReport({ weekStart: date, showFullPhone: false }, wxContext)
    }
    if (!report.success) return report

    // 构建 CSV（不含完整手机号，除非管理员明确请求）
    // CSV 防公式注入：以 = + - @ 开头的单元格添加单引号前缀
    function safeCsvCell(value) {
      const str = String(value == null ? '' : value)
      if (/^[=+\-@\t\r]/.test(str)) return `'${str}`
      if (/[\n\r",]/.test(str)) return `"${str.replace(/"/g, '""')}"`
      return str
    }
    const users = report.users || []
    const header = '注册时间,用户名,用户名来源,手机号,手机号状态,用户ID'
    const rows = users.map(u =>
      [u.registeredAt, u.nickname, u.nicknameSource, u.phoneMasked, u.hasPhone ? '已授权' : '未授权', u.userId].map(safeCsvCell).join(',')
    )
    const csv = [header, ...rows].join('\n')

    return success({
      date,
      type,
      csv,
      count: users.length,
      profile: admin.profile
    })
  } catch (error) {
    console.error('[adminExportRegistrationReport] error:', error && error.message)
    return fail('EXPORT_FAILED', '报表导出失败')
  }
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
      case 'updateMyProfile':
        return await updateMyProfile(event, wxContext)
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
      case 'adminUserOverview':
        return await userMembershipAdminService.adminUserOverview(event, wxContext)
      case 'adminListUsers':
        return await userMembershipAdminService.adminListUsers(event, wxContext)
      case 'adminListPreRegistrationEntitlements':
        return await userMembershipAdminService.adminListPreRegistrationEntitlements(event, wxContext)
      case 'adminSavePreRegistrationEntitlement':
        return await userMembershipAdminService.adminSavePreRegistrationEntitlement(event, wxContext)
      case 'adminRevokePreRegistrationEntitlement':
        return await userMembershipAdminService.adminRevokePreRegistrationEntitlement(event, wxContext)
      case 'adminGetUserDetail':
        return await userMembershipAdminService.adminGetUserDetail(event, wxContext)
      case 'adminAddMembership':
        return await userMembershipAdminService.adminAddMembership(event, wxContext)
      case 'adminUpdateMembership':
      case 'adminUpdateUserMembership':
        return await userMembershipAdminService.adminUpdateUserMembership(event, wxContext)
      case 'adminRevenueOverview':
        return await userMembershipAdminService.adminRevenueOverview(event, wxContext)
      case 'adminRevenueTrend':
        return await userMembershipAdminService.adminRevenueTrend(event, wxContext)
      case 'adminExportUsersCsv':
        return await userMembershipAdminService.adminExportUsersCsv(event, wxContext)
      case 'adminExportPreRegistrationCsv':
        return await userMembershipAdminService.adminExportPreRegistrationCsv(event, wxContext)
      case 'adminGenerateOperationsPdf':
        return await userMembershipAdminService.adminGenerateOperationsPdf(event, wxContext)
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
      case 'adminReorderTrainingContents':
        return await adminReorderTrainingContents(event, wxContext)
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
        return await adminWebSetTrainingContentStatus({ ...event, data: { ...(event.data || {}), status: 'active' } })
      case 'adminWebDisableTrainingContent':
        return await adminWebSetTrainingContentStatus({ ...event, data: { ...(event.data || {}), status: 'inactive' } })
      case 'adminWebArchiveTrainingContent':
        return await adminWebSetTrainingContentStatus({ ...event, data: { ...(event.data || {}), status: 'archived' } })
      case 'adminWebSetTrainingContentStatus':
        return await adminWebSetTrainingContentStatus(event)
      case 'adminWebDeleteTrainingContent':
        return await adminWebDeleteTrainingContent(event)
      case 'adminWebReorderTrainingContents':
        return await adminWebReorderTrainingContents(event)
      case 'getAppContentConfigs':
        return await getAppContentConfigs(event)
      case 'getTrainingContents':
        return await getTrainingContents(event, wxContext)
      case 'getTrainingContentById':
      case 'getTrainingContentByContentId':
        return await getTrainingContentById(event, wxContext)
      case 'adminGetDailyRegistrationReport':
        return await adminGetDailyRegistrationReport(event, wxContext)
      case 'adminGetWeeklyRegistrationReport':
        return await adminGetWeeklyRegistrationReport(event, wxContext)
      case 'adminRegenerateRegistrationReport':
        return await adminRegenerateRegistrationReport(event, wxContext)
      case 'adminExportRegistrationReport':
        return await adminExportRegistrationReport(event, wxContext)
      default:
        return fail('unknown_action', `未知 action：${action}`)
    }
  } catch (err) {
    console.error('[cloudApi] error:', err)
    return fail('server_error', '云函数执行失败，请稍后重试。')
  }
}
