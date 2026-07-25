const HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE = '该作品对应的历史训练内容暂不可查看。'

const MODULE_ALIASES = {
  reading: 'reading',
  read: 'reading',
  recitation: 'reading',
  retell: 'retell',
  retelling: 'retell',
  topic: 'topic',
  randomTopic: 'topic',
  speaking: 'topic',
  mandarin: 'mandarin',
  putonghua: 'mandarin',
  tongueTwister: 'mandarin',
  speech: 'speech',
  leaderSpeech: 'leaderSpeech',
  leaderspeech: 'leaderSpeech'
}

function cleanText(value) {
  return String(value || '').trim()
}

function normalizeModuleId(value) {
  const text = cleanText(value)
  if (!text) return ''
  if (MODULE_ALIASES[text]) return MODULE_ALIASES[text]
  if (/reading/i.test(text) || /朗读|朗诵/.test(text)) return 'reading'
  if (/retell/i.test(text) || /复述/.test(text)) return 'retell'
  if (/topic|random/i.test(text) || /话题|即兴/.test(text)) return 'topic'
  if (/mandarin|putonghua|tongue/i.test(text) || /普通话|绕口令/.test(text)) return 'mandarin'
  if (/leader\s*speech/i.test(text) || /领导发言/.test(text)) return 'leaderSpeech'
  if (/speech/i.test(text) || /演讲/.test(text)) return 'speech'
  return ''
}

function parseModuleFromContentId(contentId) {
  const text = cleanText(contentId)
  if (!text) return ''
  const match = text.match(/^(.+?)(?:-v\d+)?-day-\d+$/i)
  return normalizeModuleId(match ? match[1] : text)
}

function parseDayFromContentId(contentId) {
  const match = cleanText(contentId).match(/(?:day[-_]?|^)(\d+)/i)
  return match ? Number(match[1] || 0) : 0
}

function getTrainingLocator(work = {}) {
  const contentId = cleanText(work.contentId || work.taskId)
  const moduleId = normalizeModuleId(
    work.trainingCategorySnapshot ||
    work.moduleId ||
    work.category ||
    work.moduleType ||
    work.trainingType ||
    work.trainingCategory ||
    parseModuleFromContentId(contentId)
  )
  const day = Number(
    work.trainingDaySnapshot ||
    work.day ||
    work.dayNumber ||
    work.taskDay ||
    parseDayFromContentId(contentId) ||
    0
  )

  return {
    contentId,
    moduleId,
    day,
    canView: Boolean(contentId || getTrainingSnapshot(work))
  }
}

function getTrainingSnapshot(work = {}) {
  const content = cleanText(work.trainingContentSnapshot)
  if (!content) return null

  const contentId = cleanText(work.contentId || work.taskId)
  const category = cleanText(
    work.trainingCategorySnapshot ||
    work.category ||
    work.moduleType ||
    work.trainingType ||
    parseModuleFromContentId(contentId)
  )
  const moduleId = normalizeModuleId(category)
  const day = Number(work.trainingDaySnapshot || work.day || work.dayNumber || parseDayFromContentId(contentId) || 0)
  const title = cleanText(
    work.trainingTitleSnapshot ||
    work.contentTitle ||
    work.taskTitle ||
    work.title ||
    '历史训练内容'
  )

  return {
    contentId,
    category,
    moduleId,
    day,
    title,
    content,
    material: content,
    promptText: content,
    source: 'submission_snapshot',
    isHistorical: true
  }
}

function createTrainingSnapshot(task = {}, category = '') {
  const content = cleanText(task.material || task.content || task.promptText)
  const title = cleanText(task.displayTitle || task.contentTitle || task.title)
  const day = Number(task.day || task.dayNumber || 0)
  return {
    trainingTitleSnapshot: title,
    trainingContentSnapshot: content,
    trainingCategorySnapshot: cleanText(category),
    trainingDaySnapshot: day
  }
}

function resolveHistoricalOriginal(work = {}, exactContent = null) {
  const snapshot = getTrainingSnapshot(work)
  if (snapshot) {
    return { found: true, source: 'submission_snapshot', content: snapshot }
  }

  const locator = getTrainingLocator(work)
  const exactId = cleanText(exactContent && (exactContent.contentId || exactContent.taskId))
  if (locator.contentId && exactId === locator.contentId) {
    const body = cleanText(exactContent.content || exactContent.material || exactContent.promptText)
    if (body) {
      return {
        found: true,
        source: 'training_contents_exact',
        content: {
          ...exactContent,
          content: body,
          material: body,
          promptText: body,
          isHistorical: true
        }
      }
    }
  }

  return {
    found: false,
    source: 'unavailable',
    content: null,
    message: HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE
  }
}

module.exports = {
  HISTORY_ORIGINAL_UNAVAILABLE_MESSAGE,
  createTrainingSnapshot,
  getTrainingLocator,
  getTrainingSnapshot,
  normalizeModuleId,
  parseDayFromContentId,
  parseModuleFromContentId,
  resolveHistoricalOriginal
}
