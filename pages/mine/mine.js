const { getCurrentOpenId } = require('../../utils/cloud-user')
const auth = require('../../utils/auth')
const {
  formatDateTime,
  getClassByCode,
  getClasses,
  getUserInfo,
  saveClasses,
  saveUserInfo
} = require('../../utils/local-data')

Page({
  data: {
    // 当前版本仅展示学员身份和个人训练相关入口
    isLoggedIn: false,
    userInfo: null,
    displayName: '同学',
    roleText: '游客模式',
    profileTip: '登录后保存训练记录',
    avatarText: '同',
    currentClass: null,
    hasClass: false,
    quickActions: [
      {
        title: '我的作品',
        iconText: '录',
        desc: '查看录音和录像作品',
        type: 'navigate',
        url: '/pages/my-works/my-works'
      },
      {
        title: '我的训练',
        iconText: '练',
        desc: '查看训练记录与进度',
        type: 'switchTab',
        url: '/pages/training/training'
      },
      {
        title: '帮助与反馈',
        iconText: '问',
        desc: '问题反馈与使用帮助',
        type: 'navigate',
        url: '/pages/help-feedback/help-feedback'
      }
    ],
    trainingItems: [
      { title: '我的训练记录', type: 'navigate', url: '/pages/my-works/my-works' },
      { title: '我的点评反馈', type: 'switchTab', url: '/pages/review/review' },
      { title: '我的成长报告', type: 'switchTab', url: '/pages/growth/growth' }
    ],
    aboutItems: [
      { title: '关注视频号', type: 'navigate', url: '/pages/video-channel/video-channel' },
      { title: '联系我们', type: 'navigate', url: '/pages/contact/contact' },
      { title: '分享推荐', type: 'share' },
      { title: '帮助与反馈', type: 'navigate', url: '/pages/help-feedback/help-feedback' },
      { title: '关于我们', type: 'navigate', url: '/pages/about/about' },
      { title: '隐私协议', type: 'navigate', url: '/pages/privacy/privacy' },
      { title: '设置', type: 'navigate', url: '/pages/settings/settings' }
    ]
  },

  onShow() {
    this.loadUserInfo()
  },

  getAvatarText(nickname) {
    const name = (nickname || '同学').trim()
    if (!name) return '同'

    const first = name.slice(0, 1)

    if (/^[a-zA-Z]$/.test(first)) {
      return first.toUpperCase()
    }

    return first
  },

  loadUserInfo() {
    const userInfo = getUserInfo() || {}
    const isLoggedIn = !!(userInfo && (userInfo.isLoggedIn || userInfo.openid))
    const nickname = userInfo.nickname || userInfo.nickName || '同学'
    const currentClass = userInfo.currentClass || null

    this.setData({
      isLoggedIn,
      userInfo: isLoggedIn ? {
        ...userInfo,
        nickname
      } : null,
      displayName: isLoggedIn ? nickname : '同学',
      roleText: isLoggedIn ? '学员' : '游客模式',
      profileTip: isLoggedIn ? '训练记录和点评反馈将自动保存' : '登录后保存训练记录',
      avatarText: isLoggedIn ? this.getAvatarText(nickname) : '同',
      currentClass,
      hasClass: !!currentClass
    })
  },

  handleProfileAction() {
    if (!this.data.isLoggedIn) {
      auth.goLogin({
        redirect: '/pages/mine/mine'
      })
      return
    }

    this.editProfile()
  },

  editProfile() {
    wx.showModal({
      title: '设置昵称',
      editable: true,
      placeholderText: '请输入昵称',
      success: res => {
        if (!res.confirm) return

        const nickname = String(res.content || '').trim()

        if (!nickname) {
          wx.showToast({
            title: '昵称不能为空',
            icon: 'none'
          })
          return
        }

        const userInfo = {
          ...getUserInfo(),
          nickname,
          role: 'student',
          isLoggedIn: true
        }

        saveUserInfo(userInfo)
        this.loadUserInfo()
        wx.showToast({
          title: '已保存',
          icon: 'success'
        })
      }
    })
  },

  handleProfileTap() {
    if (this.data.isLoggedIn) return

    auth.goLogin({
      redirect: '/pages/mine/mine'
    })
  },

  joinClass() {
    wx.showModal({
      title: '加入班级',
      editable: true,
      placeholderText: '请输入班级码',
      confirmText: '加入',
      success: res => {
        if (!res.confirm) return

        const classCode = String(res.content || '').trim().toUpperCase()
        const targetClass = getClassByCode(classCode)

        if (!targetClass) {
          wx.showToast({
            title: '班级码不存在，请确认后重试',
            icon: 'none'
          })
          return
        }

        const userInfo = {
          ...getUserInfo(),
          nickname: this.data.displayName || '同学',
          role: 'student',
          isLoggedIn: true,
          currentClass: {
            classId: targetClass.id,
            className: targetClass.className,
            classCode: targetClass.classCode,
            teacherName: targetClass.teacherName,
            joinedAt: formatDateTime()
          }
        }
        const classes = getClasses().map(item => (
          String(item.id) === String(targetClass.id)
            ? {
              ...item,
              studentCount: Number(item.studentCount || 0) + 1
            }
            : item
        ))

        saveUserInfo(userInfo)
        saveClasses(classes)
        this.loadUserInfo()

        wx.showToast({
          title: '已加入班级',
          icon: 'success'
        })
      }
    })
  },

  viewClassInfo() {
    const currentClass = this.data.currentClass

    if (!currentClass) return

    wx.showModal({
      title: '我的班级',
      content: [
        `班级：${currentClass.className}`,
        `老师：${currentClass.teacherName}`,
        `班级码：${currentClass.classCode}`,
        `加入时间：${currentClass.joinedAt || '暂无'}`
      ].join('\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  },

  exitClass() {
    const currentClass = this.data.currentClass

    if (!currentClass) return

    wx.showModal({
      title: '退出班级',
      content: '退出后，后续提交作品将不再归入该班级，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#d84d4d',
      success: res => {
        if (!res.confirm) return

        const userInfo = {
          ...getUserInfo()
        }
        const classes = getClasses().map(item => (
          String(item.id) === String(currentClass.classId)
            ? {
              ...item,
              studentCount: Math.max(Number(item.studentCount || 0) - 1, 0)
            }
            : item
        ))

        delete userInfo.currentClass
        saveUserInfo(userInfo)
        saveClasses(classes)
        this.loadUserInfo()

        wx.showToast({
          title: '已退出班级',
          icon: 'none'
        })
      }
    })
  },

  handleQuickTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.handleActionWithLogin(this.data.quickActions[index])
  },

  handleListTap(e) {
    const group = e.currentTarget.dataset.group
    const index = Number(e.currentTarget.dataset.index)
    const list = group === 'training' ? this.data.trainingItems : this.data.aboutItems
    const item = list[index]

    if (group === 'about') {
      this.handleAction(item)
      return
    }

    this.handleActionWithLogin(item)
  },

  handleActionWithLogin(item) {
    if (!item) return

    if (item.type === 'share') {
      this.handleShareTap()
      return
    }

    auth.requireLogin(() => this.handleAction(item), {
      redirect: item.type === 'navigate' || item.type === 'switchTab' ? item.url : ''
    })
  },

  handleAction(item) {
    if (!item) return false

    if (item.type === 'switchTab') {
      wx.switchTab({
        url: item.url
      })
      return true
    }

    if (item.type === 'navigate') {
      wx.navigateTo({
        url: item.url
      })
      return true
    }

    if (item.type === 'share') {
      this.handleShareTap()
      return true
    }

    wx.showToast({
      title: item.toast || item.title,
      icon: 'none'
    })
    return false
  },

  handleShareTap() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage']
    })
  },

  onShareAppMessage() {
    return {
      title: '每天 3 分钟，练成好口才',
      path: '/pages/training/training',
      imageUrl: ''
    }
  }
})
