const { getPublicWeeklySchedule } = require('../../utils/cloud-api')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getShareImage
} = require('../../utils/share-config')
const {
  fetchScheduleShareSnapshot,
  getScheduleShareSnapshotUrl
} = require('../../utils/schedule-share-snapshot')

const TIMELINE_SNAPSHOT_MAX_QUERY_LENGTH = 1600
const SNAPSHOT_TIP = '朋友圈预览为分享时课表，进入小程序查看完整课程详情。'
const SINGLE_PAGE_GUIDE_DESC = '朋友圈预览暂不支持直接加载最新数据，请点击底部“前往小程序”查看完整课表。'

function normalizeScheduleType(value) {
  return value === 'college' ? 'college' : 'adult'
}

function getSchedulePageTitle(type) {
  return type === 'college' ? '大学生课表' : '成人课表'
}

function getScheduleShareImage(type) {
  return getShareImage(type === 'college' ? 'scheduleCollege' : 'scheduleAdult')
}

function getDefaultSummary(type) {
  return type === 'college'
    ? '本周安排大学生表达、自信展示和综合素质训练。'
    : '本周安排成人当众讲话、沟通表达和综合表达训练。'
}

function getEmptyTitle(type) {
  return type === 'college' ? '本周大学生课表暂未更新' : '本周成人课表暂未更新'
}

function getEmptyDesc(type) {
  return type === 'college' ? '大学生课程安排发布后会显示在这里' : '课程安排发布后会显示在这里'
}

function truncateText(value, maxLength) {
  const text = String(value || '').trim()
  if (!Number.isFinite(maxLength) || text.length <= maxLength) return text
  return text.slice(0, maxLength)
}

function createSnapshotData(schedule, scheduleType, limits) {
  const source = schedule && typeof schedule === 'object' ? schedule : {}
  const courses = Array.isArray(source.courses) ? source.courses : []
  return {
    t: normalizeScheduleType(scheduleType || source.scheduleType),
    w: truncateText(source.weekLabel, limits.weekLength),
    c: courses.slice(0, limits.courseCount).map(course => {
      const item = normalizeCourse(course)
      const compactCourse = {
        d: truncateText(item.date, limits.dateLength),
        wd: truncateText(item.weekday, limits.weekdayLength),
        tm: truncateText(item.time, limits.timeLength),
        n: truncateText(item.courseName, limits.nameLength),
        a: truncateText(item.targetAudience, limits.audienceLength)
      }
      return compactCourse
    })
  }
}

function encodeSnapshot(snapshot) {
  return encodeURIComponent(JSON.stringify(snapshot))
}

function buildTimelineSnapshot(schedule, scheduleType) {
  if (!schedule || typeof schedule !== 'object') return ''

  const courses = Array.isArray(schedule.courses) ? schedule.courses : []
  const minimumCourseCount = Math.min(courses.length, 3)
  const regularLimits = {
    nameLength: 32,
    audienceLength: 12,
    dateLength: 12,
    weekdayLength: 4,
    timeLength: 16,
    weekLength: 32
  }
  const candidates = []

  // 朋友圈 query 只携带课表快照基础字段，避免课程详情导致参数过长。
  candidates.push({ ...regularLimits, courseCount: courses.length })
  candidates.push({ ...regularLimits, courseCount: courses.length, nameLength: 24, audienceLength: 10 })

  const reducedCounts = [Math.min(courses.length, 5), minimumCourseCount]
    .filter((count, index, list) => count > 0 && count < courses.length && list.indexOf(count) === index)
  reducedCounts.forEach(courseCount => {
    candidates.push({ ...regularLimits, courseCount, nameLength: 24, audienceLength: 10 })
    candidates.push({ ...regularLimits, courseCount, nameLength: 16, audienceLength: 8, dateLength: 10, weekdayLength: 3, timeLength: 14, weekLength: 24 })
  })

  if (minimumCourseCount === 0) candidates.push({ ...regularLimits, courseCount: 0 })

  for (const limits of candidates) {
    const encoded = encodeSnapshot(createSnapshotData(schedule, scheduleType, limits))
    const query = `scheduleType=${normalizeScheduleType(scheduleType)}&snapshot=${encoded}`
    if (query.length <= TIMELINE_SNAPSHOT_MAX_QUERY_LENGTH) return encoded
  }

  return ''
}

function parseTimelineSnapshot(rawSnapshot, fallbackType) {
  if (!rawSnapshot) return null

  const candidates = [String(rawSnapshot)]
  try {
    const decoded = decodeURIComponent(String(rawSnapshot))
    if (!candidates.includes(decoded)) candidates.push(decoded)
  } catch (error) {
    console.warn('[weekly-schedule] snapshot decode failed:', error && error.message || error)
  }

  for (const candidate of candidates) {
    try {
      const snapshot = JSON.parse(candidate)
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue
      if (!['adult', 'college'].includes(snapshot.t) || !Array.isArray(snapshot.c)) continue
      const scheduleType = normalizeScheduleType(snapshot.t || fallbackType)
      const courses = Array.isArray(snapshot.c)
        ? snapshot.c.map(item => normalizeCourse({
            date: item && item.d,
            weekday: item && item.wd,
            time: item && item.tm,
            courseName: item && item.n,
            targetAudience: item && item.a,
            content: item && item.x
          }))
        : []
      return {
        title: getSchedulePageTitle(scheduleType),
        weekLabel: truncateText(snapshot.w, 40),
        scheduleType,
        summary: '',
        courses
      }
    } catch (error) {
      // 同时兼容微信已解码和仍为编码字符串的两种 options 形态。
    }
  }

  return null
}

function isSinglePageMode() {
  try {
    const app = getApp()
    return Boolean(app && app.globalData && app.globalData.isSinglePageMode)
  } catch (error) {
    return false
  }
}

function getErrorDetails(error) {
  return {
    code: error && (error.code !== undefined ? error.code : error.errCode) || '',
    errMsg: error && error.errMsg || '',
    message: error && error.message || ''
  }
}

function buildErrorDebug(stage, error, source, requestSeq) {
  const details = getErrorDetails(error)
  return `${stage} source=${source}; requestSeq=${requestSeq}; code=${details.code || 'none'}; errMsg=${details.errMsg || 'none'}; message=${details.message || 'none'}`
}

function normalizeCourse(course) {
  const source = course && typeof course === 'object' ? course : {}
  const time = source.startTime || source.endTime
    ? [source.startTime, source.endTime].filter(Boolean).join('-')
    : (source.time || '')
  return {
    ...source,
    date: source.date || '',
    weekday: source.weekday || '',
    time,
    courseName: source.courseName || source.courseTitle || '',
    targetAudience: source.targetAudience || source.audience || '',
    content: source.content || source.description || '',
    remark: source.remark || source.note || ''
  }
}

function normalizeScheduleForView(schedule) {
  const source = schedule && typeof schedule === 'object' ? schedule : {}
  const courses = Array.isArray(source.courses) ? source.courses : []
  return {
    ...source,
    title: source.title || '',
    weekLabel: source.weekLabel || '',
    summary: source.summary || '',
    marqueeText: source.marqueeText || '',
    courses: courses.map(normalizeCourse)
  }
}

Page({
  data: {
    errorDebug: '',
    loadState: 'loading',
    scheduleType: 'adult',
    pageTitle: getSchedulePageTitle('adult'),
    schedule: null,
    courses: [],
    hasSchedule: false,
    isSnapshot: false,
    snapshotTip: '',
    snapshotUrl: '',
    singlePageGuideDesc: SINGLE_PAGE_GUIDE_DESC,
    errorTitle: '课表加载失败',
    errorDesc: '请稍后重试',
    isSinglePageMode: false,
    scheduleDisplayType: 'none',
    emptyTitle: getEmptyTitle('adult'),
    emptyDesc: getEmptyDesc('adult'),
    summaryText: getDefaultSummary('adult')
  },

  onLoad(options = {}) {
    const scheduleType = normalizeScheduleType(options.scheduleType)
    const singlePageMode = isSinglePageMode()
    this.setData({
      scheduleType,
      pageTitle: getSchedulePageTitle(scheduleType),
      emptyTitle: getEmptyTitle(scheduleType),
      emptyDesc: getEmptyDesc(scheduleType),
      summaryText: getDefaultSummary(scheduleType),
      isSinglePageMode: singlePageMode,
      isSnapshot: false,
      snapshotTip: '',
      snapshotUrl: ''
    })
    this._scheduleRequestSeq = 0
    this._loadedOnce = false
    this._skipNextShowLoad = true
    enableShareMenu()

    if (singlePageMode) {
      this._loadedOnce = true
      const snapshotUrl = getScheduleShareSnapshotUrl(scheduleType, options)
      if (snapshotUrl) {
        this.loadShareSnapshot(scheduleType, options, 'singlePagePublicJson')
      } else {
        const snapshotSchedule = parseTimelineSnapshot(options.snapshot, scheduleType)
        if (snapshotSchedule) {
          this.applyTimelineSnapshot(snapshotSchedule, { source: 'query-snapshot' })
        } else {
          this.showSinglePageGuide(scheduleType)
        }
      }
      return
    }

    this.loadSchedule(scheduleType, 'onLoad')
  },

  async loadShareSnapshot(scheduleType = this.data.scheduleType, options = {}, source = 'singlePagePublicJson') {
    const requestedType = normalizeScheduleType(scheduleType)
    const requestSeq = (this._scheduleRequestSeq || 0) + 1
    this._scheduleRequestSeq = requestSeq
    this._loadedOnce = true
    const snapshotUrl = getScheduleShareSnapshotUrl(requestedType, options)

    console.log('[weekly-schedule] load public snapshot', {
      source,
      requestSeq,
      scheduleType: requestedType,
      hasSnapshotUrl: Boolean(snapshotUrl)
    })

    this.setData({
      loadState: 'loading',
      scheduleType: requestedType,
      pageTitle: getSchedulePageTitle(requestedType),
      emptyTitle: getEmptyTitle(requestedType),
      emptyDesc: getEmptyDesc(requestedType),
      snapshotUrl,
      errorDebug: ''
    })

    try {
      const { snapshot, url } = await fetchScheduleShareSnapshot(requestedType, options)
      if (this.isStaleScheduleRequest(requestSeq)) return
      this.applyTimelineSnapshot({
        ...snapshot,
        shareSnapshotUrl: url
      }, { source: 'public-json', snapshotUrl: url })
    } catch (error) {
      if (this.isStaleScheduleRequest(requestSeq)) return
      console.warn('[weekly-schedule] public snapshot failed', {
        source,
        requestSeq,
        scheduleType: requestedType,
        code: error && error.code,
        message: error && error.message
      })
      const snapshotSchedule = parseTimelineSnapshot(options.snapshot, requestedType)
      if (snapshotSchedule) {
        this.applyTimelineSnapshot(snapshotSchedule, { source: 'query-snapshot-fallback' })
      } else {
        this.showSinglePageGuide(requestedType)
      }
    }
  },

  onShow() {
    enableShareMenu()
    if (this.data.isSinglePageMode && this._loadedOnce) return
    if (this._skipNextShowLoad) {
      this._skipNextShowLoad = false
      return
    }
    this.loadSchedule(this.data.scheduleType, 'onShow')
  },

  async loadSchedule(scheduleType = this.data.scheduleType, source = 'unknown') {
    const requestedType = normalizeScheduleType(scheduleType)
    if (this.data.isSinglePageMode) {
      console.warn('[weekly-schedule] skip cloud api in single-page mode', { source, scheduleType: requestedType })
      if (this.data.loadState !== 'success' || !this.data.isSnapshot) {
        this.showSinglePageGuide(requestedType)
      }
      return
    }
    const requestSeq = (this._scheduleRequestSeq || 0) + 1
    this._scheduleRequestSeq = requestSeq
    this._loadedOnce = true
    console.log('[weekly-schedule] loadSchedule start', {
      source,
      requestSeq,
      scheduleType: requestedType,
      isSinglePageMode: this.data.isSinglePageMode,
      currentLoadState: this.data.loadState
    })
    const keepCurrentSchedule = this.data.loadState === 'success' && Boolean(this.data.schedule)
    this.setData(keepCurrentSchedule
      ? { errorDebug: '' }
      : {
          loadState: 'loading',
          errorTitle: '课表加载失败',
          errorDesc: '请稍后重试',
          isSnapshot: false,
          snapshotTip: '',
          snapshotUrl: '',
          errorDebug: ''
        })

    let raw
    try {
      raw = await getPublicWeeklySchedule({ scheduleType: requestedType })
    } catch (apiError) {
      const details = getErrorDetails(apiError)
      console.error('[weekly-schedule] public api reject full error', apiError)
      console.error('[weekly-schedule] loadSchedule api reject', {
        source,
        requestSeq,
        ...details
      })
      if (this.isStaleScheduleRequest(requestSeq)) return
      if (this.data.schedule && this.data.hasSchedule) {
        console.warn('[weekly-schedule] keep successful schedule after api reject', {
          source,
          requestSeq
        })
        this.setData({
          errorDebug: buildErrorDebug('api_reject', apiError, source, requestSeq)
        })
        return
      }
      this.setScheduleError(apiError, 'api_reject', source, requestSeq)
      return
    }

    if (this.isStaleScheduleRequest(requestSeq)) return
    console.log('[weekly-schedule] raw public api response', {
      keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
      hasResult: Boolean(raw && raw.result)
    })

    const payload = raw && raw.result ? raw.result : raw
    console.log('[weekly-schedule] public api payload', {
      success: payload && payload.success,
      hasSchedule: Boolean(payload && payload.schedule),
      scheduleType: payload && payload.scheduleType,
      scheduleDisplayType: payload && payload.scheduleDisplayType,
      coursesCount: payload && payload.schedule && Array.isArray(payload.schedule.courses)
        ? payload.schedule.courses.length
        : 0
    })

    if (!payload || payload.success !== true) {
      const payloadError = new Error(payload && payload.message || '公开课表接口返回失败')
      payloadError.code = payload && payload.code || 'PUBLIC_SCHEDULE_FAILED'
      this.setScheduleError(payloadError, 'payload_failed', source, requestSeq)
      return
    }

    const finalScheduleType = normalizeScheduleType(payload.scheduleType || requestedType)
    const commonState = {
      scheduleType: finalScheduleType,
      pageTitle: getSchedulePageTitle(finalScheduleType),
      emptyTitle: getEmptyTitle(finalScheduleType),
      emptyDesc: getEmptyDesc(finalScheduleType)
    }

    if (!payload.schedule) {
      console.log('[weekly-schedule] public schedule empty', {
        scheduleType: finalScheduleType
      })
      this.setData({
        ...commonState,
        schedule: null,
        courses: [],
        hasSchedule: false,
        isSnapshot: false,
        snapshotTip: '',
        snapshotUrl: '',
        scheduleDisplayType: 'none',
        summaryText: getDefaultSummary(finalScheduleType),
        loadState: 'empty',
        errorDebug: ''
      })
      console.log('[weekly-schedule] loadSchedule success', {
        source,
        requestSeq,
        coursesCount: 0,
        loadState: 'empty'
      })
      return
    }

    let schedule
    try {
      schedule = normalizeScheduleForView(payload.schedule)
    } catch (parseError) {
      console.error('[weekly-schedule] normalize schedule failed, use raw schedule', parseError)
      const rawSchedule = payload.schedule && typeof payload.schedule === 'object' ? payload.schedule : {}
      schedule = {
        ...rawSchedule,
        courses: Array.isArray(rawSchedule.courses) ? rawSchedule.courses.filter(Boolean) : []
      }
    }

    this.setData({
      ...commonState,
      schedule,
      courses: Array.isArray(schedule.courses) ? schedule.courses : [],
      hasSchedule: true,
      isSnapshot: false,
      snapshotTip: '',
      snapshotUrl: '',
      scheduleDisplayType: payload.scheduleDisplayType || schedule.scheduleDisplayType || 'none',
      summaryText: schedule.summary || schedule.marqueeText || getDefaultSummary(finalScheduleType),
      loadState: 'success',
      errorDebug: ''
    })
    console.log('[weekly-schedule] loadSchedule success', {
      source,
      requestSeq,
      coursesCount: Array.isArray(schedule.courses) ? schedule.courses.length : 0,
      loadState: 'success'
    })
  },

  isStaleScheduleRequest(requestSeq) {
    if (requestSeq === this._scheduleRequestSeq) return false
    console.warn('[weekly-schedule] ignore stale request', requestSeq, this._scheduleRequestSeq)
    return true
  },

  applyTimelineSnapshot(schedule, options = {}) {
    const scheduleType = normalizeScheduleType(schedule && schedule.scheduleType)
    const normalizedSchedule = normalizeScheduleForView(schedule)
    const snapshotTip = normalizedSchedule.summary || SNAPSHOT_TIP
    this.setData({
      scheduleType,
      pageTitle: getSchedulePageTitle(scheduleType),
      schedule: normalizedSchedule,
      courses: normalizedSchedule.courses,
      hasSchedule: true,
      isSnapshot: true,
      snapshotTip,
      snapshotUrl: options.snapshotUrl || normalizedSchedule.shareSnapshotUrl || '',
      scheduleDisplayType: 'current',
      summaryText: snapshotTip,
      loadState: 'success',
      errorDebug: ''
    })
    console.log('[weekly-schedule] timeline snapshot applied', {
      scheduleType,
      coursesCount: normalizedSchedule.courses.length,
      source: options.source || 'unknown'
    })
  },

  showSinglePageGuide(scheduleType) {
    const normalizedType = normalizeScheduleType(scheduleType)
    this.setData({
      scheduleType: normalizedType,
      pageTitle: getSchedulePageTitle(normalizedType),
      schedule: null,
      courses: [],
      hasSchedule: false,
      isSnapshot: false,
      snapshotTip: '',
      snapshotUrl: '',
      scheduleDisplayType: 'none',
      loadState: 'singlePageGuide',
      errorDebug: ''
    })
    console.log('[weekly-schedule] show single-page guide', { scheduleType: normalizedType })
  },

  setScheduleError(error, stage = 'api_reject', source = 'unknown', requestSeq = 0) {
    if (this.isStaleScheduleRequest(requestSeq)) return
    const details = getErrorDetails(error)
    console.error('[weekly-schedule] public schedule failed', {
      stage,
      source,
      requestSeq,
      ...details
    })
    if (this.data.schedule && this.data.hasSchedule) {
      this.setData({
        errorDebug: buildErrorDebug(stage, error, source, requestSeq)
      })
      return
    }
    this.setData({
      schedule: null,
      hasSchedule: false,
      isSnapshot: false,
      snapshotTip: '',
      snapshotUrl: '',
      scheduleDisplayType: 'none',
      loadState: 'error',
      errorTitle: '课表加载失败',
      errorDesc: '请稍后重试',
      errorDebug: buildErrorDebug(stage, error, source, requestSeq)
    })
  },

  retryLoad() {
    if (this.data.isSinglePageMode) {
      this.loadShareSnapshot(this.data.scheduleType, {
        snapshotUrl: this.data.snapshotUrl
      }, 'reloadButton')
      return
    }
    this.loadSchedule(this.data.scheduleType, 'reloadButton')
  },

  goTraining() {
    if (this.data.isSinglePageMode) return
    wx.switchTab({ url: '/pages/training/training' })
  },

  onShareAppMessage() {
    const scheduleType = this.data.scheduleType || 'adult'
    return getDefaultShareMessage({
      title: '杨勤口才' + this.data.pageTitle,
      path: `/pages/weekly-schedule/weekly-schedule?scheduleType=${scheduleType}`,
      imageUrl: getScheduleShareImage(scheduleType)
    })
  },

  onShareTimeline() {
    const scheduleType = normalizeScheduleType(this.data.scheduleType)
    let snapshotUrl = getScheduleShareSnapshotUrl(scheduleType, {
      snapshotUrl: this.data.snapshotUrl || (this.data.schedule && this.data.schedule.shareSnapshotUrl)
    })
    let snapshot = ''
    let query = snapshotUrl
      ? `shareMode=scheduleShare&scheduleType=${scheduleType}&snapshotUrl=${encodeURIComponent(snapshotUrl)}`
      : ''

    if (!query || query.length > TIMELINE_SNAPSHOT_MAX_QUERY_LENGTH) {
      if (query.length > TIMELINE_SNAPSHOT_MAX_QUERY_LENGTH) {
        console.warn('[weekly-schedule] snapshotUrl query too long, fallback to compact snapshot', {
          scheduleType,
          queryLength: query.length
        })
      }
      snapshotUrl = ''
      snapshot = buildTimelineSnapshot(this.data.schedule, scheduleType)
      query = snapshot ? `scheduleType=${scheduleType}&snapshot=${snapshot}` : `scheduleType=${scheduleType}`
    }

    console.log('[weekly-schedule] timeline share query', {
      scheduleType,
      hasSnapshotUrl: Boolean(snapshotUrl),
      hasSnapshot: Boolean(snapshot),
      queryLength: query.length
    })
    return {
      title: scheduleType === 'college' ? '杨勤口才大学生课表' : '杨勤口才成人课表',
      query,
      imageUrl: getScheduleShareImage(scheduleType)
    }
  }
})
