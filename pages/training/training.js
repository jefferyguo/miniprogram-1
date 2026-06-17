const {
  STORAGE_KEY,
  getTrainingModules,
  getExtraTraining
} = require('../../utils/training-data')
const auth = require('../../utils/auth')

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

function requireLoginToNavigate(url) {
  auth.requireLogin(() => {
    wx.navigateTo({
      url
    })
    return true
  }, {
    redirect: url
  })
}

Page({
  data: {
    // mock data：训练页作为主页面，展示四个 21 天模块
    modules: [],
    // mock data：每日额外训练入口从统一训练数据读取
    extraTrainings: [],
    recentRecord: null,
    hasRecentRecord: false
  },

  onShow() {
    const records = getRecords()
    const recentRecord = records[0] || null

    this.setData({
      modules: getTrainingModules(),
      extraTrainings: getExtraTraining(),
      recentRecord: recentRecord ? {
        ...recentRecord,
        displayTime: getDisplayTime(recentRecord)
      } : null,
      hasRecentRecord: !!recentRecord
    })
  },

  openModule(e) {
    requireLoginToNavigate(`/pages/module-detail/module-detail?moduleId=${e.currentTarget.dataset.id}`)
  },

  openExtraTraining(e) {
    const type = e.currentTarget.dataset.id
    let targetUrl = '/pages/extra-training/extra-training?type=dailyQuote'

    if (type === 'dailyQuote') {
      requireLoginToNavigate('/pages/extra-training/extra-training?type=dailyQuote')
      return
    }

    if (type === 'randomTopic') {
      requireLoginToNavigate('/pages/extra-training/extra-training?type=randomTopic')
      return
    }

    if (type === 'tongueTwister') {
      requireLoginToNavigate('/pages/extra-training/extra-training?type=tongueTwister')
      return
    }

    requireLoginToNavigate(targetUrl)
  },

  openEvaluation() {
    requireLoginToNavigate('/pages/ai-evaluation/ai-evaluation')
  },

  continueTraining() {
    const record = this.data.recentRecord

    if (!record) {
      requireLoginToNavigate('/pages/task-detail/task-detail?moduleId=reading&day=1')
      return
    }

    requireLoginToNavigate(`/pages/task-detail/task-detail?moduleId=${record.moduleId}&day=${record.day}`)
  }
})
