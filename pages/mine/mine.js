const auth = require('../../utils/auth')
const { getCurrentAccessStatus } = require('../../utils/access-control')
const { healthCheck, getAdminProfile } = require('../../utils/cloud-api')
const { FEATURE_FLAGS } = require('../../utils/feature-flags')
const { JUST_LOGGED_OUT_KEY } = require('../../utils/profile-auth')
const {
  bindPhoneWithCode,
  isPhoneBound,
  refreshPhoneMembership
} = require('../../utils/phone-auth')
const {
  formatDateTime,
  getClassByCode,
  getClasses,
  getUserInfo,
  saveClasses,
  saveUserInfo
} = require('../../utils/local-data')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline
} = require('../../utils/share-config')

const XIAOHONGSHU_URL = 'https://www.xiaohongshu.com/user/profile/636dad38000000001f01f1b7?xsec_token=YByzICSU3RtKmCt33QGC8N_DdhizKaN09aRDunhNxGDVs=&xsec_source=app_share&xhsshare=WeixinSession&appuid=636dad38000000001f01f1b7&apptime=1782869328&share_id=3753d8051b224c1f9ff50cbcac7fa680'
const STORE_ADDRESS = '武汉市武昌区中南路中建广场B座12楼'
const CONTACT_PHONE = '17786012145'
const TEACHER_WECHAT_QR = '/images/customer-service-qr.png'

// 社交平台弹层共用一套结构，避免账号与二维码资源混用。
const SOCIAL_MODAL_CONFIG = {
  douyin: {
    qr: '/images/douyin-qrcode.jpg',
    link: ''
  },
  xiaohongshu: {
    qr: '/images/xiaohongshu-qrcode.jpg',
    link: XIAOHONGSHU_URL
  }
}

Page({
  data: {
    // 当前版本仅展示学员身份和个人训练相关入口
    userInfo: null,
    displayName: '同学',
    roleText: '普通用户',
    profileTip: '登录后保存训练记录',
    avatarText: '同',
    avatarUrl: '',
    memberStatus: null,
    memberLabel: '普通用户',
    memberBadgeClass: 'member-free',
    // memberTip removed — 不在顶部卡片显示免费/AI次数
    membershipExpireText: '',
    memberButtonText: '开通会员',
    phoneBound: false,
    phoneStatusText: '',
    bindingLogin: false,
    currentClass: null,
    hasClass: false,
    // 班级入口暂时隐藏，后续可通过统一开关恢复
    showClassSection: FEATURE_FLAGS.classEnabled,
    featureFlags: FEATURE_FLAGS,
    socialModalVisible: false,
    socialModalType: '',
    socialModalQr: '',
    socialModalLink: '',
    socialModalQrLoadError: false,
    contactModalVisible: false,
    teacherWechatQr: TEACHER_WECHAT_QR,
    teacherQrLoadError: false,
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
      { title: '我的成长', desc: '查看训练进度与成长记录', type: 'navigate', url: '/pages/growth/growth' },
      { title: '会员中心', desc: '进阶训练与 AI 次数', type: 'memberModal' }
    ],
    aboutItems: [
      { title: '关注视频号', type: 'navigate', url: '/pages/video-channel/video-channel', visible: FEATURE_FLAGS.showVideoChannelEntry },
      { title: '关注抖音', type: 'douyin', visible: true },
      { title: '关注小红书', type: 'xiaohongshu', visible: true },
      { title: '联系我们', type: 'contact', visible: true },
      { title: '分享推荐', type: 'share', visible: true },
      { title: '帮助与反馈', type: 'navigate', url: '/pages/help-feedback/help-feedback', visible: true },
      { title: '关于我们', type: 'navigate', url: '/pages/about/about', visible: true },
      { title: '隐私协议', type: 'navigate', url: '/pages/privacy/privacy', visible: true },
      { title: '设置', type: 'navigate', url: '/pages/settings/settings', visible: true }
    ],
    // 调试入口独立于正式列表，仅由 feature flag 控制渲染。
    cloudDebugItem: { title: '云端连通测试', type: 'cloudHealth' }
  },

  onShow() {
    enableShareMenu()
    this.loadUserInfo()
    if (isPhoneBound()) {
      refreshPhoneMembership()
        .then(() => this.loadUserInfo())
        .catch(error => console.warn('[mine] 会员身份刷新失败:', error))
    }
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
    const rawPhoneBound = isPhoneBound(userInfo)
    // 两层模型：基础登录（有稳定身份+profile）vs 手机绑定
    // phoneBound 只在 isAuthenticated=true 时有效；无身份时忽略旧缓存
    const isAuthenticated = auth.isAuthenticated()
    const phoneBound = isAuthenticated && rawPhoneBound
    const nickname = (isAuthenticated ? (userInfo.nickname || userInfo.nickName || '同学') : '同学').trim()
    const currentClass = userInfo.currentClass || null
    const accessStatus = getCurrentAccessStatus()
    const memberLabel = phoneBound ? accessStatus.label : '普通用户'
    const membershipEndAt = accessStatus.membershipEndAt || ''
    const membershipExpireText = phoneBound && accessStatus.canAccessAdvanced && membershipEndAt
      ? `有效期至：${membershipEndAt}`
      : ''

    const app = getApp()
    if (app && app.globalData) {
      app.globalData.userInfo = isAuthenticated ? userInfo : null
      app.globalData.isLogin = phoneBound
      app.globalData.isAuthenticated = isAuthenticated
      app.globalData.profileCompleted = isAuthenticated
    }

    this.setData({
      phoneBound,
      isAuthenticated,
      userInfo: isAuthenticated ? { ...userInfo, nickname } : null,
      displayName: isAuthenticated ? (nickname || '同学') : '同学',
      roleText: isAuthenticated ? '学员' : '普通用户',
      profileTip: isAuthenticated ? '' : '登录后保存训练记录',
      avatarText: isAuthenticated ? this.getAvatarText(nickname || '同学') : '同',
      avatarUrl: isAuthenticated ? (userInfo.avatarUrl || '') : '',
      memberStatus: phoneBound ? accessStatus : null,
      memberLabel,
      memberBadgeClass: isAuthenticated ? `member-${accessStatus.roleType}` : 'member-free',
      membershipExpireText,
      memberButtonText: isAuthenticated && accessStatus.canAccessAdvanced ? '会员权益' : '开通会员',
      phoneBound,
      phoneStatusText: phoneBound
        ? `已绑定：${userInfo.phoneMasked || '手机号已脱敏'}`
        : '',
      currentClass,
      hasClass: !!currentClass
    })
  },

  openLoginGate() {
    auth.requirePhoneBound(null, {
      actionName: '登录',
      source: 'mine_page',
      resumePolicy: 'manual_retry'
    })
  },

  async onGetPhoneNumberLogin(e) {
    if (this.data.bindingLogin) return
    const code = e.detail && e.detail.code
    if (!code) {
      wx.showToast({
        title: '需要绑定手机号后才能保存训练记录和使用 AI 点评',
        icon: 'none'
      })
      return
    }

    this.setData({ bindingLogin: true })
    wx.showLoading({ title: '正在登录', mask: true })
    let loginSucceeded = false
    let errorMessage = ''
    try {
      await bindPhoneWithCode(code)
      this.loadUserInfo()
      loginSucceeded = true
    } catch (error) {
      errorMessage = error.message || '当前暂无法获取手机号，请联系周老师绑定手机号'
    } finally {
      wx.hideLoading()
      this.setData({ bindingLogin: false })
    }

    wx.showToast({
      title: loginSucceeded ? '登录成功' : errorMessage,
      icon: loginSucceeded ? 'success' : 'none'
    })
  },

  handleProfileAction() {
    if (!this.data.isAuthenticated) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    this.editProfile()
  },

  openMemberCenter() {
    const modal = this.selectComponent('#memberBenefitModal')
    if (modal && typeof modal.open === 'function') {
      modal.open({ reason: 'member_center' })
      return
    }
    wx.navigateTo({ url: '/pages/member-center/member-center' })
  },

  editProfile() {
    const modal = this.selectComponent('#profileLoginModal')
    if (modal && typeof modal.open === 'function') modal.open({ mode: 'edit' })
  },

  onProfileSaved() {
    this.loadUserInfo()
  },

  onProfileSkipped() {
    this.loadUserInfo()
  },

  handleProfileTap() {
    if (this.data.isAuthenticated) this.editProfile()
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

    if (group === 'about' || (item && item.type === 'memberModal')) {
      this.handleAction(item)
      return
    }

    this.handleActionWithLogin(item)
  },

  handleActionWithLogin(item) {
    if (!item) return

    // 个人数据入口统一要求手机号登录；高风险操作仍由目标页面自行校验并要求手动重试。
    // requireLogin 在已登录时会同步执行回调，未登录时则在 Level 1 完成后执行；此处不再重复调用。
    auth.requireLogin(() => this.handleAction(item), { actionName: '查看个人中心' })
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

    if (item.type === 'memberModal') {
      this.openMemberCenter()
      return true
    }

    if (item.type === 'share') {
      this.handleShareTap()
      return true
    }

    if (item.type === 'douyin') {
      this.openSocialModal('douyin')
      return true
    }

    if (item.type === 'xiaohongshu') {
      this.openSocialModal('xiaohongshu')
      return true
    }

    if (item.type === 'contact') {
      this.openContactModal()
      return true
    }

    if (item.type === 'cloudHealth') {
      this.testCloudHealth()
      return true
    }

    wx.showToast({
      title: item.toast || item.title,
      icon: 'none'
    })
    return false
  },

  openSocialModal(type) {
    const config = SOCIAL_MODAL_CONFIG[type]
    if (!config) return

    this.setData({
      socialModalVisible: true,
      socialModalType: type,
      socialModalQr: config.qr,
      socialModalLink: config.link,
      socialModalQrLoadError: false
    })
  },

  closeSocialModal() {
    this.setData({ socialModalVisible: false })
  },

  openContactModal() {
    this.setData({
      contactModalVisible: true,
      teacherQrLoadError: false
    })
  },

  closeContactModal() {
    this.setData({ contactModalVisible: false })
  },

  noop() {},

  onSocialQrError() {
    this.setData({ socialModalQrLoadError: true })
  },

  onTeacherQrError() {
    this.setData({ teacherQrLoadError: true })
  },

  saveCurrentQr(e) {
    const qrType = (e.currentTarget.dataset && e.currentTarget.dataset.qrType) || this.data.socialModalType
    const isContact = qrType === 'contact'

    this.saveQrToAlbum({
      path: isContact ? this.data.teacherWechatQr : this.data.socialModalQr,
      hasLoadError: isContact ? this.data.teacherQrLoadError : this.data.socialModalQrLoadError,
      errorField: isContact ? 'teacherQrLoadError' : 'socialModalQrLoadError'
    })
  },

  saveQrToAlbum(options) {
    const { path, hasLoadError, errorField } = options
    if (hasLoadError || !path) {
      wx.showToast({ title: '二维码待上传', icon: 'none' })
      return
    }

    wx.getImageInfo({
      src: path,
      success: imageInfo => {
        wx.saveImageToPhotosAlbum({
          filePath: imageInfo.path,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: error => this.handleAlbumPermissionError(error)
        })
      },
      fail: error => {
        const message = String((error && error.errMsg) || '').toLowerCase()
        const imageMissing = message.includes('not found') || message.includes('no such file') || message.includes('not exist')

        if (imageMissing && errorField) this.setData({ [errorField]: true })
        wx.showToast({
          title: imageMissing ? '二维码待上传' : '保存失败，请稍后重试',
          icon: 'none'
        })
      }
    })
  },

  handleAlbumPermissionError(error) {
    const message = String((error && error.errMsg) || '')
    if (message.includes('auth deny') || message.includes('auth denied')) {
      wx.showModal({
        title: '需要相册权限',
        content: '请在设置中允许保存图片到相册。',
        confirmText: '去设置',
        success: result => {
          if (result.confirm) wx.openSetting()
        }
      })
      return
    }
    wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
  },

  copySocialLink() {
    if (this.data.socialModalType !== 'xiaohongshu' || !this.data.socialModalLink) return

    wx.setClipboardData({
      data: this.data.socialModalLink,
      success: () => wx.showToast({ title: '小红书链接已复制', icon: 'success' })
    })
  },

  callContactPhone() {
    wx.makePhoneCall({ phoneNumber: CONTACT_PHONE })
  },

  copyStoreAddress() {
    wx.setClipboardData({
      data: STORE_ADDRESS,
      success: () => wx.showToast({ title: '地址已复制', icon: 'success' })
    })
  },

  testCloudHealth() {
    healthCheck().then(async res => {
      console.log('[mine] cloud health:', { success: res && res.success === true })
      const adminProfile = await getAdminProfile().catch(err => {
        console.warn('[mine] getAdminProfile failed:', err)
        return null
      })
      console.log('[mine] admin profile:', {
        success: Boolean(adminProfile),
        isAdmin: Boolean(adminProfile && adminProfile.isAdmin)
      })

      const roleText = adminProfile && adminProfile.isAdmin
        ? `管理员角色：${adminProfile.role}（${adminProfile.source}）`
        : '当前不是管理员，可到管理员端初始化。'

      wx.showModal({
        title: '云端连通成功',
        content: [
          `openId 后 6 位：${res.openid ? res.openid.slice(-6) : '无'}`,
          roleText
        ].join('\n')
      })
    }).catch(err => {
      wx.showModal({
        title: '云端连通失败',
        content: err.message || '请检查云函数是否已部署'
      })
    })
  },

  logout() {
    wx.showModal({
      title: '确认退出登录？',
      content: '退出后将暂时无法同步训练记录和查看个人资料，重新登录后可继续使用。',
      cancelText: '取消',
      confirmText: '退出登录',
      confirmColor: '#c85a5a',
      success: res => {
        if (!res.confirm) return

        const identityStorageKeys = [
          'userInfo',
          'memberProfile',
          'userProfile',
          'profileCompleted',
          'skippedProfileAuth',
          'profileAuthSkipped',
          'profileAuthSkippedAt',
          'profileLoginPrompted',
          'loginState',
          'token',
          'sessionToken',
          'openid',
          'openId',
          'cloudOpenid',
          JUST_LOGGED_OUT_KEY
        ]

        identityStorageKeys.forEach(key => wx.removeStorageSync(key))
        wx.setStorageSync(JUST_LOGGED_OUT_KEY, true)
        auth.clearUserInfo()

        const app = getApp()
        if (app && app.globalData) {
          app.globalData.userInfo = null
          app.globalData.isLogin = false
          app.globalData.memberProfile = null
          app.globalData.profileCompleted = false
          app.globalData.skippedProfileAuth = false
        }

        const memberModal = this.selectComponent('#memberBenefitModal')
        const profileModal = this.selectComponent('#profileLoginModal')
        if (memberModal && typeof memberModal.close === 'function') memberModal.close()
        if (profileModal && typeof profileModal.close === 'function') profileModal.close()

        this.setData({
          isAuthenticated: false,
          phoneBound: false,
          userInfo: null,
          displayName: '同学',
          roleText: '普通用户',
          profileTip: '登录后保存训练记录',
          avatarText: '同',
          avatarUrl: '',
          memberStatus: null,
          memberLabel: '普通用户',
          memberBadgeClass: 'member-free',
          // memberTip removed — 不在顶部卡片显示免费/AI次数
          membershipExpireText: '',
          memberButtonText: '开通会员',
          phoneBound: false,
          phoneStatusText: '',
          bindingLogin: false,
          currentClass: null,
          hasClass: false
        })

        wx.showToast({
          title: '已退出登录',
          icon: 'success'
        })
      }
    })
  },

  handleShareTap() {
    enableShareMenu()
    wx.showToast({ title: '请使用右上角菜单分享', icon: 'none' })
  },

  onMembershipChanged() {
    refreshPhoneMembership()
      .catch(() => null)
      .then(() => this.loadUserInfo())
  },

  onShareAppMessage() {
    return getDefaultShareMessage({
      title: '杨勤口才训练KEEP｜记录每一次表达成长',
      path: '/pages/mine/mine',
      pageType: 'default'
    })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({
      title: '杨勤口才训练KEEP｜记录每一次表达成长',
      targetPage: 'mine',
      pageType: 'default'
    })
  }
})
