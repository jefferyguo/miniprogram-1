const { getUserInfo, formatDateTime } = require('./local-data')
const {
  submitWorkRecord,
  unpublishMyWorkFromSquare: unpublishCloudWorkFromSquare,
  updateWorkPublicStatus: updateCloudWorkPublicStatus
} = require('./cloud-api')
const { uploadMediaToCloud } = require('./cloud-upload')

const STORAGE_KEYS = {
  main: 'trainingSubmissions',
  extra: 'extraTrainingSubmissions'
}

const DRAFT_KEYS = {
  main: 'trainingDrafts',
  extra: 'extraTrainingDrafts'
}

function getAvatarText(nickname) {
  const name = String(nickname || '同学').trim()
  if (!name) return '同'

  const first = name.slice(0, 1)
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
}

function getStorageKey(sourceType) {
  return STORAGE_KEYS[sourceType] || STORAGE_KEYS.main
}

function getStorageList(sourceType) {
  const list = wx.getStorageSync(getStorageKey(sourceType)) || []
  return Array.isArray(list) ? list : []
}

function getStorageListByKey(storageKey) {
  const list = wx.getStorageSync(storageKey) || []
  return Array.isArray(list) ? list : []
}

function patchLocalWork(sourceType, workId, patch) {
  const keys = [getStorageKey(sourceType), DRAFT_KEYS[sourceType]].filter(Boolean)

  keys.forEach(storageKey => {
    const list = getStorageListByKey(storageKey)
    wx.setStorageSync(storageKey, list.map(item => (
      String(item.id) === String(workId) || (item.cloudId && String(item.cloudId) === String(workId))
        ? {
          ...item,
          ...patch
        }
        : item
    )))
  })
}

function buildPublicPatch(isPublic) {
  const now = formatDateTime()

  if (!isPublic) {
    return {
      isPublic: false,
      publicPermissionConfirmed: false,
      publicStatus: 'unpublished',
      squareStatus: 'unpublished',
      unpublicAt: now,
      unpublishedAt: now
    }
  }

  const userInfo = getUserInfo() || {}
  const nickname = userInfo.nickname || userInfo.nickName || '同学'

  return {
    isPublic: true,
    publicStatus: 'published',
    squareStatus: 'active',
    publicAt: now,
    publishedAt: now,
    unpublishedAt: '',
    publicPermissionConfirmed: true,
    publicNickname: nickname,
    publicAvatarText: getAvatarText(nickname),
    publicOpenid: userInfo.openid || ''
  }
}

function isCloudFileID(value) {
  return /^cloud:\/\//i.test(String(value || '').trim())
}

function isRemoteMediaUrl(value) {
  const url = typeof value === 'string' ? value.trim() : ''
  return /^https?:\/\//i.test(url) && !/^https?:\/\/(tmp|usr)\//i.test(url)
}

const PUBLISH_MEDIA_FIELDS = [
  'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL',
  'videoUrl', 'videoURL', 'videoFileUrl', 'videoFileURL',
  'audioPath', 'videoPath', 'tempFilePath', 'filePath',
  'localPath', 'localFilePath', 'recordPath', 'savedFilePath',
  'audioFileID', 'audioFileId', 'videoFileID', 'videoFileId',
  'fileID', 'fileId', 'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId',
  'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL'
]

const CLOUD_FILE_ID_FIELDS = [
  'audioFileID', 'audioFileId', 'videoFileID', 'videoFileId',
  'fileID', 'fileId', 'cloudFileID', 'cloudFileId', 'mediaFileID', 'mediaFileId'
]

const LOCAL_MEDIA_FIELDS = [
  'tempFilePath', 'filePath', 'localPath', 'localFilePath',
  'audioPath', 'videoPath', 'audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL',
  'videoUrl', 'videoURL', 'videoFileUrl', 'videoFileURL',
  'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL', 'recordPath', 'savedFilePath',
  ...CLOUD_FILE_ID_FIELDS
]

function getSafeString(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || /^(undefined|null|\[object Object\])$/i.test(text)) return ''
  return text
}

function buildOriginalLocatorPatch(work = {}) {
  const moduleId = getSafeString(work.moduleId) ||
    getSafeString(work.category) ||
    getSafeString(work.moduleType) ||
    getSafeString(work.trainingType)
  const contentId = getSafeString(work.contentId) || getSafeString(work.taskId)
  const day = Number(work.day || work.dayNumber || 0)

  return {
    moduleId,
    category: getSafeString(work.category) || moduleId,
    moduleType: getSafeString(work.moduleType) || moduleId,
    trainingType: getSafeString(work.trainingType) || moduleId,
    day,
    contentId,
    taskId: getSafeString(work.taskId) || contentId,
    trainingTitleSnapshot: getSafeString(work.trainingTitleSnapshot),
    trainingContentSnapshot: getSafeString(work.trainingContentSnapshot),
    trainingCategorySnapshot: getSafeString(work.trainingCategorySnapshot),
    trainingDaySnapshot: Number(work.trainingDaySnapshot || 0)
  }
}

function getFirstValue(work, fields, predicate = value => Boolean(value)) {
  for (const field of fields) {
    const value = getSafeString(work && work[field])
    if (value && predicate(value)) return value
  }
  return ''
}

function getLocalPathType(value) {
  const path = getSafeString(value)
  if (!path) return 'empty'
  if (isCloudFileID(path)) return 'cloud'
  if (/^https?:\/\/(tmp|usr)\//i.test(path)) return 'http-temp'
  if (/^https?:\/\//i.test(path)) return 'http-url'
  if (/^wxfile:\/\//i.test(path)) return 'wxfile'
  if (/^file:\/\//i.test(path)) return 'file-url'
  if (/^\//.test(path)) return 'absolute-path'
  if (/[/\\]/.test(path) || /\.(mp3|m4a|aac|wav|amr|silk|ogg|mp4|mov|m4v|avi)(\?|$)/i.test(path)) {
    return 'relative-path'
  }
  return 'invalid'
}

function isLocalMediaPath(value) {
  return ['http-temp', 'wxfile', 'file-url', 'absolute-path', 'relative-path'].includes(getLocalPathType(value))
}

function inferPublishMediaType(work = {}, candidate = '') {
  const explicitType = getFirstValue(work, ['mediaType', 'submitType', 'workType', 'type']).toLowerCase()
  if (explicitType.includes('video')) return 'video'
  if (explicitType.includes('audio') || explicitType.includes('voice') || explicitType.includes('record')) return 'audio'

  const hasVideoField = ['videoUrl', 'videoURL', 'videoFileUrl', 'videoFileURL', 'videoPath', 'videoFileID', 'videoFileId']
    .some(field => Boolean(getSafeString(work[field])))
  const hasAudioField = ['audioUrl', 'audioURL', 'audioFileUrl', 'audioFileURL', 'audioPath', 'audioFileID', 'audioFileId', 'recordPath']
    .some(field => Boolean(getSafeString(work[field])))
  if (hasVideoField || /\.(mp4|mov|m4v|avi)(\?|$)/i.test(candidate)) return 'video'
  if (hasAudioField || /\.(mp3|m4a|aac|wav|amr|silk|ogg)(\?|$)/i.test(candidate)) return 'audio'
  return candidate ? 'audio' : 'unknown'
}

/**
 * 统一解析发布所需媒体。只接受字符串字段，避免把 undefined 或对象误传给 uploadFile。
 */
function resolvePublishMedia(work = {}) {
  const allFields = [...new Set([...CLOUD_FILE_ID_FIELDS, ...LOCAL_MEDIA_FIELDS])]
  const cloudFileID = getFirstValue(work, allFields, isCloudFileID)
  const url = getFirstValue(work, LOCAL_MEDIA_FIELDS, isRemoteMediaUrl)
  const localPath = getFirstValue(work, LOCAL_MEDIA_FIELDS, isLocalMediaPath)
  const candidate = cloudFileID || url || localPath
  const mediaType = inferPublishMediaType(work, candidate)
  const hasMedia = Boolean(cloudFileID || url || localPath)

  return {
    mediaType,
    localPath,
    cloudFileID,
    url,
    shouldUpload: Boolean(localPath && !cloudFileID && !url),
    reason: hasMedia ? '' : 'NO_MEDIA_PATH'
  }
}

function getPublishMediaFieldPresence(work = {}) {
  return PUBLISH_MEDIA_FIELDS.reduce((result, field) => {
    result[field] = Boolean(getSafeString(work[field]))
    return result
  }, {})
}

function createPublishError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function getPublishErrorMessage(error) {
  const messages = {
    UPLOAD_FILE_PATH_MISSING: '该作品缺少本地文件，暂时无法发布。',
    NO_MEDIA_PATH: '该作品缺少录音/录像文件，暂时无法发布。',
    UPLOAD_FILE_ID_MISSING: '作品上传失败，请稍后再试。',
    UPLOAD_FILE_FAILED: '作品上传失败，请检查网络后重试。'
  }
  return messages[error && error.code] || error && error.message || '发布失败，请稍后重试。'
}

function getWorkById(workId, sourceType) {
  return getStorageList(sourceType).find(item => (
    String(item.id) === String(workId) ||
    (item.cloudId && String(item.cloudId) === String(workId))
  )) || null
}

function buildMediaPatch(media) {
  const workType = media.mediaType
  const fileID = workType === 'video' ? media.videoFileID : media.audioFileID
  const mediaUrl = workType === 'video' ? media.videoUrl : media.audioUrl
  return {
    workType,
    mediaType: workType,
    submitType: workType,
    type: workType,
    fileID,
    cloudFileID: fileID,
    filePath: mediaUrl,
    audioFileID: media.audioFileID || '',
    audioUrl: media.audioUrl || '',
    videoFileID: media.videoFileID || '',
    videoUrl: media.videoUrl || '',
    coverFileID: media.coverFileID || '',
    coverUrl: media.coverUrl || ''
  }
}

function stripPrivatePublicFields(work = {}) {
  const safe = { ...work }
  ;[
    'phone', 'phoneNumber', 'mobile',
    'openid', 'openId', 'ownerOpenid', 'publicOpenid',
    'sessionKey', 'token', 'accessToken'
  ].forEach(field => delete safe[field])
  Object.keys(safe).forEach(field => {
    if (typeof safe[field] === 'undefined') delete safe[field]
  })
  return safe
}

async function ensureCloudMediaFile(work = {}) {
  const media = resolvePublishMedia(work)
  const workType = media.mediaType === 'video' ? 'video' : 'audio'
  const workId = String(work.id || work.cloudId || work._id || '')
  console.log('[square-publish] work media fields', {
    workId,
    title: getSafeString(work.title) || getSafeString(work.taskTitle),
    type: getSafeString(work.type),
    submitType: getSafeString(work.submitType),
    mediaType: getSafeString(work.mediaType),
    fields: getPublishMediaFieldPresence(work)
  })
  console.log('[square-publish] resolve publish media', {
    mediaType: media.mediaType,
    localPathExists: Boolean(media.localPath),
    cloudFileIdExists: Boolean(media.cloudFileID),
    urlExists: Boolean(media.url),
    localPathType: getLocalPathType(media.localPath),
    shouldUpload: media.shouldUpload,
    reason: media.reason
  })

  if (media.cloudFileID) {
    return {
      mediaType: workType,
      audioFileID: workType === 'audio' ? media.cloudFileID : '',
      audioUrl: workType === 'audio' ? media.url : '',
      videoFileID: workType === 'video' ? media.cloudFileID : '',
      videoUrl: workType === 'video' ? media.url : '',
      coverFileID: work.coverFileID || work.coverFileId || '',
      coverUrl: work.coverUrl || '',
      uploaded: false
    }
  }

  if (media.url) {
    return {
      mediaType: workType,
      audioFileID: '',
      audioUrl: workType === 'audio' ? media.url : '',
      videoFileID: '',
      videoUrl: workType === 'video' ? media.url : '',
      coverFileID: work.coverFileID || work.coverFileId || '',
      coverUrl: work.coverUrl || '',
      uploaded: false
    }
  }

  if (media.reason === 'NO_MEDIA_PATH') {
    console.warn('[square-publish] no local media path or cloud file id', { workId })
    throw createPublishError('NO_MEDIA_PATH', '该作品缺少录音/录像文件，暂时无法发布。')
  }

  if (!media.shouldUpload || !media.localPath) {
    throw createPublishError('UPLOAD_FILE_PATH_MISSING', '该作品缺少本地文件，暂时无法发布。')
  }

  wx.showLoading({ title: '正在上传作品...', mask: true })
  const uploadResult = await uploadMediaToCloud(media.localPath, workType)
  const uploadedFileID = String(uploadResult.fileID || '')
  console.log('[square-publish] upload success', {
    workId,
    mediaType: workType,
    fileIDExists: Boolean(uploadedFileID),
    isCloudFile: isCloudFileID(uploadedFileID)
  })

  if (!isCloudFileID(uploadedFileID)) {
    throw createPublishError('UPLOAD_FILE_ID_MISSING', '作品上传失败，请稍后再试。')
  }

  return {
    mediaType: workType,
    audioFileID: workType === 'audio' ? uploadedFileID : '',
    audioUrl: '',
    videoFileID: workType === 'video' ? uploadedFileID : '',
    videoUrl: '',
    coverFileID: work.coverFileID || work.coverFileId || '',
    coverUrl: work.coverUrl || '',
    uploaded: true
  }
}

async function publishWorkToSquare(workId, sourceType) {
  const work = getWorkById(workId, sourceType)
  if (!work) return { success: false, message: '作品不存在' }

  wx.showLoading({ title: '正在准备作品...', mask: true })
  try {
    const cloudMedia = await ensureCloudMediaFile(work)
    const mediaPatch = buildMediaPatch(cloudMedia)
    const publicPatch = buildPublicPatch(true)
    const locatorPatch = buildOriginalLocatorPatch(work)
    const normalizedTitle = getSafeString(work.title) || getSafeString(work.taskTitle) || getSafeString(work.contentTitle)
    const normalizedTaskTitle = getSafeString(work.taskTitle) || getSafeString(work.contentTitle) || normalizedTitle
    const sourceType = getSafeString(work.sourceType) || 'main'
    const isExtraWork = sourceType === 'extra'
    const updatedWork = {
      ...work,
      ...publicPatch,
      ...mediaPatch,
      ...locatorPatch,
      sourceType,
      duration: work.duration || '',
      taskTitle: normalizedTaskTitle,
      contentTitle: getSafeString(work.contentTitle) || normalizedTaskTitle,
      title: normalizedTitle,
      content: isExtraWork ? (work.content || '') : '',
      promptText: isExtraWork ? (work.promptText || work.content || '') : '',
      materialSummary: work.materialSummary || getSafeString(work.contentTitle) || normalizedTaskTitle || normalizedTitle,
      materialText: isExtraWork ? (work.materialText || work.content || work.promptText || '') : ''
    }
    const safePayload = stripPrivatePublicFields(updatedWork)
    let cloudId = work.cloudId || ''

    wx.showLoading({ title: '正在发布作品...', mask: true })
    console.log('[square-publish] publish payload', {
      workId: String(work.id || workId || ''),
      mediaType: cloudMedia.mediaType,
      hasAudioFileID: Boolean(cloudMedia.audioFileID),
      hasVideoFileID: Boolean(cloudMedia.videoFileID),
      hasAudioUrl: Boolean(cloudMedia.audioUrl),
      hasVideoUrl: Boolean(cloudMedia.videoUrl)
    })

    if (cloudId) {
      await updateCloudWorkPublicStatus(cloudId, true, {
        ...mediaPatch,
        ...locatorPatch,
        duration: updatedWork.duration || '',
        taskTitle: updatedWork.taskTitle || updatedWork.contentTitle || '',
        contentTitle: updatedWork.contentTitle || updatedWork.taskTitle || '',
        title: updatedWork.title || updatedWork.taskTitle || updatedWork.contentTitle || '',
        content: updatedWork.content || '',
        promptText: updatedWork.promptText || '',
        materialSummary: updatedWork.materialSummary || '',
        materialText: updatedWork.materialText || '',
        trainingTitleSnapshot: updatedWork.trainingTitleSnapshot || '',
        trainingContentSnapshot: updatedWork.trainingContentSnapshot || '',
        trainingCategorySnapshot: updatedWork.trainingCategorySnapshot || '',
        trainingDaySnapshot: Number(updatedWork.trainingDaySnapshot || 0)
      })
    } else {
      const cloudResult = await submitWorkRecord(safePayload)
      cloudId = cloudResult.submission && cloudResult.submission._id || ''
    }

    const finalPatch = {
      ...publicPatch,
      ...mediaPatch,
      ...locatorPatch,
      cloudId,
      squareWorkId: cloudId,
      sourceWorkId: cloudId,
      submissionId: cloudId,
      cloudUploaded: true,
      cloudError: ''
    }
    patchLocalWork(sourceType, workId, finalPatch)
    console.log('[square-publish] publish success', {
      workId: String(work.id || workId || ''),
      mediaType: cloudMedia.mediaType,
      uploaded: cloudMedia.uploaded,
      hasCloudId: Boolean(cloudId)
    })
    return { success: true, work: { ...work, ...finalPatch }, patch: finalPatch }
  } catch (error) {
    console.warn('[square-publish] publish fail', {
      workId: String(work.id || workId || ''),
      errCode: error && error.code,
      errMsg: error && error.message
    })
    return {
      success: false,
      message: getPublishErrorMessage(error)
    }
  } finally {
    wx.hideLoading()
  }
}

function updateWorkPublicStatus(workId, sourceType, isPublic, options = {}) {
  const storageKey = getStorageKey(sourceType)
  const list = getStorageList(sourceType)
  let updatedWork = null
  const patch = buildPublicPatch(isPublic)
  const nextList = list.map(item => {
    const matchLocalId = String(item.id) === String(workId)
    const matchCloudId = item.cloudId && String(item.cloudId) === String(workId)

    if (!matchLocalId && !matchCloudId) return item

    updatedWork = {
      ...item,
      ...patch
    }
    return updatedWork
  })

  if (!updatedWork) {
    return {
      success: false,
      message: '作品不存在'
    }
  }

  wx.setStorageSync(storageKey, nextList)

  // 同步更新草稿记录，避免从“我的作品/点评页”操作后，训练详情历史状态不一致。
  const draftKey = DRAFT_KEYS[sourceType]
  if (draftKey) {
    const draftList = getStorageListByKey(draftKey)
    const nextDraftList = draftList.map(item => (
      String(item.id) === String(workId) || (item.cloudId && String(item.cloudId) === String(workId))
        ? {
          ...item,
          ...patch
        }
        : item
    ))

    wx.setStorageSync(draftKey, nextDraftList)
  }

  const cloudId = updatedWork.cloudId || ''

  if (cloudId && options.syncCloud !== false) {
    updateCloudWorkPublicStatus(cloudId, isPublic).then(res => {
      console.log('[work-public] 云端公开状态已同步:', res)
    }).catch(err => {
      console.warn('[work-public] 云端公开状态同步失败，本地状态已更新:', err)
    })
  }

  return {
    success: true,
    work: updatedWork,
    patch
  }
}

async function unpublishWorkFromSquare(workId, sourceType) {
  const work = getWorkById(workId, sourceType)
  if (!work) return { success: false, message: '作品不存在' }
  const cloudId = work.cloudId || work.squareWorkId || ''
  try {
    if (cloudId) await unpublishCloudWorkFromSquare(cloudId)
    return updateWorkPublicStatus(workId, sourceType, false, { syncCloud: false })
  } catch (error) {
    return {
      success: false,
      message: error && error.message || '取消公开失败，请稍后重试。'
    }
  }
}

module.exports = {
  ensureCloudMediaFile,
  getAvatarText,
  publishWorkToSquare,
  resolvePublishMedia,
  unpublishWorkFromSquare,
  updateWorkPublicStatus
}
