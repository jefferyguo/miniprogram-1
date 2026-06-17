const {
  DRAFTS_KEY,
  SUBMISSIONS_KEY,
  getModuleById,
  getTaskByModuleAndDay
} = require('../../utils/training-data')
const { requestTrainingFeedback } = require('../../utils/ai-feedback')
const { buildClassSubmissionPatch } = require('../../utils/local-data')

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSeconds(seconds) {
  const minute = Math.floor(seconds / 60)
  const second = seconds % 60
  return `${pad(minute)}:${pad(second)}`
}

function getDrafts() {
  return wx.getStorageSync(DRAFTS_KEY) || []
}

function getSubmissions() {
  return wx.getStorageSync(SUBMISSIONS_KEY) || []
}

function getDurationText(duration, defaultSeconds) {
  const seconds = duration ? Math.max(Math.round(duration / 1000), 1) : Math.max(defaultSeconds || 1, 1)
  return `${seconds}秒`
}

function buildDisplayDraft(draft) {
  return {
    ...draft,
    icon: draft.type === 'audio' ? '🎤' : '🎥',
    typeTitle: draft.type === 'audio' ? '录音作品' : '录像作品',
    statusText: draft.submitted ? '已提交' : '未提交',
    actionText: draft.type === 'audio' ? '播放' : '查看'
  }
}

function resolveContentTitle(task) {
  if (task && task.contentTitle) {
    return task.contentTitle
  }

  return task ? task.title : ''
}

Page({
  data: {
    // 本页面使用真实录音；录像跳转到 video-record 页面完成
    moduleInfo: null,
    task: null,
    moduleId: '',
    day: 1,
    actionStatus: '还没有开始录制',
    isAudioRecording: false,
    isVideoRecording: false,
    recordingSeconds: 0,
    recordingTimeText: '00:00',
    drafts: [],
    hasDrafts: false,
    submittedCount: 0,
    feedbackCount: 0,
    feedbackDesc: '还没有提交作品，完成录音或录像后可以生成 AI 反馈。'
  },

  onLoad(options) {
    const moduleId = options.moduleId || 'reading'
    const day = Number(options.day || 1)
    const moduleInfo = getModuleById(moduleId)
    const task = getTaskByModuleAndDay(moduleId, day)

    if (!moduleInfo || !task) {
      wx.showToast({
        title: '训练任务不存在',
        icon: 'none'
      })
      return
    }

    const displayTask = {
      ...task,
      contentTitle: resolveContentTitle(task)
    }

    console.log('[task-detail] 当前任务标题：', displayTask.contentTitle, displayTask.title)

    this.setData({
      moduleId,
      day,
      moduleInfo,
      task: displayTask
    })
    this.initRecorderManager()
    this.loadDrafts()
    this.loadFeedbackSummary()
  },

  onShow() {
    if (this.data.moduleId) {
      this.loadDrafts()
      this.loadFeedbackSummary()
    }
  },

  initRecorderManager() {
    this.recorderManager = wx.getRecorderManager()

    this.recorderManager.onStart(() => {
      this.startRecordingTimer()
    })

    this.recorderManager.onStop(res => {
      this.clearRecordingTimer()
      this.createAudioDraft(res)
      this.setData({
        isAudioRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00',
        actionStatus: '录音已保存'
      })
      wx.showToast({
        title: '录音已保存',
        icon: 'success'
      })
    })

    this.recorderManager.onError(error => {
      this.clearRecordingTimer()
      this.setData({
        isAudioRecording: false,
        recordingSeconds: 0,
        recordingTimeText: '00:00',
        actionStatus: '录音失败，请重试'
      })
      console.error('录音失败', error)
      wx.showToast({
        title: '录音失败',
        icon: 'none'
      })
    })
  },

  loadDrafts() {
    const drafts = getDrafts()
      .filter(item => item.moduleId === this.data.moduleId && Number(item.day) === Number(this.data.day))
      .map(buildDisplayDraft)

    this.setData({
      drafts,
      hasDrafts: drafts.length > 0
    })
  },

  loadFeedbackSummary() {
    const taskSubmissions = getSubmissions().filter(item => (
      item.moduleId === this.data.moduleId && Number(item.day) === Number(this.data.day)
    ))
    const feedbackCount = taskSubmissions.filter(item => (
      item.aiFeedbackStatus === 'done' && item.aiFeedback
    )).length
    const submittedCount = taskSubmissions.length

    this.setData({
      submittedCount,
      feedbackCount,
      feedbackDesc: submittedCount > 0
        ? `已提交 ${submittedCount} 个作品，${feedbackCount} 个已有反馈。`
        : '还没有提交作品，完成录音或录像后可以生成 AI 反馈。'
    })
  },

  toggleAudioRecord() {
    if (this.data.isVideoRecording) {
      wx.showToast({
        title: '请先完成录像',
        icon: 'none'
      })
      return
    }

    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
      return
    }

    this.ensureRecordPermission(() => {
      this.startAudioRecord()
    })
  },

  startAudioRecord() {
    this.clearRecordingTimer()
    this.setData({
      isAudioRecording: true,
      recordingSeconds: 0,
      recordingTimeText: '00:00',
      actionStatus: '正在录音中 00:00'
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

  toggleVideoRecord() {
    if (this.data.isAudioRecording) {
      wx.showToast({
        title: '请先停止录音',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({
      url: '/pages/video-record/video-record',
      events: {
        videoRecorded: data => {
          this.createVideoDraft(data)
        }
      },
      success: res => {
        res.eventChannel.emit('videoRecordContext', {
          sourceType: 'main',
          title: this.data.task.title,
          subtitle: `${this.data.moduleInfo.title} Day ${this.data.task.day}`,
          promptText: this.data.task.promptText || this.data.task.material || this.data.task.requirement || '',
          requirement: this.data.task.requirement || ''
        })
      }
    })
  },

  startRecordingTimer() {
    this.clearRecordingTimer()
    this.recordingTimer = setInterval(() => {
      const seconds = this.data.recordingSeconds + 1

      this.setData({
        recordingSeconds: seconds,
        recordingTimeText: formatSeconds(seconds),
        actionStatus: `正在录音中 ${formatSeconds(seconds)}`
      })
    }, 1000)
  },

  clearRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer)
      this.recordingTimer = null
    }
  },

  createAudioDraft(res) {
    const draft = {
      id: Date.now(),
      moduleId: this.data.moduleInfo.id,
      moduleTitle: this.data.moduleInfo.title,
      day: this.data.task.day,
      taskTitle: this.data.task.title,
      type: 'audio',
      duration: getDurationText(res.duration, this.data.recordingSeconds),
      createdAt: formatDateTime(new Date()),
      submitted: false,
      filePath: res.tempFilePath || '',
      fileSize: res.fileSize || 0
    }
    const drafts = getDrafts()

    wx.setStorageSync(DRAFTS_KEY, [draft].concat(drafts))
    this.loadDrafts()
  },

  createVideoDraft(data) {
    const seconds = Math.max(Number(data.duration || 1), 1)
    const draft = {
      id: Date.now(),
      moduleId: this.data.moduleInfo.id,
      moduleTitle: this.data.moduleInfo.title,
      day: this.data.task.day,
      taskTitle: this.data.task.title,
      type: 'video',
      duration: `${seconds}秒`,
      createdAt: formatDateTime(new Date()),
      submitted: false,
      filePath: data.filePath || '',
      thumbPath: data.thumbPath || '',
      promptText: data.promptText || '',
      recordTitle: data.recordTitle || '',
      recordSubtitle: data.recordSubtitle || ''
    }
    const drafts = getDrafts()

    wx.setStorageSync(DRAFTS_KEY, [draft].concat(drafts))
    this.loadDrafts()
    wx.showToast({
      title: '录像已保存',
      icon: 'success'
    })
  },

  playWork(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = getDrafts()
    const target = drafts.find(item => Number(item.id) === id)

    if (!target) {
      wx.showToast({
        title: '作品不存在',
        icon: 'none'
      })
      return
    }

    if (target.type === 'audio') {
      this.playAudio(target)
      return
    }

    this.previewVideo(target)
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
    this.audioContext.onEnded(() => {
      console.log('录音播放结束')
    })
    this.audioContext.onError(error => {
      console.error('录音播放失败', error)
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
      fail: error => {
        console.error('录像预览失败', error)
        wx.showToast({
          title: '预览失败',
          icon: 'none'
        })
      }
    })
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

  submitDraft(e) {
    const id = Number(e.currentTarget.dataset.id)
    const drafts = getDrafts()
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
      content: '提交后，该作品将作为本次训练记录，并计入训练进度。是否确认提交？',
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
    const drafts = getDrafts()
    const target = drafts.find(item => Number(item.id) === id)

    if (!target || target.submitted) {
      this.loadDrafts()
      return
    }

    const updatedDrafts = drafts.map(item => (
      Number(item.id) === id ? { ...item, submitted: true } : item
    ))
    const submission = {
      id: target.id,
      sourceType: 'main',
      ...buildClassSubmissionPatch(),
      moduleId: target.moduleId,
      moduleTitle: target.moduleTitle,
      day: target.day,
      taskTitle: target.taskTitle,
      content: this.data.task.material || this.data.task.requirement || '',
      promptText: target.promptText || this.data.task.material || this.data.task.requirement || '',
      requirement: this.data.task.requirement || '',
      type: target.type,
      duration: target.duration,
      targetSeconds: this.data.task.targetSeconds || 0,
      createdAt: formatDateTime(new Date()),
      filePath: target.filePath || '',
      thumbPath: target.thumbPath || '',
      fileSize: target.fileSize || 0,
      aiFeedbackStatus: '',
      aiFeedbackSource: '',
      aiFeedbackModel: ''
    }
    const submissions = getSubmissions()

    wx.setStorageSync(DRAFTS_KEY, updatedDrafts)
    wx.setStorageSync(SUBMISSIONS_KEY, [submission].concat(submissions))
    this.loadDrafts()
    this.loadFeedbackSummary()

    wx.showToast({
      title: '提交成功',
      icon: 'success'
    })

    requestTrainingFeedback({
      storageKey: SUBMISSIONS_KEY,
      submission
    }).then(res => {
      this.loadFeedbackSummary()
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
    const drafts = getDrafts()
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
    const drafts = getDrafts()
    const target = drafts.find(item => Number(item.id) === id)
    const updatedDrafts = drafts.filter(item => Number(item.id) !== id)

    wx.setStorageSync(DRAFTS_KEY, updatedDrafts)

    if (target && target.submitted) {
      const submissions = getSubmissions().filter(item => Number(item.id) !== id)
      wx.setStorageSync(SUBMISSIONS_KEY, submissions)
    }

    this.loadDrafts()
    this.loadFeedbackSummary()

    wx.showToast({
      title: '已删除',
      icon: 'none'
    })
  },

  openTaskReview() {
    wx.setStorageSync('reviewFilter', {
      type: 'task',
      moduleId: this.data.moduleId,
      moduleTitle: this.data.moduleInfo && this.data.moduleInfo.title,
      day: this.data.day,
      taskTitle: this.data.task && (this.data.task.contentTitle || this.data.task.title),
      createdAt: Date.now()
    })

    wx.switchTab({
      url: '/pages/review/review'
    })
  },

  stopAudioContext() {
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
  },

  onHide() {
    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    }
  },

  onUnload() {
    if (this.data.isAudioRecording) {
      this.stopAudioRecord()
    }
    this.clearRecordingTimer()
    this.stopAudioContext()
  }
})
