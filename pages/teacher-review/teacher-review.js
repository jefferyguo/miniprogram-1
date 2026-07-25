const {
  addWorkToDefaultFavorite,
  formatDateTime,
  getAllSubmittedWorks,
  getClassById,
  getFavoriteWorks,
  hasTeacherFeedback,
  updateSubmissionById
} = require('../../utils/local-data')
const { getVideoPath, previewVideoByPath } = require('../../utils/work-media')

const QUICK_TAGS = [
  '声音清楚',
  '表达完整',
  '语速稳定',
  '逻辑清晰',
  '继续加油',
  '注意停顿',
  '声音再打开',
  '重点再突出'
]

function getFilterText(type) {
  if (type === 'pending') return '待点评'
  if (type === 'done') return '已点评'
  return '全部作品'
}

function getAiStatusText(item) {
  if (item.aiFeedbackStatus === 'done') return 'AI已反馈'
  if (item.aiFeedbackStatus === 'pending') return 'AI生成中'
  if (item.aiFeedbackStatus === 'blocked') return '时长不够'
  if (item.aiFeedbackStatus === 'error' || item.aiFeedbackError) return '生成失败'
  if (item.aiFeedback) return 'AI已反馈'
  return '暂无AI反馈'
}

function buildTeacherWork(item, favoriteWorks) {
  const favoriteSourceType = item.sourceType === 'extra' ? 'extra' : 'training'
  const isFavorited = favoriteWorks.some(favorite => (
    String(favorite.submissionId) === String(item.id) &&
    String(favorite.sourceType) === favoriteSourceType
  ))

  return {
    ...item,
    aiStatusText: getAiStatusText(item),
    teacherStatusText: hasTeacherFeedback(item) ? '老师已点评' : '待老师点评',
    favoriteText: isFavorited ? '已收藏' : '收藏',
    isFavorited
  }
}

Page({
  data: {
    type: 'pending',
    classId: '',
    className: '',
    filterText: '待点评',
    filterOptions: [
      { type: 'all', text: '全部' },
      { type: 'pending', text: '待点评' },
      { type: 'done', text: '已点评' }
    ],
    works: [],
    activeWorkKey: '',
    commentText: '',
    selectedTags: [],
    selectedScore: 5,
    quickTags: QUICK_TAGS.map(label => ({ label, selected: false })),
    scores: [1, 2, 3, 4, 5]
  },

  onLoad(options) {
    const type = options.type || 'pending'
    const classId = options.classId || ''
    const targetClass = classId ? getClassById(classId) : null

    this.setData({
      type,
      classId,
      className: targetClass ? targetClass.className : '',
      filterText: getFilterText(type)
    })
  },

  onShow() {
    this.loadWorks()
  },

  loadWorks() {
    const favoriteWorks = getFavoriteWorks()
    let works = getAllSubmittedWorks()

    if (this.data.classId) {
      works = works.filter(item => String(item.classId || '') === String(this.data.classId))
    }

    if (this.data.type === 'pending') {
      works = works.filter(item => !hasTeacherFeedback(item))
    }

    if (this.data.type === 'done') {
      works = works.filter(item => hasTeacherFeedback(item))
    }

    this.setData({
      works: works.map(item => buildTeacherWork(item, favoriteWorks))
    })
  },

  switchReviewFilter(e) {
    const type = e.currentTarget.dataset.type || 'all'

    this.setData({
      type,
      filterText: getFilterText(type),
      activeWorkKey: ''
    }, () => {
      this.loadWorks()
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

    this.audioContext.onError(error => {
      console.error('teacher audio play error', error)
      wx.showToast({
        title: '播放失败',
        icon: 'none'
      })
    })
  },

  previewVideo(item) {
    const videoPath = getVideoPath(item)

    if (!videoPath) {
      wx.showToast({
        title: '录像文件不存在',
        icon: 'none'
      })
      return
    }

    previewVideoByPath(videoPath, item.displaySubtitle || item.displayTitle || '训练录像')
  },

  writeFeedback(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)
    const feedback = target && target.teacherFeedback ? target.teacherFeedback : null

    this.setData({
      activeWorkKey: key,
      commentText: feedback ? feedback.content : '',
      selectedTags: feedback && Array.isArray(feedback.tags) ? feedback.tags : [],
      selectedScore: feedback ? Number(feedback.score || 5) : 5,
      quickTags: QUICK_TAGS.map(label => ({
        label,
        selected: feedback && Array.isArray(feedback.tags) ? feedback.tags.indexOf(label) > -1 : false
      }))
    })
  },

  cancelFeedback() {
    this.setData({
      activeWorkKey: '',
      commentText: '',
      selectedTags: [],
      selectedScore: 5,
      quickTags: QUICK_TAGS.map(label => ({ label, selected: false }))
    })
  },

  onCommentInput(e) {
    this.setData({
      commentText: e.detail.value
    })
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const selectedTags = this.data.selectedTags.slice()
    const index = selectedTags.indexOf(tag)

    if (index > -1) {
      selectedTags.splice(index, 1)
    } else {
      selectedTags.push(tag)
    }

    this.setData({
      selectedTags,
      quickTags: QUICK_TAGS.map(label => ({
        label,
        selected: selectedTags.indexOf(label) > -1
      }))
    })
  },

  selectScore(e) {
    this.setData({
      selectedScore: Number(e.currentTarget.dataset.score)
    })
  },

  saveFeedback(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)
    const content = String(this.data.commentText || '').trim()

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (!content) {
      wx.showToast({
        title: '请输入点评内容',
        icon: 'none'
      })
      return
    }

    const teacherFeedback = {
      teacherName: '杨勤老师',
      content,
      tags: this.data.selectedTags,
      score: this.data.selectedScore,
      createdAt: formatDateTime()
    }

    updateSubmissionById(target._storageKey, target.id, {
      teacherFeedback,
      teacherFeedbackStatus: 'done'
    })

    this.setData({
      activeWorkKey: '',
      commentText: '',
      selectedTags: [],
      selectedScore: 5,
      quickTags: QUICK_TAGS.map(label => ({ label, selected: false }))
    })
    this.loadWorks()

    wx.showToast({
      title: '点评已保存',
      icon: 'success'
    })
  },

  viewFeedback(e) {
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

  collectWork(e) {
    const key = e.currentTarget.dataset.key
    const target = this.data.works.find(item => item.key === key)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    const result = addWorkToDefaultFavorite(target)

    if (result.duplicated) {
      wx.showToast({
        title: '该作品已在收藏夹中',
        icon: 'none'
      })
      return
    }

    this.loadWorks()
    wx.showToast({
      title: '已加入收藏夹',
      icon: 'success'
    })
  },

  switchTeacherTab(e) {
    const url = e.currentTarget.dataset.url

    if (!url) return

    if (url.indexOf('/pages/teacher-review/teacher-review') === 0 && this.data.type === 'all' && !this.data.classId) {
      return
    }

    wx.redirectTo({
      url
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
