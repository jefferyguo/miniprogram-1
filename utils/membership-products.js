// 前端只保留可公开展示的商品信息；offerId、AppKey 等支付配置只能存在于云函数环境变量。
const MEMBERSHIP_PRODUCTS = [
  {
    productId: 'quarterly_membership',
    membershipType: 'monthly',
    wechatProductName: '杨勤口才训练KEEP季度会员',
    title: '季度会员',
    priceFen: 2990,
    priceText: '¥29.9',
    unitText: '/ 季',
    durationDays: 90,
    description: '适合阶段性集中训练，每天 5 次 AI 点评/测评。'
  },
  {
    productId: 'yearly_membership',
    membershipType: 'yearly',
    wechatProductName: '杨勤口才训练KEEP年度会员',
    title: '年度会员',
    priceFen: 5990,
    priceText: '¥59.9',
    unitText: '/ 年',
    durationDays: 365,
    description: '年度会员限时体验价，每天 5 次 AI 点评/测评。'
  }
]

function getMembershipProduct(productId) {
  return MEMBERSHIP_PRODUCTS.find(item => item.productId === productId) || null
}

module.exports = {
  MEMBERSHIP_PRODUCTS,
  getMembershipProduct
}
