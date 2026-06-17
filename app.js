// app.js
App({
  onLaunch() {
    // 初始化微信云开发，用于前端安全调用云函数
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d0geb9qt9d29ee6fc',
        traceUser: true
      })
    } else {
      console.error('请使用支持云开发的微信开发者工具')
    }

    // 原有本地日志逻辑
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 登录只在用户点击功能入口后触发，不在启动时强制登录
  },

  globalData: {
    userInfo: null,
    role: 'student', // student 学员 / teacher 老师 / admin 管理员
    apiBaseUrl: ''
  }
})