// pages/extra-training/extra-training.js
const { extraTraining } = require('../../utils/training-data')
const { requestTrainingFeedback } = require('../../utils/ai-feedback')
const { buildClassSubmissionPatch } = require('../../utils/local-data')

const PAGE_CONFIG = {
  dailyQuote: {
    contentTitle: '今日金句',
    contentTip: '先朗读，再用自己的话表达理解'
  },
  randomTopic: {
    contentTitle: '今日话题',
    contentTip: '先表明观点，再补充原因和例子'
  },
  tongueTwister: {
    contentTitle: '今日绕口令',
    contentTip: '先慢读清楚，再逐渐加快速度'
  }
}

function formatSeconds(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

function buildWorkItem(item) {
  return {
    ...item,
    typeTitle: item.type === 'audio' ? '录音作品' : '录像作品',
    typeIcon: item.type === 'audio' ? '🎤' : '🎥',
    actionText: item.type === 'audio' ? '播放' : '查看'
  }
}

function normalizeExtraItem(item) {
  if (typeof item === 'string') {
    return {
      text: item,
      category: '',
      usageTip: ''
    }
  }

  return {
    text: item && item.text ? item.text : '',
    category: item && item.category ? item.category : '',
    usageTip: item && item.usageTip ? item.usageTip : ''
  }
}

function getExtraItemText(item) {
  return normalizeExtraItem(item).text
}

Page({
  data: {
    type: '',
    title: '',
    desc: '',
    icon: '',
    heroClass: '',
    contentTitle: '',
    contentTip: '',
    content: '',
    contentCategory: '',
    contentUsageTip: '',
    items: [],

    isAudioRecording: false,
    isVideoRecording: false,
    isRecording: false,
    recordingSeconds: 0,
    recordingTypeText: '',
    recordingTimeText: '00:00',
    drafts: [],
    hasDrafts: false
  },

  onLoad(options) {
    const type = options.type || 'dailyQuote'
    const training = extraTraining.find(item => item.id === type) || extraTraining[0]
    const config = PAGE_CONFIG[training.id] || PAGE_CONFIG.dailyQuote
    const items = (training.items || []).concat(training.importedQuotes || [])
    const firstItem = this.getRandomItem(items)
    const normalizedItem = this.normalizeExtraItem(firstItem)

    this.setData({
      type: training.id,
      title: training.title,
      desc: training.desc,
      icon: training.icon,
      heroClass: training.className,
      contentTitle: config.contentTitle,
      contentTip: config.contentTip,
      items,
      content: normalizedItem.text,
      contentCategory: normalizedItem.category,
      contentUsageTip: normalizedItem.usageTip
    })
    this.initRecorderManager()
    this.loadDrafts()
  },

  onShow() {
    if (this.data.type) {
      this.loadDrafts()
    }
  },

  normalizeExtraItem(item) {
    return normalizeExtraItem(item)
  },

  getRandomItem(items, currentContent = '') {
    if (!items.length) return '暂无训练内容'
    if (items.length === 1) return items[0]

    let next = null
    let count = 0

    while (getExtraItemText(next) === currentContent && count < 8) {
      const index = Math.floor(Math.random() * items.length)
      next = items[index]
      count += 1
    }

    return next
  },

  changeContent() {
    const nextItem = this.getRandomItem(this.data.items, this.data.content)
    const normalizedItem = this.normalizeExtraItem(nextItem)

    this.setData({
      content: normalizedItem.text,
      contentCategory: normalizedItem.category,
      contentUsageTip: normalizedItem.usageTip
    })

    wx.showToast({
      title: '已换一条',
      icon: 'none'
    })
  },

  loadDrafts() {
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const currentDrafts = drafts
      .filter(item => item.extraType === this.data.type)
      .map(buildWorkItem)

    this.setData({
      drafts: currentDrafts,
      hasDrafts: currentDrafts.length > 0
    })
  },

  initRecorderManager() {
    this.recorderManager = wx.getRecorderManager()

    this.recorderManager.onStart(() => {
      this.startRecordingTimer()
    })

    this.recorderManager.onStop(res => {
      this.clearTimer()
      this.createAudioDraft(res)
      this.setData({
        isAudioRecording: false,
        isRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00'
      })
      wx.showToast({
        title: '录音已保存',
        icon: 'success'
      })
    })

    this.recorderManager.onError(error => {
      this.clearTimer()
      this.setData({
        isAudioRecording: false,
        isRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00'
      })
      console.error('额外训练录音失败', error)
      wx.showToast({
        title: '录音失败',
        icon: 'none'
      })
    })
  },

  toggleAudio() {
    if (this.data.isVideoRecording) return

    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    } else {
      this.ensureRecordPermission(() => {
        this.startAudioRecord()
      })
    }
  },

  toggleVideo() {
    if (this.data.isAudioRecording) return

    wx.navigateTo({
      url: '/pages/video-record/video-record',
      events: {
        videoRecorded: data => {
          this.createVideoDraft(data)
        }
      },
      success: res => {
        res.eventChannel.emit('videoRecordContext', {
          sourceType: 'extra',
          title: this.data.title,
          subtitle: '额外训练',
          promptText: this.data.content || '',
          requirement: ''
        })
      }
    })
  },

  startAudioRecord() {
    this.clearTimer()
    this.setData({
      isAudioRecording: true,
      isVideoRecording: false,
      isRecording: true,
      recordingSeconds: 0,
      recordingTypeText: '录音',
      recordingTimeText: '00:00'
    })

    this.recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    })
  },

  stopAudioRecord() {
    if (this.recorderManager) {
      this.recorderManager.stop()
    }
  },

  startRecordingTimer() {
    this.clearTimer()
    this.recordingTimer = setInterval(() => {
      const seconds = this.data.recordingSeconds + 1

      this.setData({
        recordingSeconds: seconds,
        recordingTimeText: formatSeconds(seconds)
      })
    }, 1000)
  },

  createAudioDraft(res) {
    const seconds = res.duration ? Math.max(Math.round(res.duration / 1000), 1) : Math.max(this.data.recordingSeconds || 1, 1)
    const draft = {
      id: Date.now(),
      extraType: this.data.type,
      extraTitle: this.data.title,
      content: this.data.content,
      type: 'audio',
      duration: `${seconds}秒`,
      createdAt: formatDate(new Date()),
      submitted: false,
      filePath: res.tempFilePath || '',
      fileSize: res.fileSize || 0
    }

    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    drafts.unshift(draft)
    wx.setStorageSync('extraTrainingDrafts', drafts)
    this.loadDrafts()
  },

  createVideoDraft(data) {
    const seconds = Math.max(Number(data.duration || 1), 1)
    const draft = {
      id: Date.now(),
      extraType: this.data.type,
      extraTitle: this.data.title,
      content: this.data.content,
      type: 'video',
      duration: `${seconds}秒`,
      createdAt: formatDate(new Date()),
      submitted: false,
      filePath: data.filePath || '',
      thumbPath: data.thumbPath || '',
      promptText: data.promptText || '',
      recordTitle: data.recordTitle || '',
      recordSubtitle: data.recordSubtitle || ''
    }
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []

    drafts.unshift(draft)
    wx.setStorageSync('extraTrainingDrafts', drafts)
    this.loadDrafts()

    wx.showToast({
      title: '录像已保存',
      icon: 'success'
    })
  },

  playWork(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const target = drafts.find(item => Number(item.id) === id)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.type === 'audio') {
      if (!target.filePath) {
        wx.showToast({
          title: '录音文件不存在',
          icon: 'none'
        })
        return
      }

      this.stopAudioContext()
      this.audioContext = wx.createInnerAudioContext()
      this.audioContext.src = target.filePath
      this.audioContext.onEnded(() => {
        console.log('额外训练录音播放结束')
      })
      this.audioContext.onError(error => {
        console.error('额外训练录音播放失败', error)
        wx.showToast({
          title: '播放失败',
          icon: 'none'
        })
      })
      wx.showToast({
        title: '开始播放',
        icon: 'none'
      })
      this.audioContext.play()
      return
    }

    if (!target.filePath) {
      wx.showToast({
        title: '录像文件不存在',
        icon: 'none'
      })
      return
    }

    wx.previewMedia({
      sources: [
        {
          url: target.filePath,
          type: 'video',
          poster: target.thumbPath || ''
        }
      ],
      fail: error => {
        console.error('额外训练录像预览失败', error)
        wx.showToast({
          title: '预览失败',
          icon: 'none'
        })
      }
    })
  },

  submitDraft(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const target = drafts.find(item => Number(item.id) === id)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.submitted) {
      wx.showToast({
        title: '作品已提交',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认提交',
      content: '提交后，该作品将计入你的额外训练记录。是否确认提交？',
      cancelText: '取消',
      confirmText: '确认提交',
      confirmColor: '#07c160',
      success: res => {
        if (res.confirm) {
          this.confirmSubmitDraft(id)
        }
      }
    })
  },

  confirmSubmitDraft(id) {
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const target = drafts.find(item => Number(item.id) === id)

    if (!target || target.submitted) {
      this.loadDrafts()
      return
    }

    const updatedDrafts = drafts.map(item => (
      Number(item.id) === id ? { ...item, submitted: true } : item
    ))
    const submissions = wx.getStorageSync('extraTrainingSubmissions') || []
    const submission = {
      id: target.id,
      sourceType: 'extra',
      ...buildClassSubmissionPatch(),
      extraType: target.extraType,
      extraTitle: target.extraTitle,
      taskTitle: target.extraTitle,
      content: target.content,
      promptText: target.promptText || target.content || '',
      type: target.type,
      duration: target.duration,
      targetSeconds: 0,
      createdAt: formatDate(new Date()),
      filePath: target.filePath || '',
      thumbPath: target.thumbPath || '',
      fileSize: target.fileSize || 0,
      aiFeedbackStatus: '',
      aiFeedbackSource: '',
      aiFeedbackModel: ''
    }

    wx.setStorageSync('extraTrainingDrafts', updatedDrafts)
    wx.setStorageSync('extraTrainingSubmissions', [submission].concat(submissions))
    this.loadDrafts()

    wx.showToast({
      title: '提交成功',
      icon: 'success'
    })

    requestTrainingFeedback({
      storageKey: 'extraTrainingSubmissions',
      submission
    }).then(res => {
      if (res.status === 'done') {
        wx.showToast({
          title: 'AI点评已生成',
          icon: 'success'
        })
        return
      }

      if (res.status === 'error' && res.message) {
        wx.showToast({
          title: res.message,
          icon: 'none'
        })
      }
    })
  },

  deleteDraft(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const target = drafts.find(item => Number(item.id) === id)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认删除',
      content: '删除后，该作品记录将无法恢复。是否确认删除？',
      cancelText: '取消',
      confirmText: '确认删除',
      confirmColor: '#d84d4d',
      success: res => {
        if (res.confirm) {
          this.confirmDeleteDraft(id)
        }
      }
    })
  },

  confirmDeleteDraft(id) {
    const drafts = wx.getStorageSync('extraTrainingDrafts') || []
    const target = drafts.find(item => Number(item.id) === id)
    const updatedDrafts = drafts.filter(item => Number(item.id) !== id)

    wx.setStorageSync('extraTrainingDrafts', updatedDrafts)

    if (target && target.submitted) {
      const submissions = wx.getStorageSync('extraTrainingSubmissions') || []
      wx.setStorageSync('extraTrainingSubmissions', submissions.filter(item => Number(item.id) !== id))
    }

    this.loadDrafts()

    wx.showToast({
      title: '已删除',
      icon: 'none'
    })
  },

  clearTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer)
      this.recordingTimer = null
    }
  },

  ensureRecordPermission(callback) {
    wx.getSetting({
      success: setting => {
        if (setting.authSetting['scope.record']) {
          callback()
          return
        }

        wx.authorize({
          scope: 'scope.record',
          success: callback,
          fail: () => {
            wx.showModal({
              title: '需要录音权限',
              content: '需要开启录音权限后才能使用该功能。',
              confirmText: '去设置',
              success: res => {
                if (res.confirm) {
                  wx.openSetting()
                }
              }
            })
          }
        })
      }
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
    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    }
    this.clearTimer()
    this.stopAudioContext()
  }
})
