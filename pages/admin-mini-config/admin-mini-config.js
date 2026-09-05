const {
  trainingModules: baseTrainingModules,
  formatContentTitle,
  splitTitleAndAuthor,
  upsertCloudTrainingContent
} = require('../../utils/training-data')
const { resolveSingleItemPolicy, computeModuleAccessPolicy } = require('../../utils/training-access-policy')
const {
  DAILY_QUOTES,
  DAILY_TOPICS,
  TONGUE_TWISTERS
} = require('../../utils/daily-training-data')
const {
  getAdminProfile,
  adminListTrainingContents,
  adminSaveTrainingContent,
  adminDeleteTrainingContent,
  adminReorderTrainingContents,
  adminGetDailyRegistrationReport,
  adminGetWeeklyRegistrationReport,
  adminRegenerateRegistrationReport
} = require('../../utils/cloud-api')

const CONFIG_CATEGORIES = [
  {
    category: 'reading',
    categoryName: '朗读训练',
    desc: '编辑朗读训练内容',
    group: 'training',
    moduleId: 'reading',
    iconText: '读',
    theme: 'card-green'
  },
  {
    category: 'retelling',
    categoryName: '复述训练',
    desc: '编辑复述训练内容',
    group: 'training',
    moduleId: 'retell',
    iconText: '述',
    theme: 'card-blue'
  },
  {
    category: 'topic',
    categoryName: '即兴讲话',
    desc: '编辑即兴讲话内容',
    group: 'training',
    moduleId: 'topic',
    iconText: '题',
    theme: 'card-orange'
  },
  {
    category: 'mandarin',
    categoryName: '普通话训练',
    desc: '编辑普通话训练内容',
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

const LIST_PAGE_SIZE = 20
const PERMANENT_CONTENT_ID_RE = /^tc_[0-9a-f]{32}$/

const STATUS_FILTER_OPTIONS = [
  { value: 'active', label: '当前内容' },
  { value: 'all', label: '全部状态' },
  { value: 'published', label: '已发布' },
  { value: 'disabled', label: '已下架' },
  { value: 'archived', label: '已归档' }
]

const SORT_OPTIONS = [
  { value: 'custom', label: '自定义排序' },
  { value: 'number', label: '序号升序' },
  { value: 'updated', label: '最近更新' },
  { value: 'title', label: '标题排序' }
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
  if (day) return `Day ${day}`
  return fallback
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
  if (status === 'disabled' || status === 'inactive') return '已下架'
  if (status === 'draft') return '草稿'
  if (status === 'archived') return '已归档'
  if (status === 'deleted') return '已删除'
  return '已发布'
}

function getStatusClass(status) {
  if (status === 'disabled' || status === 'draft' || status === 'inactive') return 'status-disabled'
  if (status === 'archived') return 'status-archived'
  if (status === 'deleted') return 'status-deleted'
  return 'status-published'
}

function getStatusGroup(status) {
  if (status === 'archived') return 'archived'
  if (status === 'disabled' || status === 'draft' || status === 'inactive') return 'disabled'
  if (status === 'deleted') return 'deleted'
  return 'published'
}

function getNextDay(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item.day || item.dayNumber || 0)), 0) + 1
}

function getNextSortOrder(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item.sortOrder || item.day || item.dayNumber || 0)), 0) + 1
}

function getVersionValue(value) {
  if (!value) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value._date) return String(value._date)
  if (value.$date) return String(value.$date)
  if (value.seconds || value.nanoseconds) return `${value.seconds || 0}:${value.nanoseconds || 0}`
  try {
    return JSON.stringify(value)
  } catch (error) {
    return ''
  }
}

function getExpectedVersion(item = {}) {
  const version = Number(item.version || item.contentVersion || item.expectedVersion || 1)
  return Number.isFinite(version) && version > 0 ? version : 1
}

function getConflictMessage(error) {
  const code = trimText(error && (error.code || error.errCode))
  const message = trimText(error && (error.message || error.errMsg))
  const text = `${code} ${message}`
  if (/CONFLICT|VERSION|EXPECTED_VERSION|STALE|冲突|版本|已被.*修改/i.test(text)) {
    return '内容已被其他人更新，请刷新后再编辑'
  }
  return message || '操作失败'
}

function buildTrainingLocalItems(config) {
  const module = baseTrainingModules.find(item => item.id === config.moduleId)
  const days = module && Array.isArray(module.days) ? module.days : []
  const rawItems = days.map(dayItem => {
    const day = Number(dayItem.day || 0)
    const parsed = splitTitleAndAuthor(
      dayItem.contentTitle || dayItem.displayTitle || dayItem.title
    )
    const title = normalizeTitle(parsed.title, `第 ${day} 条`)
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
    return {
      contentId: PERMANENT_CONTENT_ID_RE.test(trimText(dayItem.contentId))
        ? trimText(dayItem.contentId)
        : '',
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
      sortOrder: day,
      contentStyle: normalizeContentStyle(dayItem.contentStyle),
      contentRichStyle: normalizeContentRichStyle(dayItem.contentRichStyle, content.length),
      status: 'published',
      active: true,
      visible: true
    }
  })
  // 模块级权限计算：按 sortOrder 排序后，前3篇免费
  const policyItems = computeModuleAccessPolicy(rawItems)
  return policyItems.map(item => ({
    ...item,
    membershipLevel: item.effectiveMembershipLevel,
    membershipText: getMembershipLabel(item.effectiveMembershipLevel),
    membershipClass: item.effectiveMembershipLevel === 'member' ? 'membership-member' : 'membership-free',
    statusText: getStatusText('published'),
    statusClass: getStatusClass('published')
  }))
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
      sortOrder: number,
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
  const content = trimText(
    item.content ||
    item.material ||
    item.promptText ||
    item.text ||
    item.trainingContent ||
    item.exampleText ||
    ''
  )
  const parsed = splitTitleAndAuthor(item.title)
  const title = normalizeTitle(parsed.title, day ? `第 ${day} 条` : '未命名内容')
  const author = Object.prototype.hasOwnProperty.call(item, 'author')
    ? (trimText(item.author) || parsed.author)
    : parsed.author
  // effectiveMembershipLevel 由 computeModuleAccessPolicy 在 mergeCloudItems 中统一计算
  const membershipLevel = resolveSingleItemPolicy(item).effectiveMembershipLevel
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
    expectedVersion: getExpectedVersion(item),
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
    const cloudComplete = Boolean(trimText(cloudItem.title) && trimText(cloudItem.content))
    const localComplete = Boolean(localItem && trimText(localItem.title) && trimText(localItem.content))
    const mergedItem = {
      ...(localItem || {}),
      ...cloudItem,
      day: cloudItem.day || (localItem && localItem.day) || 0,
      category: cloudItem.category || (localItem && localItem.category) || config.category,
      categoryName: cloudItem.categoryName || (localItem && localItem.categoryName) || config.categoryName
    }
    if (!cloudComplete && localComplete) {
      mergedItem.title = localItem.title
      mergedItem.author = localItem.author
      mergedItem.displayTitle = localItem.displayTitle
      mergedItem.content = localItem.content
      mergedItem.excerpt = localItem.excerpt
      mergedItem.contentStyle = localItem.contentStyle
      mergedItem.contentRichStyle = localItem.contentRichStyle
      mergedItem.sourceText = '云端数据不完整，当前显示本地完整版本'
      mergedItem.cloudDataIncomplete = true
    }
    map.set(cloudItem.contentId, mergedItem)
  })

  const merged = Array.from(map.values())
  // 模块级权限计算：按 sortOrder 排序后，每篇获得 policyPosition / effectiveMembershipLevel
  const policyItems = computeModuleAccessPolicy(merged)
  // 同步显示字段到 effectiveMembershipLevel（合并后位置可能已变化）
  return policyItems.map(item => ({
    ...item,
    membershipLevel: item.effectiveMembershipLevel,
    membershipText: getMembershipLabel(item.effectiveMembershipLevel),
    membershipClass: item.effectiveMembershipLevel === 'member' ? 'membership-member' : 'membership-free'
  }))
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
    statusFilterOptions: STATUS_FILTER_OPTIONS,
    sortOptions: SORT_OPTIONS,
    moduleFilterOptions: CONFIG_CATEGORIES,
    moduleFilterIndex: 0,
    statusFilterIndex: 0,
    sortIndex: 0,
    currentCategory: null,
    allItems: [],
    filteredItems: [],
    currentItems: [],
    listSearch: '',
    listStatusFilter: 'active',
    listSortMode: 'custom',
    listStatusLabel: STATUS_FILTER_OPTIONS[0].label,
    listSortLabel: SORT_OPTIONS[0].label,
    listPage: 1,
    listPageSize: LIST_PAGE_SIZE,
    listTotalPages: 1,
    listSummary: '',
    listLoading: false,
    listError: '',
    editItem: null,
    editTitle: '',
    editAuthor: '',
    editArticleCategory: '',
    editCover: '',
    editSourceFileID: '',
    editSortOrder: '',
    editContent: '',
    editRichContentHtml: '',
    editRichContentVersion: 0,
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
    saving: false,

    // 新用户报表
    reportType: 'daily',
    reportDate: '',
    reportWeekDate: '',
    reportWeekStart: '',
    reportLoading: false,
    reportError: '',
    reportData: null,
    reportSearch: '',
    reportPhoneAuthRate: 0,
    filteredReportUsers: [],

    // 编辑器状态
    editorCtx: null,
    editorReady: false,
    editorPreviewMode: false,
    editorDirty: false,
    editorFormats: {},
    previewSegments: []
  },

  onLoad() {
    this.checkAdmin()
  },

  onPageScroll(event) {
    this._listScrollTop = Number(event && event.scrollTop || 0)
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

  getModuleFilterIndex(category) {
    return Math.max(CONFIG_CATEGORIES.findIndex(item => item.category === category), 0)
  },

  getStatusFilterIndex(value) {
    return Math.max(STATUS_FILTER_OPTIONS.findIndex(item => item.value === value), 0)
  },

  getSortIndex(value) {
    return Math.max(SORT_OPTIONS.findIndex(item => item.value === value), 0)
  },

  async loadCategory(category) {
    const config = getCategoryConfig(category)
    if (!config) return
    const localItems = buildLocalItems(config)
    const moduleFilterIndex = this.getModuleFilterIndex(config.category)
    this.setData({
      mode: 'list',
      currentCategory: config,
      allItems: localItems,
      filteredItems: localItems,
      currentItems: localItems,
      listSearch: this.data.currentCategory && this.data.currentCategory.category === config.category ? this.data.listSearch : '',
      listStatusFilter: this.data.listStatusFilter || 'active',
      listSortMode: this.data.listSortMode || 'custom',
      listStatusLabel: STATUS_FILTER_OPTIONS[this.getStatusFilterIndex(this.data.listStatusFilter || 'active')].label,
      listSortLabel: SORT_OPTIONS[this.getSortIndex(this.data.listSortMode || 'custom')].label,
      listPage: 1,
      listTotalPages: 1,
      listSummary: '',
      moduleFilterIndex,
      statusFilterIndex: this.getStatusFilterIndex(this.data.listStatusFilter || 'active'),
      sortIndex: this.getSortIndex(this.data.listSortMode || 'custom'),
      listLoading: true,
      listError: '',
      editItem: null,
      editTitle: '',
      editAuthor: '',
      editArticleCategory: '',
      editCover: '',
      editSourceFileID: '',
      editSortOrder: '',
      editContent: '',
      editRichContentHtml: '',
      editRichContentVersion: 0,
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
      saving: false,
      editorCtx: null,
      editorReady: false,
      editorPreviewMode: false,
      editorDirty: false,
      editorFormats: {},
      previewSegments: []
    })
    this.refreshListView({ page: 1 })

    try {
      const result = await adminListTrainingContents(config.category)
      const cloudItems = (result.contents || result.data || [])
        .concat(result.archivedContents || [])
        .concat(result.deletedContents || [])
      this.setData({ allItems: mergeCloudItems(localItems, cloudItems, config), listLoading: false })
      this.refreshListView({ page: 1 })
    } catch (error) {
      this.setData({
        allItems: localItems,
        currentItems: localItems,
        listLoading: false,
        listError: error.message || '云端内容读取失败，当前显示本地默认内容'
      })
      this.refreshListView({ page: 1 })
      wx.showToast({ title: '云端内容读取失败', icon: 'none' })
    }
  },

  refreshListView(options = {}) {
    const keyword = trimText(options.search !== undefined ? options.search : this.data.listSearch).toLowerCase()
    const statusFilter = options.statusFilter || this.data.listStatusFilter || 'active'
    const sortMode = options.sortMode || this.data.listSortMode || 'custom'
    const pageSize = Number(this.data.listPageSize || LIST_PAGE_SIZE)
    const source = Array.isArray(this.data.allItems) ? this.data.allItems : []
    const movableItems = source
      .filter(item => getStatusGroup(item.status) === 'published')
      .sort((a, b) => Number(a.sortOrder || a.day || 0) - Number(b.sortOrder || b.day || 0))
    const movableIndexById = new Map(movableItems.map((item, index) => [item.contentId, index]))
    const searched = source.filter(item => {
      const statusGroup = getStatusGroup(item.status)
      if (statusGroup === 'deleted') return false
      if (statusFilter === 'active' && statusGroup !== 'published') return false
      if (statusFilter !== 'all' && statusFilter !== 'active' && statusGroup !== statusFilter) return false
      if (!keyword) return true
      const haystack = [
        item.title,
        item.displayTitle,
        item.author,
        item.articleCategory,
        item.categoryName,
        item.contentId,
        item.content
      ].map(value => String(value || '').toLowerCase()).join(' ')
      return haystack.includes(keyword)
    })
    const filtered = searched.sort((a, b) => {
      if (sortMode === 'updated') {
        return getVersionValue(b.updatedAt).localeCompare(getVersionValue(a.updatedAt))
      }
      if (sortMode === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN')
      }
      if (sortMode === 'number') {
        const dayDiff = Number(a.day || 0) - Number(b.day || 0)
        if (dayDiff) return dayDiff
      }
      const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
      if (sortDiff) return sortDiff
      const dayDiff = Number(a.day || 0) - Number(b.day || 0)
      if (dayDiff) return dayDiff
      return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN')
    })
    const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1)
    const nextPage = Math.min(Math.max(Number(options.page || this.data.listPage || 1), 1), totalPages)
    const start = (nextPage - 1) * pageSize
    const currentItems = filtered.slice(start, start + pageSize).map(item => {
      const movableIndex = movableIndexById.has(item.contentId) ? movableIndexById.get(item.contentId) : -1
      return {
        ...item,
        canMoveUp: movableIndex > 0,
        canMoveDown: movableIndex >= 0 && movableIndex < movableItems.length - 1
      }
    })
    const summaryStart = filtered.length ? start + 1 : 0
    const summaryEnd = start + currentItems.length
    this.setData({
      filteredItems: filtered,
      currentItems,
      listSearch: keyword,
      listStatusFilter: statusFilter,
      listSortMode: sortMode,
      listPage: nextPage,
      listTotalPages: totalPages,
      listSummary: `共 ${filtered.length} 条 · ${summaryStart}-${summaryEnd}`,
      statusFilterIndex: this.getStatusFilterIndex(statusFilter),
      sortIndex: this.getSortIndex(sortMode),
      listStatusLabel: STATUS_FILTER_OPTIONS[this.getStatusFilterIndex(statusFilter)].label,
      listSortLabel: SORT_OPTIONS[this.getSortIndex(sortMode)].label
    })
  },

  handleListSearchInput(e) {
    this.refreshListView({ search: e.detail.value, page: 1 })
  },

  clearListSearch() {
    this.refreshListView({ search: '', page: 1 })
  },

  handleModuleFilterChange(e) {
    const index = Number(e.detail.value || 0)
    const option = CONFIG_CATEGORIES[index]
    if (!option) return
    this.setData({ moduleFilterIndex: index })
    this.loadCategory(option.category)
  },

  handleStatusFilterChange(e) {
    const index = Number(e.detail.value || 0)
    const option = STATUS_FILTER_OPTIONS[index] || STATUS_FILTER_OPTIONS[0]
    this.refreshListView({ statusFilter: option.value, page: 1 })
  },

  handleSortChange(e) {
    const index = Number(e.detail.value || 0)
    const option = SORT_OPTIONS[index] || SORT_OPTIONS[0]
    this.refreshListView({ sortMode: option.value, page: 1 })
  },

  goPrevPage() {
    this.refreshListView({ page: Number(this.data.listPage || 1) - 1 })
  },

  goNextPage() {
    this.refreshListView({ page: Number(this.data.listPage || 1) + 1 })
  },

  async reloadCurrentCategory() {
    const category = this.data.currentCategory && this.data.currentCategory.category
    if (!category) return
    const page = Number(this.data.listPage || 1)
    const scrollTop = Number(this._listScrollTop || 0)
    await this.loadCategory(category)
    this.refreshListView({ page })
    if (typeof wx.pageScrollTo === 'function') {
      wx.pageScrollTo({ scrollTop, duration: 0 })
    }
  },

  backHome() {
    this.setData({
      mode: 'home',
      currentCategory: null,
      allItems: [],
      filteredItems: [],
      currentItems: [],
      listSearch: '',
      listStatusFilter: 'active',
      listSortMode: 'custom',
      listStatusLabel: STATUS_FILTER_OPTIONS[0].label,
      listSortLabel: SORT_OPTIONS[0].label,
      listPage: 1,
      listTotalPages: 1,
      listSummary: '',
      editItem: null,
      editTitle: '',
      editAuthor: '',
      editArticleCategory: '',
      editCover: '',
      editSourceFileID: '',
      editSortOrder: '',
      editContent: '',
      editRichContentHtml: '',
      editRichContentVersion: 0,
      editMembershipLevel: 'free',
      isCreatingContent: false,
      listError: '',
      editorCtx: null,
      editorReady: false,
      editorPreviewMode: false,
      editorDirty: false,
      editorFormats: {},
      previewSegments: []
    })
  },

  addContent() {
    const config = this.data.currentCategory
    if (!config) return
    const day = getNextDay(this.data.allItems)
    const sortOrder = getNextSortOrder(this.data.allItems)

    this.setData({
      mode: 'edit',
      editItem: {
        // 新内容的永久 ID 由云端生成，客户端不制造第二套身份规则。
        contentId: '',
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
        status: 'published',
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
      editSortOrder: String(sortOrder),
      editContent: '',
      editRichContentHtml: '',
      editRichContentVersion: 0,
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
      saving: false,
      editorCtx: null,
      editorReady: false,
      editorPreviewMode: false,
      editorDirty: false,
      editorFormats: {},
      previewSegments: []
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
      editSortOrder: String(item.sortOrder || item.day || ''),
      editContent: item.content || item.material || '',
      editRichContentHtml: item.richContentHtml || '',
      editRichContentVersion: item.richContentVersion || 0,
      editMembershipLevel: normalizeMembershipLevel(item.membershipLevel),
      editContentStyle: normalizeContentStyle(item.contentStyle),
      editContentRichStyle: normalizeContentRichStyle(item.contentRichStyle, String(item.content || '').length),
      richStart: '',
      richEnd: '',
      richFontSize: DEFAULT_CONTENT_STYLE.fontSize,
      richColor: DEFAULT_CONTENT_STYLE.color,
      richBold: false,
      richPreviewSegments: buildRichPreviewSegments(item.content || '', item.contentStyle, item.contentRichStyle),
      isCreatingContent: false,
      saving: false,
      editorCtx: null,
      editorReady: false,
      editorPreviewMode: false,
      editorDirty: false,
      editorFormats: {},
      previewSegments: []
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

  handleSortOrderInput(e) {
    this.setData({ editSortOrder: e.detail.value })
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
      editSortOrder: '',
      editContent: '',
      editRichContentHtml: '',
      editRichContentVersion: 0,
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
      saving: false,
      editorCtx: null,
      editorReady: false,
      editorPreviewMode: false,
      editorDirty: false,
      editorFormats: {},
      previewSegments: []
    })
  },

  buildTrainingSavePayload(item, overrides = {}) {
    const source = item || {}
    const content = trimText(overrides.content !== undefined ? overrides.content : source.content)
    const contentStyle = normalizeContentStyle(overrides.contentStyle || source.contentStyle)
    const contentRichStyle = normalizeContentRichStyle(overrides.contentRichStyle || source.contentRichStyle, content.length)
    return {
      contentId: PERMANENT_CONTENT_ID_RE.test(trimText(source.contentId))
        ? trimText(source.contentId)
        : '',
      category: source.category,
      categoryName: source.categoryName,
      day: overrides.day !== undefined ? overrides.day : source.day,
      sortOrder: Number(overrides.sortOrder !== undefined ? overrides.sortOrder : (source.sortOrder || source.day || 0)) || 0,
      title: trimText(overrides.title !== undefined ? overrides.title : source.title),
      author: trimText(overrides.author !== undefined ? overrides.author : source.author),
      articleCategory: trimText(overrides.articleCategory !== undefined ? overrides.articleCategory : source.articleCategory),
      cover: trimText(overrides.cover !== undefined ? overrides.cover : source.cover),
      sourceFileID: trimText(overrides.sourceFileID !== undefined ? overrides.sourceFileID : source.sourceFileID),
      content,
      contentStyle,
      contentRichStyle,
      richContentHtml: trimText(overrides.richContentHtml !== undefined ? overrides.richContentHtml : source.richContentHtml),
      richContentVersion: Number(overrides.richContentVersion !== undefined ? overrides.richContentVersion : source.richContentVersion) || 0,
      isCustom: source.isCustom === true,
      membershipLevel: normalizeMembershipLevel(overrides.membershipLevel !== undefined ? overrides.membershipLevel : source.membershipLevel),
      status: trimText(overrides.status !== undefined ? overrides.status : source.status) || 'published',
      expectedVersion: getExpectedVersion(source)
    }
  },

  mergeServerContentIntoList(savedContent) {
    if (!savedContent || !savedContent.contentId) return
    const config = getCategoryConfig(savedContent.category) || this.data.currentCategory
    const normalized = normalizeCloudItem(savedContent, config)
    const nextItems = (this.data.allItems || []).filter(item => item.contentId !== normalized.contentId)
    if (normalized.status !== 'deleted') nextItems.push(normalized)
    this.setData({ allItems: nextItems })
    this.refreshListView()
  },

  assertSaveResult(result, expected) {
    const saved = result && (result.content || result.data)
    if (!saved) throw new Error('服务端未返回保存后的内容，请刷新确认')
    if (!PERMANENT_CONTENT_ID_RE.test(trimText(saved.contentId))) {
      throw new Error('服务端未返回有效的永久内容 ID，请刷新后重试')
    }
    const savedTitle = trimText(saved.title)
    const savedContent = trimText(saved.content)
    const verification = result.verification || {}
    if (
      savedTitle !== trimText(expected.title) ||
      savedContent !== trimText(expected.content) ||
      verification.matched === false
    ) {
      const titleSaved = savedTitle === trimText(expected.title)
      throw new Error(titleSaved ? '标题已更新，但正文保存失败，请重试' : '训练内容保存校验失败，请重试')
    }
    upsertCloudTrainingContent(saved)
    this.mergeServerContentIntoList(saved)
    return saved
  },

  async saveEdit() {
    if (this.data.saving) return
    const item = this.data.editItem
    const title = trimText(this.data.editTitle)
    const author = trimText(this.data.editAuthor)
    const articleCategory = trimText(this.data.editArticleCategory)
    const cover = trimText(this.data.editCover)
    const sourceFileID = trimText(this.data.editSourceFileID)
    // 已有内容只能通过列表的原子上移/下移调整顺序，避免单条保存产生重复序号。
    const sortOrder = this.data.isCreatingContent
      ? (Number(this.data.editSortOrder || (item && (item.sortOrder || item.day)) || 0) || 0)
      : (Number(item && (item.sortOrder || item.day)) || 0)
    const content = trimText(this.data.editContent)
    const richContentHtml = trimText(this.data.editRichContentHtml)
    const richContentVersion = richContentHtml ? (this.data.editRichContentVersion || 1) : 0
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
      const payload = this.buildTrainingSavePayload(item, {
        day: item.day,
        sortOrder,
        title,
        author,
        articleCategory,
        cover,
        sourceFileID,
        content,
        contentStyle,
        contentRichStyle,
        richContentHtml,
        richContentVersion,
        membershipLevel,
        status: 'published'
      })
      const result = await adminSaveTrainingContent(payload)
      this.assertSaveResult(result, payload)
      wx.showToast({ title: this.data.isCreatingContent ? '已添加' : '已保存', icon: 'success' })
      this.setData({ saving: false, mode: 'list', editItem: null, isCreatingContent: false })
      await this.reloadCurrentCategory()
    } catch (error) {
      wx.showToast({ title: getConflictMessage(error) || '保存失败', icon: 'none' })
      this.setData({ saving: false })
    }
  },

  async saveItemStatus(item, nextStatus) {
    const payload = this.buildTrainingSavePayload(item, { status: nextStatus })
    const result = await adminSaveTrainingContent(payload)
    this.assertSaveResult(result, payload)
  },

  async toggleContentStatus(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const item = this.data.currentItems[index]
    if (!item || this.data.saving) return

    const nextStatus = ['disabled', 'draft', 'archived', 'inactive'].includes(item.status) ? 'published' : 'disabled'
    try {
      this.setData({ saving: true })
      await this.saveItemStatus(item, nextStatus)
      wx.showToast({ title: nextStatus === 'published' ? '已发布' : '已下架', icon: 'success' })
      await this.reloadCurrentCategory()
    } catch (error) {
      wx.showToast({ title: getConflictMessage(error), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  archiveContent(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const item = this.data.currentItems[index]
    if (!item) return

    wx.showModal({
      title: '确认归档',
      content: '归档后学员端不再展示，可在已归档筛选中查看并重新发布。',
      confirmText: '归档',
      confirmColor: '#8a681f',
      cancelText: '取消',
      success: async res => {
        if (!res.confirm) return
        if (this.data.saving) return
        try {
          this.setData({ saving: true })
          const result = await adminDeleteTrainingContent({
            contentId: item.contentId,
            moduleId: item.category,
            category: item.category,
            expectedVersion: getExpectedVersion(item),
            operation: 'archive'
          })
          const saved = result && (result.content || result.data)
          if (!saved || saved.status !== 'archived') throw new Error('归档回读校验失败')
          this.mergeServerContentIntoList(saved)
          wx.showToast({ title: '已归档', icon: 'success' })
          await this.reloadCurrentCategory()
        } catch (error) {
          wx.showToast({ title: getConflictMessage(error), icon: 'none' })
        } finally {
          this.setData({ saving: false })
        }
      }
    })
  },

  deleteContent(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const item = this.data.currentItems[index]
    const category = this.data.currentCategory
    if (!item || !category) return

    wx.showModal({
      title: '确认删除素材',
      content: `《${item.displayTitle || item.title}》\n模块：${category.categoryName}\nDay ${item.day}\n\n删除后进入已删除状态，学员端不再展示；历史作品、录音、视频和 AI 点评不会删除。该操作不能在当前页面直接恢复。`,
      confirmText: '确认删除',
      confirmColor: '#d85b5b',
      cancelText: '取消',
      success: async res => {
        if (!res.confirm || this.data.saving) return
        this.setData({ saving: true })
        try {
          const result = await adminDeleteTrainingContent({
            contentId: item.contentId,
            moduleId: item.category,
            category: item.category,
            expectedVersion: getExpectedVersion(item),
            operation: 'delete'
          })
          const saved = result && (result.content || result.data)
          if (!saved || saved.status !== 'deleted') throw new Error('删除回读校验失败')
          this.mergeServerContentIntoList(saved)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.reloadCurrentCategory()
        } catch (error) {
          wx.showToast({ title: getConflictMessage(error), icon: 'none' })
        } finally {
          this.setData({ saving: false })
        }
      }
    })
  },

  async moveContent(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const direction = e.currentTarget.dataset.direction === 'down' ? 1 : -1
    const item = this.data.currentItems[index]
    if (!item || this.data.saving || this.data.listSortMode !== 'custom') {
      wx.showToast({ title: '请在自定义排序下调整', icon: 'none' })
      return
    }

    const ordered = (this.data.filteredItems || [])
      .filter(candidate => candidate.category === item.category && getStatusGroup(candidate.status) !== 'archived')
      .sort((a, b) => {
        const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
        if (sortDiff) return sortDiff
        return Number(a.day || 0) - Number(b.day || 0)
      })
    const currentIndex = ordered.findIndex(candidate => candidate.contentId === item.contentId)
    const target = ordered[currentIndex + direction]
    if (!target) {
      wx.showToast({ title: direction < 0 ? '已经在最前' : '已经在最后', icon: 'none' })
      return
    }

    const currentOrder = Number(item.sortOrder || item.day || 0) || 0
    const targetOrder = Number(target.sortOrder || target.day || 0) || 0
    try {
      this.setData({ saving: true })
      wx.showLoading({ title: '排序中' })
      const result = await adminReorderTrainingContents({
        category: item.category,
        items: [
          {
            contentId: item.contentId,
            expectedVersion: getExpectedVersion(item),
            sortOrder: targetOrder
          },
          {
            contentId: target.contentId,
            expectedVersion: getExpectedVersion(target),
            sortOrder: currentOrder
          }
        ]
      })
      ;(result.contents || []).forEach(saved => {
        upsertCloudTrainingContent(saved)
        this.mergeServerContentIntoList(saved)
      })
      wx.hideLoading()
      wx.showToast({ title: '排序已更新', icon: 'success' })
      await this.reloadCurrentCategory()
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: getConflictMessage(error), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  // ====== WYSIWYG 编辑器 ======

  onEditorReady() {
    const that = this
    wx.createSelectorQuery().in(this).select('#articleEditor').context(function (res) {
      if (res && res.context) {
        that.setData({ editorCtx: res.context, editorReady: true })
        // 加载已有内容到编辑器
        const content = that.data.editContent
        if (content) {
          res.context.setContents({
            html: that.data.editRichContentHtml || content.split('\n').map(l => `<p>${l || '<br>'}</p>`).join(''),
            success() { console.log('[editor] content loaded') }
          })
        }
      }
    }).exec()
  },

  onEditorInput(e) {
    const html = e.detail.html || ''
    const text = e.detail.text || ''
    this.setData({ editContent: text, editRichContentHtml: html, editorDirty: true })
  },

  onEditorStatusChange(e) {
    const formats = e.detail && e.detail.formats ? e.detail.formats : {}
    this.setData({ editorFormats: formats })
  },

  switchToEdit() { this.setData({ editorPreviewMode: false }) },
  switchToPreview() {
    this.buildEditorPreview()
    this.setData({ editorPreviewMode: true })
  },

  buildEditorPreview() {
    const segs = buildRichPreviewSegments(
      this.data.editContent, this.data.editContentStyle, this.data.editContentRichStyle
    )
    this.setData({ previewSegments: segs })
  },

  editorUndo() { if (this.data.editorCtx) this.data.editorCtx.undo() },
  editorRedo() { if (this.data.editorCtx) this.data.editorCtx.redo() },
  editorBold() {
    if (!this.data.editorCtx) return
    const v = !this.data.editorFormats.bold
    this.data.editorCtx.format('bold', v)
    this.setData({ 'editorFormats.bold': v })
  },
  editorItalic() {
    if (!this.data.editorCtx) return
    const v = !this.data.editorFormats.italic
    this.data.editorCtx.format('italic', v)
    this.setData({ 'editorFormats.italic': v })
  },
  editorUnderline() {
    if (!this.data.editorCtx) return
    const v = !this.data.editorFormats.underline
    this.data.editorCtx.format('underline', v)
    this.setData({ 'editorFormats.underline': v })
  },
  editorClearFormat() { if (this.data.editorCtx) this.data.editorCtx.clear() },
  editorFontSize(e) {
    if (!this.data.editorCtx) return
    const size = e.currentTarget.dataset.size
    const sizeMap = { small: '14px', normal: '16px', large: '20px', xlarge: '24px' }
    this.data.editorCtx.format('fontSize', sizeMap[size] || '16px')
    this.setData({ 'editorFormats.fontSize': size })
  },
  editorColor(e) {
    if (!this.data.editorCtx) return
    const color = e.currentTarget.dataset.color
    const colorMap = { default: '#1f2933', green: '#0f766e', red: '#b91c1c', blue: '#1d4ed8', gold: '#a16207' }
    this.data.editorCtx.format('color', colorMap[color] || '#1f2933')
    this.setData({ 'editorFormats.color': color })
  },
  editorAlign(e) {
    if (!this.data.editorCtx) return
    const align = e.currentTarget.dataset.align
    this.data.editorCtx.format('align', align)
    this.setData({ 'editorFormats.align': align })
  },

  // ====== 新用户报表 ======

  getTodayStr() {
    const d = new Date(); const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  },

  getMondayStr(dateStr) {
    const parts = dateStr.split('-').map(Number)
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    d.setDate(d.getDate() - ((d.getDay() || 7) - 1))
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  },

  openReport() {
    const today = this.getTodayStr()
    const monday = this.getMondayStr(today)
    this.setData({
      mode: 'report', reportType: 'daily', reportDate: today,
      reportWeekDate: today, reportWeekStart: monday,
      reportLoading: false, reportError: '', reportData: null,
      reportSearch: '', reportPhoneAuthRate: 0, filteredReportUsers: []
    })
    this.loadReport()
  },

  switchReportType(e) {
    this.setData({ reportType: e.currentTarget.dataset.type, reportError: '' })
    this.loadReport()
  },

  handleReportDateChange(e) {
    this.setData({ reportDate: e.detail.value })
    this.loadReport()
  },

  handleReportWeekDateChange(e) {
    const d = e.detail.value
    this.setData({ reportWeekDate: d, reportWeekStart: this.getMondayStr(d) })
    this.loadReport()
  },

  handleReportSearchInput(e) {
    const kw = (e.detail.value || '').trim().toLowerCase()
    const users = (this.data.reportData && this.data.reportData.users) || []
    this.setData({
      reportSearch: kw,
      filteredReportUsers: kw ? users.filter(u =>
        (u.nickname || '').toLowerCase().includes(kw) ||
        (u.phoneMasked || '').slice(-4).includes(kw)
      ) : users
    })
  },

  async loadReport() {
    this.setData({ reportLoading: true, reportError: '' })
    try {
      let result
      if (this.data.reportType === 'daily') {
        result = await adminGetDailyRegistrationReport({ date: this.data.reportDate })
      } else {
        result = await adminGetWeeklyRegistrationReport({ weekStart: this.data.reportWeekStart })
      }
      const users = result.users || []
      const rate = result.count > 0 ? Math.round((result.phoneAuthorized / result.count) * 1000) / 10 : 0
      this.setData({
        reportData: result, reportLoading: false,
        reportPhoneAuthRate: rate,
        filteredReportUsers: users
      })
    } catch (error) {
      this.setData({ reportLoading: false, reportError: error.message || '报表加载失败' })
    }
  },

  refreshReport() { this.loadReport() },

  async handleRegenerateReport() {
    const res = await new Promise(resolve => wx.showModal({
      title: '保存快照', content: '将当前报表保存为云端快照？', confirmText: '确认', cancelText: '取消', success: resolve
    }))
    if (!res.confirm) return
    wx.showLoading({ title: '保存中' })
    try {
      await adminRegenerateRegistrationReport({
        date: this.data.reportType === 'daily' ? this.data.reportDate : this.data.reportWeekStart,
        type: this.data.reportType
      })
      wx.hideLoading()
      wx.showToast({ title: '快照已保存', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
    }
  }
})
