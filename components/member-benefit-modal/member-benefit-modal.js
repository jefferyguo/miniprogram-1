const { purchaseMembership } = require('../../utils/virtual-payment')
const { getMembershipProduct } = require('../../utils/membership-products')

function getCurrentPage() {
  if (typeof getCurrentPages !== 'function') return null
  const pages = getCurrentPages()
  return pages.length ? pages[pages.length - 1] : null
}

Component({
  data: {
    visible: false,
    viewMode: 'comparison',
    quarterlyProduct: getMembershipProduct('quarterly_membership'),
    yearlyProduct: getMembershipProduct('yearly_membership'),
    usageText: '',
    paymentBusyProductId: '',
    paymentStatusText: ''
  },

  methods: {
    open(options = {}) {
      const isLimit = options.reason === 'ai_limit'
      const limit = Number(options.limit || 1)
      const used = Number(options.used || limit)

      this.setData({
        visible: true,
        viewMode: isLimit ? 'limit' : 'comparison',
        usageText: isLimit ? `今日已使用 ${used}/${limit} 次` : '',
        paymentBusyProductId: '',
        paymentStatusText: ''
      })
    },

    close() {
      this.setData({ visible: false })
      this.triggerEvent('close')
    },

    noop() {},

    showBenefits() {
      this.setData({ viewMode: 'comparison' })
    },

    buyQuarterlyMembership() {
      return this.purchaseMembershipFromModal('quarterly_membership')
    },

    buyYearlyMembership() {
      return this.purchaseMembershipFromModal('yearly_membership')
    },

    // 两个购买按钮共用同一套支付编排，实际安全支付流程仍由 utils/virtual-payment.js 负责。
    async purchaseMembershipFromModal(productId) {
      if (!productId || this.data.paymentBusyProductId) return

      this.setData({
        paymentBusyProductId: productId,
        paymentStatusText: '正在创建支付订单…'
      })

      try {
        await purchaseMembership(productId, {
          page: getCurrentPage(),
          onState: state => {
            this.setData({ paymentStatusText: state.message || '' })
          },
          onFulfilled: result => {
            this.triggerEvent('membershipchanged', { productId, result })
            this.close()
          },
          onPending: result => {
            this.triggerEvent('membershippending', { productId, result })
          }
        })
      } finally {
        this.setData({ paymentBusyProductId: '' })
      }
    }
  }
})
