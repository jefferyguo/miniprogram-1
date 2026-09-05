const { ensureVoiceConsentAndMicPermission } = require('../../utils/voice-consent')

function formatSeconds(seconds) {
  const minute = Math.floor(seconds / 60)
  const second = seconds % 60
  return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

const DEFAULT_MAX_VIDEO_RECORD_SECONDS = 180
const ABSOLUTE_MAX_VIDEO_RECORD_SECONDS = 300
const AUTO_STOP_BUFFER_SECONDS = 2

function normalizeVideoMaxDuration(value) {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_VIDEO_RECORD_SECONDS
  return Math.min(parsed, ABSOLUTE_MAX_VIDEO_RECORD_SECONDS)
}

function getAutoStopAtSeconds(maxDuration) {
  return Math.max(10, maxDuration - AUTO_STOP_BUFFER_SECONDS)
}

function formatMaxDurationText(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  if (!remainSeconds) return `${minutes} 分钟`
  if (!minutes) return `${remainSeconds} 秒`
  return `${minutes} 分 ${remainSeconds} 秒`
}

function getBaseLibraryVersion() {
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      return String((wx.getAppBaseInfo() || {}).SDKVersion || '')
    }
    if (typeof wx.getSystemInfoSync === 'function') {
      return String((wx.getSystemInfoSync() || {}).SDKVersion || '')
    }
  } catch (error) {
    console.warn('[video-record] base library info unavailable', {
      errMsg: error && error.message
    })
  }
  return ''
}

function createVideoAsrTraceId() {
  return `video_asr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getFileExtension(filePath = '') {
  const match = String(filePath).split('?')[0].toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : 'unknown'
}

Page({
  data: {
    devicePosition: 'front',
    cameraLabel: '前置摄像头',
    cameraKey: 0,
    voiceConsentVisible: false,
    isSwitchingCamera: false,
    isRecording: false,
    isStopping: false,
    recordStatus: 'idle',
    hasVideo: false,
    tempVideoPath: '',
    tempThumbPath: '',
    recordingSeconds: 0,
    recordingTimeText: '00:00',
    maxVideoDuration: DEFAULT_MAX_VIDEO_RECORD_SECONDS,
    autoStopAtSeconds: DEFAULT_MAX_VIDEO_RECORD_SECONDS - AUTO_STOP_BUFFER_SECONDS,
    maxDurationText: formatMaxDurationText(DEFAULT_MAX_VIDEO_RECORD_SECONDS),
    nearingMaxDuration: false,
    recordTitle: '录像练习',
    recordSubtitle: '',
    taskTitle: '',
    moduleTitle: '',
    day: '',
    promptText: '',
    requirement: '',
    showPrompt: true,
    promptFontSize: 30
  },

  onLoad(options = {}) {
    this.recordSessionId = 0
    this.startRequestPending = false
    this.stopRequestPending = false
    this.pageHidden = false
    this.pageUnloading = false
    const initialMaxDuration = normalizeVideoMaxDuration(
      options.maxVideoDuration || options.videoMaxDuration || options.durationLimit
    )
    this.setData({
      devicePosition: 'front',
      cameraLabel: '前置摄像头',
      isSwitchingCamera: false,
      maxVideoDuration: initialMaxDuration,
      autoStopAtSeconds: getAutoStopAtSeconds(initialMaxDuration),
      maxDurationText: formatMaxDurationText(initialMaxDuration)
    })

    const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel()
    if (eventChannel && eventChannel.on) {
      eventChannel.on('videoRecordContext', data => {
        const recordTitle = data.contentTitle || data.title || data.taskTitle || '录像练习'
        const recordSubtitle = data.subtitle || (data.moduleTitle && data.day ? `${data.moduleTitle} · Day ${data.day}` : '')
        const promptText = data.material || data.promptText || ''
        const maxVideoDuration = normalizeVideoMaxDuration(
          data.maxVideoDuration || data.videoMaxDuration || data.durationLimit
        )

        this.setData({
          recordTitle,
          recordSubtitle,
          taskTitle: data.taskTitle || recordTitle,
          moduleTitle: data.moduleTitle || '',
          day: data.day || '',
          promptText,
          requirement: data.requirement || '',
          showPrompt: true,
          maxVideoDuration,
          autoStopAtSeconds: getAutoStopAtSeconds(maxVideoDuration),
          maxDurationText: formatMaxDurationText(maxVideoDuration)
        })
      })
    }
  },

  onReady() {
    this.cameraContext = wx.createCameraContext()
  },

  onShow() {
    this.pageHidden = false
  },

  switchCamera() {
    console.log('switchCamera triggered')
    console.log('点击翻转摄像头，当前：', this.data.devicePosition)

    if (this.data.isRecording || this.data.isStopping) {
      wx.showToast({
        title: '录像中不能切换摄像头',
        icon: 'none'
      })
      return
    }

    if (this.data.isSwitchingCamera) {
      return
    }

    const next = this.data.devicePosition === 'front' ? 'back' : 'front'

    this.setData({
      isSwitchingCamera: true,
      devicePosition: next,
      cameraLabel: next === 'front' ? '前置摄像头' : '后置摄像头'
    }, () => {
      console.log('已切换摄像头到：', this.data.devicePosition)
    })

    this.switchCameraTimer = setTimeout(() => {
      this.setData({
        isSwitchingCamera: false
      })
    }, 500)
  },

  togglePrompt() {
    this.setData({
      showPrompt: !this.data.showPrompt
    })
  },

  onVoiceConsentVisibilityChange(event) {
    this.setData({
      voiceConsentVisible: Boolean(event && event.detail && event.detail.visible)
    })
  },

  increasePromptFont() {
    this.increaseFontSize()
  },

  decreasePromptFont() {
    this.decreaseFontSize()
  },

  increaseFontSize() {
    const next = Math.min(Number(this.data.promptFontSize || 30) + 2, 44)
    this.setData({
      promptFontSize: next
    })
  },

  decreaseFontSize() {
    const next = Math.max(Number(this.data.promptFontSize || 30) - 2, 24)
    this.setData({
      promptFontSize: next
    })
  },

  toggleRecord() {
    if (this.data.isStopping || this.stopRequestPending) return
    if (this.data.isRecording) {
      this.stopRecord()
      return
    }

    this.startRecord()
  },

  async startRecord() {
    if (this.data.isRecording || this.data.isStopping || this.startRequestPending || this.stopRequestPending) return
    if (this.data.hasVideo) {
      wx.showToast({
        title: '请先重新录制或使用该视频',
        icon: 'none'
      })
      return
    }

    this.startRequestPending = true
    const voiceAllowed = await ensureVoiceConsentAndMicPermission(this)
    if (!voiceAllowed) {
      this.startRequestPending = false
      return
    }

    this.ensureCameraPermission(() => {
      if (!this.cameraContext) {
        this.cameraContext = wx.createCameraContext()
      }

      const sessionId = ++this.recordSessionId
      this.videoAsrTraceId = createVideoAsrTraceId()
      this.videoMediaInfo = null
      const maxDuration = normalizeVideoMaxDuration(this.data.maxVideoDuration)
      const autoStopAtSeconds = getAutoStopAtSeconds(maxDuration)
      this.maxDurationWarningShown = false
      console.log('[video-record] start record', {
        sessionId,
        maxDurationSeconds: maxDuration,
        autoStopAtSeconds,
        sdkVersion: getBaseLibraryVersion() || 'unknown'
      })
      console.log(`[VIDEO_ASR][${this.videoAsrTraceId}][record]`, {
        event: 'start',
        sessionId,
        sdkVersion: getBaseLibraryVersion() || 'unknown',
        devicePosition: this.data.devicePosition,
        microphonePermissionConfirmed: true
      })
      const startOptions = {
        // 新基础库使用 camera timeout；旧基础库即使忽略该字段，JS timer 仍会兜底停止。
        timeout: maxDuration,
        success: () => {
          this.startRequestPending = false
          if (this.pageHidden || this.pageUnloading) {
            console.log('[video-record] start completed after page hidden, stop immediately')
            this.cameraContext.stopRecord({
              complete: () => this.safeResetVideoRecordState({ status: 'idle', resetDuration: true })
            })
            return
          }
          this.recordingStartedAt = Date.now()
          this.pendingStopDurationSeconds = 0
          this.setData({
            isRecording: true,
            isStopping: false,
            recordStatus: 'recording',
            recordingSeconds: 0,
            recordingTimeText: '00:00',
            maxVideoDuration: maxDuration,
            autoStopAtSeconds,
            maxDurationText: formatMaxDurationText(maxDuration),
            nearingMaxDuration: false
          })
          this.startVideoRecordTimers(sessionId, autoStopAtSeconds)
        },
        fail: err => {
          this.startRequestPending = false
          console.error('[video-record] start record fail', {
            errCode: err && err.errCode,
            errMsg: err && err.errMsg
          })
          this.safeResetVideoRecordState({ status: 'error', resetDuration: true })
          wx.showToast({
            title: '录像启动失败',
            icon: 'none'
          })
        },
        complete: result => {
          console.log('[video-record] start record complete', {
            errMsg: result && result.errMsg || ''
          })
        },
        timeoutCallback: result => {
          this.onVideoRecordTimeout(result, sessionId)
        }
      }
      try {
        this.cameraContext.startRecord(startOptions)
      } catch (error) {
        this.startRequestPending = false
        console.error('[video-record] start record fail', {
          errCode: error && error.errCode,
          errMsg: error && error.message
        })
        this.safeResetVideoRecordState({ status: 'error', resetDuration: true })
        wx.showToast({ title: '录像启动失败', icon: 'none' })
      }
    }, () => {
      this.startRequestPending = false
    })
  },

  stopRecord() {
    console.log('[video-record] stop record click', {
      isRecording: this.data.isRecording,
      isStopping: this.data.isStopping
    })
    this.safeStopVideoRecord('manual')
  },

  safeStopVideoRecord(reason = 'manual') {
    if (this.data.isStopping || this.stopRequestPending) {
      console.log('[video-record] stop ignored: already stopping', { reason })
      return
    }
    if (!this.data.isRecording) {
      console.log('[video-record] stop fallback: not recording', { reason })
      this.safeResetVideoRecordState({
        status: this.data.hasVideo ? 'finished' : 'idle',
        resetDuration: false
      })
      return
    }

    if (!this.cameraContext) this.cameraContext = wx.createCameraContext()
    this.stopRequestPending = true
    this.pendingStopDurationSeconds = this.getCurrentRecordingSeconds()
    this.clearVideoRecordTimers()
    this.setVideoRecordState({
      isRecording: true,
      isStopping: true,
      recordStatus: 'stopping'
    })
    console.log('[video-record] stop record request', {
      reason,
      durationSeconds: this.pendingStopDurationSeconds
    })

    let stopSucceeded = false
    const stopOptions = {
      compressed: true,
      success: res => {
        stopSucceeded = this.saveRecordedVideo(res, reason)
        console.log('[video-record] stop success', {
          reason,
          hasTempVideoPath: Boolean(res && res.tempVideoPath),
          hasTempThumbPath: Boolean(res && res.tempThumbPath),
          saved: stopSucceeded
        })
        if (!stopSucceeded && !this.pageUnloading) {
          wx.showToast({ title: '视频保存失败，请重新录制', icon: 'none' })
        }
      },
      fail: err => {
        console.error('[video-record] stop fail', {
          reason,
          errCode: err && err.errCode,
          errMsg: err && err.errMsg
        })
        if (!this.pageUnloading && !this.data.hasVideo) {
          wx.showToast({ title: '录制已结束，请重新录制', icon: 'none' })
        }
      },
      complete: () => {
        this.stopRequestPending = false
        this.safeResetVideoRecordState({
          status: stopSucceeded || this.data.hasVideo ? 'finished' : 'error',
          resetDuration: false
        })
      }
    }

    // 极端情况下 stopRecord 没有回调，也要在超时后解除按钮锁定。
    this.stopRequestWatchdogTimer = setTimeout(() => {
      if (!this.stopRequestPending) return
      this.stopRequestPending = false
      console.error('[video-record] stop fail', {
        reason,
        errCode: 'STOP_CALLBACK_TIMEOUT',
        errMsg: 'stopRecord callback timeout'
      })
      this.safeResetVideoRecordState({ status: this.data.hasVideo ? 'finished' : 'error' })
      if (!this.pageUnloading && !this.data.hasVideo) {
        wx.showToast({ title: '录制已结束，请重新录制', icon: 'none' })
      }
    }, 5000)

    try {
      this.cameraContext.stopRecord(stopOptions)
    } catch (error) {
      this.stopRequestPending = false
      console.error('[video-record] stop fail', {
        reason,
        errCode: error && error.errCode,
        errMsg: error && error.message
      })
      this.safeResetVideoRecordState({ status: 'error', resetDuration: false })
      if (!this.pageUnloading) {
        wx.showToast({ title: '视频保存失败，请重新录制', icon: 'none' })
      }
    }
  },

  startVideoRecordTimers(sessionId, autoStopAtSeconds) {
    this.clearVideoRecordTimers()
    this.recordTimer = setInterval(() => {
      if (!this.data.isRecording || this.data.isStopping || sessionId !== this.recordSessionId) return
      const seconds = this.getCurrentRecordingSeconds()
      const shouldWarn = seconds >= Math.max(1, autoStopAtSeconds - 10)
      this.setData({
        recordingSeconds: seconds,
        recordingTimeText: formatSeconds(seconds),
        nearingMaxDuration: shouldWarn
      })
      if (shouldWarn && !this.maxDurationWarningShown) {
        this.maxDurationWarningShown = true
        wx.showToast({ title: '即将达到最长录制时长', icon: 'none' })
      }
    }, 1000)

    this.maxVideoRecordTimer = setTimeout(() => {
      if (!this.data.isRecording || this.data.isStopping || sessionId !== this.recordSessionId) return
      console.log('[video-record] auto stop by max duration', {
        sessionId,
        maxDurationSeconds: this.data.maxVideoDuration,
        autoStopAtSeconds
      })
      wx.showToast({
        title: '已达到最长录制时长，正在保存视频',
        icon: 'none',
        duration: 2200
      })
      this.safeStopVideoRecord('auto_max_duration')
    }, autoStopAtSeconds * 1000)
  },

  onVideoRecordTimeout(result = {}, sessionId) {
    if (sessionId !== this.recordSessionId) return
    console.log('[video-record] timeout callback', {
      sessionId,
      hasTempVideoPath: Boolean(result.tempVideoPath),
      hasTempThumbPath: Boolean(result.tempThumbPath || result.thumbTempFilePath)
    })
    const awaitingStopResult = this.stopRequestPending || this.data.isStopping
    const saved = result.tempVideoPath
      ? this.saveRecordedVideo(result, 'timeout_callback')
      : false
    if (saved || this.data.hasVideo) {
      this.clearVideoRecordTimers()
      this.stopRequestPending = false
      this.safeResetVideoRecordState({ status: 'finished', resetDuration: false })
      return
    }
    if (awaitingStopResult) {
      // 保留 stop 回调看门狗，只清除计时与自动停止 timer。
      this.clearVideoDurationTimers()
      wx.showToast({ title: '录制已到达最长时长，视频正在保存', icon: 'none' })
      return
    }
    this.clearVideoRecordTimers()
    this.safeResetVideoRecordState({ status: 'error', resetDuration: false })
    if (!this.pageUnloading) {
      wx.showToast({ title: '录制已到达最长时长，请重新录制', icon: 'none' })
    }
  },

  clearVideoDurationTimers() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer)
      this.recordTimer = null
    }
    if (this.maxVideoRecordTimer) {
      clearTimeout(this.maxVideoRecordTimer)
      this.maxVideoRecordTimer = null
    }
  },

  clearVideoRecordTimers() {
    this.clearVideoDurationTimers()
    if (this.cameraStopFallbackTimer) {
      clearTimeout(this.cameraStopFallbackTimer)
      this.cameraStopFallbackTimer = null
    }
    if (this.stopRequestWatchdogTimer) {
      clearTimeout(this.stopRequestWatchdogTimer)
      this.stopRequestWatchdogTimer = null
    }
  },

  getCurrentRecordingSeconds() {
    const elapsed = this.recordingStartedAt
      ? Math.floor((Date.now() - this.recordingStartedAt) / 1000)
      : Number(this.data.recordingSeconds || 0)
    return Math.min(
      normalizeVideoMaxDuration(this.data.maxVideoDuration),
      Math.max(elapsed, Number(this.data.recordingSeconds || 0), 0)
    )
  },

  setVideoRecordState(patch) {
    if (this.pageUnloading) {
      Object.assign(this.data, patch)
      return
    }
    this.setData(patch)
  },

  safeResetVideoRecordState(options = {}) {
    this.clearVideoRecordTimers()
    this.startRequestPending = false
    this.maxDurationWarningShown = false
    const patch = {
      isRecording: false,
      isStopping: false,
      nearingMaxDuration: false,
      recordStatus: options.status || (this.data.hasVideo ? 'finished' : 'idle')
    }
    if (options.resetDuration) {
      patch.recordingSeconds = 0
      patch.recordingTimeText = '00:00'
    }
    this.setVideoRecordState(patch)
    console.log('[video-record] reset state', {
      status: patch.recordStatus,
      resetDuration: options.resetDuration === true
    })
  },

  saveRecordedVideo(result = {}, source = 'unknown') {
    const tempVideoPath = String(result.tempVideoPath || '')
    if (!tempVideoPath || this.pageUnloading) return false
    const duration = Math.max(
      Number(this.pendingStopDurationSeconds || 0),
      this.getCurrentRecordingSeconds(),
      1
    )
    const maxDuration = normalizeVideoMaxDuration(this.data.maxVideoDuration)
    const savedDuration = Math.min(duration, maxDuration)
    this.setData({
      hasVideo: true,
      tempVideoPath,
      tempThumbPath: result.tempThumbPath || result.thumbTempFilePath || '',
      recordingSeconds: savedDuration,
      recordingTimeText: formatSeconds(savedDuration),
      showPrompt: false,
      recordStatus: 'finished',
      nearingMaxDuration: false
    })
    console.log('[video-record] video saved', {
      source,
      durationSeconds: savedDuration,
      hasTempVideoPath: true,
      hasTempThumbPath: Boolean(result.tempThumbPath || result.thumbTempFilePath)
    })
    const traceId = this.videoAsrTraceId || createVideoAsrTraceId()
    this.videoAsrTraceId = traceId
    let fileSize = null
    try {
      const stat = wx.getFileSystemManager && wx.getFileSystemManager().statSync(tempVideoPath)
      fileSize = stat && Number.isFinite(Number(stat.size)) ? Number(stat.size) : null
    } catch (error) {
      console.warn(`[VIDEO_ASR][${traceId}][record]`, {
        event: 'stat_failed',
        errMsg: error && (error.errMsg || error.message) || ''
      })
    }
    const baseMediaInfo = {
      duration: savedDuration,
      fileSize,
      extension: getFileExtension(tempVideoPath),
      mimeType: getFileExtension(tempVideoPath) === 'mp4' ? 'video/mp4' : 'application/octet-stream',
      hasAudioStream: null,
      audioCodec: null,
      sampleRate: null,
      channels: null
    }
    this.videoMediaInfo = baseMediaInfo
    console.log(`[VIDEO_ASR][${traceId}][record]`, {
      event: 'saved',
      VIDEO_ASR_MEDIA_INFO: baseMediaInfo
    })
    if (typeof wx.getVideoInfo === 'function') {
      wx.getVideoInfo({
        src: tempVideoPath,
        success: info => {
          this.videoMediaInfo = {
            ...baseMediaInfo,
            duration: Number(info.duration || savedDuration),
            bitrate: Number(info.bitrate || 0) || null,
            fps: Number(info.fps || 0) || null,
            width: Number(info.width || 0) || null,
            height: Number(info.height || 0) || null,
            orientation: info.orientation || ''
          }
          console.log(`[VIDEO_ASR][${traceId}][record]`, {
            event: 'video_info',
            VIDEO_ASR_MEDIA_INFO: this.videoMediaInfo
          })
        },
        fail: error => console.warn(`[VIDEO_ASR][${traceId}][record]`, {
          event: 'video_info_failed',
          errMsg: error && (error.errMsg || error.message) || ''
        })
      })
    }
    return true
  },

  resetRecord() {
    this.clearVideoRecordTimers()
    this.stopRequestPending = false
    this.recordingStartedAt = 0
    this.pendingStopDurationSeconds = 0
    this.maxDurationWarningShown = false
    this.setData({
      hasVideo: false,
      isRecording: false,
      isStopping: false,
      recordStatus: 'idle',
      nearingMaxDuration: false,
      tempVideoPath: '',
      tempThumbPath: '',
      recordingSeconds: 0,
      recordingTimeText: '00:00',
      showPrompt: true
    })
  },

  useVideo() {
    if (!this.data.tempVideoPath) {
      wx.showToast({
        title: '请先完成录像',
        icon: 'none'
      })
      return
    }

    const eventChannel = this.getOpenerEventChannel()
    eventChannel.emit('videoRecorded', {
      filePath: this.data.tempVideoPath,
      thumbPath: this.data.tempThumbPath,
      duration: this.data.recordingSeconds,
      devicePosition: this.data.devicePosition,
      promptText: this.data.promptText,
      recordTitle: this.data.recordTitle,
      recordSubtitle: this.data.recordSubtitle,
      traceId: this.videoAsrTraceId || createVideoAsrTraceId(),
      fileSize: this.videoMediaInfo && this.videoMediaInfo.fileSize,
      mimeType: this.videoMediaInfo && this.videoMediaInfo.mimeType || 'video/mp4',
      mediaInfo: this.videoMediaInfo || null
    })
    wx.navigateBack()
  },

  onCameraRecordStop(e) {
    const detail = e && e.detail || {}
    console.log('[video-record] camera stop event', {
      reason: detail.reason || '',
      hasTempVideoPath: Boolean(detail.tempVideoPath),
      hasTempThumbPath: Boolean(detail.tempThumbPath || detail.thumbTempFilePath)
    })
    const waitingForStopCallback = this.stopRequestPending
    const saved = detail.tempVideoPath ? this.saveRecordedVideo(detail, 'camera_stop_event') : false
    if (saved || !waitingForStopCallback) this.stopRequestPending = false
    this.safeResetVideoRecordState({
      status: saved || this.data.hasVideo ? 'finished' : 'error',
      resetDuration: false
    })
    if (!saved && !this.data.hasVideo && !this.pageUnloading) {
      // 手动 stop 的 success 可能稍晚到达，短暂等待后再给出兜底提示。
      const sessionId = this.recordSessionId
      this.cameraStopFallbackTimer = setTimeout(() => {
        this.stopRequestPending = false
        if (sessionId !== this.recordSessionId || this.data.hasVideo || this.pageUnloading) return
        wx.showToast({ title: '录制已结束，请重新录制', icon: 'none' })
      }, 800)
    }
  },

  onCameraError(e) {
    const detail = e && e.detail || {}
    console.error('[video-record] camera error', {
      errCode: detail.errCode,
      errMsg: detail.errMsg
    })
    this.stopRequestPending = false
    this.safeResetVideoRecordState({ status: 'error', resetDuration: !this.data.hasVideo })
    wx.showModal({
      title: '摄像头不可用',
      content: '摄像头异常，请重新进入页面后再试。也可以检查微信的摄像头权限。',
      confirmText: '去设置',
      success: res => {
        if (res.confirm) {
          wx.openSetting()
        }
      }
    })
  },

  ensureCameraPermission(callback, onFail) {
    wx.getSetting({
      success: setting => {
        if (setting.authSetting['scope.camera']) {
          callback()
          return
        }

        wx.authorize({
          scope: 'scope.camera',
          success: callback,
          fail: () => {
            if (typeof onFail === 'function') onFail()
            wx.showModal({
              title: '需要摄像头权限',
              content: '需要开启摄像头权限后才能使用该功能。',
              confirmText: '去设置',
              success: res => {
                if (res.confirm) {
                  wx.openSetting()
                }
              }
            })
          }
        })
      },
      fail: () => {
        if (typeof onFail === 'function') onFail()
        wx.showToast({ title: '摄像头权限检查失败，请重试', icon: 'none' })
      }
    })
  },

  onHide() {
    this.pageHidden = true
    if (this.data.isRecording && !this.data.isStopping) {
      console.log('[video-record] page hide while recording')
      this.safeStopVideoRecord('page_hide')
      return
    }
    this.clearVideoRecordTimers()
  },

  onUnload() {
    this.pageUnloading = true
    if (this.switchCameraTimer) {
      clearTimeout(this.switchCameraTimer)
      this.switchCameraTimer = null
    }

    if (this.data.isRecording && !this.data.isStopping) {
      console.log('[video-record] page unload while recording')
      this.safeStopVideoRecord('page_unload')
    }
    this.clearVideoRecordTimers()
    this.stopRequestPending = false
    this.safeResetVideoRecordState({ status: 'idle', resetDuration: false })
  }
})
