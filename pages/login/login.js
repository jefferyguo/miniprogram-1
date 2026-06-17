const auth = require('../../utils/auth')

const TAB_PAGES = [
  '/pages/training/training',
  '/pages/review/review',
  '/pages/growth/growth',
  '/pages/mine/mine'
]

function buildMockUser() {
  return {
    id: Date.now(),
    nickname: '同学',
    role: 'student',
    isLoggedIn: true,
    loginType: 'mock',
    loginAt: Date.now()
  }
}

Page({
  data: {
    redirect: '',
    isLoggingIn: false
  },

  onLoad(options) {
    this.setData({
      redirect: options.redirect || ''
    })
  },

  handleLogin() {
    if (this.data.isLoggingIn) return

    this.setData({
      isLoggingIn: true
    })

    wx.login({
      success: res => {
        if (!res.code) {
          this.setData({
            isLoggingIn: false
          })
          wx.showToast({
            title: '登录失败，请重试',
            icon: 'none'
          })
          return
        }

        this.loginWithCloud(res.code)
      },
      fail: () => {
        this.setData({
          isLoggingIn: false
        })
        wx.showToast({
          title: '微信登录失败',
          icon: 'none'
        })
      }
    })
  },

  loginWithCloud(code) {
    if (!wx.cloud || !wx.cloud.callFunction) {
      this.finishLogin(buildMockUser())
      return
    }

    wx.cloud.callFunction({
      name: 'login',
      data: {
        code
      },
      success: cloudRes => {
        const user = cloudRes.result && cloudRes.result.user
        this.finishLogin(user || buildMockUser())
      },
      fail: err => {
        console.warn('cloud login failed, use mock login', err)
        this.finishLogin(buildMockUser())
      }
    })
  },

  finishLogin(userInfo) {
    auth.setUserInfo({
      ...userInfo,
      nickname: userInfo.nickname || userInfo.nickName || '同学',
      role: userInfo.role || 'student',
      isLoggedIn: true
    })

    this.setData({
      isLoggingIn: false
    })

    wx.showToast({
      title: '登录成功',
      icon: 'success'
    })

    setTimeout(() => {
      this.goBackOrContinue()
    }, 350)
  },

  goBackOrContinue() {
    const pendingResult = auth.consumePendingAction()

    if (pendingResult !== null) {
      if (pendingResult === false || pendingResult === undefined) {
        this.navigateBackSafely()
      }
      return
    }

    const redirect = this.data.redirect ? decodeURIComponent(this.data.redirect) : ''

    if (redirect) {
      this.navigateAfterLogin(redirect)
      return
    }

    this.navigateBackSafely()
  },

  navigateAfterLogin(url) {
    if (TAB_PAGES.includes(url)) {
      wx.switchTab({
        url
      })
      return
    }

    wx.redirectTo({
      url,
      fail: () => {
        this.navigateBackSafely()
      }
    })
  },

  navigateBackSafely() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/mine/mine'
        })
      }
    })
  }
})
