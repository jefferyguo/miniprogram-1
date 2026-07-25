const { normalizePhone } = require('../../utils/access-control')
const {
  getAdminProfile,
  adminListPhoneEntitlements,
  adminSavePhoneEntitlement,
  adminDisablePhoneEntitlement,
  adminEnablePhoneEntitlement,
  adminDeletePhoneEntitlement
} = require('../../utils/cloud-api')

const MEMBERSHIP_OPTIONS = [
  { value: 'free', name: '普通' },
  { value: 'monthly', name: '季度会员' },
  { value: 'yearly', name: '年度会员' },
  { value: 'admin', name: '管理员' }
]

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + Number(days || 0))
  return formatDate(date)
}

function getDefaultEndDate(type) {
  if (type === 'monthly') return addDays(90)
  if (type === 'yearly') return addDays(365)
  return ''
}

function getMembershipOption(type) {
  return MEMBERSHIP_OPTIONS.find(item => item.value === type) || MEMBERSHIP_OPTIONS[0]
}

function buildMemberView(item = {}) {
  const option = getMembershipOption(item.membershipType)
  const status = item.status || 'active'
  const expired = item.membershipStatus === 'expired'
  const isDisabled = status === 'disabled'
  let expireText = '无'
  if (item.membershipType === 'admin') expireText = '长期有效'
  if (['monthly', 'yearly'].includes(item.membershipType)) expireText = item.membershipEndAt || '未设置'

  return {
    ...item,
    id: item.id || item._id || '',
    name: item.name || '未填写姓名',
    phoneMask: item.phoneMasked || '手机号已脱敏',
    membershipName: option.name,
    expireText,
    statusText: isDisabled ? '停用' : (expired ? '已过期' : '正常'),
    statusClass: isDisabled || expired ? 'status-muted' : 'status-active',
    isDisabled,
    isLegacy: item.isLegacy === true || item.source === 'legacy'
  }
}

function getEmptyForm() {
  return {
    id: '',
    name: '',
    phone: '',
    className: '',
    remark: '',
    membershipType: 'free',
    membershipEndAt: ''
  }
}

Page({
  data: {
    isAdmin: false,
    checkingAdmin: true,
    keyword: '',
    loadingList: false,
    phoneEntitlements: [],
    showEditor: false,
    editorTitle: '添加学员',
    isEditing: false,
    currentIsDisabled: false,
    currentIsLegacy: false,
    saving: false,
    membershipOptions: MEMBERSHIP_OPTIONS,
    membershipIndex: 0,
    selectedMembershipName: MEMBERSHIP_OPTIONS[0].name,
    showExpiryPicker: false,
    form: getEmptyForm()
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
      await this.loadPhoneEntitlements()
    } catch (error) {
      this.setData({ isAdmin: false, checkingAdmin: false })
      wx.showToast({ title: error.message || '管理员身份读取失败', icon: 'none' })
    }
  },

  async loadPhoneEntitlements() {
    if (this.data.loadingList) return
    this.setData({ loadingList: true })
    try {
      const result = await adminListPhoneEntitlements(this.data.keyword)
      this.setData({ phoneEntitlements: (result.list || []).map(buildMemberView) })
    } catch (error) {
      wx.showToast({ title: error.message || '学员列表读取失败', icon: 'none' })
    } finally {
      this.setData({ loadingList: false })
    }
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  searchMembers() {
    this.loadPhoneEntitlements()
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.loadPhoneEntitlements())
  },

  openCreateEditor() {
    this.setData({
      showEditor: true,
      editorTitle: '添加学员',
      isEditing: false,
      currentIsDisabled: false,
      currentIsLegacy: false,
      membershipIndex: 0,
      selectedMembershipName: MEMBERSHIP_OPTIONS[0].name,
      showExpiryPicker: false,
      form: getEmptyForm()
    })
  },

  openEditEditor(e) {
    const id = e.currentTarget.dataset.id || ''
    const phone = e.currentTarget.dataset.phone || ''
    const item = this.data.phoneEntitlements.find(record => (id ? record.id === id : record.phone === phone))
    if (!item) return

    const option = getMembershipOption(item.membershipType)
    const membershipIndex = MEMBERSHIP_OPTIONS.findIndex(record => record.value === option.value)
    this.setData({
      showEditor: true,
      editorTitle: item.isLegacy ? '迁移并编辑学员' : '编辑学员',
      isEditing: true,
      currentIsDisabled: item.isDisabled,
      currentIsLegacy: item.isLegacy,
      membershipIndex,
      selectedMembershipName: option.name,
      showExpiryPicker: ['monthly', 'yearly'].includes(option.value),
      form: {
        id: item.id || '',
        name: item.name === '未填写姓名' ? '' : item.name,
        phone: item.phone || '',
        className: item.className || '',
        remark: item.remark || '',
        membershipType: option.value,
        membershipEndAt: ['monthly', 'yearly'].includes(option.value)
          ? (item.membershipEndAt || getDefaultEndDate(option.value))
          : ''
      }
    })
  },

  closeEditor() {
    if (!this.data.saving) this.setData({ showEditor: false })
  },

  noop() {},

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onMembershipChange(e) {
    const membershipIndex = Number(e.detail.value || 0)
    const option = MEMBERSHIP_OPTIONS[membershipIndex]
    this.setData({
      membershipIndex,
      selectedMembershipName: option.name,
      showExpiryPicker: ['monthly', 'yearly'].includes(option.value),
      'form.membershipType': option.value,
      'form.membershipEndAt': getDefaultEndDate(option.value)
    })
  },

  onEndDateChange(e) {
    this.setData({ 'form.membershipEndAt': e.detail.value })
  },

  async saveMember() {
    if (this.data.saving) return
    const form = this.data.form
    const phone = normalizePhone(form.phone)
    if (!String(form.name || '').trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (['monthly', 'yearly'].includes(form.membershipType) && !form.membershipEndAt) {
      wx.showToast({ title: '请选择到期日期', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      await adminSavePhoneEntitlement({
        id: form.id,
        name: String(form.name || '').trim(),
        phone,
        className: String(form.className || '').trim(),
        remark: String(form.remark || '').trim(),
        membershipType: form.membershipType,
        membershipEndAt: form.membershipEndAt || ''
      })
      this.setData({ showEditor: false })
      await this.loadPhoneEntitlements()
      wx.showToast({ title: '学员信息已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ saving: false })
    }
  },

  toggleCurrentMember() {
    if (this.data.currentIsLegacy) {
      wx.showToast({ title: '请先保存迁移后的学员档案', icon: 'none' })
      return
    }
    const enabling = this.data.currentIsDisabled
    wx.showModal({
      title: enabling ? '确认启用该学员？' : '确认停用该学员？',
      content: enabling ? '启用后将恢复当前身份权益。' : '停用后，已绑定用户将恢复为普通用户。',
      confirmText: enabling ? '启用' : '停用',
      confirmColor: enabling ? '#07c160' : '#d85b5b',
      success: async result => {
        if (!result.confirm) return
        try {
          const action = enabling ? adminEnablePhoneEntitlement : adminDisablePhoneEntitlement
          await action({ id: this.data.form.id, phone: this.data.form.phone })
          this.setData({ showEditor: false })
          await this.loadPhoneEntitlements()
          wx.showToast({ title: enabling ? '已启用' : '已停用', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  deleteCurrentMember() {
    if (this.data.currentIsLegacy) {
      wx.showToast({ title: '旧数据请先编辑并保存', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认删除该学员档案？',
      content: '删除后该手机号将恢复为普通用户，历史训练数据不会删除。',
      confirmText: '删除',
      confirmColor: '#d85b5b',
      success: async result => {
        if (!result.confirm) return
        try {
          await adminDeletePhoneEntitlement({ id: this.data.form.id, phone: this.data.form.phone })
          this.setData({ showEditor: false })
          await this.loadPhoneEntitlements()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败', icon: 'none' })
        }
      }
    })
  }
})
