const {
  getAdminProfile,
  adminUserOverview,
  adminListUsers,
  adminListPreRegistrationEntitlements,
  adminSavePreRegistrationEntitlement,
  adminRevokePreRegistrationEntitlement,
  adminGetUserDetail,
  adminUpdateUserMembership,
  adminRevenueOverview,
  adminExportUsersCsv,
  adminExportPreRegistrationCsv,
  adminGenerateOperationsPdf
} = require('../../utils/cloud-api')

const SECTION_OPTIONS = [
  { value: 'overview', label: '数据总览' },
  { value: 'users', label: '用户管理' },
  { value: 'members', label: '会员管理' },
  { value: 'preauth', label: '待注册授权' },
  { value: 'revenue', label: '收入分析' },
  { value: 'export', label: '数据导出' }
]

const USER_STATE_OPTIONS = [
  { value: 'all', label: '全部用户', countKey: 'all' },
  { value: 'ordinary', label: '普通用户', countKey: 'ordinary' },
  { value: 'active', label: '有效会员', countKey: 'active' },
  { value: 'expired', label: '已过期', countKey: 'expired' }
]

const MEMBERSHIP_OPTIONS = [
  { value: '', label: '全部套餐' },
  { value: 'free', label: '普通用户' },
  { value: 'monthly', label: '季度会员' },
  { value: 'yearly', label: '年度会员' }
]

const MANAGED_MEMBERSHIP_OPTIONS = [
  { value: 'monthly', label: '季度会员', durationDays: 90 },
  { value: 'yearly', label: '年度会员', durationDays: 365 }
]

const PREAUTH_PLAN_OPTIONS = [
  { value: 'monthly', label: '季度会员', membershipType: 'monthly', durationDays: 90 },
  { value: 'yearly', label: '年度会员', membershipType: 'yearly', durationDays: 365 }
]

const PREAUTH_STATUS_OPTIONS = [
  { value: 'pending', label: '待注册', countKey: 'pending' },
  { value: 'all', label: '全部', countKey: '' },
  { value: 'claimed', label: '已领取', countKey: 'claimed' },
  { value: 'revoked', label: '已撤销', countKey: 'revoked' },
  { value: 'expired', label: '已过期', countKey: 'expired' }
]

const PREAUTH_ACTIVATION_OPTIONS = [
  { value: 'on_claim', label: '注册后激活' },
  { value: 'fixed', label: '固定时间授权' }
]

const SORT_OPTIONS = [
  { value: 'latest_registration', label: '最新注册' },
  { value: 'oldest_registration', label: '最早注册' },
  { value: 'expiry_soon', label: '最近到期' },
  { value: 'expiry_latest', label: '最晚到期' }
]

const REVENUE_RANGE_OPTIONS = [
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
  { value: 'year', label: '今年' }
]

const HISTORY_OPTIONS = [
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' },
  { value: 'year', label: '按年' }
]

function pad(value) {
  return String(value).padStart(2, '0')
}

function createAdminOperationId(prefix) {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(dateText, days) {
  const parts = String(dateText || '').split('-').map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  date.setDate(date.getDate() + Number(days || 0))
  return formatDate(date)
}

function money(fen) {
  if (fen == null || fen === '') return '—'
  return `¥${(Number(fen || 0) / 100).toFixed(2)}`
}

function formatDateTime(value, fallback = '历史数据未记录') {
  const text = String(value || '').trim()
  if (!text) return fallback
  const date = new Date(text.replace(' ', 'T').replace(/(T\d{2}:\d{2}:\d{2})$/, '$1+08:00'))
  if (!Number.isFinite(date.getTime())) return text
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function buildUserView(item = {}) {
  const isMember = ['active', 'scheduled', 'expired'].includes(item.customerState)
  return {
    ...item,
    displayPhone: item.phone || '未绑定手机号',
    registeredAtLabel: formatDateTime(item.registeredAt, '历史数据未记录'),
    lastActiveAtLabel: formatDateTime(item.lastActiveAt, '历史数据未记录'),
    purchaseTimeLabel: item.purchaseTimeLabel || '历史数据未记录',
    membershipStartAtLabel: item.membershipStartAt || '历史数据未记录',
    membershipEndAtLabel: item.membershipEndAt || '—',
    amountLabel: item.paidAmountFen == null ? '—' : money(item.paidAmountFen),
    stateClass: item.customerState === 'active'
      ? 'tag-active'
      : (item.customerState === 'scheduled'
          ? 'tag-pending'
          : (item.customerState === 'expired' ? 'tag-expired' : 'tag-ordinary')),
    isMember,
    actionLabel: isMember ? '编辑会员' : '添加会员'
  }
}

function buildPreauthView(item = {}) {
  return {
    ...item,
    createdAtLabel: formatDateTime(item.createdAt, '—'),
    claimedAtLabel: formatDateTime(item.claimedAt, '—'),
    dateRangeLabel: item.activationMode === 'fixed'
      ? `${item.membershipStartAt || '—'} 至 ${item.membershipEndAt || '—'}`
      : `领取后 ${item.durationDays || 0} 天`,
    stateClass: item.status === 'pending'
      ? 'tag-pending'
      : (item.status === 'claimed'
          ? 'tag-active'
          : (item.status === 'expired' ? 'tag-expired' : 'tag-revoked'))
  }
}

function buildMetric(label, value, tone = '') {
  return { label, value, tone }
}

function buildOverviewView(result = {}) {
  const counts = result.counts || {}
  const revenue = result.revenue || {}
  return {
    ...result,
    userMetrics: [
      buildMetric('总用户', counts.all || 0),
      buildMetric('有效会员', counts.active || 0, 'green'),
      buildMetric('普通用户', counts.ordinary || 0),
      buildMetric('待注册授权', counts.pendingPreauthorizations || 0, 'violet'),
      buildMetric('付费转化率', `${(Number(counts.paidConversionRate || 0) * 100).toFixed(1)}%`, 'blue')
    ],
    growthMetrics: [
      buildMetric('今日新增用户', counts.todayNewUsers || 0),
      buildMetric('今日新增会员', counts.todayNewMembers || 0, 'green'),
      buildMetric('7日新增会员', counts.sevenDayNewMembers || 0),
      buildMetric('30日新增会员', counts.thirtyDayNewMembers || 0)
    ],
    expiryMetrics: [
      { ...buildMetric('7天内到期', counts.expiring7 || 0, 'amber'), state: 'expiring7' },
      { ...buildMetric('30天内到期', counts.expiring30 || 0, 'amber'), state: 'expiring30' },
      { ...buildMetric('已过期', counts.expired || 0, 'red'), state: 'expired' }
    ],
    revenueMetrics: [
      buildMetric('今日收入', money(revenue.today && revenue.today.confirmedFen), 'green'),
      buildMetric('本周收入', money(revenue.week && revenue.week.confirmedFen), 'green'),
      buildMetric('本月收入', money(revenue.month && revenue.month.confirmedFen), 'blue'),
      buildMetric('今年收入', money(revenue.year && revenue.year.confirmedFen), 'blue')
    ]
  }
}

function withChartBars(items = [], valueKey, formatter) {
  const max = Math.max(1, ...items.map(item => Number(item[valueKey] || 0)))
  const labelStep = Math.max(1, Math.ceil(items.length / 7))
  return items.map((item, index) => ({
    ...item,
    value: Number(item[valueKey] || 0),
    valueLabel: formatter(Number(item[valueKey] || 0)),
    barHeight: Number(item[valueKey] || 0) > 0
      ? Math.max(6, Math.round(Number(item[valueKey] || 0) / max * 150))
      : 2,
    shortLabel: String(item.label || '').slice(5),
    showLabel: index % labelStep === 0 || index === items.length - 1
  }))
}

function buildRevenueView(result = {}, historyType = 'month') {
  const metrics = result.metrics || {}
  const paymentMetrics = result.paymentMetrics || {}
  const manualMetrics = result.manualMetrics || {}
  const history = result.history || {}
  return {
    ...result,
    metricCards: [
      buildMetric('今日收入', money(metrics.today && metrics.today.confirmedFen), 'green'),
      buildMetric('本周收入', money(metrics.week && metrics.week.confirmedFen), 'green'),
      buildMetric('本月收入', money(metrics.month && metrics.month.confirmedFen), 'blue'),
      buildMetric('今年收入', money(metrics.year && metrics.year.confirmedFen), 'blue'),
      buildMetric('累计支付收入', money(paymentMetrics.all && paymentMetrics.all.confirmedFen), 'green'),
      buildMetric('累计人工会员', money(manualMetrics.all && manualMetrics.all.confirmedFen), 'violet')
    ],
    trendBars: withChartBars(result.trend || [], 'confirmedFen', money),
    packagesView: (result.packages || []).map(item => ({
      ...item,
      amountLabel: money(item.confirmedFen),
      shareLabel: `${(Number(item.share || 0) * 100).toFixed(1)}%`
    })),
    revenueDetailsView: (result.revenueDetails || []).map(item => ({
      ...item,
      amountLabel: money(item.amountFen)
    })),
    historyRows: (history[historyType] || []).map(item => ({
      ...item,
      amountLabel: money(item.confirmedFen)
    }))
  }
}

Page({
  data: {
    isAdmin: false,
    checkingAdmin: true,
    sections: SECTION_OPTIONS,
    activeSection: 'overview',
    userStateOptions: USER_STATE_OPTIONS.map(item => ({ ...item, count: 0 })),
    membershipOptions: MEMBERSHIP_OPTIONS,
    membershipIndex: 0,
    sortOptions: SORT_OPTIONS,
    sortIndex: 0,
    managedMembershipOptions: MANAGED_MEMBERSHIP_OPTIONS,
    overviewLoading: false,
    overview: buildOverviewView(),
    usersLoading: false,
    users: [],
    userState: 'all',
    keyword: '',
    appliedKeyword: '',
    registeredStartDate: '',
    registeredEndDate: '',
    expiryStartDate: '',
    expiryEndDate: '',
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
    preauthLoading: false,
    preauthList: [],
    preauthStatusOptions: PREAUTH_STATUS_OPTIONS.map(item => ({ ...item, count: 0 })),
    preauthStatusIndex: 0,
    preauthMembershipOptions: MEMBERSHIP_OPTIONS.filter(item => item.value !== 'free'),
    preauthMembershipIndex: 0,
    preauthKeyword: '',
    preauthAppliedKeyword: '',
    preauthCreatedStartDate: '',
    preauthCreatedEndDate: '',
    preauthPage: 1,
    preauthPageSize: 20,
    preauthTotal: 0,
    preauthTotalPages: 1,
    showPreauthFilters: false,
    showPreauthEditor: false,
    savingPreauth: false,
    preauthEditorTitle: '添加未注册学员',
    preauthPlanOptions: PREAUTH_PLAN_OPTIONS,
    preauthPlanIndex: 0,
    preauthActivationOptions: PREAUTH_ACTIVATION_OPTIONS,
    preauthActivationIndex: 0,
    preauthEditor: {
      id: '',
      phone: '',
      membershipType: 'monthly',
      durationDays: 90,
      activationMode: 'on_claim',
      startDate: '',
      endDate: '',
      note: '',
      operationId: ''
    },
    showFilters: false,
    showDetail: false,
    detailLoading: false,
    currentUser: null,
    membershipHistory: [],
    showMembershipEditor: false,
    savingMembership: false,
    membershipEditorTitle: '添加会员',
    membershipEditor: {
      userId: '',
      membershipAction: 'add',
      membershipType: 'monthly',
      startDate: '',
      endDate: '',
      reason: '',
      operationId: ''
    },
    managedMembershipIndex: 0,
    revenueLoading: false,
    revenueRangeOptions: REVENUE_RANGE_OPTIONS,
    revenueRangeIndex: 1,
    historyOptions: HISTORY_OPTIONS,
    historyIndex: 1,
    revenue: buildRevenueView(),
    exportingCsv: false,
    exportingPreauthCsv: false,
    exportingPdf: false,
    exportStartDate: '',
    exportEndDate: '',
    selectedUserStateLabel: USER_STATE_OPTIONS[0].label
  },

  onShow() {
    this.verifyAdmin()
  },

  async verifyAdmin() {
    this.setData({ checkingAdmin: true })
    try {
      const profile = await getAdminProfile()
      const isAdmin = profile.isAdmin === true && ['super_admin', 'admin'].includes(profile.role)
      this.setData({ isAdmin, checkingAdmin: false })
      if (!isAdmin) {
        wx.showToast({ title: '当前账号没有管理员权限', icon: 'none' })
        return
      }
      await Promise.all([this.loadOverview(), this.loadUsers(true)])
    } catch (error) {
      this.setData({ isAdmin: false, checkingAdmin: false })
      wx.showToast({ title: error.message || '管理员身份读取失败', icon: 'none' })
    }
  },

  switchSection(e) {
    const section = e.currentTarget.dataset.section
    if (!section || section === this.data.activeSection) return
    const patch = { activeSection: section }
    if (section === 'members' && !['active', 'expired'].includes(this.data.userState)) {
      patch.userState = 'active'
      patch.selectedUserStateLabel = '有效会员'
      patch.page = 1
    }
    if (section === 'users' && !['all', 'ordinary'].includes(this.data.userState)) {
      patch.userState = 'all'
      patch.selectedUserStateLabel = '全部用户'
      patch.page = 1
    }
    this.setData(patch, () => {
      if (section === 'overview') this.loadOverview()
      if (section === 'users' || section === 'members') this.loadUsers(true)
      if (section === 'preauth') this.loadPreauthorizations(true)
      if (section === 'revenue') this.loadRevenue()
    })
  },

  async loadOverview() {
    if (this.data.overviewLoading) return
    this.setData({ overviewLoading: true })
    try {
      const result = await adminUserOverview({ trendDays: 30 })
      const counts = result.counts || {}
      this.setData({
        overview: buildOverviewView(result),
        userStateOptions: USER_STATE_OPTIONS.map(item => ({
          ...item,
          count: Number(counts[item.countKey] || 0)
        }))
      })
    } catch (error) {
      wx.showToast({ title: error.message || '数据总览读取失败', icon: 'none' })
    } finally {
      this.setData({ overviewLoading: false })
    }
  },

  getListFilters(page = this.data.page) {
    return {
      page,
      pageSize: this.data.pageSize,
      membershipState: this.data.userState,
      keyword: this.data.appliedKeyword,
      membershipType: MEMBERSHIP_OPTIONS[this.data.membershipIndex].value,
      sortBy: SORT_OPTIONS[this.data.sortIndex].value,
      registeredStartDate: this.data.registeredStartDate,
      registeredEndDate: this.data.registeredEndDate,
      expiryStartDate: this.data.expiryStartDate,
      expiryEndDate: this.data.expiryEndDate
    }
  },

  async loadUsers(reset = false) {
    if (this.data.usersLoading) return
    const page = reset ? 1 : this.data.page
    this.setData({ usersLoading: true, page })
    try {
      const result = await adminListUsers(this.getListFilters(page))
      this.setData({
        users: (result.list || []).map(buildUserView),
        total: result.total || 0,
        page: result.page || page,
        pageSize: result.pageSize || this.data.pageSize,
        totalPages: result.totalPages || 1
      })
    } catch (error) {
      wx.showToast({ title: error.message || '用户列表读取失败', icon: 'none' })
    } finally {
      this.setData({ usersLoading: false })
    }
  },

  getPreauthFilters(page = this.data.preauthPage) {
    return {
      page,
      pageSize: this.data.preauthPageSize,
      status: PREAUTH_STATUS_OPTIONS[this.data.preauthStatusIndex].value,
      membershipType: this.data.preauthMembershipOptions[this.data.preauthMembershipIndex].value,
      keyword: this.data.preauthAppliedKeyword,
      createdStartDate: this.data.preauthCreatedStartDate,
      createdEndDate: this.data.preauthCreatedEndDate
    }
  },

  async loadPreauthorizations(reset = false) {
    if (this.data.preauthLoading) return
    const page = reset ? 1 : this.data.preauthPage
    this.setData({ preauthLoading: true, preauthPage: page })
    try {
      const result = await adminListPreRegistrationEntitlements(this.getPreauthFilters(page))
      const counts = result.counts || {}
      this.setData({
        preauthList: (result.list || []).map(buildPreauthView),
        preauthTotal: Number(result.total || 0),
        preauthPage: Number(result.page || page),
        preauthPageSize: Number(result.pageSize || this.data.preauthPageSize),
        preauthTotalPages: Number(result.totalPages || 1),
        preauthStatusOptions: PREAUTH_STATUS_OPTIONS.map(item => ({
          ...item,
          count: item.value === 'all'
            ? Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
            : Number(counts[item.countKey] || 0)
        }))
      })
    } catch (error) {
      wx.showToast({ title: error.message || '待注册授权读取失败', icon: 'none' })
    } finally {
      this.setData({ preauthLoading: false })
    }
  },

  switchPreauthStatus(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    if (index === this.data.preauthStatusIndex) return
    this.setData({ preauthStatusIndex: index, preauthPage: 1 }, () => this.loadPreauthorizations(true))
  },

  onPreauthKeywordInput(e) {
    this.setData({ preauthKeyword: e.detail.value })
  },

  searchPreauthorizations() {
    this.setData({
      preauthAppliedKeyword: String(this.data.preauthKeyword || '').trim(),
      preauthPage: 1
    }, () => this.loadPreauthorizations(true))
  },

  clearPreauthSearch() {
    this.setData({ preauthKeyword: '', preauthAppliedKeyword: '', preauthPage: 1 }, () => {
      this.loadPreauthorizations(true)
    })
  },

  togglePreauthFilters() {
    this.setData({ showPreauthFilters: !this.data.showPreauthFilters })
  },

  onPreauthMembershipFilterChange(e) {
    this.setData({ preauthMembershipIndex: Number(e.detail.value || 0), preauthPage: 1 })
  },

  onPreauthFilterDateChange(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value, preauthPage: 1 })
  },

  applyPreauthFilters() {
    this.setData({ showPreauthFilters: false }, () => this.loadPreauthorizations(true))
  },

  resetPreauthFilters() {
    this.setData({
      preauthMembershipIndex: 0,
      preauthCreatedStartDate: '',
      preauthCreatedEndDate: '',
      showPreauthFilters: false,
      preauthPage: 1
    }, () => this.loadPreauthorizations(true))
  },

  previousPreauthPage() {
    if (this.data.preauthPage <= 1 || this.data.preauthLoading) return
    this.setData({ preauthPage: this.data.preauthPage - 1 }, () => this.loadPreauthorizations())
  },

  nextPreauthPage() {
    if (this.data.preauthPage >= this.data.preauthTotalPages || this.data.preauthLoading) return
    this.setData({ preauthPage: this.data.preauthPage + 1 }, () => this.loadPreauthorizations())
  },

  openPreauthEditor(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id
    const current = id ? this.data.preauthList.find(item => item.id === id) : null
    if (current && !current.canEdit) {
      wx.showToast({ title: '只有待注册授权可以编辑', icon: 'none' })
      return
    }
    const today = formatDate(new Date())
    const membershipType = current && current.membershipType || 'monthly'
    const defaultDuration = membershipType === 'yearly' ? 365 : 90
    const durationDays = defaultDuration
    const planIndex = Math.max(0, PREAUTH_PLAN_OPTIONS.findIndex(item => item.value === membershipType))
    const activationMode = current && current.activationMode || 'on_claim'
    this.setData({
      showPreauthEditor: true,
      preauthEditorTitle: current ? '编辑待注册授权' : '添加未注册学员',
      preauthPlanIndex: planIndex,
      preauthActivationIndex: activationMode === 'fixed' ? 1 : 0,
      preauthEditor: {
        id: current && current.id || '',
        phone: current && current.phone || '',
        membershipType,
        durationDays,
        activationMode,
        startDate: current && current.membershipStartAt || today,
        endDate: current && current.membershipEndAt || addDays(today, durationDays),
        note: current && current.note || '',
        operationId: current ? '' : createAdminOperationId('preauth-grant')
      }
    })
  },

  closePreauthEditor() {
    if (!this.data.savingPreauth) this.setData({ showPreauthEditor: false })
  },

  onPreauthPhoneInput(e) {
    if (this.data.preauthEditor.id) return
    this.setData({ 'preauthEditor.phone': e.detail.value })
  },

  onPreauthPlanChange(e) {
    const index = Number(e.detail.value || 0)
    const option = PREAUTH_PLAN_OPTIONS[index]
    const patch = {
      preauthPlanIndex: index,
      'preauthEditor.membershipType': option.membershipType,
      'preauthEditor.durationDays': option.durationDays
    }
    if (this.data.preauthEditor.activationMode === 'fixed') {
      patch['preauthEditor.endDate'] = addDays(this.data.preauthEditor.startDate, option.durationDays)
    }
    this.setData(patch)
  },

  onPreauthActivationChange(e) {
    const index = Number(e.detail.value || 0)
    const activationMode = PREAUTH_ACTIVATION_OPTIONS[index].value
    const patch = {
      preauthActivationIndex: index,
      'preauthEditor.activationMode': activationMode
    }
    if (activationMode === 'fixed') {
      const startDate = this.data.preauthEditor.startDate || formatDate(new Date())
      patch['preauthEditor.startDate'] = startDate
      patch['preauthEditor.endDate'] = this.data.preauthEditor.endDate || addDays(startDate, this.data.preauthEditor.durationDays)
    }
    this.setData(patch)
  },

  onPreauthDateChange(e) {
    const field = e.currentTarget.dataset.field
    const patch = { [`preauthEditor.${field}`]: e.detail.value }
    if (field === 'startDate') {
      patch['preauthEditor.endDate'] = addDays(e.detail.value, this.data.preauthEditor.durationDays)
    }
    this.setData(patch)
  },

  onPreauthNoteInput(e) {
    this.setData({ 'preauthEditor.note': e.detail.value })
  },

  async savePreauthorization() {
    if (this.data.savingPreauth) return
    const form = { ...this.data.preauthEditor }
    const phone = String(form.phone || '').replace(/\D/g, '')
    const plan = PREAUTH_PLAN_OPTIONS[this.data.preauthPlanIndex] || PREAUTH_PLAN_OPTIONS[0]
    const membershipType = plan.membershipType
    const durationDays = plan.durationDays
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入有效手机号', icon: 'none' })
      return
    }
    if (form.activationMode === 'fixed' && (!form.startDate || !form.endDate || form.endDate <= form.startDate)) {
      wx.showToast({ title: '固定到期日期必须晚于生效日期', icon: 'none' })
      return
    }
    this.setData({ savingPreauth: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      const result = await adminSavePreRegistrationEntitlement({
        ...form,
        phone,
        membershipType,
        durationDays
      })
      this.setData({ showPreauthEditor: false })
      await Promise.all([this.loadOverview(), this.loadPreauthorizations(true)])
      const toastTitle = result.reconciled
        ? '已匹配注册用户并领取'
        : (result.reconciliationPending ? '已保存，等待自动领取' : '预授权已保存')
      wx.showToast({ title: toastTitle, icon: 'none' })
    } catch (error) {
      if (error.code === 'PHONE_ALREADY_REGISTERED' && error.result && error.result.registeredUser) {
        const registeredUser = error.result.registeredUser
        wx.showModal({
          title: '该手机号已经注册',
          content: '请直接进入现有用户的会员管理，不创建待注册授权。',
          confirmText: '查看用户',
          success: modal => {
            if (!modal.confirm) return
            this.setData({ showPreauthEditor: false, activeSection: 'users' }, () => {
              this.openUserDetail({ currentTarget: { dataset: { userId: registeredUser.userId } } })
            })
          }
        })
      } else if (error.code === 'PREAUTH_ALREADY_EXISTS') {
        const entitlementId = error.result && error.result.entitlementId || ''
        await new Promise(resolve => this.setData({
          showPreauthEditor: false,
          preauthKeyword: phone,
          preauthAppliedKeyword: phone,
          preauthStatusIndex: 0
        }, resolve))
        await this.loadPreauthorizations(true)
        const existing = this.data.preauthList.find(item => item.id === entitlementId) ||
          this.data.preauthList.find(item => item.phone === phone)
        if (existing && existing.canEdit) {
          this.openPreauthEditor({ currentTarget: { dataset: { id: existing.id } } })
          wx.showToast({ title: '已打开现有预授权', icon: 'none' })
        } else {
          wx.showToast({ title: '已定位现有预授权', icon: 'none' })
        }
      } else {
        wx.showToast({ title: error.message || '预授权保存失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ savingPreauth: false })
    }
  },

  revokePreauthorization(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.preauthList.find(record => record.id === id)
    if (!item || !item.canRevoke) return
    wx.showModal({
      title: '撤销待注册授权？',
      content: '撤销后，该手机号未来注册时不会自动领取此会员。',
      editable: true,
      placeholderText: '请输入撤销原因',
      confirmText: '确认撤销',
      confirmColor: '#d85b5b',
      success: async modal => {
        if (!modal.confirm) return
        const reason = String(modal.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写撤销原因', icon: 'none' })
          return
        }
        wx.showLoading({ title: '正在撤销', mask: true })
        try {
          await adminRevokePreRegistrationEntitlement({ id, reason })
          await Promise.all([this.loadOverview(), this.loadPreauthorizations(true)])
          wx.showToast({ title: '已撤销', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '撤销失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  switchUserState(e) {
    const state = e.currentTarget.dataset.state
    if (!state || state === this.data.userState) return
    const option = USER_STATE_OPTIONS.find(item => item.value === state)
    this.setData({
      userState: state,
      selectedUserStateLabel: option ? option.label : '全部用户',
      page: 1
    }, () => this.loadUsers(true))
  },

  openExpiryFilter(e) {
    const state = e.currentTarget.dataset.state
    if (!state) return
    const labels = {
      expiring7: '7天内到期',
      expiring30: '30天内到期',
      expired: '已过期'
    }
    this.setData({
      activeSection: 'members',
      userState: state,
      selectedUserStateLabel: labels[state] || '会员用户',
      page: 1
    }, () => this.loadUsers(true))
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  searchUsers() {
    this.setData({ appliedKeyword: String(this.data.keyword || '').trim(), page: 1 }, () => this.loadUsers(true))
  },

  clearSearch() {
    this.setData({ keyword: '', appliedKeyword: '', page: 1 }, () => this.loadUsers(true))
  },

  toggleFilters() {
    this.setData({ showFilters: !this.data.showFilters })
  },

  onMembershipFilterChange(e) {
    this.setData({ membershipIndex: Number(e.detail.value || 0), page: 1 }, () => this.loadUsers(true))
  },

  onSortChange(e) {
    this.setData({ sortIndex: Number(e.detail.value || 0), page: 1 }, () => this.loadUsers(true))
  },

  onFilterDateChange(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value, page: 1 })
  },

  applyFilters() {
    this.setData({ showFilters: false }, () => this.loadUsers(true))
  },

  resetFilters() {
    this.setData({
      membershipIndex: 0,
      sortIndex: 0,
      registeredStartDate: '',
      registeredEndDate: '',
      expiryStartDate: '',
      expiryEndDate: '',
      page: 1,
      showFilters: false
    }, () => this.loadUsers(true))
  },

  previousPage() {
    if (this.data.page <= 1 || this.data.usersLoading) return
    this.setData({ page: this.data.page - 1 }, () => this.loadUsers())
  },

  nextPage() {
    if (this.data.page >= this.data.totalPages || this.data.usersLoading) return
    this.setData({ page: this.data.page + 1 }, () => this.loadUsers())
  },

  copyPhone(e) {
    const phone = String(e.currentTarget.dataset.phone || '')
    if (!phone) return
    wx.setClipboardData({ data: phone })
  },

  async openUserDetail(e) {
    const userId = e.currentTarget.dataset.userId
    if (!userId) return
    this.setData({ showDetail: true, detailLoading: true, currentUser: null, membershipHistory: [] })
    try {
      const result = await adminGetUserDetail(userId)
      this.setData({
        currentUser: buildUserView(result.user || {}),
        membershipHistory: (result.history || []).map((item, index) => ({
          ...item,
          historyKey: `${item.kind || 'history'}-${item.orderNo || item.happenedAt || index}-${index}`,
          amountLabel: item.amountFen == null ? '—' : money(item.amountFen),
          endAtLabel: item.endAt || '—'
        }))
      })
    } catch (error) {
      this.setData({ showDetail: false })
      wx.showToast({ title: error.message || '用户详情读取失败', icon: 'none' })
    } finally {
      this.setData({ detailLoading: false })
    }
  },

  closeDetail() {
    if (!this.data.savingMembership) this.setData({ showDetail: false })
  },

  openMembershipEditor(e) {
    const userId = e && e.currentTarget && e.currentTarget.dataset.userId
    const current = userId
      ? this.data.users.find(item => item.userId === userId)
      : this.data.currentUser
    if (!current || !current.canManageMembership) {
      wx.showToast({ title: '该用户身份不能在这里修改', icon: 'none' })
      return
    }
    const isExistingMember = ['active', 'expired'].includes(current.customerState)
    const type = ['monthly', 'yearly'].includes(current.membershipType) ? current.membershipType : 'monthly'
    const index = MANAGED_MEMBERSHIP_OPTIONS.findIndex(item => item.value === type)
    const today = formatDate(new Date())
    const duration = MANAGED_MEMBERSHIP_OPTIONS[index < 0 ? 0 : index].durationDays
    this.setData({
      showMembershipEditor: true,
      membershipEditorTitle: isExistingMember ? '编辑会员' : '添加会员',
      managedMembershipIndex: index < 0 ? 0 : index,
      membershipEditor: {
        userId: current.userId,
        membershipAction: current.customerState === 'expired' ? 'restore' : (isExistingMember ? 'update' : 'add'),
        membershipType: type,
        startDate: current.customerState === 'active' && current.membershipStartAt ? current.membershipStartAt.slice(0, 10) : today,
        endDate: current.membershipEndAt ? current.membershipEndAt.slice(0, 10) : addDays(today, duration),
        reason: '',
        operationId: createAdminOperationId('member-grant')
      },
      currentUser: current
    })
  },

  closeMembershipEditor() {
    if (!this.data.savingMembership) this.setData({ showMembershipEditor: false })
  },

  onManagedMembershipChange(e) {
    const index = Number(e.detail.value || 0)
    const option = MANAGED_MEMBERSHIP_OPTIONS[index]
    const startDate = this.data.membershipEditor.startDate || formatDate(new Date())
    this.setData({
      managedMembershipIndex: index,
      'membershipEditor.membershipType': option.value,
      'membershipEditor.endDate': addDays(startDate, option.durationDays)
    })
  },

  onMembershipDateChange(e) {
    const field = e.currentTarget.dataset.field
    const patch = { [`membershipEditor.${field}`]: e.detail.value }
    if (field === 'startDate') {
      const option = MANAGED_MEMBERSHIP_OPTIONS[this.data.managedMembershipIndex]
      patch['membershipEditor.endDate'] = addDays(e.detail.value, option.durationDays)
    }
    this.setData(patch)
  },

  onMembershipReasonInput(e) {
    this.setData({ 'membershipEditor.reason': e.detail.value })
  },

  saveMembership() {
    if (this.data.savingMembership) return
    const form = this.data.membershipEditor
    if (!form.reason.trim()) {
      wx.showToast({ title: '请填写调整原因', icon: 'none' })
      return
    }
    if (!form.startDate || !form.endDate || form.endDate <= form.startDate) {
      wx.showToast({ title: '到期日期必须晚于生效日期', icon: 'none' })
      return
    }
    const current = this.data.currentUser || {}
    const option = MANAGED_MEMBERSHIP_OPTIONS[this.data.managedMembershipIndex]
    const currentEndDate = String(current.membershipEndAt || '').slice(0, 10)
    const shortening = current.isMember && currentEndDate && form.endDate < currentEndDate
    const downgrade = current.membershipType === 'yearly' && option.value === 'monthly'
    const membershipAction = current.isMember && !shortening && !downgrade &&
      current.membershipType === option.value && form.endDate > currentEndDate
      ? 'extend'
      : form.membershipAction
    wx.showModal({
      title: shortening || downgrade ? '确认缩短或变更会员？' : '确认会员调整？',
      content: `${current.nickname || '用户'}\n${current.phone || '未绑定手机号'}\n` +
        `修改前：${current.membershipLabel || '普通用户'} ${current.membershipEndAtLabel || ''}\n` +
        `修改后：${option.label} ${form.startDate} 至 ${form.endDate}`,
      confirmText: '确认保存',
      confirmColor: shortening || downgrade ? '#d85b5b' : '#168f5b',
      success: result => {
        if (result.confirm) this.submitMembershipMutation({ ...form, membershipAction })
      }
    })
  },

  endMembership() {
    const current = this.data.currentUser || {}
    const reason = String(this.data.membershipEditor.reason || '').trim()
    if (!reason) {
      wx.showToast({ title: '请先填写提前结束原因', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认提前结束会员？',
      content: `${current.nickname || '用户'}\n${current.phone || ''}\n` +
        `当前：${current.membershipLabel || ''}，到期 ${current.membershipEndAtLabel || '—'}\n` +
        '结束后立即恢复为普通用户，历史记录仍会保留。',
      confirmText: '结束会员',
      confirmColor: '#d85b5b',
      success: result => {
        if (result.confirm) this.submitMembershipMutation({
          ...this.data.membershipEditor,
          membershipAction: 'end'
        })
      }
    })
  },

  async submitMembershipMutation(form) {
    this.setData({ savingMembership: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      const result = await adminUpdateUserMembership(form)
      this.setData({
        showMembershipEditor: false,
        currentUser: buildUserView(result.user || {}),
        membershipHistory: (result.history || []).map((item, index) => ({
          ...item,
          historyKey: `${item.kind || 'history'}-${item.orderNo || item.happenedAt || index}-${index}`,
          amountLabel: item.amountFen == null ? '—' : money(item.amountFen),
          endAtLabel: item.endAt || '—'
        }))
      })
      await Promise.all([this.loadOverview(), this.loadUsers(true)])
      wx.showToast({ title: '会员信息已更新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '会员调整失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ savingMembership: false })
    }
  },

  onRevenueRangeChange(e) {
    this.setData({ revenueRangeIndex: Number(e.currentTarget.dataset.index || 0) }, () => this.loadRevenue())
  },

  async loadRevenue() {
    if (this.data.revenueLoading) return
    this.setData({ revenueLoading: true })
    try {
      const rangeType = REVENUE_RANGE_OPTIONS[this.data.revenueRangeIndex].value
      const result = await adminRevenueOverview({ rangeType })
      const historyType = HISTORY_OPTIONS[this.data.historyIndex].value
      this.setData({ revenue: buildRevenueView(result, historyType) })
    } catch (error) {
      wx.showToast({ title: error.message || '收入数据读取失败', icon: 'none' })
    } finally {
      this.setData({ revenueLoading: false })
    }
  },

  switchHistoryType(e) {
    const historyIndex = Number(e.currentTarget.dataset.index || 0)
    const historyType = HISTORY_OPTIONS[historyIndex].value
    const source = this.data.revenue.history || {}
    this.setData({
      historyIndex,
      'revenue.historyRows': (source[historyType] || []).map(item => ({
        ...item,
        amountLabel: money(item.confirmedFen)
      }))
    })
  },

  onExportDateChange(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  async exportCsv() {
    if (this.data.exportingCsv) return
    this.setData({ exportingCsv: true })
    wx.showLoading({ title: '正在生成 CSV', mask: true })
    try {
      const result = await adminExportUsersCsv(this.getListFilters(1))
      await this.downloadAndOpen(result.tempFileURL, result.filename, 'csv')
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || 'CSV 导出失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ exportingCsv: false })
    }
  },

  async exportPreauthCsv() {
    if (this.data.exportingPreauthCsv) return
    this.setData({ exportingPreauthCsv: true })
    wx.showLoading({ title: '正在生成 CSV', mask: true })
    try {
      const result = await adminExportPreRegistrationCsv({
        ...this.getPreauthFilters(1),
        status: 'all'
      })
      await this.downloadAndOpen(result.tempFileURL, result.filename, 'csv')
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '待注册授权 CSV 导出失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ exportingPreauthCsv: false })
    }
  },

  async exportPdf() {
    if (this.data.exportingPdf) return
    const today = formatDate(new Date())
    const startDate = this.data.exportStartDate || `${today.slice(0, 7)}-01`
    const endDate = this.data.exportEndDate || today
    if (endDate < startDate) {
      wx.showToast({ title: '报告结束日期不能早于开始日期', icon: 'none' })
      return
    }
    this.setData({ exportingPdf: true })
    wx.showLoading({ title: '正在生成 PDF', mask: true })
    try {
      const result = await adminGenerateOperationsPdf({ startDate, endDate })
      await this.downloadAndOpen(result.tempFileURL, result.filename, 'pdf')
    } catch (error) {
      wx.showToast({ title: error.message || 'PDF 报告生成失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ exportingPdf: false })
    }
  },

  downloadAndOpen(url, filename, fileType) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error('下载地址为空'))
        return
      }
      wx.downloadFile({
        url,
        success: response => {
          if (response.statusCode !== 200) {
            reject(new Error('文件下载失败'))
            return
          }
          wx.openDocument({
            filePath: response.tempFilePath,
            fileType,
            fileName: filename,
            showMenu: true,
            success: resolve,
            fail: reject
          })
        },
        fail: reject
      })
    })
  },

  noop() {}
})
