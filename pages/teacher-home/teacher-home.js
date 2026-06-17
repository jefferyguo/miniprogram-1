const {
  getAllSubmittedWorks,
  getClasses,
  getFavoriteWorks,
  hasTeacherFeedback
} = require('../../utils/local-data')

function isToday(timeText) {
  if (!timeText) return false

  const today = new Date()
  const date = new Date(String(timeText).replace(/-/g, '/'))

  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
}

Page({
  data: {
    teacherName: '杨勤老师',
    stats: [
      { label: '班级数', value: 0 },
      { label: '今日待点评', value: 0 },
      { label: '已点评', value: 0 },
      { label: '收藏作品', value: 0 }
    ],
    quickActions: [
      { title: '创建班级', desc: '生成班级码，邀请学员加入', action: 'openClassManage' },
      { title: '查看待点评', desc: '按班级处理学生提交作品', action: 'openPendingWorks' },
      { title: '点评模板', desc: '管理常用点评话术', action: 'openCommentTemplates' },
      { title: '收藏夹', desc: '管理重点作品和案例素材', action: 'openFavorites' }
    ],
    recentPendingWorks: []
  },

  onShow() {
    this.ensureTeacherSession()
    this.loadDashboard()
  },

  ensureTeacherSession() {
    const teacherSession = wx.getStorageSync('teacherSession') || null

    if (!teacherSession || !teacherSession.isTeacher) {
      wx.redirectTo({
        url: '/pages/teacher-login/teacher-login'
      })
      return
    }

    this.setData({
      teacherName: teacherSession.teacherName || '杨勤老师'
    })
  },

  loadDashboard() {
    const classes = getClasses()
    const works = getAllSubmittedWorks()
    const favoriteWorks = getFavoriteWorks()
    const pendingWorks = works.filter(item => !hasTeacherFeedback(item))
    const reviewedWorks = works.filter(item => hasTeacherFeedback(item))
    const todayPending = pendingWorks.filter(item => isToday(item.createdAt)).length

    this.setData({
      stats: [
        { label: '班级数', value: classes.length },
        { label: '今日待点评', value: todayPending },
        { label: '已点评', value: reviewedWorks.length },
        { label: '收藏作品', value: favoriteWorks.length }
      ],
      recentPendingWorks: pendingWorks.slice(0, 3)
    })
  },

  openClassManage() {
    wx.navigateTo({
      url: '/pages/teacher-classes/teacher-classes'
    })
  },

  openPendingWorks() {
    wx.navigateTo({
      url: '/pages/teacher-review/teacher-review?type=pending'
    })
  },

  openReviewedWorks() {
    wx.navigateTo({
      url: '/pages/teacher-review/teacher-review?type=done'
    })
  },

  openAllWorks() {
    wx.navigateTo({
      url: '/pages/teacher-review/teacher-review?type=all'
    })
  },

  openCommentTemplates() {
    wx.showToast({
      title: '快捷点评模板开发中',
      icon: 'none'
    })
  },

  openFavorites() {
    wx.navigateTo({
      url: '/pages/teacher-favorites/teacher-favorites'
    })
  },

  openExcellentWorks() {
    this.openFavorites()
  },

  logoutTeacher() {
    wx.showModal({
      title: '退出老师端',
      content: '确定退出老师端吗？',
      confirmText: '退出',
      confirmColor: '#d84d4d',
      success: res => {
        if (!res.confirm) return

        wx.removeStorageSync('teacherSession')
        wx.redirectTo({
          url: '/pages/teacher-login/teacher-login'
        })
      }
    })
  },

  handleQuickTap(e) {
    const action = e.currentTarget.dataset.action

    if (this[action]) {
      this[action]()
    }
  },

  goPendingReview() {
    this.openPendingWorks()
  },

  switchTeacherTab(e) {
    const url = e.currentTarget.dataset.url

    if (!url || url === '/pages/teacher-home/teacher-home') return

    wx.redirectTo({
      url
    })
  }
})
