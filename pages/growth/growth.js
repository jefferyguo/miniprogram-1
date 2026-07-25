const {
  SUBMISSIONS_KEY,
  EXTRA_SUBMISSIONS_KEY,
  cleanReadingDisplayTitle,
  getTrainingModules,
  getExtraTraining
} = require('../../utils/training-data')
const { requirePhoneBound } = require('../../utils/phone-auth')

function getRecords() {
  return wx.getStorageSync(SUBMISSIONS_KEY) || []
}

function getExtraRecords() {
  return wx.getStorageSync(EXTRA_SUBMISSIONS_KEY) || []
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getRecordDate(record) {
  if (record.date) {
    return record.date
  }

  if (record.createdAt) {
    return record.createdAt.indexOf('T') > -1 ? formatDate(new Date(record.createdAt)) : record.createdAt.split(' ')[0]
  }

  return ''
}

function getRecordTime(record) {
  if (!record.createdAt) {
    return ''
  }

  return record.createdAt.indexOf('T') > -1 ? `${getRecordDate(record)} ${record.createdAt.split('T')[1].slice(0, 5)}` : record.createdAt
}

function getRecentWeekCount(records) {
  const now = new Date().getTime()
  const dayTime = 24 * 60 * 60 * 1000
  const dates = records
    .map(getRecordDate)
    .filter(date => date && now - new Date(date).getTime() <= 6 * dayTime)

  return Array.from(new Set(dates)).length
}

function normalizeModuleTitle(title) {
  return String(title || '训练').replace(/^21天/, '')
}

function normalizeRecordTitle(record) {
  if (record.moduleId === 'reading' || String(record.moduleTitle || '').indexOf('朗读') > -1) {
    return cleanReadingDisplayTitle(record.taskTitle || record.contentTitle || '')
  }

  return record.taskTitle || record.contentTitle || ''
}

Page({
  data: {
    // mock data：成长页根据本地 storage 里的打卡记录计算
    totalSubmissions: 0,
    weekDone: 0,
    weekTotal: 7,
    moduleProgress: [],
    recentRecords: [],
    hasRecord: false,
    extraTotalSubmissions: 0,
    extraStats: [],
    recentExtraRecord: null,
    hasExtraRecord: false
  },

  onShow() {
    if (!requirePhoneBound('查看成长记录', {
      page: this
    })) {
      this.setData({
        totalSubmissions: 0,
        weekDone: 0,
        moduleProgress: [],
        recentRecords: [],
        hasRecord: false,
        extraTotalSubmissions: 0,
        extraStats: [],
        recentExtraRecord: null,
        hasExtraRecord: false
      })
      return
    }

    const records = getRecords()
    const extraRecords = getExtraRecords()
    const modules = getTrainingModules()
    const extraTrainings = getExtraTraining()
    const moduleProgress = modules.map(module => {
      const completedDays = records
        .filter(record => record.moduleId === module.id)
        .map(record => Number(record.day))
        .filter(day => day > 0)
      const done = Array.from(new Set(completedDays)).length

      return {
        id: module.id,
        title: module.title,
        done,
        total: module.days.length,
        percent: module.days.length ? Math.round((done / module.days.length) * 100) : 0
      }
    })
    const extraStats = extraTrainings.map(item => ({
      id: item.id,
      title: item.title,
      icon: item.icon,
      count: extraRecords.filter(record => record.extraType === item.id).length
    }))
    const recentExtraRecord = extraRecords[0] ? {
      ...extraRecords[0],
      typeTitle: extraRecords[0].type === 'audio' ? '录音作品' : '录像作品',
      displayTime: getRecordTime(extraRecords[0])
    } : null

    this.setData({
      totalSubmissions: records.length,
      weekDone: getRecentWeekCount(records),
      moduleProgress,
      recentRecords: records.slice(0, 5).map(record => ({
        ...record,
        taskTitle: normalizeRecordTitle(record),
        displayModuleTitle: normalizeModuleTitle(record.moduleTitle),
        displayDate: getRecordDate(record)
      })),
      hasRecord: records.length > 0,
      extraTotalSubmissions: extraRecords.length,
      extraStats,
      recentExtraRecord,
      hasExtraRecord: extraRecords.length > 0
    })
  }
})
