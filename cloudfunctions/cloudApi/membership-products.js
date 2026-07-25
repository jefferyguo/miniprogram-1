// 云函数独立部署，必须在服务端再次校验商品与价格，不能信任前端传入值。
// productId 即微信 short_series_goods 模式要求的道具 ID，不读取环境变量，也不映射为 goodsId。
const MEMBERSHIP_PRODUCTS = [
  {
    productId: 'quarterly_membership',
    membershipType: 'monthly',
    wechatProductName: '杨勤口才训练KEEP季度会员',
    title: '季度会员',
    priceFen: 2990,
    durationDays: 90,
    description: '适合阶段性集中训练，每天 5 次 AI 点评/测评。'
  },
  {
    productId: 'yearly_membership',
    membershipType: 'yearly',
    wechatProductName: '杨勤口才训练KEEP年度会员',
    title: '年度会员',
    priceFen: 5990,
    durationDays: 365,
    description: '年度会员限时体验价，每天 5 次 AI 点评/测评。'
  }
]

// 兼容旧版本前端和历史测试订单；新订单统一使用 quarterly_membership。
const LEGACY_PRODUCT_ID_ALIASES = {
  monthly_membership: 'quarterly_membership'
}

function getMembershipProduct(productId) {
  const requestedProductId = String(productId || '').trim()
  const canonicalProductId = LEGACY_PRODUCT_ID_ALIASES[requestedProductId] || requestedProductId
  return MEMBERSHIP_PRODUCTS.find(item => item.productId === canonicalProductId) || null
}

module.exports = {
  MEMBERSHIP_PRODUCTS,
  LEGACY_PRODUCT_ID_ALIASES,
  getMembershipProduct
}
