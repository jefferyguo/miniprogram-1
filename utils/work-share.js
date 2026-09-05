const { getShareImage } = require('./share-config')
const { isWorkShareAllowed } = require('./work-share-policy')

function getWorkPublicId(work = {}) {
  return String(
    work.squareWorkId ||
    work.cloudId ||
    work._id ||
    work.interactionId ||
    work.shareId ||
    ''
  )
}

function getWorkShareTitle(work = {}) {
  return String(
    work.titleText ||
    work.subtitleText ||
    work.title ||
    work.taskTitle ||
    work.contentTitle ||
    '训练作品'
  )
    .replace(/[《》\r\n]/g, '')
    .trim()
    .slice(0, 28) || '训练作品'
}

function getWorkAuthorName(work = {}) {
  return String(work.authorName || work.publicNickname || work.studentName || '同学').trim() || '同学'
}

function getWorkTrainingType(work = {}) {
  const categoryText = String(work.categoryText || '').trim()
  if (categoryText) return categoryText
  const moduleId = String(work.moduleId || '').trim()
  const titleText = `${work.moduleTitle || ''} ${work.extraTitle || ''} ${work.taskText || ''}`
  if (moduleId === 'reading' || /朗读|朗诵/.test(titleText)) return '朗读'
  if (moduleId === 'retell' || moduleId === 'retelling' || /复述/.test(titleText)) return '复述'
  if (moduleId === 'topic' || work.extraType === 'randomTopic' || /话题|即兴/.test(titleText)) return '话题'
  if (moduleId === 'mandarin' || work.extraType === 'tongueTwister' || /普通话|绕口令/.test(titleText)) return '普通话'
  if (work.extraType === 'dailyQuote') return '金句'
  return '训练'
}

function getWorkShareImage(work = {}, fallbackType = 'square') {
  const candidates = [
    work.coverUrl,
    work.poster,
    work.posterUrl,
    work.thumbFileURL,
    work.thumbUrl,
    work.thumbTempFilePath
  ]
  const imageUrl = candidates.find(value => {
    const url = String(value || '').trim()
    // 分享卡片不使用 wxfile/file/cloud 临时地址，也不使用带签名密钥的 URL。
    if (!url || /^(wxfile|file|cloud|blob):/i.test(url)) return false
    if (/[?&][^=]*(token|signature|credential|secret|key|sign)[^=]*=/i.test(url)) return false
    return /^https?:\/\//i.test(url) || /^\/images\//i.test(url)
  })
  return String(imageUrl || getShareImage(fallbackType))
}

function buildWorkShareConfig(work = {}, source = 'square') {
  if (!isWorkShareAllowed(work)) return null
  const workId = getWorkPublicId(work)
  const title = getWorkShareTitle(work)
  const authorName = getWorkAuthorName(work)
  const trainingType = getWorkTrainingType(work)
  return {
    title: source === 'mine'
      ? `我在杨勤口才训练KEEP完成了《${title}》`
      : `${authorName}的${trainingType}作品：${title}`,
    path: workId
      ? `/pages/work-detail/work-detail?workId=${encodeURIComponent(workId)}&source=share`
      : '/pages/square/square',
    imageUrl: getWorkShareImage(work, 'square')
  }
}

module.exports = {
  buildWorkShareConfig,
  getWorkAuthorName,
  getWorkPublicId,
  getWorkShareImage,
  getWorkShareTitle,
  getWorkTrainingType
}
