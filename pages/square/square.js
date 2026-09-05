const { getUserInfo } = require('../../utils/local-data')
const { cleanReadingDisplayTitle } = require('../../utils/training-data')
const {
  createAudioPlayer,
  getInitialAudioPlayer,
  getWorkType,
  resolveWorkMedia
} = require('../../utils/work-media')
const {
  deleteMySquareWork,
  getSquareWorks,
  toggleSquareLike
} = require('../../utils/cloud-api')
const { requirePhoneBound } = require('../../utils/phone-auth')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline,
  getShareImage
} = require('../../utils/share-config')
const { buildWorkShareConfig, getWorkPublicId } = require('../../utils/work-share')
const {
  VIDEO_SHARE_DISABLED_MESSAGE,
  isWorkShareAllowed
} = require('../../utils/work-share-policy')
const {
  formatShanghaiDateTime,
  isShanghaiToday,
  parseTimeValue
} = require('../../utils/shanghai-time')

const STORAGE_KEYS = {
  trainingSubmissions: 'trainingSubmissions',
  extraTrainingSubmissions: 'extraTrainingSubmissions'
}
const SQUARE_PAGE_SIZE = 20

const MEDIA_DEBUG_FIELDS = [
  'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL',
  'audioFileID', 'audioFileId', 'videoUrl', 'videoURL',
  'videoFileID', 'videoFileId', 'fileID', 'fileId',
  'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId',
  'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL', 'filePath',
  'tempFilePath', 'audioPath', 'videoPath', 'recordPath'
]

function getWorkDebugId(work = {}) {
  return String(work.id || work._id || work.cloudId || work.key || '')
}

function getInteractionId(work = {}, sourceType = '') {
  return String(work.cloudId || work._id || (sourceType === 'cloud' ? work.id : '') || '')
}

function getCloudErrorCode(error) {
  return String(error && (error.code || error.result && error.result.code) || '')
}

function getCloudErrorMessage(error, fallback = '操作失败，请稍后重试。') {
  return String(error && (error.result && error.result.message || error.message) || fallback)
}

function getSourceType(source) {
  const value = String(source || '')
  if (!value) return 'empty'
  if (/^https:\/\//i.test(value)) return 'https'
  if (/^http:\/\/tmp\//i.test(value)) return 'http-temp'
  if (/^http:\/\//i.test(value)) return 'http'
  if (/^cloud:\/\//i.test(value)) return 'cloud'
  if (/^wxfile:\/\//i.test(value)) return 'wxfile'
  if (/^file:/i.test(value)) return 'local-file'
  return 'path'
}

function isCloudFileID(value) {
  return getSourceType(value) === 'cloud'
}

function getMediaFieldSummary(work = {}) {
  return MEDIA_DEBUG_FIELDS.reduce((summary, field) => {
    const value = String(work[field] || '').trim()
    if (!value) return summary
    // 只输出字段类型和长度，避免 cloud 路径中的用户标识及临时 URL token 泄露。
    summary[field] = {
      exists: true,
      valueType: getSourceType(value),
      length: value.length
    }
    return summary
  }, {})
}

function debugSquareWorkMedia(work = {}) {
  const workId = getWorkDebugId(work)
  const media = resolveWorkMedia(work)
  console.log('[square-play] work media fields', {
    workIds: {
      _id: String(work._id || ''),
      id: String(work.id || '')
    },
    title: work.title || '',
    taskTitle: work.taskTitle || '',
    submitType: work.submitType || '',
    mediaType: work.mediaType || '',
    type: work.type || '',
    mediaFields: getMediaFieldSummary(work)
  })
  console.log('[square-play] resolveWorkMedia', {
    workId,
    type: media.type,
    hasSrc: Boolean(media.src),
    hasFileID: Boolean(media.fileID),
    needTempUrl: media.needTempUrl,
    srcType: getSourceType(media.src),
    fileIDType: getSourceType(media.fileID)
  })
  return media
}

function getCloudTempFileURL(fileID, workId) {
  return new Promise(resolve => {
    if (!wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
      const error = { errCode: 'CLOUD_TEMP_URL_UNAVAILABLE', errMsg: 'wx.cloud.getTempFileURL 不可用' }
      console.warn('[square-play] get temp url fail', { workId, ...error })
      resolve({ success: false, reason: 'GET_TEMP_URL_FAILED', ...error })
      return
    }

    console.log('[square-play] get temp url start', {
      workId,
      hasFileID: Boolean(fileID),
      isCloudFileID: isCloudFileID(fileID)
    })
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success(result) {
        const fileList = result && Array.isArray(result.fileList) ? result.fileList : []
        const first = fileList[0] || null
        const code = first && first.status !== undefined ? first.status : (result && result.errCode)
        const errMsg = (first && first.errMsg) || (result && result.errMsg) || ''
        const tempFileURL = String(first && first.tempFileURL || '')
        const safeFileList = fileList.map(file => ({
          status: file && file.status,
          errMsg: file && file.errMsg,
          hasTempFileURL: Boolean(file && file.tempFileURL),
          tempFileURLType: getSourceType(file && file.tempFileURL)
        }))
        console.log('[square-play] get temp url success', {
          workId,
          code,
          errMsg,
          fileList: safeFileList
        })

        if (!first) {
          resolve({ success: false, reason: 'TEMP_FILE_LIST_EMPTY', errMsg })
          return
        }
        if (Number(first.status) !== 0) {
          console.warn('[square-play] temp file status error', {
            workId,
            status: first.status,
            errMsg: first.errMsg || errMsg
          })
          resolve({
            success: false,
            reason: 'TEMP_FILE_STATUS_ERROR',
            status: first.status,
            errMsg: first.errMsg || errMsg
          })
          return
        }
        if (!tempFileURL) {
          console.warn('[square-play] tempFileURL empty', {
            workId,
            status: first.status,
            errMsg: first.errMsg || errMsg
          })
          resolve({ success: false, reason: 'TEMP_URL_EMPTY', errMsg: first.errMsg || errMsg })
          return
        }
        resolve({ success: true, tempFileURL })
      },
      fail(error) {
        console.warn('[square-play] get temp url fail', {
          workId,
          errCode: error && error.errCode,
          errMsg: error && error.errMsg
        })
        resolve({
          success: false,
          reason: 'GET_TEMP_URL_FAILED',
          errCode: error && error.errCode,
          errMsg: error && error.errMsg
        })
      }
    })
  })
}

function getMediaFailureMessage(reason, mediaType = 'audio') {
  const isVideo = mediaType === 'video'
  if (reason === 'MISSING_MEDIA') {
    return isVideo ? '该作品缺少视频文件，暂时无法查看。' : '该作品缺少录音文件，暂时无法播放。'
  }
  if (reason === 'INVALID_CLOUD_FILE_ID') {
    return isVideo ? '该作品视频文件不是云端文件，暂时无法查看。' : '该作品录音文件不是云端文件，暂时无法播放。'
  }
  if (reason === 'TEMP_URL_EMPTY') {
    return isVideo ? '视频文件地址为空，请稍后再试。' : '录音文件地址为空，请稍后再试。'
  }
  return isVideo ? '视频文件地址获取失败，请稍后再试。' : '录音文件地址获取失败，请稍后再试。'
}

const FILTERS = [
  { id: 'all', title: '全部' },
  { id: 'audio', title: '音频' },
  { id: 'reading', title: '朗读' },
  { id: 'retell', title: '复述' },
  { id: 'topic', title: '话题' },
  { id: 'mandarin', title: '普通话' },
  { id: 'randomTopic', title: '随机话题' },
  { id: 'tongueTwister', title: '绕口令' }
]

function getStorageList(key) {
  const list = wx.getStorageSync(key) || []
  return Array.isArray(list) ? list : []
}

function markLocalSquareWorkDeleted(workId) {
  const id = String(workId || '')
  Object.values(STORAGE_KEYS).forEach(storageKey => {
    const list = getStorageList(storageKey)
    let changed = false
    const nextList = list.map(item => {
      const matched = [item.cloudId, item._id, item.id].some(value => String(value || '') === id)
      if (!matched) return item
      changed = true
      return {
        ...item,
        publicStatus: 'deleted',
        isPublic: false
      }
    })
    if (changed) wx.setStorageSync(storageKey, nextList)
  })
}

function isToday(timeText) {
  return isShanghaiToday(timeText, Date.now(), { naiveTimeZone: 'Asia/Shanghai' })
}

function getAvatarText(nickname) {
  const name = String(nickname || '同学').trim()
  if (!name) return '同'

  const first = name.slice(0, 1)
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
}

function getDurationText(item) {
  if (item.duration) return item.duration
  if (item.durationSeconds) return `${item.durationSeconds}秒`
  return '暂无'
}

function normalizeModuleTitle(title) {
  return String(title || '主训练').replace(/^21天/, '')
}

function normalizeWorkTitle(item) {
  const title = item.contentTitle || item.taskTitle || item.content || '训练作品'
  if (item.moduleId === 'reading' || String(item.moduleTitle || '').indexOf('朗读') > -1) {
    return cleanReadingDisplayTitle(title)
  }

  return title
}

function getCategoryText(item, workType) {
  if (item.moduleId === 'reading' || String(item.moduleTitle || '').indexOf('朗读') > -1) return '朗读'
  if (item.moduleId === 'retell') return '复述'
  if (item.moduleId === 'topic') return '话题'
  if (item.moduleId === 'mandarin') return '普通话'
  if (item.extraType === 'randomTopic') return '随机话题'
  if (item.extraType === 'tongueTwister') return '绕口令'
  if (item.extraType === 'dailyQuote') return '每日金句'
  return item.extraTitle || '加练'
}

function normalizeWork(item, sourceType, index, naiveTimeZone = 'Asia/Shanghai') {
  const workType = getWorkType(item)
  const publicNickname = item.publicNickname || item.studentName || '同学'
  const timeText = item.publicAt || item.submittedAt || item.createdAt || ''

  return {
    ...item,
    key: `${sourceType}-${item.id || item._id || index}`,
    audioKey: `${sourceType}-${item.id || item._id || index}`,
    sourceType,
    interactionId: getInteractionId(item, sourceType),
    workType,
    shareAllowed: isWorkShareAllowed(item),
    publicNickname,
    publicAvatarText: item.publicAvatarText || getAvatarText(publicNickname),
    moduleText: item.moduleTitle
      ? `${normalizeModuleTitle(item.moduleTitle)}${item.day ? ` · Day ${item.day}` : ''}`
      : (item.extraTitle || '额外训练'),
    categoryText: getCategoryText(item, workType),
    mediaTypeText: workType === 'video' ? '视频' : '音频',
    titleText: normalizeWorkTitle(item),
    typeText: workType === 'video' ? '录像作品' : '录音作品',
    durationText: getDurationText(item),
    publicTimeText: timeText
      ? formatShanghaiDateTime(timeText, {
        naiveTimeZone
      })
      : '暂无',
    sortTime: parseTimeValue(timeText, {
      naiveTimeZone
    }) || 0,
    isMine: Boolean(item.isMine),
    likeCount: Math.max(Number(item.likeCount || 0), 0),
    commentCount: Math.max(Number(item.commentCount || 0), 0),
    likedByMe: item.likedByMe === true
  }
}

function getLocalPublicWorks() {
  const mainWorks = getStorageList(STORAGE_KEYS.trainingSubmissions)
    .filter(item => item.isPublic === true && isWorkShareAllowed(item))
    .map((item, index) => normalizeWork(item, 'main', index))
  const extraWorks = getStorageList(STORAGE_KEYS.extraTrainingSubmissions)
    .filter(item => item.isPublic === true && isWorkShareAllowed(item))
    .map((item, index) => normalizeWork(item, 'extra', index))

  return mainWorks.concat(extraWorks)
}

function matchFilter(item, filterId) {
  if (filterId === 'all') return true
  if (filterId === 'audio') return item.workType === 'audio'
  if (filterId === 'reading') return item.moduleId === 'reading' || String(item.moduleTitle || '').indexOf('朗读') > -1
  if (filterId === 'retell') return item.moduleId === 'retell'
  if (filterId === 'topic') return item.moduleId === 'topic'
  if (filterId === 'mandarin') return item.moduleId === 'mandarin'
  if (filterId === 'randomTopic') return item.extraType === 'randomTopic'
  if (filterId === 'tongueTwister') return item.extraType === 'tongueTwister'
  return true
}

function getSquareUniqueId(work = {}) {
  return String(work.cloudId || work._id || work.submissionId || work.workId || work.id || work.key || '')
}

function dedupeSquareWorks(works = []) {
  const seen = new Set()
  return works.filter(work => {
    const id = getSquareUniqueId(work)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

Page({
  data: {
    filters: FILTERS,
    activeFilter: 'all',
    allWorks: [],
    works: [],
    publicCount: 0,
    todayCount: 0,
    myPublicCount: 0,
    hasWorks: false,
    loading: false,
    loadingMore: false,
    hasMore: true,
    nextCursor: '',
    audioPlayer: getInitialAudioPlayer(),
    currentShareWorkId: ''
  },

  onLoad() {
    this.mediaTempUrlCache = Object.create(null)
    this.likeRequestMap = Object.create(null)
  },

  onShow() {
    enableShareMenu()
    if (!this.audioPlayer) {
      this.audioPlayer = createAudioPlayer(this, {
        debugPrefix: '[square-play]',
        autoplay: true
      })
    }
    this.loadPublicWorks({ reset: true })
  },

  async onPullDownRefresh() {
    try {
      await this.loadPublicWorks({ reset: true })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onReachBottom() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    this.loadPublicWorks({ reset: false })
  },

  async loadPublicWorks({ reset = true } = {}) {
    if (!reset && (this.data.loading || this.data.loadingMore || !this.data.hasMore)) return
    if (reset) this.squareLoadGeneration = Number(this.squareLoadGeneration || 0) + 1
    const generation = Number(this.squareLoadGeneration || 0)
    const cursor = reset ? '' : this.data.nextCursor
    this.setData(reset
      ? { loading: true, loadingMore: false, hasMore: true, nextCursor: '' }
      : { loadingMore: true })
    try {
      const cloudRes = await getSquareWorks('all', { pageSize: SQUARE_PAGE_SIZE, cursor })
      if (generation !== this.squareLoadGeneration) return
      this.applyCloudWorks(cloudRes.works || [], cloudRes.stats || {}, { append: !reset })
      this.setData({
        hasMore: Boolean(cloudRes.hasMore),
        nextCursor: String(cloudRes.nextCursor || '')
      })
      return
    } catch (err) {
      console.warn('[ square ] 使用本地 fallback。云端读取失败:', err)
      if (!reset) {
        if (generation === this.squareLoadGeneration) {
          wx.showToast({ title: '加载失败，请重试', icon: 'none' })
        }
        return
      }
    } finally {
      if (generation === this.squareLoadGeneration) {
        this.setData({ loading: false, loadingMore: false })
      }
    }

    if (generation !== this.squareLoadGeneration) return
    this.loadLocalPublicWorks()
  },

  applyCloudWorks(cloudWorks, stats = {}, { append = false } = {}) {
    const userInfo = getUserInfo() || {}
    const currentOpenid = userInfo.openid || ''
    const currentNickname = userInfo.nickname || userInfo.nickName || ''
    const cloudList = cloudWorks
      .filter(item => isWorkShareAllowed(item))
      .map((item, index) => normalizeWork(
        item,
        item.sourceType || 'cloud',
        index,
        'UTC'
      ))
    const existingWorks = append ? this.data.allWorks : []
    const combinedCloudWorks = dedupeSquareWorks(existingWorks.concat(cloudList))
    const cloudIds = combinedCloudWorks.map(getSquareUniqueId).filter(Boolean)
    const localOnlyWorks = getLocalPublicWorks().filter(item => !item.cloudId || !cloudIds.includes(String(item.cloudId)))
    const allWorks = dedupeSquareWorks(combinedCloudWorks.concat(localOnlyWorks))
      .map(item => ({
        ...item,
        isMine: item.isMine || (currentOpenid
          ? (item.ownerOpenid === currentOpenid || item.publicOpenid === currentOpenid)
          : Boolean(currentNickname && item.publicNickname === currentNickname))
      }))
      .sort((a, b) => b.sortTime - a.sortTime)

    this.setData({
      allWorks,
      publicCount: Number.isFinite(Number(stats.publicCount)) ? Number(stats.publicCount) : allWorks.length,
      todayCount: Number.isFinite(Number(stats.todayCount)) ? Number(stats.todayCount) : allWorks.filter(item => isToday(item.publicTimeText)).length,
      myPublicCount: Number.isFinite(Number(stats.myPublicCount)) ? Number(stats.myPublicCount) : allWorks.filter(item => item.isMine).length
    })
    this.applyFilter()
  },

  loadLocalPublicWorks() {
    const userInfo = getUserInfo() || {}
    const currentOpenid = userInfo.openid || ''
    const currentNickname = userInfo.nickname || userInfo.nickName || ''
    const allWorks = getLocalPublicWorks()
      .map(item => ({
        ...item,
        isMine: currentOpenid
          ? item.publicOpenid === currentOpenid
          : Boolean(currentNickname && item.publicNickname === currentNickname)
      }))
      .sort((a, b) => b.sortTime - a.sortTime)

    this.setData({
      allWorks,
      hasMore: false,
      nextCursor: '',
      publicCount: allWorks.length,
      todayCount: allWorks.filter(item => isToday(item.publicTimeText)).length,
      myPublicCount: allWorks.filter(item => item.isMine).length
    })
    this.applyFilter()
  },

  changeFilter(e) {
    this.setData({
      activeFilter: e.currentTarget.dataset.id || 'all'
    })
    this.applyFilter()
  },

  applyFilter() {
    const works = this.data.allWorks.filter(item => matchFilter(item, this.data.activeFilter))

    this.setData({
      works,
      hasWorks: works.length > 0
    })
  },

  patchWorkInteraction(workId, patch) {
    const id = String(workId || '')
    const allWorks = this.data.allWorks.map(item => (
      item.interactionId === id ? { ...item, ...patch } : item
    ))
    const works = allWorks.filter(item => matchFilter(item, this.data.activeFilter))
    const currentWork = this.data.currentWork && this.data.currentWork.interactionId === id
      ? { ...this.data.currentWork, ...patch }
      : this.data.currentWork
    this.setData({ allWorks, works, currentWork, hasWorks: works.length > 0 })
  },

  onDeleteSquareWork(e) {
    const workId = String(e.currentTarget.dataset.id || '')
    const work = this.data.allWorks.find(item => item.interactionId === workId)
    if (!workId || !work || !work.isMine) return

    wx.showModal({
      title: '删除作品',
      content: '删除后将不再在广场展示，确认删除吗？',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#d85050',
      success: async result => {
        if (!result.confirm) return
        wx.showLoading({ title: '正在删除', mask: true })
        try {
          await deleteMySquareWork(workId)
          wx.hideLoading()
          markLocalSquareWorkDeleted(workId)
          await this.loadPublicWorks({ reset: true })
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          wx.hideLoading()
          wx.showToast({
            title: getCloudErrorMessage(error, '删除失败，请稍后重试。'),
            icon: 'none'
          })
        }
      }
    })
  },

  onToggleLike(e) {
    const workId = String(e.currentTarget.dataset.id || '')
    if (!workId) {
      wx.showToast({ title: '作品尚未同步云端', icon: 'none' })
      return
    }
    if (!requirePhoneBound('点赞作品', {
      page: this,
      onSuccess: () => this.toggleLikeById(workId)
    })) return
    this.toggleLikeById(workId)
  },

  async toggleLikeById(workId) {
    const busyMap = this.likeRequestMap || (this.likeRequestMap = Object.create(null))
    if (busyMap[workId]) return
    busyMap[workId] = true
    try {
      const result = await toggleSquareLike(workId)
      this.patchWorkInteraction(workId, {
        likedByMe: result.liked === true,
        likeCount: Math.max(Number(result.likeCount || 0), 0)
      })
    } catch (error) {
      wx.showToast({ title: getCloudErrorMessage(error, '点赞失败，请稍后重试。'), icon: 'none' })
    } finally {
      delete busyMap[workId]
    }
  },

  noop() {},


  async getPlayableMediaUrl(media, workId) {
    if (media.src) {
      const srcType = getSourceType(media.src)
      if (srcType === 'https' || srcType === 'http') {
        return { src: media.src, reason: '' }
      }
      console.warn('[square-play] invalid cloud fileID', {
        workId,
        hasFileID: Boolean(media.fileID),
        fileIDType: getSourceType(media.fileID),
        srcType
      })
      return { src: '', reason: 'INVALID_CLOUD_FILE_ID' }
    }
    if (!media.fileID) return { src: '', reason: 'MISSING_MEDIA' }
    if (!isCloudFileID(media.fileID)) {
      console.warn('[square-play] invalid cloud fileID', {
        workId,
        hasFileID: true,
        fileIDType: getSourceType(media.fileID)
      })
      return { src: '', reason: 'INVALID_CLOUD_FILE_ID' }
    }

    const cache = this.mediaTempUrlCache || (this.mediaTempUrlCache = Object.create(null))
    if (cache[media.fileID]) {
      console.log('[square-play] temp URL cache hit', { workId })
      return { src: cache[media.fileID], reason: '' }
    }

    const result = await getCloudTempFileURL(media.fileID, workId)
    if (result.success && result.tempFileURL) {
      cache[media.fileID] = result.tempFileURL
      return { src: result.tempFileURL, reason: '' }
    }
    return { src: '', reason: result.reason || 'GET_TEMP_URL_FAILED' }
  },

  async playAudioWork(e) {
    const target = this.data.works.find(item => item.key === e.currentTarget.dataset.key)
    const workId = getWorkDebugId(target)

    if (!target) {
      console.warn('[square-play] work not found', { workId })
      wx.showToast({ title: '作品不存在', icon: 'none' })
      return
    }

    console.log('[square-play] click audio', {
      workId,
      _id: String(target._id || ''),
      id: String(target.id || ''),
      title: target.title || '',
      taskTitle: target.taskTitle || '',
      type: target.type || '',
      submitType: target.submitType || '',
      mediaType: target.mediaType || ''
    })

    if (this.audioPlayer && this.data.audioPlayer.activeKey === target.audioKey) {
      console.log('[square-play] toggle current audio', { workId })
      this.audioPlayer.play(target, target.audioKey)
      return
    }

    const media = debugSquareWorkMedia(target)

    let playable = { src: '', reason: 'GET_TEMP_URL_FAILED' }
    try {
      playable = await this.getPlayableMediaUrl(media, workId)
    } catch (error) {
      console.warn('[square-play] resolve playable url error', {
        workId,
        errCode: error && error.errCode,
        errMsg: error && error.errMsg
      })
    }
    const audioPath = playable.src

    console.log('[square-play] final playable src exists', {
      workId,
      mediaType: 'audio',
      exists: Boolean(audioPath),
      srcType: getSourceType(audioPath),
      failureStep: playable.reason || ''
    })

    if (!audioPath) {
      wx.showToast({
        title: getMediaFailureMessage(playable.reason, 'audio'),
        icon: 'none'
      })
      return
    }

    if (!this.audioPlayer) {
      this.audioPlayer = createAudioPlayer(this, {
        debugPrefix: '[square-play]',
        autoplay: true
      })
    }
    this.audioPlayer.play({
      ...target,
      filePath: audioPath,
      audioUrl: audioPath,
      fileID: ''
    }, target.audioKey)
  },

  onAudioSliderChange(e) {
    if (!this.audioPlayer) return
    this.audioPlayer.seek(e.detail.value)
  },

  goTraining() {
    wx.switchTab({
      url: '/pages/training/training'
    })
  },

  stopAudioContext() {
    if (this.audioPlayer) {
      this.audioPlayer.destroy()
    }
  },

  showTimelineShareHint() {
    wx.showToast({
      title: '朋友圈分享请进入作品详情，点击右上角 ···',
      icon: 'none'
    })
  },

  onShareAppMessage(res = {}) {
    const dataset = res.target && res.target.dataset ? res.target.dataset : {}
    const workId = String(dataset.workId || dataset.squareWorkId || '')
    const hasWorkIndex = dataset.workIndex !== undefined && dataset.workIndex !== null
    const workIndex = Number(dataset.workIndex)
    if (res.from === 'button' && (workId || hasWorkIndex)) {
      const work = this.data.works.find(item => getWorkPublicId(item) === workId) ||
        (Number.isInteger(workIndex) ? this.data.works[workIndex] : null)
      if (work && !isWorkShareAllowed(work)) {
        wx.showToast({ title: VIDEO_SHARE_DISABLED_MESSAGE, icon: 'none' })
        return undefined
      }
      if (work) {
        const shareWorkId = getWorkPublicId(work)
        this.setData({ currentShareWorkId: shareWorkId })
        const shareConfig = buildWorkShareConfig(work, 'square')
        return shareConfig ? getDefaultShareMessage(shareConfig) : undefined
      }
    }

    return getDefaultShareMessage({
      title: '表达广场｜看看大家的口才训练作品',
      path: '/pages/square/square',
      imageUrl: getShareImage('square')
    })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({
      title: '表达广场｜看看大家的口才训练作品',
      targetPage: 'square',
      imageUrl: getShareImage('square')
    })
  },

  onHide() {
    if (this.audioPlayer) {
      this.audioPlayer.pause()
    }
  },

  onUnload() {
    this.stopAudioContext()
  }
})
