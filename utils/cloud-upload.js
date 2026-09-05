const { normalizeError, toError } = require('./error-normalizer')

function getExt(filePath, fallback = 'dat') {
  const clean = String(filePath || '').split('?')[0]
  const parts = clean.split('.')
  if (parts.length < 2) return fallback
  return parts.pop().toLowerCase() || fallback
}

function getCloudPathByType(filePath, workType, openid = '') {
  const ext = getExt(filePath, workType === 'video' ? 'mp4' : 'm4a')
  const folder = workType === 'video' ? 'videos' : 'recordings'
  const owner = openid || 'anonymous'
  return `${folder}/${owner}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
}

function getSquareCloudPathByType(filePath, workType) {
  const mediaType = workType === 'video' ? 'video' : 'audio'
  const ext = getExt(filePath, mediaType === 'video' ? 'mp4' : 'm4a')
  const random = Math.random().toString(36).slice(2, 10)
  // 广场媒体路径不包含手机号、openid 或其他用户标识。
  return `square-media/${mediaType}/${Date.now()}_${random}.${ext}`
}

function createUploadError(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) {
    error.errCode = cause.errCode
    error.errMsg = cause.errMsg
  }
  return error
}

function ensureCloudReady() {
  if (typeof getApp !== 'function') return Promise.resolve(true)
  const app = getApp()
  return app && typeof app.ensureCloudReady === 'function'
    ? app.ensureCloudReady()
    : Promise.resolve(true)
}

function getLocalFileSize(filePath) {
  try {
    if (!wx.getFileSystemManager) return null
    const stat = wx.getFileSystemManager().statSync(filePath)
    const size = Number(stat && stat.size)
    return Number.isFinite(size) ? size : null
  } catch (error) {
    console.warn('[cloud-upload] local file stat unavailable:', {
      errMsg: error && (error.errMsg || error.message) || ''
    })
    return null
  }
}

async function uploadFileToCloud(filePath, cloudPath, workType, options = {}) {
  await ensureCloudReady()
  const fileSize = getLocalFileSize(filePath)
  const traceId = String(options.traceId || '')
  return new Promise((resolve, reject) => {
    if (!filePath) {
      reject(new Error('文件路径为空'))
      return
    }
    if (!wx.cloud) {
      reject(new Error('wx.cloud 不可用'))
      return
    }

    console.log('[cloud-upload] upload start:', {
      workType,
      hasFilePath: true,
      fileSize
    })
    if (workType === 'video' && traceId) {
      console.log(`[VIDEO_ASR][${traceId}][upload]`, {
        event: 'start', fileSize, extension: getExt(filePath, 'mp4'), mimeType: options.mimeType || 'video/mp4'
      })
    }
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: res => {
        console.log('[cloud-upload] success:', { hasFileID: Boolean(res.fileID), fileSize })
        if (workType === 'video' && traceId) {
          console.log(`[VIDEO_ASR][${traceId}][upload]`, {
            event: 'success', fileSize, hasCloudFileID: Boolean(res.fileID)
          })
        }
        resolve({ fileID: res.fileID, cloudPath, fileSize })
      },
      fail: err => {
        const normalized = normalizeError(err, '文件上传失败')
        console.warn('[cloud-upload] fail:', normalized)
        if (workType === 'video' && traceId) {
          console.error(`[VIDEO_ASR][${traceId}][upload]`, {
            event: 'failed', code: normalized.code || normalized.errCode, message: normalized.message
          })
        }
        reject(toError(err, normalized.message))
      }
    })
  })
}

function uploadWorkFile(filePath, workType = 'audio', options = {}) {
  const userInfo = wx.getStorageSync('userInfo') || {}
  const openid = userInfo.openid || userInfo.openId || ''
  const cloudPath = getCloudPathByType(filePath, workType, openid)
  return uploadFileToCloud(filePath, cloudPath, workType, options)
}

function uploadSquareMediaFile(filePath, workType = 'audio') {
  return uploadMediaToCloud(filePath, workType)
}

/**
 * 安全上传广场媒体：入口和返回值都做硬校验，绝不把空 filePath 交给微信 SDK。
 */
async function uploadMediaToCloud(localPath, workType = 'audio') {
  const filePath = typeof localPath === 'string' ? localPath.trim() : ''
  const mediaType = workType === 'video' ? 'video' : 'audio'

  if (!filePath) {
    return Promise.reject(createUploadError(
      'UPLOAD_FILE_PATH_MISSING',
      '该作品缺少本地文件，暂时无法发布。'
    ))
  }

  await ensureCloudReady()

  if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    return Promise.reject(createUploadError(
      'UPLOAD_FILE_FAILED',
      '作品上传失败，请检查网络后重试。'
    ))
  }

  const cloudPath = getSquareCloudPathByType(filePath, mediaType)
  console.log('[square-publish] upload start', {
    mediaType,
    filePathExists: true,
    cloudPath
  })

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: res => {
        const fileID = res && typeof res.fileID === 'string' ? res.fileID.trim() : ''
        console.log('[square-publish] upload success', {
          mediaType,
          fileIDExists: Boolean(fileID),
          isCloudFile: /^cloud:\/\//i.test(fileID)
        })

        if (!fileID || !/^cloud:\/\//i.test(fileID)) {
          reject(createUploadError(
            'UPLOAD_FILE_ID_MISSING',
            '作品上传失败，请稍后再试。'
          ))
          return
        }

        resolve({ fileID, cloudPath })
      },
      fail: err => {
        console.warn('[square-publish] upload fail', {
          mediaType,
          errCode: err && err.errCode,
          errMsg: err && err.errMsg
        })
        reject(createUploadError(
          'UPLOAD_FILE_FAILED',
          '作品上传失败，请检查网络后重试。',
          err
        ))
      }
    })
  })
}

module.exports = {
  uploadMediaToCloud,
  uploadWorkFile,
  uploadSquareMediaFile,
  getCloudPathByType,
  getSquareCloudPathByType
}
