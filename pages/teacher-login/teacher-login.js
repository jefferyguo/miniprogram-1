Page({
  data: {
    // 老师端为隐藏入口，不在学员 tabBar 和普通页面展示。
    // 当前老师登录为开发阶段 mock 口令。
    // 正式上线前应改为云函数校验老师身份，不能只依赖前端口令。
    password: ''
  },

  onLoad() {
    const teacherSession = wx.getStorageSync('teacherSession') || null

    if (teacherSession && teacherSession.isTeacher) {
      wx.redirectTo({
        url: '/pages/teacher-home/teacher-home'
      })
    }
  },

  onPasswordInput(e) {
    this.setData({
      password: e.detail.value
    })
  },

  enterTeacherHome() {
    if (this.data.password === '888888') {
      wx.setStorageSync('teacherSession', {
        isTeacher: true,
        teacherName: '杨勤老师',
        loginAt: Date.now()
      })

      wx.showToast({
        title: '登录成功',
        icon: 'success'
      })

      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/teacher-home/teacher-home'
        })
      }, 500)
      return
    }

    wx.showToast({
      title: '教师口令错误',
      icon: 'none'
    })
  }
})
