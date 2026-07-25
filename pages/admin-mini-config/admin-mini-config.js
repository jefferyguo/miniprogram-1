const {
  trainingModules: baseTrainingModules,
  formatContentTitle,
  splitTitleAndAuthor
} = require('../../utils/training-data')
const {
  DAILY_QUOTES,
  DAILY_TOPICS,
  TONGUE_TWISTERS
} = require('../../utils/daily-training-data')
const {
  getAdminProfile,
  adminListTrainingContents,
  adminSaveTrainingContent,
  adminDeleteTrainingContent
} = require('../../utils/cloud-api')

const CONFIG_CATEGORIES = [
  {
    category: 'reading',
    categoryName: '朗读训练',
    desc: '编辑朗读训练 Day 内容',
    group: 'training',
    moduleId: 'reading',
    iconText: '读',
    theme: 'card-green'
  },
  {
    category: 'retelling',
    categoryName: '复述训练',
    desc: '编辑复述训练 Day 内容',
    group: 'training',
    moduleId: 'retell',
    iconText: '述',
    theme: 'card-blue'
  },
  {
    category: 'topic',
    categoryName: '话题训练',
    desc: '编辑话题训练 Day 内容',
    group: 'training',
    moduleId: 'topic',
    iconText: '题',
    theme: 'card-orange'
  },
  {
    category: 'mandarin',
    categoryName: '普通话训练',
    desc: '编辑普通话训练 Day 内容',
    group: 'training',
    moduleId: 'mandarin',
    iconText: '普',
    theme: 'card-cyan'
  },
  {
    category: 'speech',
    categoryName: '演讲训练',
    desc: '编辑演讲训练内容',
    group: 'training',
    moduleId: 'speech',
    iconText: '演',
    theme: 'card-violet'
  },
  {
    category: 'leaderSpeech',
    categoryName: '领导发言',
    desc: '编辑领导发言稿、讲话稿与致辞内容',
    group: 'training',
    moduleId: 'leaderSpeech',
    iconText: '领',
    theme: 'card-amber'
  },
  {
    category: 'dailyQuote',
    categoryName: '每日金句',
    desc: '编辑每日金句内容库',
    group: 'daily',
    iconText: '引',
    theme: 'card-amber'
  },
  {
    category: 'dailyTopic',
    categoryName: '随机话题',
    desc: '编辑随机话题内容库',
    group: 'daily',
    iconText: '问',
    theme: 'card-violet'
  },
  {
    category: 'tongueTwister',
    categoryName: '绕口令挑战',
    desc: '编辑绕口令训练内容',
    group: 'daily',
    iconText: '令',
    theme: 'card-red'
  }
]

const DEFAULT_CONTENT_STYLE = {
  fontSize: 'normal',
  color: 'default',
  bold: false
}

const DEFAULT_CONTENT_RICH_STYLE = {
  ranges: []
}

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: '小' },
  { value: 'normal', label: '标准' },
  { value: 'large', label: '大' },
  { value: 'xlarge', label: '超大' }
]

const COLOR_OPTIONS = [
  { value: 'default', label: '默认黑' },
  { value: 'green', label: '深绿' },
  { value: 'red', label: '红色' },
  { value: 'blue', label: '蓝色' },
  { value: 'gold', label: '金色' }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function trimText(value) {
  return String(value || '').trim()
}

function getExcerpt(value) {
  const text = trimText(value).replace(/\s+/g, ' ')
  return text.length > 72 ? `${text.slice(0, 72)}...` : text
}

function normalizeTitle(value, fallback) {
  const title = trimText(value)
  return title || fallback
}

function getMetaText(config, day, fallback = '') {
  if (day) return config && config.group === 'training' ? `Day ${day}` : `第 ${day} 条`
  return fallback
}

function formatTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    String(date.getMilliseconds()).padStart(3, '0')
  ].join('')
}

function generateCustomContentId(category) {
  return `${category}-custom-${formatTimestamp()}`
}

function normalizeMembershipLevel(value, fallback = 'free') {
  const level = String(value || '').trim()
  if (level === 'member') return 'member'
  if (['monthly', 'yearly', 'admin'].includes(level)) return 'member'
  if (level === 'free') return 'free'
  return fallback
}

function normalizeContentStyle(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  const fontSize = FONT_SIZE_OPTIONS.some(item => item.value === source.fontSize)
    ? source.fontSize
    : DEFAULT_CONTENT_STYLE.fontSize
  const color = COLOR_OPTIONS.some(item => item.value === source.color)
    ? source.color
    : DEFAULT_CONTENT_STYLE.color

  return {
    fontSize,
    color,
    bold: source.bold === true
  }
}

function normalizeContentRichStyle(value = {}, contentLength) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  const maxLength = Number.isFinite(contentLength) ? Math.max(contentLength, 0) : Infinity
  const ranges = Array.isArray(source.ranges) ? source.ranges : []

  return {
    ranges: ranges
      .map(item => {
        const start = Math.max(Number(item && item.start || 0), 0)
        const end = Math.max(Number(item && item.end || 0), 0)
        const clampedStart = Number.isFinite(maxLength) ? Math.min(start, maxLength) : start
        const clampedEnd = Number.isFinite(maxLength) ? Math.min(end, maxLength) : end
        return {
          start: clampedStart,
          end: clampedEnd,
          ...normalizeContentStyle(item)
        }
      })
      .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end)
  }
}

function getContentStyleClass(style = {}) {
  const normalized = normalizeContentStyle(style)
  return [
    `material-size-${normalized.fontSize}`,
    `material-color-${normalized.color}`,
    normalized.bold ? 'material-bold' : ''
  ].filter(Boolean).join(' ')
}

function buildRichPreviewSegments(content, baseStyle, richStyle) {
  const text = String(content || '')
  const ranges = normalizeContentRichStyle(richStyle, text.length).ranges
  const segments = []
  let cursor = 0

  ranges.forEach(range => {
    if (range.start > cursor) {
      segments.push({
        text: text.slice(cursor, range.start),
        className: getContentStyleClass(baseStyle)
      })
    }
    const start = Math.max(range.start, cursor)
    if (range.end > start) {
      segments.push({
        text: text.slice(start, range.end),
        className: getContentStyleClass(range)
      })
      cursor = range.end
    }
  })

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      className: getContentStyleClass(baseStyle)
    })
  }

  if (!segments.length) {
    segments.push({
      text: text || '内容预览会显示在这里',
      className: getContentStyleClass(baseStyle)
    })
  }

  return segments
}

function getMembershipLabel(level) {
  return normalizeMembershipLevel(level) === 'member' ? '会员' : '免费'
}

function getStatusText(status) {
  if (status === 'disabled' || status === 'draft') return '未发布'
  if (status === 'deleted') return '已删除'
  return '已发布'
}

function getStatusClass(status) {
  if (status === 'disabled' || status === 'draft') return 'status-disabled'
  if (status === 'deleted') return 'status-deleted'
  return 'status-published'
}

function getNextDay(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item.day || item.dayNumber || 0)), 0) + 1
}

function getNextSortOrder(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item.sortOrder || item.day || item.dayNumber || 0)), 0) + 1
}

function buildTrainingLocalItems(config) {
  const module = baseTrainingModules.find(item => item.id === config.moduleId)
  const days = module && Array.isArray(module.days) ? module.days : []
  return days.map(dayItem => {
    const day = Number(dayItem.day || 0)
    const parsed = splitTitleAndAuthor(
      dayItem.contentTitle || dayItem.displayTitle || dayItem.title
    )
    const title = normalizeTitle(parsed.title, `Day ${day}`)
    const author = trimText(dayItem.author || parsed.author)
    const displayTitle = formatContentTitle({ title, author })
    const content = trimText(
      dayItem.material ||
      dayItem.content ||
      dayItem.example ||
      dayItem.requirement ||
      dayItem.goal ||
      ''
    )
    const membershipLevel = normalizeMembershipLevel(dayItem.membershipLevel, day <= 21 ? 'free' : 'member')
    return {
      contentId: `${config.category}-day-${day}`,
      category: config.category,
      categoryName: config.categoryName,
      day,
      title,
      author,
      articleCategory: dayItem.articleCategory || '',
      cover: dayItem.cover || '',
      displayTitle,
      content,
      excerpt: getExcerpt(content),
      metaText: getMetaText(config, day, `${config.categoryName}`),
      source: 'local',
      sourceText: '本地默认',
      isCloudModified: false,
      membershipLevel,
      contentStyle: normalizeContentStyle(dayItem.contentStyle),
      contentRichStyle: normalizeContentRichStyle(dayItem.contentRichStyle, content.length),
      membershipText: getMembershipLabel(membershipLevel),
      membershipClass: membershipLevel === 'member' ? 'membership-member' : 'membership-free',
      status: 'published',
      statusText: getStatusText('published'),
      statusClass: getStatusClass('published')
    }
  })
}

function buildDailyLocalItems(config) {
  let source = []
  if (config.category === 'dailyQuote') source = DAILY_QUOTES
  if (config.category === 'dailyTopic') source = DAILY_TOPICS
  if (config.category === 'tongueTwister') source = TONGUE_TWISTERS

  return source.map((item, index) => {
    const number = index + 1
    const parsed = splitTitleAndAuthor(item.title || item.content)
    const title = normalizeTitle(parsed.title, config.category === 'dailyQuote' ? `金句 ${number}` : `${config.categoryName} ${number}`)
    const author = trimText(item.author || parsed.author)
    const displayTitle = formatContentTitle({ title, author })
    const content = trimText(item.content || item.title || '')
    return {
      contentId: `${config.category}-${number}`,
      category: config.category,
      categoryName: config.categoryName,
      day: number,
      title,
      author,
      articleCategory: item.articleCategory || item.categoryName || '',
      cover: item.cover || '',
      displayTitle,
      content,
      excerpt: getExcerpt(content),
      metaText: getMetaText(config, number),
      source: 'local',
      sourceText: '本地默认',
      isCloudModified: false,
      membershipLevel: 'free',
      contentStyle: normalizeContentStyle(item.contentStyle),
      contentRichStyle: normalizeContentRichStyle(item.contentRichStyle, content.length),
      membershipText: getMembershipLabel('free'),
      membershipClass: 'membership-free',
      status: 'published',
      statusText: getStatusText('published'),
      statusClass: getStatusClass('published')
    }
  })
}

function buildLocalItems(config) {
  if (!config) return []
  return config.group === 'training'
    ? buildTrainingLocalItems(config)
    : buildDailyLocalItems(config)
}

function normalizeCloudItem(item = {}, fallbackConfig = {}) {
  const category = trimText(item.category || fallbackConfig.category)
  const categoryName = trimText(item.categoryName || fallbackConfig.categoryName)
  const day = Number(item.day || item.dayNumber || item.index || 0)
  const content = trimText(item.content || item.material || item.promptText || item.exampleText || '')
  const parsed = splitTitleAndAuthor(item.title)
  const title = normalizeTitle(parsed.title, day ? `第 ${day} 条` : '未命名内容')
  const author = Object.prototype.hasOwnProperty.call(item, 'author')
    ? (trimText(item.author) || parsed.author)
    : parsed.author
  const membershipLevel = normalizeMembershipLevel(item.membershipLevel)
  const contentStyle = normalizeContentStyle(item.contentStyle)
  const contentRichStyle = normalizeContentRichStyle(item.contentRichStyle, content.length)
  const status = trimText(item.status || 'published')
  return {
    ...item,
    contentId: trimText(item.contentId || item.key || item._id),
    cloudId: item._id || '',
    category,
    categoryName,
    day,
    title,
    author,
    articleCategory: trimText(item.articleCategory || ''),
    cover: trimText(item.cover || item.coverUrl || ''),
    sourceFileID: trimText(item.sourceFileID || ''),
    displayTitle: formatContentTitle({ title, author }),
    content,
    excerpt: getExcerpt(content),
    metaText: getMetaText(fallbackConfig, day, trimText(item.contentId || item.key || item._id)),
    source: 'cloud',
    sourceText: item.isCustom === true ? '云端新增' : '已云端修改',
    isCloudModified: true,
    isCustom: item.isCustom === true,
    sortOrder: Number(item.sortOrder || day || 0),
    membershipLevel,
    contentStyle,
    contentRichStyle,
    membershipText: getMembershipLabel(membershipLevel),
    membershipClass: membershipLevel === 'member' ? 'membership-member' : 'membership-free',
    status,
    statusText: getStatusText(status),
    statusClass: getStatusClass(status)
  }
}

function mergeCloudItems(localItems, cloudItems, config) {
  const map = new Map()
  localItems.forEach(item => map.set(item.contentId, item))

  cloudItems.forEach(rawItem => {
    const cloudItem = normalizeCloudItem(rawItem, config)
    if (!cloudItem.contentId) return
    if (cloudItem.status === 'deleted') {
      map.delete(cloudItem.contentId)
      return
    }
    const localItem = map.get(cloudItem.contentId)
    map.set(cloudItem.contentId, {
      ...(localItem || {}),
      ...cloudItem,
      day: cloudItem.day || (localItem && localItem.day) || 0,
      category: cloudItem.category || (localItem && localItem.category) || config.category,
      categoryName: cloudItem.categoryName || (localItem && localItem.categoryName) || config.categoryName
    })
  })

  return Array.from(map.values()).sort((a, b) => {
    const dayDiff = Number(a.day || 0) - Number(b.day || 0)
    if (dayDiff) return dayDiff
    const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    if (sortDiff) return sortDiff
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN')
  })
}

function getCategoryConfig(category) {
  return CONFIG_CATEGORIES.find(item => item.category === category) || null
}

Page({
  data: {
    checkingAdmin: true,
    isAdmin: false,
    adminMessage: '',
    mode: 'home',
    trainingCategories: CONFIG_CATEGORIES.filter(item => item.group === 'training'),
    dailyCategories: CONFIG_CATEGORIES.filter(item => item.group === 'daily'),
    fontSizeOptions: FONT_SIZE_OPTIONS,
    colorOptions: COLOR_OPTIONS,
    currentCategory: null,
    currentItems: [],
    listLoading: false,
    listError: '',
    editItem: null,
    editTitle: '',
    editAuthor: '',
    editArticleCategory: '',
    editCover: '',
    editSourceFileID: '',
    editContent: '',
    editMembershipLevel: 'free',
    editContentStyle: DEFAULT_CONTENT_STYLE,
    editContentRichStyle: DEFAULT_CONTENT_RICH_STYLE,
    richStart: '',
    richEnd: '',
    richFontSize: DEFAULT_CONTENT_STYLE.fontSize,
    richColor: DEFAULT_CONTENT_STYLE.color,
    richBold: false,
    richPreviewSegments: buildRichPreviewSegments('', DEFAULT_CONTENT_STYLE, DEFAULT_CONTENT_RICH_STYLE),
    isCreatingContent: false,
    saving: false
  },

  onLoad() {
    this.checkAdmin()
  },

  async checkAdmin() {
    this.setData({ checkingAdmin: true, adminMessage: '' })
    try {
      const profile = await getAdminProfile()
      const isAdmin = profile && profile.isAdmin === true && ['super_admin', 'admin'].includes(profile.role)
      this.setData({
        checkingAdmin: false,
        isAdmin,
        adminMessage: isAdmin ? '' : '当前账号暂无小程序配置权限'
      })
    } catch (error) {
      this.setData({
        checkingAdmin: false,
        isAdmin: false,
        adminMessage: error.message || '管理员身份读取失败'
      })
    }
  },

  openCategory(e) {
    const category = e.currentTarget.dataset.category
    this.loadCategory(category)
  },

  async loadCategory(category) {
    const config = getCategoryConfig(category)
    if (!config) return
    const localItems = buildLocalItems(config)
    this.setData({
      mode: 'list',
      currentCategory: config,
      currentItems: localItems,
      listLoading: true,
      listError: '',
      editItem: null,
      editTitle: '',
      editAuthor: '',
      editArticleCategory: '',
      editCover: '',
      editSourceFileID: '',
      editContent: '',
      editMembershipLevel: 'free',
      editContentStyle: DEFAULT_CONTENT_STYLE,
      editContentRichStyle: DEFAULT_CONTENT_RICH_STYLE,
      richStart: '',
      richEnd: '',
      richFontSize: DEFAULT_CONTENT_STYLE.fontSize,
      richColor: DEFAULT_CONTENT_STYLE.color,
      richBold: false,
      richPreviewSegments: buildRichPreviewSegments('', DEFAULT_CONTENT_STYLE, DEFAULT_CONTENT_RICH_STYLE),
      isCreatingContent: false,
      saving: false
    })

    try {
      const result = await adminListTrainingContents(config.category)
      const cloudItems = (result.contents || result.data || []).concat(result.deletedContents || [])
      this.setData({
        currentItems: mergeCloudItems(localItems, cloudItems, config),
        listLoading: false
      })
    } catch (error) {
      this.setData({
        currentItems: localItems,
        listLoading: false,
        listError: error.message || '云端内容读取失败，当前显示本地默认内容'
      })
      wx.showToast({ title: '云端内容读取失败', icon: 'none' })
    }
  },

  backHome() {
    this.setData({
      mode: 'home',
      currentCategory: null,
      currentItems: [],
      editItem: null,
      editTitle: '',
      editAuthor: '',
      editContent: '',
      editMembershipLevel: 'free',
      isCreatingContent: false,
      listError: ''
    })
  },

  addContent() {
    const config = this.data.currentCategory
    if (!config) return
    const day = getNextDay(this.data.currentItems)
    const sortOrder = getNextSortOrder(this.data.currentItems)

    this.setData({
      mode: 'edit',
      editItem: {
        contentId: generateCustomContentId(config.category),
        category: config.category,
        categoryName: config.categoryName,
        day,
        sortOrder,
        title: '',
        author: '',
        articleCategory: '',
        cover: '',
        sourceFileID: '',
        content: '',
        metaText: '新增',
        source: 'cloud',
        sourceText: '云端新增',
        isCloudModified: true,
        isCustom: true,
        isNew: true,
        membershipLevel: 'member',
        contentStyle: normalizeContentStyle(),
        contentRichStyle: normalizeContentRichStyle(),
        membershipText: getMembershipLabel('member'),
        membershipClass: 'membership-member'
      },
      editTitle: '',
      editAuthor: '',
      editArticleCategory: '',
      editCover: '',
      editSourceFileID: '',
      editContent: '',
      editMembershipLevel: 'member',
      editContentStyle: normalizeContentStyle(),
      editContentRichStyle: normalizeContentRichStyle(),
      richStart: '',
      richEnd: '',
      richFontSize: DEFAULT_CONTENT_STYLE.fontSize,
      richColor: DEFAULT_CONTENT_STYLE.color,
      richBold: false,
      richPreviewSegments: buildRichPreviewSegments('', normalizeContentStyle(), normalizeContentRichStyle()),
      isCreatingContent: true,
      saving: false
    })
  },

  editContent(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const item = this.data.currentItems[index]
    if (!item) return
    this.setData({
      mode: 'edit',
      editItem: clone(item),
      editTitle: item.title || '',
      editAuthor: item.author || '',
      editArticleCategory: item.articleCategory || '',
      editCover: item.cover || '',
      editSourceFileID: item.sourceFileID || '',
      editContent: item.content || '',
      editMembershipLevel: normalizeMembershipLevel(item.membershipLevel),
      editContentStyle: normalizeContentStyle(item.contentStyle),
      editContentRichStyle: normalizeContentRichStyle(item.contentRichStyle, String(item.content || '').length),
      richStart: '',
      richEnd: '',
      richFontSize: DEFAULT_CONTENT_STYLE.fontSize,
      richColor: DEFAULT_CONTENT_STYLE.color,
      richBold: false,
      richPreviewSegments: buildRichPreviewSegments(item.content || '', item.contentStyle, item.contentRichStyle),
      isCreatingContent: false
    })
  },

  handleTitleInput(e) {
    this.setData({ editTitle: e.detail.value })
  },

  handleContentInput(e) {
    const editContent = e.detail.value || ''
    const editContentRichStyle = normalizeContentRichStyle(this.data.editContentRichStyle, editContent.length)
    this.setData({
      editContent,
      editContentRichStyle,
      richPreviewSegments: buildRichPreviewSegments(editContent, this.data.editContentStyle, editContentRichStyle)
    })
  },

  handleAuthorInput(e) {
    this.setData({ editAuthor: e.detail.value })
  },

  handleArticleCategoryInput(e) {
    this.setData({ editArticleCategory: e.detail.value })
  },

  handleCoverInput(e) {
    this.setData({ editCover: e.detail.value })
  },

  importTrainingFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['doc', 'docx', 'txt', 'md'],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const name = file.name || ''
        const ext = name.split('.').pop().toLowerCase()
        if (['txt', 'md'].includes(ext)) {
          try {
            const content = wx.getFileSystemManager().readFileSync(file.path, 'utf8')
            const editContentRichStyle = normalizeContentRichStyle(this.data.editContentRichStyle, content.length)
            this.setData({
              editTitle: this.data.editTitle || name.replace(/\.(txt|md)$/i, ''),
              editContent: content,
              editContentRichStyle,
              richPreviewSegments: buildRichPreviewSegments(content, this.data.editContentStyle, editContentRichStyle)
            })
            wx.showToast({ title: '已导入文本', icon: 'success' })
          } catch (error) {
            wx.showToast({ title: '文本读取失败', icon: 'none' })
          }
          return
        }

        if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
          wx.showToast({ title: '云上传暂不可用', icon: 'none' })
          return
        }
        const cloudPath = `admin-training-docs/${Date.now()}-${name.replace(/\s+/g, '-')}`
        wx.showLoading({ title: '上传中' })
        wx.cloud.uploadFile({
          cloudPath,
          filePath: file.path,
          success: uploadRes => {
            this.setData({
              editTitle: this.data.editTitle || name.replace(/\.(doc|docx)$/i, ''),
              editSourceFileID: uploadRes.fileID || ''
            })
            wx.showToast({ title: '文件已上传', icon: 'success' })
          },
          fail: () => {
            wx.showToast({ title: '文件上传失败', icon: 'none' })
          },
          complete: () => {
            wx.hideLoading()
          }
        })
      }
    })
  },

  selectMembershipLevel(e) {
    const level = normalizeMembershipLevel(e.currentTarget.dataset.level)
    this.setData({ editMembershipLevel: level })
  },

  selectFontSize(e) {
    const value = e.currentTarget.dataset.value
    const editContentStyle = normalizeContentStyle({
      ...this.data.editContentStyle,
      fontSize: value
    })
    this.setData({
      editContentStyle,
      richPreviewSegments: buildRichPreviewSegments(this.data.editContent, editContentStyle, this.data.editContentRichStyle)
    })
  },

  selectContentColor(e) {
    const value = e.currentTarget.dataset.value
    const editContentStyle = normalizeContentStyle({
      ...this.data.editContentStyle,
      color: value
    })
    this.setData({
      editContentStyle,
      richPreviewSegments: buildRichPreviewSegments(this.data.editContent, editContentStyle, this.data.editContentRichStyle)
    })
  },

  toggleContentBold() {
    const style = normalizeContentStyle(this.data.editContentStyle)
    const editContentStyle = {
      ...style,
      bold: !style.bold
    }
    this.setData({
      editContentStyle,
      richPreviewSegments: buildRichPreviewSegments(this.data.editContent, editContentStyle, this.data.editContentRichStyle)
    })
  },

  handleContentSelect(e) {
    const detail = e.detail || {}
    if (detail.selectionStart === undefined || detail.selectionEnd === undefined) return
    if (Number(detail.selectionEnd) <= Number(detail.selectionStart)) return
    this.setData({
      richStart: String(detail.selectionStart),
      richEnd: String(detail.selectionEnd)
    })
  },

  handleRichStartInput(e) {
    this.setData({ richStart: e.detail.value })
  },

  handleRichEndInput(e) {
    this.setData({ richEnd: e.detail.value })
  },

  selectRichFontSize(e) {
    this.setData({ richFontSize: e.currentTarget.dataset.value })
  },

  selectRichColor(e) {
    this.setData({ richColor: e.currentTarget.dataset.value })
  },

  toggleRichBold() {
    this.setData({ richBold: !this.data.richBold })
  },

  applyRichStyleRange() {
    const content = String(this.data.editContent || '')
    const start = Number(this.data.richStart)
    const end = Number(this.data.richEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0 || end > content.length) {
      wx.showToast({ title: '请输入有效的起止位置', icon: 'none' })
      return
    }

    const nextRichStyle = normalizeContentRichStyle({
      ranges: [
        ...(this.data.editContentRichStyle.ranges || []),
        {
          start,
          end,
          fontSize: this.data.richFontSize,
          color: this.data.richColor,
          bold: this.data.richBold
        }
      ]
    }, content.length)

    this.setData({
      editContentRichStyle: nextRichStyle,
      richPreviewSegments: buildRichPreviewSegments(content, this.data.editContentStyle, nextRichStyle)
    })
  },

  deleteRichStyleRange(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const content = String(this.data.editContent || '')
    const ranges = (this.data.editContentRichStyle.ranges || []).filter((item, itemIndex) => itemIndex !== index)
    const nextRichStyle = normalizeContentRichStyle({ ranges }, content.length)
    this.setData({
      editContentRichStyle: nextRichStyle,
      richPreviewSegments: buildRichPreviewSegments(content, this.data.editContentStyle, nextRichStyle)
    })
  },

  clearRichStyleRanges() {
    const nextRichStyle = normalizeContentRichStyle()
    this.setData({
      editContentRichStyle: nextRichStyle,
      richPreviewSegments: buildRichPreviewSegments(this.data.editContent, this.data.editContentStyle, nextRichStyle)
    })
  },

  cancelEdit() {
    this.setData({
      mode: 'list',
      editItem: null,
      editTitle: '',
      editAuthor: '',
      editArticleCategory: '',
      editCover: '',
      editSourceFileID: '',
      editContent: '',
      editMembershipLevel: 'free',
      editContentStyle: DEFAULT_CONTENT_STYLE,
      editContentRichStyle: DEFAULT_CONTENT_RICH_STYLE,
      richStart: '',
      richEnd: '',
      richFontSize: DEFAULT_CONTENT_STYLE.fontSize,
      richColor: DEFAULT_CONTENT_STYLE.color,
      richBold: false,
      richPreviewSegments: buildRichPreviewSegments('', DEFAULT_CONTENT_STYLE, DEFAULT_CONTENT_RICH_STYLE),
      isCreatingContent: false,
      saving: false
    })
  },

  async saveEdit() {
    if (this.data.saving) return
    const item = this.data.editItem
    const title = trimText(this.data.editTitle)
    const author = trimText(this.data.editAuthor)
    const articleCategory = trimText(this.data.editArticleCategory)
    const cover = trimText(this.data.editCover)
    const sourceFileID = trimText(this.data.editSourceFileID)
    const content = trimText(this.data.editContent)
    const membershipLevel = normalizeMembershipLevel(this.data.editMembershipLevel, this.data.isCreatingContent ? 'member' : 'free')
    const contentStyle = normalizeContentStyle(this.data.editContentStyle)
    const contentRichStyle = normalizeContentRichStyle(this.data.editContentRichStyle, content.length)
    if (!item) return
    if (!title || !content) {
      wx.showToast({ title: '请填写标题和内容', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await adminSaveTrainingContent({
        contentId: item.contentId,
        category: item.category,
        categoryName: item.categoryName,
        day: item.day,
        sortOrder: item.sortOrder || item.day || 0,
        title,
        author,
        articleCategory,
        cover,
        sourceFileID,
        content,
        contentStyle,
        contentRichStyle,
        isCustom: item.isCustom === true,
        membershipLevel,
        status: 'published'
      })
      wx.showToast({ title: this.data.isCreatingContent ? '已添加' : '已保存', icon: 'success' })
      await this.loadCategory(item.category)
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
      this.setData({ saving: false })
    }
  },

  deleteContent(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const item = this.data.currentItems[index]
    if (!item) return

    wx.showModal({
      title: '确认删除',
      content: '删除后该内容将不再展示给学员，是否继续？',
      confirmText: '确认删除',
      confirmColor: '#d85b5b',
      cancelText: '取消',
      success: async res => {
        if (!res.confirm) return

        try {
          await adminDeleteTrainingContent({
            contentId: item.contentId,
            category: item.category,
            categoryName: item.categoryName,
            day: item.day,
            sortOrder: item.sortOrder || item.day || 0,
            title: item.title,
            author: item.author,
            content: item.content,
            isCustom: item.isCustom === true,
            membershipLevel: normalizeMembershipLevel(item.membershipLevel)
          })
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadCategory(item.category)
        } catch (error) {
          console.warn('[admin-mini-config] 删除训练内容失败:', error)
          wx.showToast({ title: '删除失败，请稍后重试', icon: 'none' })
        }
      }
    })
  },

  async toggleContentStatus(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const item = this.data.currentItems[index]
    if (!item) return

    const nextStatus = item.status === 'disabled' || item.status === 'draft' ? 'published' : 'disabled'
    try {
      await adminSaveTrainingContent({
        contentId: item.contentId,
        category: item.category,
        categoryName: item.categoryName,
        day: item.day,
        sortOrder: item.sortOrder || item.day || 0,
        title: item.title,
        author: item.author,
        articleCategory: item.articleCategory || '',
        cover: item.cover || '',
        sourceFileID: item.sourceFileID || '',
        content: item.content,
        contentStyle: item.contentStyle,
        contentRichStyle: item.contentRichStyle,
        isCustom: item.isCustom === true,
        membershipLevel: normalizeMembershipLevel(item.membershipLevel),
        status: nextStatus
      })
      wx.showToast({ title: nextStatus === 'published' ? '已发布' : '已下架', icon: 'success' })
      await this.loadCategory(item.category)
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' })
    }
  }
})
