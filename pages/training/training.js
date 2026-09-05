const { requireLogin } = require('../../utils/auth')
const {
  STORAGE_KEY,
  cleanReadingDisplayTitle,
  getTrainingModules,
  getExtraTraining
} = require('../../utils/training-data')
const { getPublicWeeklySchedule, getAppContentConfigs } = require('../../utils/cloud-api')
const { refreshRemoteTrainingContents } = require('../../utils/remote-training')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getDisplayTime(record) {
  if (record.createdAt) {
    return record.createdAt.indexOf('T') > -1 ? formatDateTime(new Date(record.createdAt)) : record.createdAt
  }

  if (record.date && record.time) {
    return `${record.date} ${record.time}`
  }

  return record.date || ''
}

function getRecords() {
  return wx.getStorageSync(STORAGE_KEY) || []
}

function normalizeModuleTitle(title) {
  return String(title || '训练').replace(/^21天/, '')
}

function normalizeRecordTitle(record) {
  if (!record) return ''
  if (record.moduleId === 'reading' || String(record.moduleTitle || '').indexOf('朗读') > -1) {
    return cleanReadingDisplayTitle(record.taskTitle || record.contentTitle || '')
  }

  return record.taskTitle || record.contentTitle || ''
}

function buildExtraTrainingList() {
  return getExtraTraining()
}

function buildWeeklyScheduleCourses(schedule) {
  if (!schedule) return []
  const courses = Array.isArray(schedule.courses) ? schedule.courses : []
  if (courses.length) {
    return courses.slice(0, 2).map(item => ({
      ...item,
      time: item.startTime || item.endTime
        ? [item.startTime, item.endTime].filter(Boolean).join('-')
        : (item.time || '')
    }))
  }

  return [{
    weekday: '',
    time: '',
    courseTitle: schedule.marqueeText || schedule.summary || '本周课表已更新'
  }]
}

const WEEKLY_SCHEDULE_TYPES = [
  {
    type: 'adult',
    label: '成人课表',
    emptySummary: '本周成人课表更新后显示'
  },
  {
    type: 'college',
    label: '大学生课表',
    emptySummary: '本周大学生课表更新后显示'
  }
]

function buildWeeklyScheduleEntry(config, result = {}) {
  const schedule = result.schedule || null
  const firstCourse = buildWeeklyScheduleCourses(schedule)[0] || null
  const courseTitle = firstCourse
    ? (firstCourse.courseName || firstCourse.courseTitle || firstCourse.title || '')
    : ''
  const summary = firstCourse
    ? [firstCourse.date, firstCourse.weekday, firstCourse.time, courseTitle].filter(Boolean).join(' ')
    : config.emptySummary

  return {
    ...config,
    schedule,
    hasSchedule: Boolean(schedule),
    summary: summary || config.emptySummary,
    displayType: result.scheduleDisplayType || 'none'
  }
}

function getEmptyWeeklyScheduleEntries() {
  return WEEKLY_SCHEDULE_TYPES.map(config => buildWeeklyScheduleEntry(config))
}

const DEFAULT_HOME_COPY = {
  welcomeText: '每日一练',
  trainingGuide: '选择一个训练模块，今天先完成一次',
  coursePreview: '完成一次表达力测评，了解你的表达优势与提升方向。',
  weeklyEntry: '查看 >'
}

function getConfigText(item) {
  if (!item || !item.content) return ''
  if (typeof item.content === 'string') return item.content
  return item.content.text || ''
}

Page({
  data: {
    // mock data：训练页作为主页面，展示四个训练模块
    modules: [],
    // mock data：每日加餐训练入口从统一训练数据读取
    extraTrainings: [],
    recentRecord: null,
    hasRecentRecord: false,
    weeklyScheduleEntries: getEmptyWeeklyScheduleEntries(),
    homeCopy: DEFAULT_HOME_COPY
  },

  onShow() {
    this._isPageActive = true
    enableShareMenu()
    const records = getRecords()
    const recentRecord = records[0] || null

    this.setData({
      modules: getTrainingModules(),
      extraTrainings: buildExtraTrainingList(),
      recentRecord: recentRecord ? {
        ...recentRecord,
        taskTitle: normalizeRecordTitle(recentRecord),
        displayModuleTitle: normalizeModuleTitle(recentRecord.moduleTitle),
        displayTime: getDisplayTime(recentRecord)
      } : null,
      hasRecentRecord: !!recentRecord
    })
    this.loadHomeContentConfigs()
    this.loadWeeklySchedules()
    this.loadRemoteTrainingContents()
  },

  loadHomeContentConfigs() {
    getAppContentConfigs('home').then(result => {
      if (!this._isPageActive) return
      const list = Array.isArray(result.data) ? result.data : []
      if (!list.length) return
      const byKey = list.reduce((map, item) => {
        map[item.key] = getConfigText(item)
        return map
      }, {})
      this.setData({
        homeCopy: {
          welcomeText: byKey.home_welcome_text || DEFAULT_HOME_COPY.welcomeText,
          trainingGuide: byKey.home_training_guide || DEFAULT_HOME_COPY.trainingGuide,
          coursePreview: byKey.home_course_preview || DEFAULT_HOME_COPY.coursePreview,
          weeklyEntry: byKey.home_weekly_schedule_entry || DEFAULT_HOME_COPY.weeklyEntry
        }
      })
    }).catch(error => {
      console.warn('[training] 首页文字配置读取失败，继续使用本地文案:', error && error.message ? error.message : error)
    })
  },

  loadRemoteTrainingContents() {
    const revision = Number(this._catalogRefreshRevision || 0) + 1
    this._catalogRefreshRevision = revision
    refreshRemoteTrainingContents().then(() => {
      if (!this._isPageActive || revision !== this._catalogRefreshRevision) return
      this.setData({
        modules: getTrainingModules(),
        extraTrainings: buildExtraTrainingList()
      })
    }).catch(error => {
      console.warn('[training] 远程训练目录刷新失败，继续使用本地轻量目录:', error)
    })
  },

  openModule(e) {
    const moduleId = e.currentTarget.dataset.id
    requireLogin(() => {
      wx.navigateTo({
        url: `/pages/module-detail/module-detail?moduleId=${moduleId}`
      })
    }, { actionName: '进入训练模块' })
  },

  openExtraTraining(e) {
    const type = e.currentTarget.dataset.id
    let targetUrl = '/pages/extra-training/extra-training?type=dailyQuote'

    if (type === 'dailyQuote') {
      wx.navigateTo({ url: '/pages/extra-training/extra-training?type=dailyQuote' })
      return
    }

    if (type === 'randomTopic') {
      wx.navigateTo({ url: '/pages/extra-training/extra-training?type=randomTopic' })
      return
    }

    if (type === 'tongueTwister') {
      wx.navigateTo({ url: '/pages/extra-training/extra-training?type=tongueTwister' })
      return
    }

    wx.navigateTo({ url: targetUrl })
  },

  openEvaluation() {
    wx.navigateTo({ url: '/pages/ai-evaluation/ai-evaluation' })
  },

  continueTraining() {
    const record = this.data.recentRecord

    if (!record) {
      const reading = (this.data.modules || []).find(item => item.id === 'reading')
      const firstTask = reading && reading.days && reading.days[0]
      if (!firstTask || !firstTask.contentId) {
        wx.showToast({ title: '训练目录正在同步，请稍后重试', icon: 'none' })
        return
      }
      wx.navigateTo({
        url: `/pages/task-detail/task-detail?moduleId=reading&day=${firstTask.day}&contentId=${encodeURIComponent(firstTask.contentId)}`
      })
      return
    }

    if (!record.contentId) {
      wx.navigateTo({ url: `/pages/module-detail/module-detail?moduleId=${record.moduleId || 'reading'}` })
      return
    }
    wx.navigateTo({
      url: `/pages/task-detail/task-detail?moduleId=${record.moduleId}&day=${record.day}&contentId=${encodeURIComponent(record.contentId)}`
    })
  },

  loadWeeklySchedules() {
    const requests = WEEKLY_SCHEDULE_TYPES.map(config => (
      getPublicWeeklySchedule({ scheduleType: config.type })
        .then(result => buildWeeklyScheduleEntry(config, result))
        .catch(error => {
          console.warn(`[training] ${config.label}读取失败:`, error)
          return buildWeeklyScheduleEntry(config)
        })
    ))

    return Promise.all(requests).then(weeklyScheduleEntries => {
      if (!this._isPageActive) return
      this.setData({ weeklyScheduleEntries })
    })
  },

  onHide() {
    this._isPageActive = false
  },

  onUnload() {
    this._isPageActive = false
    this._catalogRefreshRevision = Number(this._catalogRefreshRevision || 0) + 1
  },

  goWeeklySchedule(e) {
    const scheduleType = e.currentTarget.dataset.type === 'college' ? 'college' : 'adult'
    wx.navigateTo({
      url: `/pages/weekly-schedule/weekly-schedule?scheduleType=${scheduleType}`
    })
  },

  onShareAppMessage() {
    return getDefaultShareMessage({
      title: '杨勤口才训练KEEP｜每天练一点，表达更自信',
      path: '/pages/training/training',
      imageUrl: getShareImage('home')
    })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({
      title: '杨勤口才训练KEEP｜每天练一点，表达更自信',
      targetPage: 'training',
      imageUrl: getShareImage('home')
    })
  }
})
