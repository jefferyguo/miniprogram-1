const { getCurrentUser } = require('../../utils/access-control')
const {
  getAvatarText,
  loginWithProfile,
  markProfileSkipped
} = require('../../utils/profile-auth')
const { isValidNickname, normalizeNickname } = require('../../utils/auth-state')

Component({
  data: {
    visible: false,
    mode: 'login',
    nickname: '',
    avatarUrl: '',
    avatarText: '同',
    submitting: false,
    allowSkip: true,
    nicknameFillNotified: false
  },

  methods: {
    open(options = {}) {
      const user = getCurrentUser() || {}
      const mode = options.mode === 'edit' ? 'edit' : 'login'
      const savedNickname = String(options.nickname || user.nickname || user.nickName || '').trim()
      const nickname = mode === 'edit' ? savedNickname : ''

      this.setData({
        visible: true,
        mode,
        nickname,
        avatarUrl: mode === 'edit' ? (user.avatarUrl || '') : '',
        avatarText: getAvatarText(nickname || '同学'),
        submitting: false,
        allowSkip: mode !== 'edit',
        nicknameFillNotified: false
      })
    },

    close() {
      if (this.data.submitting) return
      this.setData({ visible: false })
    },

    noop() {},

    dismiss() {
      if (this.data.allowSkip) {
        this.skip()
        return
      }
      this.close()
    },

    onChooseAvatar(e) {
      const avatarUrl = e.detail.avatarUrl || ''
      this.setData({ avatarUrl })
    },

    syncNicknameFromEvent(e) {
      const nickname = String((e.detail && e.detail.value) || '')
      const shouldNotify = !String(this.data.nickname || '').trim() &&
        Boolean(nickname.trim()) &&
        !this.data.nicknameFillNotified

      this.setData({
        nickname,
        avatarText: getAvatarText(nickname || '同学'),
        nicknameFillNotified: this.data.nicknameFillNotified || shouldNotify
      })

      if (shouldNotify) {
        wx.showToast({
          title: '已填入昵称，可修改',
          icon: 'none'
        })
      }
    },

    onNicknameInput(e) {
      this.syncNicknameFromEvent(e)
    },

    onNicknameBlur(e) {
      this.syncNicknameFromEvent(e)
    },

    async submitProfile() {
      if (this.data.submitting) return
      const nickname = normalizeNickname(this.data.nickname)
      if (!isValidNickname(nickname)) {
        wx.showToast({ title: '请设置有效昵称', icon: 'none' })
        return
      }

      this.setData({ submitting: true })
      wx.showLoading({ title: this.data.mode === 'edit' ? '正在保存' : '正在登录', mask: true })

      try {
        const nicknameSource = this.data.mode === 'edit'
          ? 'manual'
          : 'wechat_or_manual'
        const avatarSource = this.data.avatarUrl
          ? (this.data.mode === 'edit' ? 'manual' : 'wechat')
          : 'default'
        const user = await loginWithProfile({
          nickname,
          avatarUrl: this.data.avatarUrl,
          nicknameSource,
          avatarSource
        })
        this.setData({ visible: false })
        this.triggerEvent('success', { user })
        wx.showToast({ title: this.data.mode === 'edit' ? '已保存' : '登录成功', icon: 'success' })
      } catch (error) {
        wx.showToast({ title: error.message || '操作失败', icon: 'none' })
      } finally {
        wx.hideLoading()
        this.setData({ submitting: false })
      }
    },

    skip() {
      markProfileSkipped()
      this.setData({ visible: false })
      this.triggerEvent('skip')
    }
  }
})
