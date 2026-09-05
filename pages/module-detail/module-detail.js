const {
  SUBMISSIONS_KEY,
  formatContentTitle,
  getModuleById,
  isTrainingContentComplete
} = require('../../utils/training-data')
const { canAccessTask, getCurrentAccessStatus } = require('../../utils/access-control')
const { isPhoneBound, refreshPhoneMembership, requirePhoneBound } = require('../../utils/phone-auth')
const { getRemoteTrainingDebugState, refreshRemoteTrainingContents } = require('../../utils/remote-training')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline
} = require('../../utils/share-config')

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
    totalDays: 0,
    progressPercent: 0,
    progressText: '0%',
    accessStatus: null
  },

  onLoad(options) {
    enableShareMenu()
    const moduleId = options.moduleId || 'reading'
    this._moduleLoadRevision = 0
    this._isPageActive = true

    this.setData({
      moduleId
    })

    this.loadModule(moduleId)
    this.loadRemoteModule({ force: true })
  },

  loadRemoteModule(options = {}) {
    const revision = ++this._moduleLoadRevision
    refreshRemoteTrainingContents({ force: options.force === true, category: this.getCloudCategory() })
      .then(() => {
        if (this._isPageActive && revision === this._moduleLoadRevision) this.loadModule()
      })
      .catch(error => console.warn('[module-detail] 训练列表刷新失败，继续使用本地/缓存数据:', error))
  },

  getCloudCategory() {
    return this.data.moduleId === 'retell' ? 'retelling' : this.data.moduleId
  },

  onShow() {
    this._isPageActive = true
    if (this.data.moduleId) {
      this.loadModule()
      if (isPhoneBound()) {
        refreshPhoneMembership()
          .catch(error => console.warn('[module-detail] 权益刷新失败:', error))
          .then(() => this.loadRemoteModule())
      } else {
        this.loadRemoteModule()
      }
    }
  },

  getDisplayIndex(index, item) {
    const sortOrder = Number(item && item.sortOrder || 0)
    return sortOrder > 0 ? sortOrder : index + 1
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
    const accessStatus = getCurrentAccessStatus()
    const completedContentIds = new Set(records
      .filter(item => item.moduleId === moduleInfo.id)
      .map(item => String(item.contentId || '').trim())
      .filter(Boolean))
    const days = moduleInfo.days.map((item, index) => {
      const completed = completedContentIds.has(String(item.contentId || '').trim())
      const accessResult = canAccessTask(moduleInfo.id, item)
      const isLocked = !accessResult.allowed
      const isMemberContent = accessResult.requiresMembership === true
      const isUnlocked = isMemberContent && accessResult.allowed

      return {
        ...item,
        displayIndex: this.getDisplayIndex(index, item),
        displayTitle: item.displayTitle || formatContentTitle(item),
        completed,
        isMemberContent,
        isLocked,
        isUnlocked,
        status: isLocked
          ? '会员'
          : (completed ? '已完成' : (isUnlocked ? '已解锁' : '未完成'))
      }
    })
    const totalDays = moduleInfo.days.length
    const completedCount = days.filter(item => item.completed).length
    const progressPercent = totalDays ? Math.round((completedCount / totalDays) * 1000) / 10 : 0

    this.setData({
      moduleInfo,
      days,
      accessStatus,
      completedCount,
      totalDays,
      progressPercent,
      progressText: `${progressPercent}%`
    })
  },

  onHide() {
    this._isPageActive = false
  },

  onUnload() {
    this._isPageActive = false
    this._moduleLoadRevision = Number(this._moduleLoadRevision || 0) + 1
  },

  openTask(e) {
    const day = Number(e.currentTarget.dataset.day)
    const contentId = e.currentTarget.dataset.contentId || ''
    const task = contentId
      ? this.data.days.find(item => String(item.contentId || '') === String(contentId))
      : null

    if (!contentId || !task) {
      wx.showToast({ title: '内容目录正在同步，请稍后重试', icon: 'none' })
      return
    }

    const accessResult = canAccessTask(this.data.moduleId, task)
    const category = this.getCloudCategory()
    const remoteState = getRemoteTrainingDebugState({ category, contentId })
    console.log('[module-detail] 点击训练内容:', {
      category,
      day,
      contentId,
      title: task && (task.displayTitle || task.contentTitle || task.title) || '',
      contentComplete: isTrainingContentComplete(task),
      categoryLoading: remoteState.categoryLoading,
      contentLoading: remoteState.contentLoading,
      cacheHit: remoteState.cacheHit
    })
    console.log('[module-detail] access result:', accessResult)

    if (!accessResult.allowed) {
      if (accessResult.reason === 'need_phone') {
        requirePhoneBound('使用会员训练内容', {
          page: this,
          onSuccess: () => this.openTask(e)
        })
        return
      }
      this.showMemberModal()
      return
    }

    wx.navigateTo({
      url: `/pages/task-detail/task-detail?moduleId=${this.data.moduleId}&day=${day}&contentId=${encodeURIComponent(contentId)}`
    })
  },

  showMemberModal() {
    wx.showModal({
      title: '会员内容',
      content: '该训练为会员内容，开通会员后即可解锁更多训练。',
      confirmText: '开通会员',
      cancelText: '先看看',
      success: res => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/member-center/member-center'
          })
        }
      }
    })
  },

  onShareAppMessage() {
    const title = this.data.moduleInfo && this.data.moduleInfo.title || '口才训练'
    return getDefaultShareMessage({
      title: `${title}｜每天练一点，表达更自信`,
      path: `/pages/module-detail/module-detail?moduleId=${encodeURIComponent(this.data.moduleId || 'reading')}`,
      pageType: 'training'
    })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({
      title: `${this.data.moduleInfo && this.data.moduleInfo.title || '口才训练'}｜每天练一点，表达更自信`,
      targetPage: 'module-detail',
      params: { moduleId: this.data.moduleId || 'reading' },
      pageType: 'training'
    })
  }
})
