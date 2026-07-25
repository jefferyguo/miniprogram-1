const {
  fetchScheduleShareSnapshot,
  getScheduleShareSnapshotUrl,
  normalizeScheduleType
} = require('../../utils/schedule-share-snapshot')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getShareImage
} = require('../../utils/share-config')

function getPageTitle(scheduleType) {
  return normalizeScheduleType(scheduleType) === 'college' ? '大学生课表' : '成人课表'
}

function getFallbackDesc(scheduleType) {
  return normalizeScheduleType(scheduleType) === 'college'
    ? '大学生课程安排发布后会同步到这里'
    : '成人课程安排发布后会同步到这里'
}

function getScheduleShareImage(scheduleType) {
  return getShareImage(normalizeScheduleType(scheduleType) === 'college' ? 'scheduleCollege' : 'scheduleAdult')
}

Page({
  data: {
    loadState: 'loading',
    scheduleType: 'adult',
    pageTitle: getPageTitle('adult'),
    schedule: null,
    courses: [],
    hasSchedule: false,
    summaryText: '',
    snapshotUrl: '',
    errorTitle: '课表暂时无法预览',
    errorDesc: '请点击底部“前往小程序”查看最新课表',
    bottomTip: '进入小程序查看最新课程安排和更多训练内容'
  },

  onLoad(options = {}) {
    const scheduleType = normalizeScheduleType(options.scheduleType)
    enableShareMenu()
    this.setData({
      scheduleType,
      pageTitle: getPageTitle(scheduleType)
    })
    this.loadSnapshot(scheduleType, options)
  },

  async loadSnapshot(scheduleType = this.data.scheduleType, options = {}) {
    const normalizedType = normalizeScheduleType(scheduleType)
    const snapshotUrl = getScheduleShareSnapshotUrl(normalizedType, options)

    this.setData({
      loadState: 'loading',
      scheduleType: normalizedType,
      pageTitle: getPageTitle(normalizedType),
      snapshotUrl,
      errorTitle: '课表暂时无法预览',
      errorDesc: '请点击底部“前往小程序”查看最新课表'
    })

    try {
      const { snapshot, url } = await fetchScheduleShareSnapshot(normalizedType, options)
      const courses = Array.isArray(snapshot.courses) ? snapshot.courses : []
      const summaryText = snapshot.summary || snapshot.marqueeText || getFallbackDesc(normalizedType)

      this.setData({
        loadState: 'success',
        scheduleType: snapshot.scheduleType,
        pageTitle: getPageTitle(snapshot.scheduleType),
        schedule: snapshot,
        courses,
        hasSchedule: true,
        summaryText,
        snapshotUrl: url
      })

      console.log('[schedule-share] snapshot loaded', {
        scheduleType: snapshot.scheduleType,
        coursesCount: courses.length,
        hasSummary: Boolean(summaryText)
      })
    } catch (error) {
      console.warn('[schedule-share] snapshot load failed', {
        scheduleType: normalizedType,
        code: error && error.code,
        message: error && error.message
      })
      this.setData({
        loadState: 'error',
        schedule: null,
        courses: [],
        hasSchedule: false,
        summaryText: '',
        errorTitle: '课表暂时无法预览',
        errorDesc: '请点击底部“前往小程序”查看最新课表'
      })
    }
  },

  retryLoad() {
    this.loadSnapshot(this.data.scheduleType, {
      snapshotUrl: this.data.snapshotUrl
    })
  },

  onShareAppMessage() {
    const scheduleType = this.data.scheduleType || 'adult'
    const snapshotUrl = this.data.snapshotUrl ? `&snapshotUrl=${encodeURIComponent(this.data.snapshotUrl)}` : ''
    return getDefaultShareMessage({
      title: `杨勤口才${this.data.pageTitle}`,
      path: `/pages/schedule-share/schedule-share?scheduleType=${scheduleType}${snapshotUrl}`,
      imageUrl: getScheduleShareImage(scheduleType)
    })
  },

  onShareTimeline() {
    const scheduleType = this.data.scheduleType || 'adult'
    const snapshotUrl = this.data.snapshotUrl ? `&snapshotUrl=${encodeURIComponent(this.data.snapshotUrl)}` : ''
    return {
      title: scheduleType === 'college' ? '杨勤口才大学生课表' : '杨勤口才成人课表',
      query: `scheduleType=${scheduleType}${snapshotUrl}`,
      imageUrl: getScheduleShareImage(scheduleType)
    }
  }
})
