'use strict'

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

function isVideoWorkRecord(work = {}) {
  if (!work || typeof work !== 'object') return false
  if (TYPE_FIELDS.some(field => {
    const value = String(work[field] || '').trim().toLowerCase()
    return value.includes('video') || value.includes('视频') || value.includes('录像')
  })) return true
  if (VIDEO_FIELDS.some(field => Boolean(String(work[field] || '').trim()))) return true
  return GENERIC_MEDIA_FIELDS.some(field => (
    /\.(mp4|mov|m4v|avi)(?:[?#]|$)/i.test(String(work[field] || '').trim())
  ))
}

async function collectShareableRecords(fetchBatch, options = {}) {
  const batchSize = Math.max(Number(options.batchSize || 100), 1)
  const requestedLimit = Number(options.limit)
  const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0 ? requestedLimit : Infinity
  const records = []
  let offset = 0

  while (records.length < limit) {
    const result = await fetchBatch(offset, batchSize)
    const batch = Array.isArray(result) ? result : []
    records.push(...batch.filter(item => !isVideoWorkRecord(item)))
    if (batch.length < batchSize) break
    offset += batch.length
  }

  return Number.isFinite(limit) ? records.slice(0, limit) : records
}

module.exports = {
  collectShareableRecords,
  isVideoWorkRecord
}
