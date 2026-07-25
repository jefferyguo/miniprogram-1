# 小程序会员虚拟支付配置

会员属于虚拟服务。本项目的季度会员和年度会员只使用微信官方 `wx.requestVirtualPayment`，不会使用普通 `wx.requestPayment` 购买会员，也不会以前端 success 回调直接开通权益。

## 1. 微信公众平台配置

1. 在微信公众平台开通“小程序虚拟支付”能力并完成签约。
2. 在虚拟支付后台使用“道具直购”配置并发布两个道具：
   - `quarterly_membership`：商品名称“杨勤口才训练KEEP季度会员”，价格 2990 分，有效期 90 天；开通后的用户会员类型仍为 `monthly`。
   - `yearly_membership`：商品名称“杨勤口才训练KEEP年度会员”，价格 5990 分，有效期 365 天；开通后的用户会员类型为 `yearly`。
3. 测试阶段优先使用沙箱环境；正式环境需要使用现网 OfferId、现网 AppKey 和已发布的现网道具。
4. 后台道具 ID、价格必须与云函数的 `membership-products.js` 一致，否则微信会拒绝下单。

云端暂时兼容旧版本传入的 `monthly_membership`，并将其映射到 `quarterly_membership` 的 2990 分、90 天和 `monthly` 权益。新版本前端和微信虚拟支付后台只使用 `quarterly_membership`。

官方文档：

- [小程序虚拟支付](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)
- [wx.requestVirtualPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)
- [查询虚拟支付订单](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order)

## 2. CloudBase 集合

手动创建集合：

```text
virtualPaymentOrders
```

集合权限建议设为“所有用户不可直接读写”，只允许 `cloudApi` 云函数访问。推荐为 `orderNo` 建唯一索引，并为 `openid + status` 建普通索引。

订单保存业务单号、用户身份、手机号、商品、金额、订单状态、微信交易号、支付时间和权益发放时间。前端不能直接写订单，也不能把订单改成已支付。

## 3. cloudApi 环境变量

在 CloudBase `cloudApi` 云函数环境变量中配置：

```dotenv
VIRTUAL_PAY_OFFER_ID=your_offer_id
VIRTUAL_PAY_APP_KEY=your_production_virtual_payment_app_key
VIRTUAL_PAY_ENV=0
VIRTUAL_PAY_CURRENCY_TYPE=CNY
WECHAT_MINIPROGRAM_APP_SECRET=your_miniprogram_app_secret
```

- `VIRTUAL_PAY_ENV=0` 表示正式环境，提交审核和正式上线必须使用现网 AppKey。
- `VIRTUAL_PAY_ENV=1` 表示沙箱环境，只用于开发测试，并配套使用沙箱 AppKey。
- 沙箱和正式环境使用不同 AppKey，必须与 `VIRTUAL_PAY_ENV` 匹配。
- `WECHAT_MINIPROGRAM_APP_SECRET` 仅用于云函数把购买时的一次性 `wx.login` code 换成当前用户 `session_key`，以生成官方要求的用户态签名。
- 不要把 AppKey、AppSecret、支付签名或 access token 写入小程序前端、代码仓库或日志。

变量缺失时，`createVirtualPaymentOrder` 返回 `VIRTUAL_PAYMENT_NOT_CONFIGURED`，会员页显示“会员支付能力配置中，请稍后再试。”，不会发起扣款。

## 4. 支付确认与权益发放

当前版本使用微信官方服务端订单查询分支：

1. 前端调用 `createVirtualPaymentOrder` 获取 `signData`、`paySig`、`signature` 和 `mode`。
2. 前端调用 `wx.requestVirtualPayment`。
3. success 后只显示“支付处理中”，再调用 `confirmVirtualPaymentOrder`。
4. 云函数调用 `/xpay/query_order`；只有微信服务端明确返回已支付状态，才调用内部 `fulfillMembershipOrder`。
5. 权益发放成功后，云函数调用 `/xpay/notify_provide_goods` 通知微信已发货。
6. 同一订单通过发放锁幂等处理，不会重复延长会员有效期。

待确认订单号会保存在本机缓存。即使支付 success 回调后小程序异常退出，重新进入会员中心仍会继续查询服务端订单状态。

`handleVirtualPaymentNotify` 目前只保留安全占位，不接受小程序客户端伪造通知。若以后接入 `xpay_goods_deliver_notify`，必须先在 CloudBase 配置微信消息推送，并确认来源校验方式后再启用。

## 5. 部署与测试

1. 右键 `cloudfunctions/cloudApi`。
2. 选择“上传并部署：云端安装依赖”。
3. 在微信开发者工具重新编译小程序。
4. 使用真实测试账号绑定手机号。
5. 先在沙箱验证创建订单、取消支付、支付确认、重复确认和权益顺延。
6. 核对 `phoneEntitlements`、`users`、`virtualPaymentOrders` 三个集合的数据。
7. 验证无误后再切换正式环境，并重新编译上传小程序。

会员开通只以微信服务端订单查询结果为准；客户端回调、客户端订单状态或本地缓存都不能直接开通会员。

## 6. 前端支付排障日志

购买季卡或年卡后，在微信开发者工具 Console 按 `[virtual-payment]` 筛选日志。安全日志会依次显示：

1. `create order start/result`：确认商品 ID、订单号以及是否返回支付参数。
2. `requestVirtualPayment start/success/fail/complete`：确认客户端是否真正拉起虚拟支付。
3. `confirm order start/result`：确认服务端查询到的订单状态。

日志只记录 `productId`、`orderNo`、`status`、`code`、`message` 和是否存在支付参数，不会输出 AppKey、AppSecret、登录 code、支付签名或完整支付参数。

常见错误：

- `VIRTUAL_PAYMENT_NOT_CONFIGURED`：检查本节云函数环境变量，并重新部署 `cloudApi`。
- `VIRTUAL_PAY_OFFER_ID_MISSING`：缺少 OfferID。
- `VIRTUAL_PAY_APP_KEY_MISSING`：缺少当前环境对应的 AppKey。
- `VIRTUAL_PAY_ENV_MISSING`：未配置环境。
- `VIRTUAL_PAY_ENV_INVALID`：环境值不是 `0 / 1`。
- `VIRTUAL_PAY_CURRENCY_TYPE_MISSING`：币种配置缺失。
- `VIRTUAL_PAY_CURRENCY_TYPE_INVALID`：币种不是 `CNY`。
- `WECHAT_MINIPROGRAM_APP_SECRET_MISSING`：缺少小程序 AppSecret。
- `VIRTUAL_PAYMENT_ORDER_STORE_UNAVAILABLE`：`virtualPaymentOrders` 集合不存在或云函数无访问权限。
- `VIRTUAL_PAYMENT_LOGIN_CODE_REQUIRED`：前端版本过旧，需重新编译当前小程序代码。
- `REQUEST_VIRTUAL_PAYMENT_NOT_SUPPORTED`：升级微信客户端或基础库后重试。
- `PAY_PARAMS_MISSING`：检查云函数返回字段和虚拟支付后台商品配置。
- `-15010` 或 `productId 未发布`：检查当前 `env` 对应环境是否已发布 `quarterly_membership / yearly_membership`，并确认没有混用沙箱与现网商品。
- `-15011` 或 `PAYMENT_ILLEGAL_IN_SANDBOX`：官方含义是“现网版本的 `env` 只能是 `0`，不能填 `1`”。沙箱测试需从开发版/预览版进入；体验、审核或正式版本必须使用 `env=0`、现网 AppKey 和现网商品。

前端日志按 `[virtual-payment]` 筛选；云函数日志按 `[virtual-payment-server]` 筛选。日志仅输出配置是否存在、环境数字、商品、金额、订单状态和支付参数字段名，不会输出 OfferID、AppKey、AppSecret、openid、手机号或完整签名。

环境配置必须成套使用：

- `VIRTUAL_PAY_ENV=1`：沙箱环境，使用沙箱 AppKey，商品也必须在沙箱环境可用。
- `VIRTUAL_PAY_ENV=0`：正式环境，使用现网 AppKey；提交审核和正式上线使用。
- 沙箱商品和现网商品不能混用。
- 修改 `cloudApi` 环境变量后，需要重新部署 `cloudApi`，或通过云开发控制台确认新环境变量已经在运行实例中生效。

`short_series_goods` 模式的官方道具字段位于 `signData.productId`。本项目把商品配置中的 `product.productId` 原样写入该字段，并同时传递 `buyQuantity: 1`、数字类型的 `env`、`currencyType` 和 `goodsPrice`。外层 `wx.requestVirtualPayment` 参数仍是 `signData / paySig / signature / mode`，不应额外猜测或改成 `goodsId`。

## 7. 审核前检查清单

1. 已在微信公众平台开通小程序虚拟支付能力。
2. 已配置与当前小程序一致的 OfferID。
3. 已为 CloudBase `cloudApi` 配置现网 AppKey，且没有把密钥写入前端。
4. 已在现网发布“杨勤口才训练KEEP季度会员”（`quarterly_membership`），价格为 2990 分。
5. 已在现网发布“杨勤口才训练KEEP年度会员”（`yearly_membership`），价格为 5990 分。
6. 已确认 iOS 和 Android 均可拉起小程序虚拟支付。
7. 提交审核前使用 `VIRTUAL_PAY_ENV=0` 和现网 AppKey；`VIRTUAL_PAY_ENV=1` 仅用于沙箱测试。
8. 已移除会员购买流程中的联系老师、线下开通和普通支付旁路。
9. 所有会员购买入口最终统一调用 `wx.requestVirtualPayment`。
10. 客户端支付成功后不会直接发放权益，只有 `cloudApi` 确认订单已支付并完成发放后才显示“会员已开通”。
