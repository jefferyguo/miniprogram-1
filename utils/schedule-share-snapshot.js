// 如需不依赖分享 query 中的 snapshotUrl，请在云存储 schedule-share 目录开放公开读后，
// 把公开 HTTPS 基础地址配置到这里，例如：https://example.com
const SNAPSHOT_PUBLIC_BASE_URL = 'https://636c-cloud1-d0geb9qt9d29ee6fc-1444235610.tcb.qcloud.la'

const SNAPSHOT_PUBLIC_URLS = {
  adult: '',
  college: ''
}

const SNAPSHOT_PATHS = {
  adult: 'schedule-share/weekly-schedule-share-adult.json',
  college: 'schedule-share/weekly-schedule-share-college.json'
}

function normalizeScheduleType(value) {
  return value === 'college' ? 'college' : 'adult'
}

function getDefaultTitle(scheduleType) {
  return normalizeScheduleType(scheduleType) === 'college' ? '大学生课表' : '成人课表'
}

function safeText(value) {
  return String(value || '').trim()
}

function decodeMaybe(value) {
  const text = safeText(value)
  if (!text) return ''
  try {
    return decodeURIComponent(text)
  } catch (error) {
    return text
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function joinUrl(base, path) {
  const cleanBase = String(base || '').replace(/\/+$/, '')
  const cleanPath = String(path || '').replace(/^\/+/, '')
  return cleanBase && cleanPath ? `${cleanBase}/${cleanPath}` : ''
}

function getScheduleShareSnapshotPath(scheduleType = 'adult') {
  return SNAPSHOT_PATHS[normalizeScheduleType(scheduleType)]
}

function getScheduleShareSnapshotUrl(scheduleType = 'adult', options = {}) {
  const normalizedType = normalizeScheduleType(scheduleType)
  const directUrl = decodeMaybe(options.snapshotUrl || options.shareSnapshotUrl || '')
  if (isHttpUrl(directUrl)) return directUrl

  const configuredUrl = safeText(SNAPSHOT_PUBLIC_URLS[normalizedType])
  if (isHttpUrl(configuredUrl)) return configuredUrl

  if (SNAPSHOT_PUBLIC_BASE_URL) {
    return joinUrl(SNAPSHOT_PUBLIC_BASE_URL, SNAPSHOT_PATHS[normalizedType])
  }

  return ''
}

function normalizeCourse(course = {}) {
  const source = course && typeof course === 'object' ? course : {}
  const startTime = safeText(source.startTime)
  const endTime = safeText(source.endTime)
  const time = startTime || endTime
    ? [startTime, endTime].filter(Boolean).join('-')
    : safeText(source.time)
  const courseName = safeText(source.courseName || source.courseTitle)
  const targetAudience = safeText(source.targetAudience || source.audience)
  const content = safeText(source.content || source.description || source.courseGoal || source.goal)
  const remark = safeText(source.remark || source.note)

  return {
    date: safeText(source.date),
    weekday: safeText(source.weekday),
    startTime,
    endTime,
    time,
    courseName,
    courseTitle: courseName,
    targetAudience,
    audience: targetAudience,
    content,
    description: content,
    remark,
    note: remark
  }
}

function normalizeScheduleSnapshot(data, fallbackType = 'adult') {
  const source = data && data.data && typeof data.data === 'object' ? data.data : data
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null

  const scheduleType = normalizeScheduleType(source.scheduleType || fallbackType)
  const courses = Array.isArray(source.courses)
    ? source.courses.map(normalizeCourse).filter(course => course.courseName || course.date || course.time || course.content)
    : []

  return {
    version: Number(source.version || 1),
    scheduleType,
    title: safeText(source.title) || getDefaultTitle(scheduleType),
    weekLabel: safeText(source.weekLabel),
    startDate: safeText(source.startDate),
    endDate: safeText(source.endDate),
    summary: safeText(source.summary),
    marqueeText: safeText(source.marqueeText),
    updatedAt: source.updatedAt || '',
    courses
  }
}

function requestSnapshotJson(url) {
  return new Promise((resolve, reject) => {
    if (!isHttpUrl(url)) {
      const error = new Error('课表快照地址未配置')
      error.code = 'SNAPSHOT_URL_NOT_CONFIGURED'
      reject(error)
      return
    }

    wx.request({
      url,
      method: 'GET',
      dataType: 'json',
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`课表快照请求失败：${res.statusCode}`)
          error.code = 'SNAPSHOT_HTTP_ERROR'
          error.statusCode = res.statusCode
          reject(error)
          return
        }

        if (typeof res.data === 'string') {
          try {
            resolve(JSON.parse(res.data))
          } catch (error) {
            error.code = 'SNAPSHOT_JSON_PARSE_FAILED'
            reject(error)
          }
          return
        }

        resolve(res.data)
      },
      fail(error) {
        const err = new Error(error && error.errMsg || '课表快照请求失败')
        err.code = 'SNAPSHOT_REQUEST_FAILED'
        err.raw = error
        reject(err)
      }
    })
  })
}

async function fetchScheduleShareSnapshot(scheduleType = 'adult', options = {}) {
  const normalizedType = normalizeScheduleType(scheduleType)
  const url = getScheduleShareSnapshotUrl(normalizedType, options)
  const raw = await requestSnapshotJson(url)
  const snapshot = normalizeScheduleSnapshot(raw, normalizedType)

  if (!snapshot) {
    const error = new Error('课表快照内容格式不正确')
    error.code = 'SNAPSHOT_INVALID'
    throw error
  }

  return {
    snapshot,
    url
  }
}

module.exports = {
  SNAPSHOT_PATHS,
  getScheduleShareSnapshotPath,
  getScheduleShareSnapshotUrl,
  fetchScheduleShareSnapshot,
  normalizeScheduleSnapshot,
  normalizeScheduleType
}
