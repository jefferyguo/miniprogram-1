const { getUserInfo } = require('../../utils/local-data')
const { cleanReadingDisplayTitle } = require('../../utils/training-data')
const {
  createAudioPlayer,
  getInitialAudioPlayer,
  getWorkType,
  previewVideoByPath,
  resolveWorkMedia
} = require('../../utils/work-media')
const {
  addSquareComment,
  deleteMySquareWork,
  deleteSquareComment,
  getSquareWorks,
  listSquareComments,
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

const STORAGE_KEYS = {
  trainingSubmissions: 'trainingSubmissions',
  extraTrainingSubmissions: 'extraTrainingSubmissions'
}

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
  { id: 'video', title: '视频' },
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

function getTimeValue(timeText) {
  if (!timeText) return 0
  const date = new Date(String(timeText).replace(/-/g, '/'))
  return date.getTime() || 0
}

function isToday(timeText) {
  if (!timeText) return false
  const date = new Date(String(timeText).replace(/-/g, '/'))
  if (!date.getTime()) return false

  const now = new Date()
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
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

function normalizeWork(item, sourceType, index) {
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
    publicTimeText: timeText || '暂无',
    sortTime: getTimeValue(timeText),
    isMine: Boolean(item.isMine),
    likeCount: Math.max(Number(item.likeCount || 0), 0),
    commentCount: Math.max(Number(item.commentCount || 0), 0),
    likedByMe: item.likedByMe === true
  }
}

function getLocalPublicWorks() {
  const mainWorks = getStorageList(STORAGE_KEYS.trainingSubmissions)
    .filter(item => item.isPublic === true)
    .map((item, index) => normalizeWork(item, 'main', index))
  const extraWorks = getStorageList(STORAGE_KEYS.extraTrainingSubmissions)
    .filter(item => item.isPublic === true)
    .map((item, index) => normalizeWork(item, 'extra', index))

  return mainWorks.concat(extraWorks)
}

function matchFilter(item, filterId) {
  if (filterId === 'all') return true
  if (filterId === 'audio') return item.workType === 'audio'
  if (filterId === 'video') return item.workType === 'video'
  if (filterId === 'reading') return item.moduleId === 'reading' || String(item.moduleTitle || '').indexOf('朗读') > -1
  if (filterId === 'retell') return item.moduleId === 'retell'
  if (filterId === 'topic') return item.moduleId === 'topic'
  if (filterId === 'mandarin') return item.moduleId === 'mandarin'
  if (filterId === 'randomTopic') return item.extraType === 'randomTopic'
  if (filterId === 'tongueTwister') return item.extraType === 'tongueTwister'
  return true
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
    audioPlayer: getInitialAudioPlayer(),
    commentsVisible: false,
    commentsLoading: false,
    commentSubmitting: false,
    currentWork: null,
    comments: [],
    commentText: '',
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
    this.loadPublicWorks()
  },

  async loadPublicWorks() {
    try {
      const cloudRes = await getSquareWorks('all', 50)
      this.applyCloudWorks(cloudRes.works || [])
      return
    } catch (err) {
      console.warn('[ square ] 使用本地 fallback。云端读取失败:', err)
    }

    this.loadLocalPublicWorks()
  },

  applyCloudWorks(cloudWorks) {
    const userInfo = getUserInfo() || {}
    const currentOpenid = userInfo.openid || ''
    const currentNickname = userInfo.nickname || userInfo.nickName || ''
    const cloudList = cloudWorks.map((item, index) => normalizeWork(item, item.sourceType || 'cloud', index))
    const cloudIds = cloudList.map(item => item.cloudId || item._id || item.id).filter(Boolean)
    const localOnlyWorks = getLocalPublicWorks().filter(item => !item.cloudId || !cloudIds.includes(item.cloudId))
    const allWorks = cloudList.concat(localOnlyWorks)
      .map(item => ({
        ...item,
        isMine: item.isMine || (currentOpenid
          ? (item.ownerOpenid === currentOpenid || item.publicOpenid === currentOpenid)
          : Boolean(currentNickname && item.publicNickname === currentNickname))
      }))
      .sort((a, b) => b.sortTime - a.sortTime)

    this.setData({
      allWorks,
      publicCount: allWorks.length,
      todayCount: allWorks.filter(item => isToday(item.publicTimeText)).length,
      myPublicCount: allWorks.filter(item => item.isMine).length
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
          const allWorks = this.data.allWorks.filter(item => item.interactionId !== workId)
          this.setData({
            allWorks,
            publicCount: allWorks.length,
            todayCount: allWorks.filter(item => isToday(item.publicTimeText)).length,
            myPublicCount: allWorks.filter(item => item.isMine).length
          })
          this.applyFilter()
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

  onOpenComments(e) {
    const workId = String(e.currentTarget.dataset.id || '')
    const currentWork = this.data.works.find(item => item.interactionId === workId)
    if (!workId || !currentWork) {
      wx.showToast({ title: '作品尚未同步云端', icon: 'none' })
      return
    }
    this.setData({
      commentsVisible: true,
      commentsLoading: true,
      currentWork,
      comments: [],
      commentText: ''
    })
    this.loadComments(workId)
  },

  async loadComments(workId) {
    try {
      const result = await listSquareComments(workId, 1, 50)
      if (!this.data.currentWork || this.data.currentWork.interactionId !== workId) return
      const commentCount = Math.max(Number(result.total || 0), 0)
      this.setData({ comments: result.data || [], commentsLoading: false })
      this.patchWorkInteraction(workId, { commentCount })
    } catch (error) {
      if (!this.data.currentWork || this.data.currentWork.interactionId !== workId) return
      this.setData({ commentsLoading: false })
      wx.showToast({ title: getCloudErrorMessage(error, '评论加载失败，请稍后重试。'), icon: 'none' })
    }
  },

  closeComments() {
    this.setData({
      commentsVisible: false,
      commentsLoading: false,
      commentSubmitting: false,
      currentWork: null,
      comments: [],
      commentText: ''
    })
  },

  noop() {},

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value || '' })
  },

  onSubmitComment() {
    if (!requirePhoneBound('发表评论', {
      page: this,
      onSuccess: () => this.submitCurrentComment()
    })) return
    this.submitCurrentComment()
  },

  async submitCurrentComment() {
    if (this.data.commentSubmitting || !this.data.currentWork) return
    const content = String(this.data.commentText || '').trim()
    if (!content) {
      wx.showToast({ title: '评论内容不能为空', icon: 'none' })
      return
    }
    if (Array.from(content).length > 200) {
      wx.showToast({ title: '评论内容不能超过 200 字', icon: 'none' })
      return
    }
    const workId = this.data.currentWork.interactionId
    this.setData({ commentSubmitting: true })
    try {
      const result = await addSquareComment(workId, content)
      const comments = result.comment ? [result.comment, ...this.data.comments] : this.data.comments
      this.setData({ comments, commentText: '', commentSubmitting: false })
      this.patchWorkInteraction(workId, {
        commentCount: Math.max(Number(result.commentCount || comments.length), 0)
      })
      wx.showToast({ title: '评论已发布', icon: 'success' })
    } catch (error) {
      this.setData({ commentSubmitting: false })
      const code = getCloudErrorCode(error)
      if (code === 'COMMENT_FORBIDDEN_WORD') {
        wx.showModal({
          title: '评论未发布',
          content: '评论包含不适合公开展示的内容，请修改后再发布。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      wx.showToast({
        title: getCloudErrorMessage(error, '评论发布失败，请稍后重试。'),
        icon: 'none',
        duration: 2600
      })
    }
  },

  onDeleteComment(e) {
    const commentId = String(e.currentTarget.dataset.id || '')
    if (!commentId || !this.data.currentWork) return
    wx.showModal({
      title: '删除评论',
      content: '确认删除这条评论吗？',
      confirmColor: '#d85050',
      success: async result => {
        if (!result.confirm || !this.data.currentWork) return
        const workId = this.data.currentWork.interactionId
        try {
          const response = await deleteSquareComment(commentId)
          this.setData({ comments: this.data.comments.filter(item => item._id !== commentId && item.id !== commentId) })
          this.patchWorkInteraction(workId, {
            commentCount: Math.max(Number(response.commentCount || 0), 0)
          })
          wx.showToast({ title: '评论已删除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: getCloudErrorMessage(error, '删除失败，请稍后重试。'), icon: 'none' })
        }
      }
    })
  },

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

  async previewVideoWork(e) {
    const target = this.data.works.find(item => item.key === e.currentTarget.dataset.key)
    const workId = getWorkDebugId(target)

    if (!target) {
      console.warn('[square-play] video work not found', { workId })
      wx.showToast({ title: '作品不存在', icon: 'none' })
      return
    }

    console.log('[square-play] click video', {
      workId,
      _id: String(target._id || ''),
      id: String(target.id || ''),
      title: target.title || '',
      taskTitle: target.taskTitle || '',
      type: target.type || '',
      submitType: target.submitType || '',
      mediaType: target.mediaType || ''
    })

    const media = debugSquareWorkMedia(target)
    let playable = { src: '', reason: 'GET_TEMP_URL_FAILED' }
    try {
      playable = await this.getPlayableMediaUrl(media, workId)
    } catch (error) {
      console.warn('[square-play] resolve playable video url error', {
        workId,
        errCode: error && error.errCode,
        errMsg: error && error.errMsg
      })
    }
    const videoPath = playable.src

    console.log('[square-play] final playable src exists', {
      workId,
      mediaType: 'video',
      exists: Boolean(videoPath),
      srcType: getSourceType(videoPath),
      failureStep: playable.reason || ''
    })

    if (!videoPath) {
      wx.showToast({
        title: getMediaFailureMessage(playable.reason, 'video'),
        icon: 'none'
      })
      return
    }

    previewVideoByPath(videoPath, target.titleText || '广场录像')
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
      if (work) {
        const shareWorkId = getWorkPublicId(work)
        this.setData({ currentShareWorkId: shareWorkId })
        return getDefaultShareMessage(buildWorkShareConfig(work, 'square'))
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
