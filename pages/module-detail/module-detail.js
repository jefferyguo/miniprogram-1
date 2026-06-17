const { SUBMISSIONS_KEY, getModuleById } = require('../../utils/training-data')

function getRecords() {
  return wx.getStorageSync(SUBMISSIONS_KEY) || []
}

Page({
  data: {
    // mock data：模块详情根据 moduleId 从训练数据中读取
    moduleId: '',
    moduleInfo: null,
    days: [],
    completedCount: 0,
    progressPercent: 0,
    progressText: '0%'
  },

  onLoad(options) {
    const moduleId = options.moduleId || 'reading'

    this.setData({
      moduleId
    })
    this.loadModule(moduleId)
  },

  onShow() {
    if (this.data.moduleId) {
      this.loadModule()
    }
  },

  loadModule(moduleId = this.data.moduleId) {
    const moduleInfo = getModuleById(moduleId)

    if (!moduleInfo) {
      wx.showToast({
        title: '训练模块不存在',
        icon: 'none'
      })
      return
    }

    const records = getRecords()
    const completedDays = records
      .filter(item => item.moduleId === moduleInfo.id)
      .map(item => Number(item.day))
      .filter(day => day > 0)
    const uniqueCompletedDays = Array.from(new Set(completedDays))
    const days = moduleInfo.days.map(item => ({
      ...item,
      completed: uniqueCompletedDays.includes(item.day),
      status: uniqueCompletedDays.includes(item.day) ? '已完成' : '未完成'
    }))
    const progressPercent = Math.round((uniqueCompletedDays.length / 21) * 1000) / 10

    this.setData({
      moduleInfo,
      days,
      completedCount: uniqueCompletedDays.length,
      progressPercent,
      progressText: `${progressPercent}%`
    })
  },

  openTask(e) {
    wx.navigateTo({
      url: `/pages/task-detail/task-detail?moduleId=${this.data.moduleId}&day=${e.currentTarget.dataset.day}`
    })
  }
})
