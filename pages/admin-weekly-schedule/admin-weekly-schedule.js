const {
  getAdminProfile,
  adminGetWeeklySchedule,
  adminSaveWeeklySchedule,
  adminArchiveWeeklySchedule
} = require('../../utils/cloud-api')
const { FEATURE_FLAGS } = require('../../utils/feature-flags')
const { generateSchedulePoster } = require('../../utils/schedule-poster')
const { generateWeeklyScheduleQr } = require('../../utils/qrcode')
const { getShareImage } = require('../../utils/share-config')

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatWeekLabel(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (!start.getTime() || !end.getTime()) return ''
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日-${end.getMonth() + 1}月${end.getDate()}日`
}

function getWeekday(dateText) {
  const date = new Date(`${dateText}T12:00:00`)
  if (!date.getTime()) return ''
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
}

function getWeekRange(offsetWeeks = 0) {
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  const currentDay = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - currentDay + 1 + offsetWeeks * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { startDate: formatDate(monday), endDate: formatDate(sunday) }
}

function splitTime(timeText) {
  const parts = String(timeText || '').split(/\s*-\s*/)
  return { startTime: parts[0] || '19:00', endTime: parts[1] || '20:30' }
}

function normalizeScheduleType(value) {
  return value === 'college' ? 'college' : 'adult'
}

function getCategoryMeta(type) {
  return type === 'college'
    ? { label: '大学生课表', audience: '大学生' }
    : { label: '成人课表', audience: '成人学员' }
}

function createEmptyCourse(scheduleType = 'adult') {
  return {
    date: '',
    weekday: '',
    startTime: '19:00',
    endTime: '20:30',
    time: '19:00-20:30',
    courseName: '',
    targetAudience: getCategoryMeta(scheduleType).audience,
    content: '',
    remark: ''
  }
}

function normalizeCourse(course = {}, scheduleType = 'adult') {
  const oldTime = splitTime(course.time)
  const startTime = course.startTime || oldTime.startTime
  const endTime = course.endTime || oldTime.endTime
  return {
    ...course,
    date: course.date || '',
    weekday: course.weekday || getWeekday(course.date),
    startTime,
    endTime,
    time: [startTime, endTime].filter(Boolean).join('-'),
    courseName: course.courseName || course.courseTitle || '',
    targetAudience: course.targetAudience || course.audience || getCategoryMeta(scheduleType).audience,
    content: course.content || course.description || '',
    remark: course.remark || course.note || ''
  }
}

function createDefaultSchedule(scheduleType = 'adult') {
  const range = getWeekRange(0)
  const category = getCategoryMeta(scheduleType)
  return {
    _id: '',
    title: category.label,
    weekLabel: formatWeekLabel(range.startDate, range.endDate),
    startDate: range.startDate,
    endDate: range.endDate,
    status: 'draft',
    scheduleType,
    summary: '',
    marqueeText: '',
    posterFileID: '',
    posterUrl: '',
    posterGeneratedAt: '',
    miniProgramQrFileID: '',
    miniProgramQrUrl: '',
    courses: []
  }
}

Page({
  data: {
    loading: true,
    saving: false,
    posterGenerating: false,
    isAdmin: false,
    scheduleType: 'adult',
    categoryLabel: '成人课表',
    schedule: createDefaultSchedule('adult'),
    showSchedulePoster: FEATURE_FLAGS.showSchedulePoster,
    localPosterPath: '',
    posterCanvasWidth: 375,
    posterCanvasHeight: 600
  },

  onLoad(options = {}) {
    const scheduleType = normalizeScheduleType(options.category || options.scheduleType)
    const categoryLabel = getCategoryMeta(scheduleType).label
    this.setData({
      scheduleType,
      categoryLabel,
      schedule: createDefaultSchedule(scheduleType)
    })
    wx.setNavigationBarTitle({ title: `${categoryLabel}管理` })
    this.verifyAdmin()
  },

  async verifyAdmin() {
    try {
      const res = await getAdminProfile()
      const isAdmin = Boolean(res.isAdmin && ['super_admin', 'admin'].includes(res.role))
      this.setData({ isAdmin, loading: false })
      if (!isAdmin) {
        wx.showToast({ title: '当前账号没有管理员权限', icon: 'none' })
        return
      }
      await this.loadSchedule()
    } catch (error) {
      this.setData({ isAdmin: false, loading: false })
      wx.showToast({ title: error.message || '管理员身份读取失败', icon: 'none' })
    }
  },

  async loadSchedule() {
    try {
      const res = await adminGetWeeklySchedule('', this.data.scheduleType)
      const base = createDefaultSchedule(this.data.scheduleType)
      const schedule = res.schedule || base
      this.setData({
        schedule: {
          ...base,
          ...schedule,
          scheduleType: this.data.scheduleType,
          courses: (schedule.courses || []).map(item => normalizeCourse(item, this.data.scheduleType))
        },
        localPosterPath: ''
      })
    } catch (error) {
      wx.showToast({ title: error.message || '课表读取失败', icon: 'none' })
    }
  },

  onFieldInput(e) {
    this.setData({ [`schedule.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  onScheduleDateChange(e) {
    const field = e.currentTarget.dataset.field
    const patch = { [`schedule.${field}`]: e.detail.value }
    const startDate = field === 'startDate' ? e.detail.value : this.data.schedule.startDate
    const endDate = field === 'endDate' ? e.detail.value : this.data.schedule.endDate
    patch['schedule.weekLabel'] = formatWeekLabel(startDate, endDate)
    this.setData(patch)
  },

  useCurrentWeek() {
    this.applyWeekRange(getWeekRange(0))
  },

  useNextWeek() {
    this.applyWeekRange(getWeekRange(1))
  },

  applyWeekRange(range) {
    this.setData({
      'schedule.startDate': range.startDate,
      'schedule.endDate': range.endDate,
      'schedule.weekLabel': formatWeekLabel(range.startDate, range.endDate)
    })
  },

  onCourseInput(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const field = e.currentTarget.dataset.field
    this.setData({ [`schedule.courses[${index}].${field}`]: e.detail.value })
  },

  onCourseDateChange(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const date = e.detail.value
    this.setData({
      [`schedule.courses[${index}].date`]: date,
      [`schedule.courses[${index}].weekday`]: getWeekday(date)
    })
  },

  onCourseTimeChange(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    const course = this.data.schedule.courses[index]
    const startTime = field === 'startTime' ? value : course.startTime
    const endTime = field === 'endTime' ? value : course.endTime
    this.setData({
      [`schedule.courses[${index}].${field}`]: value,
      [`schedule.courses[${index}].time`]: [startTime, endTime].filter(Boolean).join('-')
    })
  },

  getNextCourses(insertIndex) {
    const courses = (this.data.schedule.courses || []).slice()
    courses.splice(insertIndex, 0, createEmptyCourse(this.data.scheduleType))
    return courses
  },

  addCourseAfter(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const courses = this.getNextCourses(index + 1)
    if (courses) this.setData({ 'schedule.courses': courses })
  },

  addCourseAtEnd() {
    const courses = this.getNextCourses((this.data.schedule.courses || []).length)
    if (courses) this.setData({ 'schedule.courses': courses })
  },

  removeCourse(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    this.setData({
      'schedule.courses': this.data.schedule.courses.filter((_, itemIndex) => itemIndex !== index)
    })
  },

  saveDraft() {
    this.saveSchedule('draft')
  },

  publishSchedule() {
    wx.showModal({
      title: `发布${this.data.categoryLabel}`,
      content: '发布后学员端会展示当前类型的课程安排，是否继续？',
      confirmText: '发布',
      confirmColor: '#07c160',
      success: res => {
        if (res.confirm) this.saveSchedule('published')
      }
    })
  },

  async saveSchedule(status) {
    if (this.data.saving) return null
    const schedule = {
      ...this.data.schedule,
      title: this.data.categoryLabel,
      scheduleType: this.data.scheduleType,
      status
    }
    if (!schedule.startDate || !schedule.endDate) {
      wx.showToast({ title: '请选择课表日期范围', icon: 'none' })
      return null
    }
    if (!schedule.courses.some(item => item.courseName && item.date)) {
      wx.showToast({ title: '请至少完善一节课程', icon: 'none' })
      return null
    }

    this.setData({ saving: true })
    try {
      const res = await adminSaveWeeklySchedule(schedule)
      const saved = res.schedule || schedule
      this.setData({
        schedule: {
          ...createDefaultSchedule(this.data.scheduleType),
          ...saved,
          scheduleType: this.data.scheduleType,
          courses: (saved.courses || []).map(item => normalizeCourse(item, this.data.scheduleType))
        }
      })
      wx.showToast({ title: status === 'published' ? '课表已发布' : '草稿已保存', icon: 'success' })
      return saved
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
      return null
    } finally {
      this.setData({ saving: false })
    }
  },

  // 海报代码保留，通过 feature flag 隐藏入口。
  async generatePoster() {
    if (this.data.posterGenerating) return
    if (!this.data.schedule._id) {
      wx.showToast({ title: '请先保存课表', icon: 'none' })
      return
    }
    this.setData({ posterGenerating: true })
    wx.showLoading({ title: '正在生成海报', mask: true })
    try {
      let qrUrl = this.data.schedule.miniProgramQrUrl || this.data.schedule.miniProgramQrFileID || ''
      if (!qrUrl) {
        try {
          qrUrl = await generateWeeklyScheduleQr()
        } catch (error) {
          console.warn('[admin-weekly-schedule] 小程序码生成失败，使用占位:', error)
        }
      }
      const localPosterPath = await generateSchedulePoster(this, this.data.schedule, { qrUrl })
      this.setData({ localPosterPath })

      if (wx.cloud && wx.cloud.uploadFile) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `weekly-posters/${this.data.scheduleType}_${this.data.schedule._id}_${Date.now()}.png`,
          filePath: localPosterPath
        })
        const posterGeneratedAt = new Date().toISOString()
        const nextSchedule = {
          ...this.data.schedule,
          scheduleType: this.data.scheduleType,
          posterFileID: uploadRes.fileID || '',
          posterUrl: '',
          posterGeneratedAt,
          miniProgramQrUrl: qrUrl && qrUrl.indexOf('data:image/') !== 0
            ? qrUrl
            : this.data.schedule.miniProgramQrUrl
        }
        const res = await adminSaveWeeklySchedule(nextSchedule)
        this.setData({
          schedule: {
            ...nextSchedule,
            ...(res.schedule || {})
          }
        })
      }
      wx.showToast({ title: '课表海报已生成', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '海报生成失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ posterGenerating: false })
    }
  },

  previewPoster() {
    const url = this.data.localPosterPath || this.data.schedule.posterFileID || this.data.schedule.posterUrl
    if (url) wx.previewImage({ urls: [url], current: url })
  },

  savePosterToAlbum() {
    const filePath = this.data.localPosterPath
    if (!filePath) {
      wx.showToast({ title: '请先生成本地海报', icon: 'none' })
      return
    }
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: error => wx.showToast({
        title: error.errMsg && error.errMsg.includes('auth deny') ? '请允许保存到相册' : '保存失败',
        icon: 'none'
      })
    })
  },

  archiveSchedule() {
    const id = this.data.schedule._id
    if (!id) return
    wx.showModal({
      title: '归档课表',
      content: '归档后学员端不再展示，历史数据不会删除。',
      success: res => {
        if (!res.confirm) return
        adminArchiveWeeklySchedule(id, this.data.scheduleType).then(() => {
          wx.showToast({ title: '已归档', icon: 'none' })
          this.loadSchedule()
        }).catch(error => wx.showToast({ title: error.message || '归档失败', icon: 'none' }))
      }
    })
  },

  onShareAppMessage() {
    return {
      title: `杨勤口才${this.data.categoryLabel}`,
      path: `/pages/weekly-schedule/weekly-schedule?scheduleType=${this.data.scheduleType}`,
      imageUrl: getShareImage('home')
    }
  }
})
