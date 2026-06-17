const {
  buildFeedbackModalContent,
  buildFeedbackModalTitle,
  generateFeedbackForSubmission,
  getFeedbackActionState
} = require('../../utils/ai-feedback')
const {
  getAllSubmittedWorks,
  hasTeacherFeedback
} = require('../../utils/local-data')

function getShortText(text, maxLength = 32) {
  const value = String(text || '训练作品')
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function getAiFeedbackCount(works) {
  return works.filter(item => (
    item.aiFeedbackStatus === 'done' && item.aiFeedback
  )).length
}

function getStatusText(item) {
  if (hasTeacherFeedback(item)) return '老师已点评'
  if (item.aiFeedbackStatus === 'blocked') return '时长不够'
  if (item.aiFeedbackStatus === 'pending') return '生成中'
  if (item.aiFeedbackStatus === 'done') return 'AI反馈'
  if (item.aiFeedbackStatus === 'error' || item.aiFeedbackError) return '生成失败'
  if (item.aiFeedback) return 'AI反馈'
  return '待生成'
}

function getStatusClass(item) {
  if (hasTeacherFeedback(item)) return 'teacher-done-status'
  if (item.aiFeedbackStatus === 'blocked') return 'blocked-status'
  if (item.aiFeedbackStatus === 'pending') return 'pending-status'
  if (item.aiFeedbackStatus === 'error' || item.aiFeedbackError) return 'error-status'
  if (item.aiFeedbackStatus === 'done' || item.aiFeedback) return 'ai-done-status'
  return 'pending-status'
}

function getAiTip(item) {
  if (item.aiFeedbackStatus === 'blocked') return '本次作品时长较短，暂不能生成 AI 点评。'
  if (item.aiFeedbackStatus === 'error' || item.aiFeedbackError) return 'AI反馈生成失败，可稍后重试。'
  if (item.aiFeedbackStatus === 'done' && item.aiFeedback) return 'AI反馈已生成。'
  return ''
}

function buildDisplayWork(item) {
  const feedbackAction = getFeedbackActionState(item)

  return {
    ...item,
    displaySubtitle: item.sourceType === 'main'
      ? (item.taskTitle || '训练任务')
      : getShortText(item.content),
    displayStatus: getStatusText(item),
    displayStatusClass: getStatusClass(item),
    feedbackActionText: feedbackAction.text,
    feedbackActionDisabled: feedbackAction.disabled,
    feedbackActionClass: feedbackAction.className,
    feedbackActionStatus: feedbackAction.status,
    aiTip: getAiTip(item),
    hasTeacherFeedback: hasTeacherFeedback(item)
  }
}

function matchTaskFilter(item, filter) {
  if (!filter || filter.type !== 'task') return true

  const sameDay = Number(item.day) === Number(filter.day)
  const sameModuleId = filter.moduleId && item.moduleId === filter.moduleId
  const sameModuleTitle = filter.moduleTitle && item.moduleTitle === filter.moduleTitle

  return item.sourceType === 'main' && sameDay && (sameModuleId || sameModuleTitle)
}

Page({
  data: {
    // 点评中心只展示已提交作品；筛选入口会在当前页内切换列表。
    works: [],
    filteredWorks: [],
    submittedWorks: [],
    filterType: 'all',
    filterTitle: '',
    totalCount: 0,
    pendingCount: 0,
    reviewedCount: 0,
    aiFeedbackCount: 0,
    feedbackCards: [],
    hasReviewFilter: false,
    reviewFilter: null,
    filterText: '',
    emptyTitle: '暂无已提交作品',
    emptyDesc: '完成训练并提交作品后，这里会显示你的作品和点评状态。',
    emptyButtonText: '去训练'
  },

  onShow() {
    this.loadReviewData()
  },

  loadReviewData() {
    const works = getAllSubmittedWorks().map(buildDisplayWork)
    const reviewFilter = wx.getStorageSync('reviewFilter') || null
    const teacherDoneCount = works.filter(item => hasTeacherFeedback(item)).length
    const pendingCount = works.filter(item => !hasTeacherFeedback(item)).length
    const aiFeedbackCount = getAiFeedbackCount(works)

    this.setData({
      works,
      totalCount: works.length,
      pendingCount,
      reviewedCount: teacherDoneCount,
      aiFeedbackCount,
      feedbackCards: [
        {
          type: 'ai',
          title: 'AI反馈',
          desc: '已提交作品会自动生成 AI 点评，包含优势、提升点和训练建议。'
        },
        {
          type: 'teacher',
          title: '老师点评',
          desc: '老师点评功能开发中，后续支持文字点评、标签和评分。'
        },
        {
          type: 'all',
          title: '已提交作品',
          desc: `当前已有 ${works.length} 个作品进入点评列表。`
        }
      ]
    }, () => {
      if (reviewFilter && reviewFilter.type === 'task') {
        this.applyReviewFilter()
      } else {
        this.showAllWorks(false)
      }
    })
  },

  applyReviewFilter() {
    const reviewFilter = wx.getStorageSync('reviewFilter') || null

    if (!reviewFilter || reviewFilter.type !== 'task') {
      this.showAllWorks(false)
      return
    }

    const filteredWorks = this.data.works.filter(item => matchTaskFilter(item, reviewFilter))
    const filterTitle = `${reviewFilter.moduleTitle || '当前训练'} Day ${reviewFilter.day || ''}`

    this.setData({
      filteredWorks,
      submittedWorks: filteredWorks,
      filterType: 'task',
      filterTitle,
      hasReviewFilter: true,
      reviewFilter,
      filterText: filterTitle,
      emptyTitle: '当前训练日暂无已提交作品',
      emptyDesc: '完成本日训练并提交作品后，可以在这里生成或查看 AI 反馈。',
      emptyButtonText: '返回训练'
    })
  },

  showAllWorks(shouldClearStorage = true) {
    if (shouldClearStorage) {
      wx.removeStorageSync('reviewFilter')
    }

    this.setData({
      filteredWorks: this.data.works,
      submittedWorks: this.data.works,
      filterType: 'all',
      filterTitle: '',
      hasReviewFilter: false,
      reviewFilter: null,
      filterText: '',
      emptyTitle: '暂无已提交作品',
      emptyDesc: '完成训练并提交作品后，这里会显示你的作品和点评状态。',
      emptyButtonText: '去训练'
    })
  },

  showAiFeedbackWorks() {
    wx.removeStorageSync('reviewFilter')
    const filteredWorks = this.data.works.filter(item => (
      item.aiFeedbackStatus === 'done' && item.aiFeedback
    ))

    this.setData({
      filteredWorks,
      submittedWorks: filteredWorks,
      filterType: 'ai',
      filterTitle: 'AI反馈作品',
      hasReviewFilter: false,
      reviewFilter: null,
      filterText: 'AI反馈作品',
      emptyTitle: '暂无 AI 反馈作品',
      emptyDesc: '提交作品后可以点击“生成AI反馈”，系统会在时长达标后生成表达建议。',
      emptyButtonText: '去训练'
    })
  },

  showTeacherFeedbackWorks() {
    wx.removeStorageSync('reviewFilter')
    const filteredWorks = this.data.works.filter(item => hasTeacherFeedback(item))

    this.setData({
      filteredWorks,
      submittedWorks: filteredWorks,
      filterType: 'teacher',
      filterTitle: '老师点评作品',
      hasReviewFilter: false,
      reviewFilter: null,
      filterText: '老师点评作品',
      emptyTitle: '暂无老师点评作品',
      emptyDesc: '老师点评功能开发中，后续可查看老师的文字点评、标签和评分。',
      emptyButtonText: '去训练'
    })
  },

  clearFilter() {
    this.showAllWorks(true)
  },

  clearReviewFilter() {
    this.clearFilter()
  },

  handleFeedbackCardTap(e) {
    const type = e.currentTarget.dataset.type

    if (type === 'ai') {
      this.showAiFeedbackWorks()
      return
    }

    if (type === 'teacher') {
      this.showTeacherFeedbackWorks()
      return
    }

    this.showAllWorks(true)
  },

  findWorkByKey(key) {
    return this.data.works.find(item => item.key === key) ||
      this.data.filteredWorks.find(item => item.key === key)
  },

  playWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.type === 'video') {
      this.previewVideo(target)
      return
    }

    this.playAudio(target)
  },

  playAudio(item) {
    if (!item.filePath) {
      wx.showToast({
        title: '录音文件不存在',
        icon: 'none'
      })
      return
    }

    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
    }

    this.audioContext = wx.createInnerAudioContext()
    this.audioContext.src = item.filePath
    this.audioContext.play()

    wx.showToast({
      title: '开始播放',
      icon: 'none'
    })

    this.audioContext.onError(err => {
      console.error('audio play error', err)
      wx.showToast({
        title: '播放失败',
        icon: 'none'
      })
    })
  },

  previewVideo(item) {
    if (!item.filePath) {
      wx.showToast({
        title: '录像文件不存在',
        icon: 'none'
      })
      return
    }

    wx.previewMedia({
      sources: [
        {
          url: item.filePath,
          type: 'video',
          poster: item.thumbPath || ''
        }
      ],
      fail: err => {
        console.error('preview video error', err)
        wx.showToast({
          title: '查看失败',
          icon: 'none'
        })
      }
    })
  },

  handleFeedbackAction(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    const action = getFeedbackActionState(target)

    if (action.disabled) {
      wx.showToast({
        title: 'AI反馈生成中',
        icon: 'none'
      })
      return
    }

    if (action.blocked) {
      this.showDurationBlockedModal()
      return
    }

    if (action.canView && target.aiFeedback) {
      this.showFeedback(target)
      return
    }

    this.generateFeedback(target)
  },

  generateFeedback(target) {
    const task = generateFeedbackForSubmission(target)
    this.loadReviewData()

    task.then(res => {
      this.loadReviewData()
      if (res.status === 'blocked') {
        this.showDurationBlockedModal()
        return
      }

      if (res.status === 'done') {
        wx.showToast({
          title: 'AI反馈已生成',
          icon: 'success'
        })
        return
      }

      wx.showToast({
        title: res.message || '生成失败，可重试',
        icon: 'none'
      })
    }).catch(error => {
      console.log('manual feedback failed', error)
      this.loadReviewData()
      wx.showToast({
        title: '生成失败，可重试',
        icon: 'none'
      })
    })
  },

  showFeedback(target) {
    if (target.aiFeedbackStatus !== 'done' || !target.aiFeedback) {
      wx.showToast({
        title: 'AI反馈尚未生成',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: buildFeedbackModalTitle(target),
      content: buildFeedbackModalContent(target),
      showCancel: false,
      confirmText: '知道了'
    })
  },

  showDurationBlockedModal() {
    wx.showModal({
      title: '时长不够',
      content: '本次作品时长较短，暂不能生成 AI 点评。建议重新录制更完整的作品后再试。',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  showTeacherFeedback(e) {
    const key = e.currentTarget.dataset.key
    const target = this.findWorkByKey(key)

    if (!target || !target.teacherFeedback) {
      wx.showToast({
        title: '暂无老师点评',
        icon: 'none'
      })
      return
    }

    const feedback = target.teacherFeedback
    const tags = Array.isArray(feedback.tags) ? feedback.tags.join('、') : ''

    wx.showModal({
      title: '老师点评',
      content: [
        `老师：${feedback.teacherName || '杨勤老师'}`,
        `评分：${feedback.score || 5} / 5`,
        `标签：${tags || '暂无'}`,
        `点评内容：${feedback.content || '暂无'}`,
        `点评时间：${feedback.createdAt || '暂无'}`
      ].join('\n\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  },

  switchToTraining() {
    wx.switchTab({
      url: '/pages/training/training'
    })
  },

  onUnload() {
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
  }
})
