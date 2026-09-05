const DRAFTS_KEY = 'trainingDrafts'
const SUBMISSIONS_KEY = 'trainingSubmissions'
const STORAGE_KEY = SUBMISSIONS_KEY
const EXTRA_DRAFTS_KEY = 'extraTrainingDrafts'
const EXTRA_SUBMISSIONS_KEY = 'extraTrainingSubmissions'

// 主包只保留轻量导航索引，完整训练正文由 CloudBase 按 contentId 精确读取。
const { generatedTrainingDays } = require('./generated-training-data')
const {
  DAILY_QUOTES,
  DAILY_TOPICS,
  TONGUE_TWISTERS
} = require('./daily-training-data')
const { computeModuleAccessPolicy, resolveSingleItemPolicy } = require('./training-access-policy')

const MODULE_THEME = {
  reading: {
    gradient: 'linear-gradient(135deg, #4FB99F 0%, #6BC7B2 100%)',
    className: 'module-reading',
    iconType: 'book'
  },
  retell: {
    gradient: 'linear-gradient(135deg, #6D7FD6 0%, #8A80E8 100%)',
    className: 'module-retell',
    iconType: 'loop'
  },
  topic: {
    gradient: 'linear-gradient(135deg, #E98D7A 0%, #F2A28E 100%)',
    className: 'module-topic',
    iconType: 'bubble'
  },
  mandarin: {
    gradient: 'linear-gradient(135deg, #5C9FD6 0%, #78A7E3 100%)',
    className: 'module-mandarin',
    iconType: 'mic'
  },
  speech: {
    gradient: 'linear-gradient(135deg, #8B6DD8 0%, #A184EF 100%)',
    className: 'module-speech',
    iconType: 'podium'
  },
  leaderSpeech: {
    gradient: 'linear-gradient(135deg, #C58B4C 0%, #D9A763 100%)',
    className: 'module-leader',
    iconType: 'document'
  }
}

const MODULE_DEFINITIONS = [
  {
    id: 'reading',
    title: '朗读训练',
    desc: '练语感，积累好词好句，让表达更流畅、更自信',
    icon: 'book'
  },
  {
    id: 'retell',
    title: '复述训练',
    desc: '练信息提炼、结构复述和表达完整度',
    icon: 'loop'
  },
  {
    id: 'topic',
    title: '即兴讲话',
    desc: '练即兴表达、观点表达和逻辑结构',
    icon: 'bubble'
  },
  {
    id: 'mandarin',
    title: '普通话训练',
    desc: '练发音、声调、平翘舌和前后鼻音',
    icon: 'mic'
  },
  {
    id: 'speech',
    title: '演讲训练',
    desc: '练名人演讲、励志演讲、即兴演讲',
    icon: 'podium'
  },
  {
    id: 'leaderSpeech',
    title: '领导发言',
    desc: '练讲话稿、致辞、报告和署名文章',
    icon: 'document'
  }
]

const CATEGORY_TO_MODULE = {
  reading: 'reading',
  retell: 'retell',
  retelling: 'retell',
  topic: 'topic',
  mandarin: 'mandarin',
  speech: 'speech',
  leaderSpeech: 'leaderSpeech'
}

const MODULE_TO_CATEGORY = {
  reading: 'reading',
  retell: 'retell',
  topic: 'topic',
  mandarin: 'mandarin',
  speech: 'speech',
  leaderSpeech: 'leaderSpeech'
}

const TRAINING_TYPE_MODULE_MAP = {
  reading: 'reading',
  retell: 'retell',
  retelling: 'retell',
  speaking: 'topic',
  impromptu: 'topic',
  hosting: 'topic',
  topic: 'topic',
  mandarin: 'mandarin',
  speech: 'speech',
  leaderSpeech: 'leaderSpeech'
}

const EXTRA_CONFIG_CATEGORY_ID_MAP = {
  dailyQuote: 'dailyQuote',
  dailyTopic: 'randomTopic',
  tongueTwister: 'tongueTwister'
}

const TRAINING_CONTENT_PLACEHOLDERS = [
  '内容正在加载，请稍后重试。',
  '正在加载完整训练内容……',
  '正在重新加载完整训练内容……',
  '正在加载完整训练内容...',
  '正在重新加载完整训练内容...'
]

let cloudTrainingContents = []
const cloudTrainingCatalogs = new Map()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

function trimText(value) {
  return String(value || '').trim()
}

function estimateChars(text) {
  return String(text || '').replace(/\s/g, '').length
}

function normalizeCategory(value) {
  const category = trimText(value)
  return category === 'retelling' ? 'retell' : category
}

const PERMANENT_ID_RE = /^tc_[0-9a-f]{32}$/

function normalizeTrainingContentId(value) {
  const contentId = trimText(value)
  return PERMANENT_ID_RE.test(contentId) ? contentId : ''
}

function getModuleIdByCategory(category, trainingType = '') {
  return CATEGORY_TO_MODULE[trimText(category)] || TRAINING_TYPE_MODULE_MAP[trimText(trainingType)] || ''
}

function getTrainingConfigCategoryByModuleId(moduleId) {
  return MODULE_TO_CATEGORY[trimText(moduleId)] || ''
}

function getTrainingBody(item = {}) {
  return trimText(
    item.content ||
    item.material ||
    item.promptText ||
    item.text ||
    item.trainingContent ||
    ''
  )
}

function isTrainingContentComplete(item) {
  if (!item || item.isPlaceholder === true || item.incomplete === true) return false
  const material = getTrainingBody(item)
  return Boolean(material) && !TRAINING_CONTENT_PLACEHOLDERS.includes(material)
}

function isCompleteTrainingRecord(item = {}, expected = {}) {
  if (!isTrainingContentComplete(item)) return false
  const contentId = trimText(item.contentId)
  const title = trimText(item.contentTitle || item.title)
  const category = normalizeCategory(item.category)
  const day = Number(item.day || item.sortOrder || item.dayNumber || 0)
  if (!contentId || !title || !day) return false
  if (expected.contentId && contentId !== trimText(expected.contentId)) return false
  if (expected.category && category !== normalizeCategory(expected.category)) return false
  return true
}

// 源文档标题中的冒号、破折号属于标题本身，不再猜测后半段是作者。
function splitTitleAndAuthor(rawTitle) {
  return { title: trimText(rawTitle), author: '' }
}

function normalizeTitleAuthor(rawTitle, rawAuthor) {
  return {
    title: trimText(rawTitle),
    author: rawAuthor === undefined || rawAuthor === null ? '' : trimText(rawAuthor)
  }
}

function formatContentTitle(item = {}) {
  const parts = normalizeTitleAuthor(
    item.contentTitle || item.title || item.displayTitle || '',
    item.author
  )
  return parts.author ? `${parts.title}：${parts.author}` : parts.title
}

// 全局硬规则：前3篇免费，第4篇起会员。
// 存储的 membershipLevel 字段仅为缓存快照，不参与权限计算。
// sortOrder 是唯一排序依据。
function normalizeContentMembershipLevel(value, fallback = 'free') {
  // 不再以存储值覆盖位置计算；始终委托给 resolveSingleItemPolicy / computeModuleAccessPolicy。
  // 此函数保留给 extraTraining（每日金句/话题/绕口令）等非训练模块使用。
  const level = trimText(value)
  if (level === 'member') return 'member'
  if (['monthly', 'yearly', 'admin'].includes(level)) return 'member'
  if (level === 'free') return 'free'
  return fallback
}

function normalizeContentStyle(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    fontSize: ['small', 'normal', 'large', 'xlarge'].includes(source.fontSize) ? source.fontSize : 'normal',
    color: ['default', 'green', 'red', 'blue', 'gold'].includes(source.color) ? source.color : 'default',
    bold: source.bold === true
  }
}

function normalizeContentRichStyle(value = {}, contentLength) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const maxLength = Number.isFinite(contentLength) ? Math.max(contentLength, 0) : Infinity
  const ranges = Array.isArray(source.ranges) ? source.ranges : []
  return {
    ranges: ranges
      .map(item => {
        const start = Math.max(Number(item && item.start || 0), 0)
        const end = Math.max(Number(item && item.end || 0), 0)
        return {
          start: Number.isFinite(maxLength) ? Math.min(start, maxLength) : start,
          end: Number.isFinite(maxLength) ? Math.min(end, maxLength) : end,
          ...normalizeContentStyle(item)
        }
      })
      .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end)
  }
}

function getExtraContentId(category, index) {
  const number = Number(index || 0)
  return category && number ? `${category}-${number}` : ''
}

function extractTrainingQuote(content) {
  const matches = String(content || '').match(/(?:^|\n)\s*金句[：:]\s*([^\n]+)\s*$/)
  return matches ? trimText(matches[1]) : ''
}

function normalizeTaskForDisplay(moduleId, task) {
  if (!task) return task
  const title = trimText(task.contentTitle || task.title || task.displayTitle)
  const author = trimText(task.author)
  const material = getTrainingBody(task)
  return {
    ...task,
    day: Number(task.day || task.sortOrder || 0),
    sortOrder: Number(task.sortOrder || task.day || 0),
    title,
    contentTitle: title,
    author,
    displayTitle: formatContentTitle({ title, author }),
    material,
    quote: trimText(task.quote) || extractTrainingQuote(material),
    membershipLevel: resolveSingleItemPolicy(task).effectiveMembershipLevel,
    contentStyle: normalizeContentStyle(task.contentStyle),
    contentRichStyle: normalizeContentRichStyle(task.contentRichStyle, material.length)
  }
}

function normalizeCloudTrainingTask(item = {}) {
  const category = normalizeCategory(item.moduleId || item.category)
  const moduleId = getModuleIdByCategory(category, item.trainingType)
  const day = Number(item.day || item.sortOrder || item.dayNumber || 0)
  const sortOrder = Number(item.sortOrder || item.day || 0)
  const requirements = Array.isArray(item.requirements) ? item.requirements : []
  const aiReviewFocus = Array.isArray(item.aiReviewFocus) ? item.aiReviewFocus : []
  const material = getTrainingBody(item) || [item.promptText, item.exampleText]
    .map(trimText)
    .filter(Boolean)
    .join('\n\n')
  const title = trimText(item.contentTitle || item.title || `Day ${sortOrder || day} 训练`)
  const tips = Array.isArray(item.tips) && item.tips.length
    ? item.tips.map(trimText).filter(Boolean)
    : [item.guideText].concat(requirements, aiReviewFocus).map(trimText).filter(Boolean)
  const contentId = normalizeTrainingContentId(item.contentId)
  if (!moduleId || !contentId) return null

  return normalizeTaskForDisplay(moduleId, {
    ...item,
    category,
    moduleId,
    contentId,
    day: sortOrder || day,
    sortOrder: sortOrder || day,
    title,
    contentTitle: title,
    author: trimText(item.author),
    goal: item.goal || item.guideText || '',
    requirement: item.requirement || requirements.join('；'),
    material,
    tips: tips.length ? tips : ['先完整读题和材料，再完成一次录音或录像训练。'],
    duration: item.duration || '60秒',
    targetSeconds: Number(item.targetSeconds || 60),
    estimatedChars: Number(item.estimatedChars || estimateChars(material)),
    membershipLevel: resolveSingleItemPolicy(item).effectiveMembershipLevel,
    incomplete: item.incomplete === true,
    source: 'cloudbase'
  })
}

function shouldUseCloudConfigItem(item = {}) {
  const status = trimText(item.status).toLowerCase()
  if (status === 'deleted') return true
  if (item.active === false || item.visible === false) return false
  return !['archived', 'inactive', 'disabled', 'draft'].includes(status)
}

const trainingModules = MODULE_DEFINITIONS.map(definition => {
  const theme = MODULE_THEME[definition.id]
  const days = (generatedTrainingDays[definition.id] || []).map(item => normalizeTaskForDisplay(definition.id, item))
  return {
    ...definition,
    shortTitle: definition.title,
    color: theme.gradient,
    gradient: theme.gradient,
    themeColor: theme.gradient,
    className: theme.className,
    iconType: theme.iconType,
    totalDays: days.length,
    days
  }
})

// 云端数据集校验：所有 contentId 必须为 tc_<32hex> 永久格式，Day 必须连续。
// 旧格式（如 reading-day-N）或混合物整批拒绝，禁止与本地 canonical 拼接。
const EXPECTED_MODULE_COUNTS = { topic: 276, reading: 216, leaderSpeech: 24, retell: 257, speech: 116, mandarin: 77 }

function isValidCloudDataset(contents = [], moduleId = '') {
  if (!EXPECTED_MODULE_COUNTS[moduleId] || !Array.isArray(contents) || !contents.length) return false
  const ids = new Set()
  const days = new Set()
  for (let index = 0; index < contents.length; index += 1) {
    const item = contents[index] || {}
    const contentId = normalizeTrainingContentId(item.contentId)
    const itemModuleId = getModuleIdByCategory(item.moduleId || item.category, item.trainingType)
    const day = Number(item.day || item.sortOrder || 0)
    const sortOrder = Number(item.sortOrder || item.day || 0)
    const status = trimText(item.status || 'active').toLowerCase()
    if (!contentId || ids.has(contentId) || itemModuleId !== moduleId) return false
    if (!trimText(item.title) || day !== index + 1 || sortOrder !== day || days.has(day)) return false
    if (!['active', 'published'].includes(status)) return false
    if (!Number.isFinite(Number(item.contentVersion)) || Number(item.contentVersion) < 1) return false
    ids.add(contentId)
    days.add(day)
  }
  return true
}

function getResolvedTrainingModules() {
  return trainingModules.map(module => {
    const remoteCatalog = cloudTrainingCatalogs.get(module.id)
    const days = remoteCatalog && isValidCloudDataset(remoteCatalog, module.id)
      ? remoteCatalog.map(item => normalizeCloudTrainingTask(item)).filter(Boolean)
      : module.days.slice()
    const policyDays = computeModuleAccessPolicy(days)
    return { ...module, totalDays: policyDays.length, days: policyDays }
  })
}

function categoryMatches(left, right) {
  return normalizeCategory(left) === normalizeCategory(right)
}

function setCloudTrainingContents(contents, options = {}) {
  const nextContents = Array.isArray(contents) ? clone(contents) : []
  const category = normalizeCategory(options.moduleId || options.category)
  if (EXPECTED_MODULE_COUNTS[category]) {
    if (!isValidCloudDataset(nextContents, category)) {
      console.warn('[training-data] 云端轻量目录校验失败，整模块继续使用本地目录:', {
        moduleId: category,
        receivedCount: nextContents.length
      })
      return false
    }
    cloudTrainingCatalogs.set(category, nextContents)
    return true
  }
  if (!category) {
    cloudTrainingContents = nextContents
    return true
  }
  cloudTrainingContents = cloudTrainingContents
    .filter(item => !categoryMatches(item.category, category))
    .concat(nextContents)
  return true
}

function upsertCloudTrainingContent(content) {
  const item = content && typeof content === 'object' ? clone(content) : null
  const category = normalizeCategory(item && (item.moduleId || item.category))
  const contentId = normalizeTrainingContentId(item && item.contentId)
  if (!item) return false
  if (EXPECTED_MODULE_COUNTS[category]) {
    const current = cloudTrainingCatalogs.get(category)
    if (!current || !contentId) return false
    const index = current.findIndex(existing => existing.contentId === contentId)
    if (index < 0) return false
    const next = current.slice()
    next[index] = {
      ...next[index],
      contentId,
      moduleId: category,
      title: trimText(item.title || next[index].title),
      contentVersion: Number(item.contentVersion || next[index].contentVersion),
      status: trimText(item.status || next[index].status),
      updatedAt: item.updatedAt || next[index].updatedAt
    }
    if (!isValidCloudDataset(next, category)) return false
    cloudTrainingCatalogs.set(category, next)
    return true
  }
  if (!contentId && EXPECTED_MODULE_COUNTS[category]) return false
  const extraContentId = trimText(item.contentId)
  if (!extraContentId) return false
  item.contentId = extraContentId
  cloudTrainingContents = cloudTrainingContents
    .filter(existing => trimText(existing.contentId) !== extraContentId)
    .concat(item)
  return true
}

function clearCloudTrainingContents(category = '') {
  const targetCategory = trimText(category)
  if (!targetCategory) cloudTrainingCatalogs.clear()
  else cloudTrainingCatalogs.delete(normalizeCategory(targetCategory))
  cloudTrainingContents = targetCategory
    ? cloudTrainingContents.filter(item => !categoryMatches(item.category, targetCategory))
    : []
}

const extraTraining = [
  {
    id: 'dailyQuote',
    title: '每日金句',
    desc: '随机一句金句，练朗读和表达感',
    icon: '❝',
    color: 'yellow',
    className: 'extra-dailyQuote',
    iconClass: 'extra-icon-quote',
    items: DAILY_QUOTES.map(item => ({
      id: item.id,
      text: item.content,
      title: item.title || '',
      author: item.author || '',
      category: item.category,
      source: 'imported',
      usageTip: '朗读这句金句，注意停顿、重音和情绪。',
      membershipLevel: 'free'
    })),
    importedQuotes: []
  },
  {
    id: 'randomTopic',
    title: '随机话题',
    desc: '随机一个话题，完成 60 秒即兴表达',
    icon: '?',
    color: 'blue',
    className: 'extra-randomTopic',
    iconClass: 'extra-icon-topic',
    items: DAILY_TOPICS.map(item => ({
      id: item.id,
      text: item.title,
      title: item.title,
      author: item.author || '',
      category: item.category,
      source: 'imported',
      usageTip: '围绕该话题完成 60 秒以上即兴表达。',
      membershipLevel: 'free'
    }))
  },
  {
    id: 'tongueTwister',
    title: '绕口令挑战',
    desc: '练发音、气息、平翘舌和前后鼻音',
    icon: '~',
    color: 'orange',
    className: 'extra-tongueTwister',
    iconClass: 'extra-icon-twister',
    items: TONGUE_TWISTERS.map(item => ({
      id: item.id,
      title: item.title,
      author: item.author || '',
      text: item.content,
      category: item.category,
      source: 'imported',
      usageTip: '慢速读清楚，再逐渐加快速度，注意气息、平翘舌和前后鼻音。',
      membershipLevel: 'free'
    }))
  }
]

function normalizeExtraCloudItem(item = {}, fallbackCategory = '') {
  const category = trimText(item.category || fallbackCategory)
  const number = Number(item.day || item.index || item.sortOrder || 0)
  const title = trimText(item.title)
  return {
    ...item,
    contentId: trimText(item.contentId || getExtraContentId(category, number)),
    day: number,
    sortOrder: Number(item.sortOrder || number || 0),
    isCustom: item.isCustom === true,
    title,
    author: trimText(item.author),
    text: trimText(item.content || item.text || item.title),
    categoryName: trimText(item.categoryName),
    status: trimText(item.status || 'published'),
    membershipLevel: normalizeContentMembershipLevel(item.membershipLevel),
    source: 'cloudbase'
  }
}

function getResolvedExtraTraining() {
  return extraTraining.map(extra => {
    const cloudCategory = Object.keys(EXTRA_CONFIG_CATEGORY_ID_MAP)
      .find(category => EXTRA_CONFIG_CATEGORY_ID_MAP[category] === extra.id)
    if (!cloudCategory) return extra

    const itemMap = new Map((extra.items || []).map((item, index) => {
      const contentId = getExtraContentId(cloudCategory, index + 1)
      return [contentId, {
        ...item,
        contentId,
        day: index + 1,
        sortOrder: index + 1,
        displayTitle: formatContentTitle(item)
      }]
    }))

    cloudTrainingContents
      .filter(shouldUseCloudConfigItem)
      .filter(item => trimText(item.category) === cloudCategory)
      .map(item => normalizeExtraCloudItem(item, cloudCategory))
      .filter(item => item.contentId)
      .forEach(item => {
        if (item.status === 'deleted') {
          itemMap.delete(item.contentId)
          return
        }
        const localItem = itemMap.get(item.contentId) || {}
        itemMap.set(item.contentId, {
          ...localItem,
          ...item,
          id: localItem.id || item.contentId,
          text: item.text || localItem.text || '',
          title: item.title || localItem.title || '',
          author: hasOwn(item, 'author') ? item.author : (localItem.author || ''),
          category: localItem.category || item.categoryName || extra.title,
          usageTip: localItem.usageTip || '',
          displayTitle: formatContentTitle({
            title: item.title || localItem.title || item.text || localItem.text || '',
            author: hasOwn(item, 'author') ? item.author : (localItem.author || '')
          })
        })
      })

    return {
      ...extra,
      items: Array.from(itemMap.values()).sort((a, b) => {
        return Number(a.sortOrder || a.day || 0) - Number(b.sortOrder || b.day || 0)
      })
    }
  })
}

// 保留旧导出名供作品历史兼容，但不再改写源文档标题。
function cleanReadingDisplayTitle(title) {
  return trimText(title)
}

function normalizeModuleForDisplay(module) {
  if (!module || !Array.isArray(module.days)) return module
  return {
    ...module,
    days: module.days.map(item => normalizeTaskForDisplay(module.id, item))
  }
}

function getTrainingModules() {
  return clone(getResolvedTrainingModules().map(normalizeModuleForDisplay))
}

function getExtraTraining() {
  return clone(getResolvedExtraTraining())
}

function getExtraTrainingById(extraType) {
  const target = getResolvedExtraTraining().find(item => item.id === extraType)
  return target ? clone(target) : null
}

function getModuleById(moduleId) {
  const target = getResolvedTrainingModules().find(item => item.id === moduleId)
  return target ? clone(normalizeModuleForDisplay(target)) : null
}

function getTaskByModuleAndContentId(moduleId, contentId) {
  const target = getResolvedTrainingModules().find(item => item.id === moduleId)
  const id = normalizeTrainingContentId(contentId)
  if (!target || !id) return null
  const task = target.days.find(item => normalizeTrainingContentId(item.contentId) === id)
  return task ? clone(normalizeTaskForDisplay(moduleId, task)) : null
}

module.exports = {
  STORAGE_KEY,
  DRAFTS_KEY,
  SUBMISSIONS_KEY,
  EXTRA_DRAFTS_KEY,
  EXTRA_SUBMISSIONS_KEY,
  trainingModules,
  extraTraining,
  getTrainingModules,
  getExtraTraining,
  getExtraTrainingById,
  getModuleById,
  getTaskByModuleAndContentId,
  getTrainingBody,
  isTrainingContentComplete,
  isCompleteTrainingRecord,
  setCloudTrainingContents,
  upsertCloudTrainingContent,
  clearCloudTrainingContents,
  cleanReadingDisplayTitle,
  splitTitleAndAuthor,
  formatContentTitle,
  normalizeTrainingContentId
}
