const {
  confirmVirtualPaymentOrder,
  createVirtualPaymentOrder,
  reportVirtualPaymentResult
} = require('./cloud-api')
const { getMembershipProduct } = require('./membership-products')
const {
  isPhoneBound,
  refreshPhoneMembership
} = require('./phone-auth')
const { requirePhoneBound } = require('./auth')

const PENDING_ORDER_KEY = 'virtualPaymentPendingOrderNo'
const PAYMENT_CONFIGURING_TEXT = '会员支付能力配置中，请稍后再试。'
const PAYMENT_PENDING_TEXT = '支付结果确认中，请稍后刷新会员状态。'

const SENSITIVE_DEBUG_KEY_PATTERN = /app.?key|app.?secret|offer.?id|pay.?sig(n)?|signature|sign.?data|virtual.?pay.?params|token|login.?code|session.?key/i

function sanitizeDebugValue(value, key = '', depth = 0) {
  const keyText = String(key)
  const isSafePresenceFlag = typeof value === 'boolean' && (/^has[A-Z_]/.test(keyText) || /Exists$/.test(keyText))
  const isSafeKeyList = Array.isArray(value) && /Keys$/.test(keyText)
  if (SENSITIVE_DEBUG_KEY_PATTERN.test(keyText) && !isSafePresenceFlag && !isSafeKeyList) return value ? '[hidden]' : ''
  if (depth > 4 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => sanitizeDebugValue(item, '', depth + 1))

  const safe = {}
  Object.keys(value).forEach(field => {
    safe[field] = sanitizeDebugValue(value[field], field, depth + 1)
  })
  return safe
}

function sanitizePaymentError(error) {
  if (!error || typeof error !== 'object') return error
  return {
    ...sanitizeDebugValue(error),
    name: error.name || '',
    message: error.message || '',
    errCode: error.errCode == null ? '' : error.errCode,
    errMsg: error.errMsg || ''
  }
}

function debugLog(message, data = {}) {
  // 仅记录排障所需的非敏感字段，禁止输出签名、登录 code、密钥或完整支付参数。
  console.log(`[virtual-payment] ${message}`, sanitizeDebugValue(data))
}

function debugWarn(message, data = {}) {
  console.warn(`[virtual-payment] ${message}`, sanitizeDebugValue(data))
}

function getLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result && result.code) resolve(result.code)
        else reject({ code: 'WX_LOGIN_CODE_MISSING', message: '未获取到支付登录凭证' })
      },
      fail(error) {
        reject({
          code: 'WX_LOGIN_FAILED',
          message: (error && error.errMsg) || '获取支付登录凭证失败'
        })
      }
    })
  })
}

function normalizeError(error, fallbackCode = 'PAYMENT_FAILED') {
  const result = error && error.result ? error.result : error || {}
  const rawErrCode = result.errCode != null ? result.errCode : error && error.errCode
  return {
    code: result.code || error && error.code || fallbackCode,
    message: result.message || error && error.message || error && error.errMsg || '支付失败，请稍后重试。',
    errCode: rawErrCode == null || rawErrCode === '' ? '' : Number(rawErrCode),
    errMsg: result.errMsg || error && error.errMsg || ''
  }
}

function getPayParamKeys(params) {
  return params && typeof params === 'object' ? Object.keys(params).sort() : []
}

function getRequestVirtualPaymentParamsSummary(params = {}, context = {}) {
  let signData = {}
  try {
    signData = typeof params.signData === 'string' ? JSON.parse(params.signData) : (params.signData || {})
  } catch (error) {
    signData = {}
  }
  const effectiveEnv = params.env == null ? signData.env : params.env
  const effectiveProductId = params.productId || signData.productId || ''
  const effectiveGoodsId = params.goodsId || signData.goodsId || ''
  const effectiveBuyQuantity = params.buyQuantity == null ? signData.buyQuantity : params.buyQuantity

  return {
    productId: context.productId || effectiveProductId || effectiveGoodsId,
    orderNo: context.orderNo || '',
    payParamKeys: getPayParamKeys(params),
    signDataKeys: getPayParamKeys(signData),
    env: effectiveEnv,
    envType: typeof effectiveEnv,
    envSource: params.env == null ? 'signData.env' : 'payParams.env',
    offerIdExists: Boolean(params.offerId || signData.offerId),
    goodsIdExists: Boolean(effectiveGoodsId),
    productIdExists: Boolean(effectiveProductId),
    finalGoodsField: effectiveProductId ? 'productId' : (effectiveGoodsId ? 'goodsId' : ''),
    finalGoodsId: effectiveProductId || effectiveGoodsId,
    buyQuantityExists: effectiveBuyQuantity != null,
    buyQuantity: effectiveBuyQuantity == null ? '' : Number(effectiveBuyQuantity),
    currencyType: params.currencyType || signData.currencyType || '',
    platform: params.platform || signData.platform || '',
    hasSign: Boolean(params.sign),
    hasPaySig: Boolean(params.paySig),
    hasSignature: Boolean(params.signature)
  }
}

function isVirtualPaymentSupported() {
  if (typeof wx.requestVirtualPayment !== 'function') return false
  if (typeof wx.canIUse !== 'function') return true
  try {
    return wx.canIUse('requestVirtualPayment') !== false
  } catch (error) {
    return true
  }
}

function hasCompletePayParams(params) {
  return Boolean(
    params &&
    typeof params.signData === 'string' && params.signData &&
    typeof params.paySig === 'string' && params.paySig &&
    typeof params.signature === 'string' && params.signature &&
    params.mode === 'short_series_goods'
  )
}

function requestVirtualPayment(params, context) {
  return new Promise((resolve, reject) => {
    debugLog('requestVirtualPayment params summary', getRequestVirtualPaymentParamsSummary(params, context))
    debugLog('requestVirtualPayment start', {
      ...context,
      payParamKeys: getPayParamKeys(params),
      hasPayParams: hasCompletePayParams(params)
    })
    wx.requestVirtualPayment({
      signData: params.signData,
      paySig: params.paySig,
      signature: params.signature,
      mode: params.mode,
      success(result) {
        debugLog('requestVirtualPayment success', {
          ...context,
          result: sanitizeDebugValue(result)
        })
        resolve(result)
      },
      fail(error) {
        const normalized = normalizeError(error)
        debugWarn('requestVirtualPayment fail', {
          ...context,
          errCode: normalized.errCode,
          errMsg: normalized.errMsg || normalized.message,
          error: sanitizePaymentError(error)
        })
        reject({ ...error, ...normalized })
      },
      complete(result) {
        debugLog('requestVirtualPayment complete', {
          ...context,
          code: result && result.errCode,
          message: result && result.errMsg
        })
      }
    })
  })
}

function showDetailedPaymentError(title, normalized, options = {}) {
  if (normalized.code === 'VIRTUAL_PAYMENT_NOT_CONFIGURED') {
    wx.showModal({ title: '暂无法支付', content: PAYMENT_CONFIGURING_TEXT, showCancel: false })
    return PAYMENT_CONFIGURING_TEXT
  }

  const code = normalized.errCode !== '' ? normalized.errCode : (normalized.code || 'UNKNOWN')
  const message = normalized.errMsg || normalized.message || '未知错误'
  const sandboxIllegal = Number(normalized.errCode) === -15011 || /PAYMENT_ILLEGAL_IN_SANDBOX/i.test(message)
  if (sandboxIllegal) {
    const content = [
      '沙箱支付道具校验失败。请检查当前 cloudApi 使用的 OfferID、沙箱 AppKey、VIRTUAL_PAY_ENV=1，以及开发版本是否已发布对应道具。',
      '微信错误码 -15011 表示当前运行包被识别为现网版本，env 只能为 0。沙箱测试请从开发版/预览版进入；审核、体验或正式版本请使用 env=0 和现网配置。',
      `错误信息：${message}`,
      `错误码：${code}`
    ].join('\n')
    wx.showModal({ title, content, showCancel: false })
    return content
  }
  const lines = options.messageFirst
    ? [`错误信息：${message}`, `错误码：${code}`]
    : [`错误码：${code}`, `错误信息：${message}`]

  if (options.productHint) {
    lines.push('请检查当前虚拟支付环境中是否已发布 quarterly_membership / yearly_membership。')
  }
  wx.showModal({ title, content: lines.join('\n'), showCancel: false })
  return lines.join('\n')
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function emitState(options, state, message, extra = {}) {
  if (typeof options.onState === 'function') {
    options.onState({ state, message, ...extra })
  }
}

function showFriendlyError(code, message, productTitle = '会员') {
  let title = `${productTitle}购买失败`
  let content = '支付失败，请稍后重试。'
  if (code === 'VIRTUAL_PAYMENT_NOT_CONFIGURED' || code === 'VIRTUAL_PAYMENT_ORDER_STORE_UNAVAILABLE') {
    title = '暂无法支付'
    content = PAYMENT_CONFIGURING_TEXT
  } else if (code === 'REQUEST_VIRTUAL_PAYMENT_NOT_SUPPORTED') {
    title = '当前版本不支持'
    content = '当前微信版本暂不支持虚拟支付，请升级微信后重试。'
  } else if (code === 'PAY_PARAMS_MISSING') {
    title = '支付参数缺失'
    content = '支付参数缺失，请检查云函数虚拟支付配置。'
  } else if (code === 'CREATE_ORDER_FAILED' || code === 'WX_LOGIN_FAILED' || code === 'WX_LOGIN_CODE_MISSING') {
    title = '创建订单失败'
    content = '创建订单失败，请检查网络或稍后重试。'
  } else if (message && !String(message).includes('cloud.callFunction')) {
    content = message
  }
  wx.showModal({ title, content, showCancel: false })
  return content
}

async function reportClientResult(orderNo, status, reason) {
  if (!orderNo) return
  try {
    await reportVirtualPaymentResult(orderNo, status, reason)
  } catch (error) {
    const normalized = normalizeError(error)
    debugWarn('report client result fail', { orderNo, status, ...normalized })
  }
}

async function confirmOrder(orderNo, productId, options = {}, attempts = 4) {
  debugLog('confirm order start', { productId, orderNo, attempts })
  let result
  try {
    result = await confirmVirtualPaymentOrder(orderNo)
  } catch (error) {
    const normalized = normalizeError(error, 'CONFIRM_ORDER_FAILED')
    debugWarn('confirm order result', {
      productId,
      orderNo,
      success: false,
      code: normalized.code,
      message: normalized.message,
      status: 'error',
      error: sanitizePaymentError(error)
    })
    if (normalized.code === 'VIRTUAL_PAYMENT_NOT_CONFIGURED') {
      emitState(options, 'pending', PAYMENT_CONFIGURING_TEXT, { productId, orderNo, code: normalized.code })
      if (typeof options.onPending === 'function') options.onPending({ status: 'pending', orderNo })
      wx.showModal({ title: '支付结果待确认', content: PAYMENT_CONFIGURING_TEXT, showCancel: false })
      return { success: true, status: 'pending', code: normalized.code, orderNo }
    }
    if (attempts > 1) {
      await wait(1500)
      return confirmOrder(orderNo, productId, options, attempts - 1)
    }
    emitState(options, 'pending', PAYMENT_PENDING_TEXT, { productId, orderNo })
    if (typeof options.onPending === 'function') options.onPending({ status: 'pending', orderNo })
    showDetailedPaymentError('支付结果确认失败', normalized)
    return { success: true, status: 'pending', code: normalized.code, orderNo }
  }

  const status = result.status || result.orderStatus || 'pending'
  debugLog('confirm order result', {
    productId,
    orderNo,
    success: result.success !== false,
    status,
    code: result.code,
    message: result.message
  })

  if (status === 'fulfilled') {
    wx.removeStorageSync(PENDING_ORDER_KEY)
    await refreshPhoneMembership().catch(error => {
      const normalized = normalizeError(error, 'MEMBERSHIP_REFRESH_FAILED')
      debugWarn('refresh membership fail', { productId, orderNo, status, ...normalized })
    })
    emitState(options, 'fulfilled', '会员已开通。', { productId, orderNo })
    if (typeof options.onFulfilled === 'function') options.onFulfilled(result)
    wx.showToast({ title: '会员已开通', icon: 'success' })
    return { success: true, status, orderNo, data: result }
  }

  if (status === 'failed' || status === 'cancelled') {
    wx.removeStorageSync(PENDING_ORDER_KEY)
    const normalized = normalizeError(result, status === 'cancelled' ? 'CANCELLED' : 'CONFIRM_ORDER_FAILED')
    const message = status === 'cancelled'
      ? '已取消支付。'
      : showDetailedPaymentError('支付结果确认失败', normalized)
    emitState(options, status, message, { productId, orderNo })
    if (typeof options.onFailed === 'function') options.onFailed(result)
    if (status === 'cancelled') wx.showToast({ title: message, icon: 'none' })
    return { success: false, status, orderNo }
  }

  if (attempts > 1) {
    await wait(1500)
    return confirmOrder(orderNo, productId, options, attempts - 1)
  }
  emitState(options, 'pending', PAYMENT_PENDING_TEXT, { productId, orderNo })
  if (typeof options.onPending === 'function') options.onPending(result)
  if (result.code && result.code !== 'WECHAT_ORDER_NOT_READY') {
    showDetailedPaymentError('支付结果确认失败', normalizeError(result, 'CONFIRM_ORDER_FAILED'))
  } else {
    wx.showModal({ title: '支付结果确认中', content: PAYMENT_PENDING_TEXT, showCancel: false })
  }
  return { success: true, status: 'pending', orderNo, data: result }
}

async function purchaseMembership(productId, options = {}) {
  const product = getMembershipProduct(productId)
  if (!product) {
    const normalized = {
      code: 'INVALID_MEMBERSHIP_PRODUCT',
      message: '会员商品不存在。',
      errCode: '',
      errMsg: ''
    }
    const message = showDetailedPaymentError('创建订单失败', normalized, { productHint: true })
    debugWarn('invalid product', { productId, code: 'INVALID_MEMBERSHIP_PRODUCT', message })
    return { success: false, code: 'INVALID_MEMBERSHIP_PRODUCT' }
  }
  if (!isPhoneBound()) {
    debugWarn('phone not bound', { productId, code: 'PHONE_REQUIRED' })
    requirePhoneBound(null, { actionName: '开通会员' })
    return { success: false, code: 'PHONE_REQUIRED' }
  }
  if (!isVirtualPaymentSupported()) {
    const code = 'REQUEST_VIRTUAL_PAYMENT_NOT_SUPPORTED'
    const message = showFriendlyError(code, '', product.title)
    debugWarn('requestVirtualPayment unsupported', { productId, code, message })
    emitState(options, 'failed', message, { productId, code })
    return { success: false, code }
  }

  let orderNo = ''
  let paymentStage = 'create'
  emitState(options, 'creating', '正在创建支付订单…', { productId })
  wx.showLoading({ title: '创建订单中…', mask: true })
  debugLog('create order start', { productId })
  try {
    const loginCode = await getLoginCode()
    const created = await createVirtualPaymentOrder(productId, loginCode)
    orderNo = created.orderNo || ''
    const payParams = created.paymentParams || created.payParams || created.virtualPayParams
    debugLog('create order result', {
      productId,
      success: created.success !== false,
      orderNoExists: Boolean(orderNo),
      status: created.status,
      code: created.code,
      message: created.message,
      payParamsExists: Boolean(payParams),
      payParamKeys: getPayParamKeys(payParams)
    })
    if (!orderNo || !hasCompletePayParams(payParams)) {
      const error = { code: 'PAY_PARAMS_MISSING', message: '支付参数缺失，请检查云函数虚拟支付配置。' }
      debugWarn('pay params missing', { productId, orderNo, ...error, hasPayParams: Boolean(payParams) })
      throw error
    }

    wx.setStorageSync(PENDING_ORDER_KEY, orderNo)
    wx.hideLoading()
    emitState(options, 'paying', '支付处理中', { productId, orderNo })
    paymentStage = 'request'

    try {
      await requestVirtualPayment(payParams, { productId, orderNo })
    } catch (paymentError) {
      const normalized = normalizeError(paymentError)
      const cancelled = normalized.errCode === -2 || /cancel|取消/i.test(normalized.message)
      const resultUnknown = normalized.errCode === -5
      if (resultUnknown) {
        emitState(options, 'pending', PAYMENT_PENDING_TEXT, { productId, orderNo })
        return confirmOrder(orderNo, productId, options, 2)
      }
      const status = cancelled ? 'cancelled' : 'failed'
      await reportClientResult(orderNo, status, normalized.message)
      wx.removeStorageSync(PENDING_ORDER_KEY)
      const message = cancelled
        ? '已取消支付。'
        : showDetailedPaymentError('虚拟支付拉起失败', normalized, {
          messageFirst: true,
          productHint: true
        })
      emitState(options, status, message, { productId, orderNo, code: normalized.code })
      if (cancelled) wx.showToast({ title: message, icon: 'none' })
      return { success: false, status, code: cancelled ? 'CANCELLED' : normalized.code, orderNo }
    }

    paymentStage = 'confirm'
    emitState(options, 'confirming', '支付处理中，正在确认支付结果…', { productId, orderNo })
    return confirmOrder(orderNo, productId, options, 4)
  } catch (error) {
    const normalized = normalizeError(error, orderNo ? 'PAYMENT_FAILED' : 'CREATE_ORDER_FAILED')
    const logName = paymentStage === 'create' ? 'create order result' : 'payment flow fail'
    debugWarn(logName, {
      productId,
      success: false,
      orderNoExists: Boolean(orderNo),
      payParamsExists: false,
      code: normalized.code,
      message: normalized.message,
      error: sanitizePaymentError(error)
    })
    wx.hideLoading()
    const message = paymentStage === 'confirm'
      ? showDetailedPaymentError('支付结果确认失败', normalized)
      : showDetailedPaymentError('创建订单失败', normalized, { productHint: true })
    emitState(options, 'failed', message, { productId, orderNo, code: normalized.code })
    return { success: false, code: normalized.code, orderNo }
  } finally {
    wx.hideLoading()
  }
}

function resumePendingMembership(options = {}) {
  const orderNo = String(wx.getStorageSync(PENDING_ORDER_KEY) || '')
  if (!orderNo) return Promise.resolve({ success: true, status: 'none' })
  const productId = options.productId || ''
  debugLog('resume pending order', { productId, orderNo })
  emitState(options, 'confirming', '正在刷新支付结果…', { productId, orderNo })
  return confirmOrder(orderNo, productId, options, options.attempts || 1)
}

module.exports = {
  PAYMENT_CONFIGURING_TEXT,
  PAYMENT_PENDING_TEXT,
  PENDING_ORDER_KEY,
  purchaseMembership,
  resumePendingMembership
}
