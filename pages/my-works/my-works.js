const STORAGE_KEYS = {
  trainingDrafts: 'trainingDrafts',
  trainingSubmissions: 'trainingSubmissions',
  extraDrafts: 'extraTrainingDrafts',
  extraSubmissions: 'extraTrainingSubmissions'
}
const {
  buildFeedbackModalContent,
  buildFeedbackModalTitle,
  generateFeedbackForSubmission,
  getFeedbackActionState
} = require('../../utils/ai-feedback')

function getStorageList(key) {
  const list = wx.getStorageSync(key) || []
  let changed = false
  const baseId = Date.now()
  const nextList = list.map((item, index) => {
    if (item.id) return item
    changed = true
    return {
      ...item,
      id: baseId + index
    }
  })

  if (changed) {
    wx.setStorageSync(key, nextList)
  }

  return nextList
}

function getTimeValue(timeText) {
  if (!timeText) return 0
  const date = new Date(String(timeText).replace(/-/g, '/'))
  return date.getTime() || 0
}

function getAiTip(item) {
  if (item.aiFeedbackStatus === 'blocked') return '本次作品时长较短，暂不能生成 AI 点评。'
  if (item.aiFeedbackStatus === 'error' || item.aiFeedbackError) return 'AI反馈生成失败，可稍后重试。'
  if (item.aiFeedbackStatus === 'done' && item.aiFeedback) return 'AI反馈已生成。'
  return ''
}

function buildWork(item, sourceType, submitted, index) {
  const isMain = sourceType === 'main'
  const isVideo = item.type === 'video'
  const feedbackAction = getFeedbackActionState(item)
  const hasTeacherFeedback = !!(item.teacherFeedback || item.teacherFeedbackStatus === 'done')

  return {
    ...item,
    key: `${sourceType}-${item.id || index}`,
    sourceType,
    sourceText: isMain ? '主训练' : '额外训练',
    typeText: isVideo ? '录像作品' : '录音作品',
    actionText: isVideo ? '查看' : '播放',
    titleText: isMain
      ? `${item.moduleTitle || '主训练'}${item.day ? ` Day ${item.day}` : ''}`
      : (item.extraTitle || '额外训练'),
    subtitleText: item.taskTitle || item.content || '训练作品',
    durationText: item.duration || '暂无',
    createdAtText: item.createdAt || '暂无',
    submitted,
    statusText: submitted ? '已提交' : '未提交',
    statusClass: submitted ? 'submitted-status' : 'draft-status',
    feedbackActionText: feedbackAction.text,
    feedbackActionDisabled: feedbackAction.disabled,
    feedbackActionClass: feedbackAction.className,
    hasTeacherFeedback,
    aiTip: getAiTip(item),
    sortTime: getTimeValue(item.createdAt)
  }
}

function mergeWorks(drafts, submissions, sourceType) {
  const map = {}

  drafts.forEach((item, index) => {
    const work = buildWork(item, sourceType, Boolean(item.submitted), index)
    map[work.key] = work
  })

  submissions.forEach((item, index) => {
    const work = buildWork(item, sourceType, true, index)
    map[work.key] = {
      ...(map[work.key] || {}),
      ...work,
      submitted: true,
      statusText: '已提交',
      statusClass: 'submitted-status'
    }
  })

  return Object.keys(map).map(key => map[key])
}

Page({
  data: {
    // 我的作品页只做查看，不在这里提交或删除作品
    works: [],
    totalCount: 0,
    submittedCount: 0,
    draftCount: 0
  },

  onShow() {
    this.loadWorks()
  },

  loadWorks() {
    const trainingDrafts = getStorageList(STORAGE_KEYS.trainingDrafts)
    const trainingSubmissions = getStorageList(STORAGE_KEYS.trainingSubmissions)
    const extraDrafts = getStorageList(STORAGE_KEYS.extraDrafts)
    const extraSubmissions = getStorageList(STORAGE_KEYS.extraSubmissions)

    const works = mergeWorks(trainingDrafts, trainingSubmissions, 'main')
      .concat(mergeWorks(extraDrafts, extraSubmissions, 'extra'))
      .sort((a, b) => b.sortTime - a.sortTime)

    const submittedCount = works.filter(item => item.submitted).length

    this.setData({
      works,
      totalCount: works.length,
      submittedCount,
      draftCount: works.length - submittedCount
    })
  },

  playWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

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

    this.stopAudioContext()
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

  showWorkStatus(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

    if (!target) return

    wx.showToast({
      title: target.submitted ? '已提交，可在点评页查看状态' : '请到对应训练任务中提交',
      icon: 'none'
    })
  },

  handleFeedbackAction(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (!target.submitted) {
      wx.showToast({
        title: '请先提交作品',
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
    this.loadWorks()

    task.then(res => {
      this.loadWorks()
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
      console.log('my works feedback failed', error)
      this.loadWorks()
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
    const target = this.data.works.find(item => item.key === key)

    if (!target || !target.teacherFeedback) {
      wx.showToast({
        title: '暂无老师点评',
        icon: 'none'
      })
      return
    }

    const feedback = target.teacherFeedback

    wx.showModal({
      title: '老师点评',
      content: [
        `老师：${feedback.teacherName || '杨勤老师'}`,
        `评分：${feedback.score || 5} / 5`,
        `标签：${Array.isArray(feedback.tags) ? feedback.tags.join('、') : '暂无'}`,
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

  stopAudioContext() {
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
  },

  onUnload() {
    this.stopAudioContext()
  }
})
