const AUDIO_PATH_FIELDS = [
  'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL',
  'audioPath', 'recordPath', 'mediaUrl', 'mediaURL',
  'fileUrl', 'fileURL', 'filePath', 'tempFilePath',
  'audioFileID', 'audioFileId', 'fileID', 'fileId',
  'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId'
]

const VIDEO_PATH_FIELDS = [
  'videoUrl', 'videoURL', 'videoFileUrl', 'videoFileURL',
  'videoPath', 'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL',
  'filePath', 'tempFilePath', 'recordPath',
  'videoFileID', 'videoFileId', 'fileID', 'fileId',
  'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId'
]

const AUDIO_FILE_ID_FIELDS = [
  'audioFileID', 'audioFileId', 'fileID', 'fileId',
  'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId'
]

const VIDEO_FILE_ID_FIELDS = [
  'videoFileID', 'videoFileId', 'fileID', 'fileId',
  'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId'
]

function getFirstMediaValue(work, fields) {
  if (!work) return ''
  for (const field of fields) {
    const value = String(work[field] || '').trim()
    if (value) return value
  }
  return ''
}

function isCloudFileID(value) {
  return /^cloud:\/\//i.test(String(value || '').trim())
}

function getMediaSourceType(value) {
  const source = String(value || '').trim()
  if (!source) return 'empty'
  if (isCloudFileID(source)) return 'cloud-file-id'
  if (/^https?:\/\//i.test(source)) return 'http-url'
  if (/^(wxfile|file):/i.test(source)) return 'local-file'
  return 'path'
}

function getAudioPath(work) {
  return getFirstMediaValue(work, AUDIO_PATH_FIELDS)
}

function getVideoPath(work) {
  return getFirstMediaValue(work, VIDEO_PATH_FIELDS)
}

function getWorkType(work) {
  if (!work) return ''
  const explicitType = String(work.workType || work.mediaType || work.submitType || work.type || '').toLowerCase()
  if (explicitType.includes('video')) return 'video'
  if (explicitType.includes('audio') || explicitType.includes('voice') || explicitType.includes('record')) return 'audio'

  const videoPath = getFirstMediaValue(work, [
    'videoUrl', 'videoURL', 'videoFileUrl', 'videoFileURL',
    'videoFileID', 'videoFileId', 'videoPath'
  ])
  const audioPath = getFirstMediaValue(work, [
    'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL',
    'audioFileID', 'audioFileId', 'audioPath', 'recordPath'
  ])
  const anyPath = getFirstMediaValue(work, [
    'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL', 'filePath',
    'tempFilePath', 'fileID', 'fileId', 'cloudFileID', 'cloudFileId'
  ])

  if (videoPath || /\.(mp4|mov|m4v|avi)(\?|$)/i.test(anyPath)) return 'video'
  if (audioPath || /\.(mp3|m4a|aac|wav|amr|silk|ogg)(\?|$)/i.test(anyPath)) return 'audio'
  return 'audio'
}

function resolveWorkMedia(work = {}) {
  const inferredType = getWorkType(work)
  const fields = inferredType === 'video' ? VIDEO_PATH_FIELDS : AUDIO_PATH_FIELDS
  const fileIdFields = inferredType === 'video' ? VIDEO_FILE_ID_FIELDS : AUDIO_FILE_ID_FIELDS
  const candidate = getFirstMediaValue(work, fields)
  let fileID = getFirstMediaValue(work, fileIdFields)

  if (isCloudFileID(candidate)) fileID = candidate
  const needTempUrl = isCloudFileID(fileID || candidate)
  const src = needTempUrl ? '' : candidate
  const hasMedia = Boolean(candidate || fileID)

  return {
    type: hasMedia ? inferredType : 'unknown',
    src,
    fileID,
    needTempUrl,
    coverUrl: getFirstMediaValue(work, ['coverUrl', 'coverURL']),
    coverFileID: getFirstMediaValue(work, ['coverFileID', 'coverFileId'])
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatAudioTime(seconds) {
  const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(Math.floor(Number(seconds)), 0) : 0
  const minute = Math.floor(safeSeconds / 60)
  const second = safeSeconds % 60

  return `${pad(minute)}:${pad(second)}`
}

function parseDurationToSeconds(duration) {
  if (typeof duration === 'number') return Math.max(Math.floor(duration), 0)
  if (!duration) return 0

  const text = String(duration).trim()
  const minuteMatch = text.match(/(\d+)\s*分(?:钟)?\s*(\d+)?\s*秒?/)
  if (minuteMatch) {
    return Number(minuteMatch[1] || 0) * 60 + Number(minuteMatch[2] || 0)
  }

  const secondMatch = text.match(/(\d+)\s*秒/)
  if (secondMatch) return Number(secondMatch[1] || 0)

  const colonMatch = text.match(/^(\d{1,2}):(\d{1,2})$/)
  if (colonMatch) return Number(colonMatch[1] || 0) * 60 + Number(colonMatch[2] || 0)

  const numberMatch = text.match(/\d+/)
  return numberMatch ? Number(numberMatch[0]) : 0
}

function getInitialAudioPlayer() {
  return {
    activeKey: '',
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    duration: 0,
    progress: 0,
    currentText: '00:00',
    durationText: '00:00'
  }
}

function getAudioButtonText(audioPlayer, key) {
  const activeKey = String(key || '')
  if (!audioPlayer || audioPlayer.activeKey !== activeKey) return '播放'
  if (audioPlayer.isPlaying) return '暂停'
  if (audioPlayer.isPaused) return '继续'
  return '播放'
}

function createAudioPlayer(page, options = {}) {
  let audioContext = null
  let activeKey = ''
  const debugPrefix = String(options.debugPrefix || '').trim()

  function debugEvent(event, data = {}) {
    if (!debugPrefix) return
    console.log(`${debugPrefix} ${event}`, data)
  }

  function setPlayerState(patch) {
    const current = page.data && page.data.audioPlayer ? page.data.audioPlayer : getInitialAudioPlayer()
    page.setData({
      audioPlayer: {
        ...current,
        ...patch
      }
    })
  }

  function syncDuration() {
    if (!audioContext || !activeKey) return

    const duration = Number(audioContext.duration || 0)
    if (!duration || Number.isNaN(duration)) return

    setPlayerState({
      duration,
      durationText: formatAudioTime(duration)
    })
  }

  function destroy(shouldReset = true) {
    if (audioContext) {
      audioContext.stop()
      audioContext.destroy()
      audioContext = null
    }
    activeKey = ''

    if (shouldReset) {
      setPlayerState(getInitialAudioPlayer())
    }
  }

  function pause() {
    if (audioContext) {
      audioContext.pause()
    }
  }

  function play(work, key) {
    const nextKey = String(key || (work && (work.key || work.id)) || '')
    const currentPlayer = page.data && page.data.audioPlayer ? page.data.audioPlayer : getInitialAudioPlayer()

    if (audioContext && activeKey === nextKey) {
      if (currentPlayer.isPlaying) {
        audioContext.pause()
        return
      }

      audioContext.play()
      return
    }

    const audioPath = getAudioPath(work)
    if (!audioPath) {
      wx.showToast({
        title: '录音文件暂时无法播放',
        icon: 'none'
      })
      return
    }

    destroy(false)

    const estimatedDuration = parseDurationToSeconds(work.durationSeconds || work.duration || work.durationText)
    activeKey = nextKey
    setPlayerState({
      activeKey,
      isPlaying: false,
      isPaused: false,
      currentTime: 0,
      duration: estimatedDuration,
      progress: 0,
      currentText: '00:00',
      durationText: formatAudioTime(estimatedDuration)
    })

    wx.showLoading({
      title: '准备播放'
    })

    audioContext = wx.createInnerAudioContext()
    audioContext.autoplay = options.autoplay === true

    audioContext.onCanplay(() => {
      debugEvent('innerAudioContext onCanplay', { workId: activeKey })
      setTimeout(syncDuration, 200)
    })

    audioContext.onPlay(() => {
      debugEvent('innerAudioContext onPlay', { workId: activeKey })
      wx.hideLoading()
      syncDuration()
      setPlayerState({
        isPlaying: true,
        isPaused: false
      })
    })

    audioContext.onPause(() => {
      setPlayerState({
        isPlaying: false,
        isPaused: true
      })
    })

    audioContext.onTimeUpdate(() => {
      const currentTime = Number(audioContext.currentTime || 0)
      const duration = Number(audioContext.duration || page.data.audioPlayer.duration || 0)
      const progress = duration > 0 ? Math.min(100, Math.round((currentTime / duration) * 1000) / 10) : 0

      setPlayerState({
        currentTime,
        duration,
        progress,
        currentText: formatAudioTime(currentTime),
        durationText: formatAudioTime(duration)
      })
    })

    audioContext.onEnded(() => {
      debugEvent('innerAudioContext onEnded', { workId: activeKey })
      setPlayerState({
        isPlaying: false,
        isPaused: false,
        currentTime: 0,
        progress: 0,
        currentText: '00:00'
      })
    })

    audioContext.onError(error => {
      const failedKey = activeKey
      wx.hideLoading()
      const errorSummary = {
        workId: failedKey,
        errCode: error && error.errCode,
        errMsg: error && error.errMsg
      }
      if (debugPrefix) debugEvent('innerAudioContext onError', errorSummary)
      else console.error('audio play error', errorSummary)
      destroy()
      wx.showToast({
        title: '录音文件暂时无法播放',
        icon: 'none'
      })
    })

    if (typeof audioContext.onStop === 'function') {
      audioContext.onStop(() => {
        debugEvent('innerAudioContext onStop', { workId: activeKey })
      })
    }

    debugEvent('innerAudioContext src', {
      workId: activeKey,
      hasSrc: Boolean(audioPath),
      srcType: getMediaSourceType(audioPath)
    })
    audioContext.src = audioPath
    if (!audioContext.autoplay) audioContext.play()
  }

  function seek(progress) {
    if (!audioContext || !activeKey) return

    const player = page.data && page.data.audioPlayer ? page.data.audioPlayer : getInitialAudioPlayer()
    const duration = Number(player.duration || audioContext.duration || 0)
    if (!duration || Number.isNaN(duration)) return

    const safeProgress = Math.max(0, Math.min(100, Number(progress || 0)))
    const nextTime = duration * safeProgress / 100

    audioContext.seek(nextTime)
    setPlayerState({
      currentTime: nextTime,
      progress: safeProgress,
      currentText: formatAudioTime(nextTime)
    })
  }

  return {
    play,
    pause,
    seek,
    destroy,
    getButtonText: key => getAudioButtonText(page.data && page.data.audioPlayer, key)
  }
}

function previewVideoByPath(videoPath, title = '视频预览') {
  if (!videoPath) {
    wx.showToast({
      title: '视频文件暂时无法查看',
      icon: 'none'
    })
    return
  }

  const previewKey = `videoPreview:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  try {
    wx.setStorageSync(previewKey, {
      src: String(videoPath),
      title: String(title || '视频预览'),
      createdAt: Date.now()
    })
  } catch (error) {
    console.error('save video preview session failed', error)
    wx.showToast({ title: '视频文件暂时无法查看', icon: 'none' })
    return
  }

  wx.navigateTo({
    url: `/pages/video-preview/video-preview?previewKey=${encodeURIComponent(previewKey)}`,
    fail: error => {
      try {
        wx.removeStorageSync(previewKey)
      } catch (removeError) {
        console.warn('remove video preview session failed', removeError)
      }
      console.error('open video preview failed', error)
      wx.showToast({
        title: '视频文件暂时无法查看',
        icon: 'none'
      })
    }
  })
}

module.exports = {
  createAudioPlayer,
  formatAudioTime,
  getAudioPath,
  getVideoPath,
  getWorkType,
  getInitialAudioPlayer,
  getAudioButtonText,
  resolveWorkMedia,
  parseDurationToSeconds,
  previewVideoByPath
}
