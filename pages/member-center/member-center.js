const {
  getCurrentAccessStatus,
  getCurrentUser,
  getUserPackages
} = require('../../utils/access-control')
const {
  NORMAL_USER_BENEFITS,
  MEMBER_USER_BENEFITS
} = require('../../utils/membership-config')
const { MEMBERSHIP_PRODUCTS, getMembershipProduct } = require('../../utils/membership-products')
const { listMembershipProducts } = require('../../utils/cloud-api')
const {
  isPhoneBound,
  refreshPhoneMembership
} = require('../../utils/phone-auth')
const {
  PAYMENT_CONFIGURING_TEXT,
  purchaseMembership: purchaseMembershipFlow,
  resumePendingMembership
} = require('../../utils/virtual-payment')
const {
  enableShareMenu,
  getDefaultShareMessage,
  getDefaultShareTimeline
} = require('../../utils/share-config')

function buildPackageView(item) {
  return {
    ...item,
    // 不在会员购买页展示历史权限包内部编码或名称，避免与可购买会员商品混淆。
    displayName: '学校已绑定训练权限',
    expireText: item.expireAt || '长期有效',
    statusText: item.status === 'active' ? '有效' : '已关闭'
  }
}

function getProductActionName(item = {}) {
  if (item.membershipType === 'monthly') return '季卡'
  if (item.membershipType === 'yearly') return '年卡'
  return item.title
}

function mergeProductView(item, accessStatus, paymentBusyProductId = '') {
  const local = getMembershipProduct(item.productId) || {}
  const product = { ...item, ...local }
  const isAdmin = accessStatus.membershipType === 'admin'
  const downgradeBlocked = accessStatus.membershipType === 'yearly' && product.membershipType === 'monthly'
  const isBusy = paymentBusyProductId === product.productId
  const sameMembership = accessStatus.membershipType === product.membershipType
  const actionName = getProductActionName(product)
  return {
    ...product,
    priceText: product.priceText || `¥${(Number(product.priceFen || 0) / 100).toFixed(1)}`,
    unitText: product.unitText || (product.membershipType === 'yearly' ? '/ 年' : '/ 季'),
    buttonDisabled: isAdmin || downgradeBlocked || Boolean(paymentBusyProductId),
    buttonText: isBusy
      ? '支付处理中…'
      : isAdmin
        ? '管理员无需购买'
        : downgradeBlocked
          ? '年度会员有效期内不可购买季卡'
          : sameMembership
            ? `续费${actionName}`
            : `购买${actionName}`
  }
}

Page({
  data: {
    accessStatus: null,
    accessLabel: '游客',
    accessDesc: '你可以使用四大训练营前 21 天内容，每天可使用 1 次 AI 测评/反馈。',
    membershipExpireText: '尚未开通',
    phoneMask: '未验证',
    packages: [],
    hasPackages: false,
    isMember: false,
    isWhitelist: false,
    normalBenefits: NORMAL_USER_BENEFITS,
    memberBenefits: MEMBER_USER_BENEFITS,
    products: MEMBERSHIP_PRODUCTS.map(item => ({ ...item, buttonText: `购买${getProductActionName(item)}`, buttonDisabled: false })),
    productsLoading: true,
    paymentConfigured: false,
    paymentConfigurationCode: '',
    paymentBusy: false,
    paymentBusyProductId: '',
    paymentStatusText: ''
  },

  onLoad() {
    enableShareMenu()
  },

  onShow() {
    enableShareMenu()
    this.loadAccessStatus()
    if (isPhoneBound()) {
      refreshPhoneMembership()
        .then(() => this.loadAccessStatus())
        .catch(error => console.warn('[member-center] 会员状态刷新失败:', error && error.code ? error.code : 'unknown'))
    }
    this.loadMembershipProducts().then(() => this.resumePendingPayment())
  },

  loadAccessStatus() {
    const user = getCurrentUser()
    const accessStatus = getCurrentAccessStatus()
    const packages = getUserPackages(user.phone, user.openid).map(buildPackageView)
    const membershipExpireText = accessStatus.membershipType === 'admin'
      ? '长期有效'
      : accessStatus.membershipEndAt
        ? `有效期至：${accessStatus.membershipEndAt}`
        : '尚未开通'

    this.setData({
      accessStatus,
      accessLabel: accessStatus.label,
      accessDesc: accessStatus.desc,
      membershipExpireText,
      phoneMask: user.phone ? `***${String(user.phone).slice(-4)}` : '未验证',
      packages,
      hasPackages: packages.length > 0,
      isMember: accessStatus.canAccessAdvanced,
      isWhitelist: accessStatus.roleType === 'whitelist',
      products: this.data.products.map(item => mergeProductView(item, accessStatus, this.data.paymentBusyProductId))
    })
  },

  loadMembershipProducts() {
    return listMembershipProducts()
      .then(result => {
        const remoteProducts = Array.isArray(result.products)
          ? result.products.filter(item => ['quarterly_membership', 'yearly_membership'].includes(item.productId))
          : []
        const products = remoteProducts.length
          ? remoteProducts
          : MEMBERSHIP_PRODUCTS
        const accessStatus = this.data.accessStatus || getCurrentAccessStatus()
        const configurationCode = result.configurationCode || ''
        const configurationMessage = result.configurationMessage || PAYMENT_CONFIGURING_TEXT
        this.setData({
          products: products.map(item => mergeProductView(item, accessStatus, this.data.paymentBusyProductId)),
          productsLoading: false,
          paymentConfigured: result.paymentConfigured === true,
          paymentConfigurationCode: configurationCode,
          paymentStatusText: result.paymentConfigured === true ? this.data.paymentStatusText : configurationMessage
        })
      })
      .catch(error => {
        console.warn('[member-center] 会员商品读取失败:', error && error.code ? error.code : 'unknown')
        this.setData({
          productsLoading: false,
          paymentConfigured: false,
          paymentConfigurationCode: error && error.code || '',
          paymentStatusText: PAYMENT_CONFIGURING_TEXT
        })
      })
  },

  purchaseMembership(event) {
    const productId = String(event.currentTarget.dataset.productId || '')
    const product = this.data.products.find(item => item.productId === productId)
    if (!product || product.buttonDisabled || this.data.paymentBusy) return
    if (!this.data.paymentConfigured) {
      const code = this.data.paymentConfigurationCode
      const message = this.data.paymentStatusText || PAYMENT_CONFIGURING_TEXT
      if (code && code !== 'VIRTUAL_PAYMENT_NOT_CONFIGURED') {
        wx.showModal({
          title: '创建订单失败',
          content: `错误码：${code}\n错误信息：${message}`,
          showCancel: false
        })
      } else {
        wx.showToast({ title: PAYMENT_CONFIGURING_TEXT, icon: 'none' })
      }
      return
    }
    this.startMembershipPurchase(productId)
  },

  async startMembershipPurchase(productId) {
    const accessStatus = this.data.accessStatus || getCurrentAccessStatus()
    this.setData({
      paymentBusy: true,
      paymentBusyProductId: productId,
      products: this.data.products.map(item => mergeProductView(item, accessStatus, productId))
    })
    await purchaseMembershipFlow(productId, {
      page: this,
      onState: state => this.setData({ paymentStatusText: state.message || '' }),
      onFulfilled: () => this.loadAccessStatus()
    })
    this.finishPaymentLoading()
  },

  resumePendingPayment() {
    if (this.data.paymentBusy || !this.data.paymentConfigured) return
    resumePendingMembership({
      page: this,
      attempts: 1,
      onState: state => this.setData({ paymentStatusText: state.message || '' }),
      onFulfilled: () => this.loadAccessStatus()
    })
  },

  refreshPaymentStatus() {
    resumePendingMembership({
      page: this,
      attempts: 2,
      onState: state => this.setData({ paymentStatusText: state.message || '' }),
      onFulfilled: () => this.loadAccessStatus()
    }).then(result => {
      if (result.status !== 'none') return
      refreshPhoneMembership()
        .catch(() => null)
        .then(() => {
          this.loadAccessStatus()
          wx.showToast({ title: '会员状态已刷新', icon: 'none' })
        })
    })
  },

  finishPaymentLoading() {
    const accessStatus = this.data.accessStatus || getCurrentAccessStatus()
    this.setData({
      paymentBusy: false,
      paymentBusyProductId: '',
      products: this.data.products.map(item => mergeProductView(item, accessStatus, ''))
    })
  },

  onShareAppMessage() {
    return getDefaultShareMessage({
      title: '口才训练会员中心｜解锁更多训练内容',
      path: '/pages/member-center/member-center',
      pageType: 'training'
    })
  },

  onShareTimeline() {
    return getDefaultShareTimeline({
      title: '口才训练会员中心｜解锁更多训练内容',
      targetPage: 'member-center',
      pageType: 'training'
    })
  }
})
