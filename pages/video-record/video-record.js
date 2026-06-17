function formatSeconds(seconds) {
  const minute = Math.floor(seconds / 60)
  const second = seconds % 60
  return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

Page({
  data: {
    devicePosition: 'front',
    cameraLabel: '前置摄像头',
    cameraKey: 0,
    isSwitchingCamera: false,
    isRecording: false,
    hasVideo: false,
    tempVideoPath: '',
    tempThumbPath: '',
    recordingSeconds: 0,
    recordingTimeText: '00:00',
    recordTitle: '录像练习',
    recordSubtitle: '',
    promptText: '',
    requirement: '',
    showPrompt: true,
    promptFontSize: 32
  },

  onLoad() {
    this.setData({
      devicePosition: 'front',
      cameraLabel: '前置摄像头',
      isSwitchingCamera: false
    })

    const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel()
    if (eventChannel && eventChannel.on) {
      eventChannel.on('videoRecordContext', data => {
        this.setData({
          recordTitle: data.title || '录像练习',
          recordSubtitle: data.subtitle || '',
          promptText: data.promptText || '',
          requirement: data.requirement || '',
          showPrompt: true
        })
      })
    }
  },

  onReady() {
    this.cameraContext = wx.createCameraContext()
  },

  switchCamera() {
    console.log('switchCamera triggered')
    console.log('点击翻转摄像头，当前：', this.data.devicePosition)

    if (this.data.isRecording) {
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

  increasePromptFont() {
    const next = Math.min(this.data.promptFontSize + 2, 44)
    this.setData({
      promptFontSize: next
    })
  },

  decreasePromptFont() {
    const next = Math.max(this.data.promptFontSize - 2, 24)
    this.setData({
      promptFontSize: next
    })
  },

  increaseFontSize() {
    this.increasePromptFont()
  },

  decreaseFontSize() {
    this.decreasePromptFont()
  },

  toggleRecord() {
    if (this.data.isRecording) {
      this.stopRecord()
      return
    }

    this.startRecord()
  },

  startRecord() {
    if (this.data.hasVideo) {
      wx.showToast({
        title: '请先重新录制或使用该视频',
        icon: 'none'
      })
      return
    }

    this.ensureCameraPermission(() => {
      if (!this.cameraContext) {
        this.cameraContext = wx.createCameraContext()
      }

      this.cameraContext.startRecord({
        success: () => {
          this.setData({
            isRecording: true,
            recordingSeconds: 0,
            recordingTimeText: '00:00'
          })
          this.startTimer()
        },
        fail: err => {
          console.error('startRecord failed', err)
          wx.showToast({
            title: '录像启动失败',
            icon: 'none'
          })
        }
      })
    })
  },

  stopRecord() {
    if (!this.data.isRecording) return

    this.cameraContext.stopRecord({
      compressed: true,
      success: res => {
        this.setData({
          hasVideo: true,
          tempVideoPath: res.tempVideoPath,
          tempThumbPath: res.tempThumbPath || '',
          showPrompt: false
        })
      },
      fail: err => {
        console.error('stopRecord failed', err)
        wx.showToast({
          title: '停止录像失败',
          icon: 'none'
        })
      },
      complete: () => {
        this.stopTimer()
        this.setData({
          isRecording: false
        })
      }
    })
  },

  startTimer() {
    this.stopTimer()
    this.recordTimer = setInterval(() => {
      const seconds = this.data.recordingSeconds + 1

      this.setData({
        recordingSeconds: seconds,
        recordingTimeText: formatSeconds(seconds)
      })
    }, 1000)
  },

  stopTimer() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer)
      this.recordTimer = null
    }
  },

  resetRecord() {
    this.stopTimer()
    this.setData({
      hasVideo: false,
      isRecording: false,
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
      recordSubtitle: this.data.recordSubtitle
    })
    wx.navigateBack()
  },

  onCameraError(e) {
    console.error('camera error', e)
    wx.showModal({
      title: '摄像头不可用',
      content: '请检查摄像头权限，或在微信设置中开启摄像头权限。',
      confirmText: '去设置',
      success: res => {
        if (res.confirm) {
          wx.openSetting()
        }
      }
    })
  },

  ensureCameraPermission(callback) {
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
      }
    })
  },

  onUnload() {
    if (this.switchCameraTimer) {
      clearTimeout(this.switchCameraTimer)
      this.switchCameraTimer = null
    }

    if (this.data.isRecording && this.cameraContext) {
      this.cameraContext.stopRecord({})
    }
    this.stopTimer()
  }
})
