'use strict'

const VIDEO_SHARE_DISABLED_MESSAGE = '视频训练作品暂不支持分享'
const TYPE_FIELDS = ['workType', 'mediaType', 'submitType', 'type']
const VIDEO_FIELDS = [
  'videoFileID', 'videoFileId', 'videoUrl', 'videoURL',
  'videoFileUrl', 'videoFileURL', 'videoPath'
]
const GENERIC_MEDIA_FIELDS = [
  'mediaUrl', 'mediaURL', 'fileUrl', 'fileURL',
  'filePath', 'localFilePath', 'tempFilePath',
  'fileID', 'fileId', 'cloudFileID', 'cloudFileId',
  'mediaFileID', 'mediaFileId'
]

function isVideoType(value) {
  const type = String(value || '').trim().toLowerCase()
  return type.includes('video') || type.includes('录像') || type.includes('视频')
}

function isVideoWork(work = {}) {
  if (!work || typeof work !== 'object') return false
  if (TYPE_FIELDS.some(field => isVideoType(work[field]))) return true
  if (VIDEO_FIELDS.some(field => Boolean(String(work[field] || '').trim()))) return true

  return GENERIC_MEDIA_FIELDS.some(field => (
    /\.(mp4|mov|m4v|avi)(?:[?#]|$)/i.test(String(work[field] || '').trim())
  ))
}

function isWorkShareAllowed(work = {}) {
  return !isVideoWork(work)
}

module.exports = {
  VIDEO_SHARE_DISABLED_MESSAGE,
  isVideoWork,
  isWorkShareAllowed
}
