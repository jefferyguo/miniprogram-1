# 微信审核失败整改验收报告

## 1. Git HEAD

`179541d7b2314499fefe2898029a2c55b50e827f`

## 2. 初始工作区状态

任务开始时工作区已包含此前多轮功能开发的大量未提交修改和未跟踪文件。整改前已记录 `git status --short`；本轮未执行 `git reset`、`git clean`、`git checkout`、`git restore`、commit 或 push，也未覆盖无关工作区改动。

## 3. 审核失败原因与代码根因

1. 声音/声纹授权：三个真实采音调用点仅依赖系统 `scope.record` 或相机权限，没有独立《声纹授权协议》、业务层同意记录和撤回入口。
2. 登录官方混淆：手机号能力前置 UI 存在“手机号授权登录”“微信手机号一键绑定”“微信昵称”等字样。原生 `getPhoneNumber` 链路本身正确，问题位于自有页面和提示文案。

## 4. 所有录音和采音入口

| 入口 | 真实采音调用 | 覆盖范围 | 统一门禁 |
| --- | --- | --- | --- |
| `pages/task-detail/task-detail` | `RecorderManager.start()` | 朗诵、复述、即兴话题、演讲、普通话、领导发言；主持内容沿用普通话/主持模块 | 是 |
| `pages/extra-training/extra-training` | `RecorderManager.start()` | 每日金句、随机话题、绕口令等额外训练 | 是 |
| `pages/video-record/video-record` | `CameraContext.startRecord()`，同时采集音轨 | 所有从主训练或额外训练进入的录像训练 | 是 |

未发现自动开始录音，也未发现第四个生产采音调用点。训练首页、模块列表和详情路由均最终进入上述页面，没有独立绕过录制器。

## 5. 独立《声纹授权协议》

页面路径：`/pages/voiceprint-agreement/voiceprint-agreement`

协议独立于隐私政策，并从录制前授权弹层、隐私政策和设置页进入。

## 6. 协议正文关键内容

- 仅在用户主动点击开始录音或开始录像后采集声音，不在后台自动录音。
- 用途限于口才训练、语音内容识别、AI 训练点评与反馈、保存用户选择保留的作品。
- 如实说明本地临时文件、云开发存储、腾讯云语音识别和云开发 AI 处理流程。
- 明确本小程序不把声音用于身份认证或声纹身份识别，也不用于广告投放。
- 未编造固定保存期限；如实说明当前没有统一自动到期删除期限及用户可用的数据处理渠道。
- 明确用户可拒绝、撤回、删除可见训练记录或联系课程老师申请处理相关数据。

## 7. 授权状态保存机制

本地键：`voiceConsentRecord`

```json
{
  "accepted": true,
  "version": "2026-08-10",
  "acceptedAt": 1786348800000
}
```

默认无记录即未同意；协议版本不一致时旧记录失效。授权只在用户主动点击“同意并继续”后保存，不与登录、注册、会员购买或隐私政策同意绑定。

## 8. 撤回授权机制

“我的 → 设置 → 声音信息授权管理”支持查看协议及撤回业务层授权。撤回会删除 `voiceConsentRecord`，不会伪造或更改系统麦克风权限。撤回后下一次录音或录像必须重新单独同意。

## 9. RecorderManager 统一门禁

统一服务：`utils/voice-consent.js`

`ensureVoiceConsentAndMicPermission(page)` 严格按以下顺序执行：

1. 检查独立业务授权；
2. 未同意时展示授权弹层；
3. 用户明确同意后保存版本和时间；
4. 检查/请求系统 `scope.record`；
5. 两项均通过后才允许 `RecorderManager.start()` 或 `CameraContext.startRecord()`。

拒绝授权时不会开始录制、上传声音、创建空作品或生成训练记录。双击保护避免并发弹层和重复启动。

## 10. 登录页官方混淆元素整改

登录前置 UI 未引用微信官方 Logo；自动扫描结果为 0。已移除登录/手机号绑定界面中的“微信”“WeChat”及容易造成官方混淆的授权式文案，保留项目自身品牌“杨勤口才训练KEEP”。

## 11. 登录文案修改前后

| 修改前 | 修改后 |
| --- | --- |
| 手机号授权登录 | 手机号快捷登录 |
| 微信手机号一键绑定 | 手机号快捷登录 |
| 手机号授权 | 账号状态 / 手机号快捷登录 |
| 请输入微信昵称 | 请输入昵称 |
| 手机号授权失败 | 手机号快捷登录失败 |

原生 `open-type="getPhoneNumber"`、`bindgetphonenumber`、可信手机号 code 绑定和预注册 entitlement 领取链路均保留。

## 12. 修改文件完整列表

### 新增

- `utils/voice-consent.js`
- `utils/voice-consent.test.js`
- `components/voice-consent-modal/voice-consent-modal.js`
- `components/voice-consent-modal/voice-consent-modal.wxml`
- `components/voice-consent-modal/voice-consent-modal.wxss`
- `components/voice-consent-modal/voice-consent-modal.json`
- `pages/voiceprint-agreement/voiceprint-agreement.js`
- `pages/voiceprint-agreement/voiceprint-agreement.wxml`
- `pages/voiceprint-agreement/voiceprint-agreement.wxss`
- `pages/voiceprint-agreement/voiceprint-agreement.json`
- `scripts/check-review-privacy-compliance.js`
- `reports/privacy-review-remediation/*`

### 修改

- `app.json`
- `pages/task-detail/task-detail.js`
- `pages/task-detail/task-detail.wxml`
- `pages/extra-training/extra-training.js`
- `pages/extra-training/extra-training.wxml`
- `pages/video-record/video-record.js`
- `pages/video-record/video-record.wxml`
- `pages/privacy/privacy.js`
- `pages/privacy/privacy.wxml`
- `pages/privacy/privacy.wxss`
- `pages/settings/settings.js`
- `pages/settings/settings.wxml`
- `components/login-gate/login-gate.wxml`
- `components/login-gate/login-gate.wxss`
- `pages/login/login.wxml`
- `pages/phone-auth/phone-auth.wxml`
- `components/profile-login-modal/profile-login-modal.wxml`
- `utils/profile-auth.js`
- `utils/cloud-api.js`
- `cloudfunctions/cloudApi/index.js`（仅中性化两处手机号登录错误文案）
- `scripts/check-phone-login-final.js`（同步既有测试夹具与当前生产契约，不改生产登录逻辑）

未修改训练数据、contentId、trainingContents、会员价格、支付、AI 点评算法、ASR SDK、管理端或 tabBar。

## 13. 自动化测试结果

- `node --test cloudfunctions/cloudApi/*.test.js utils/voice-consent.test.js`：70/70 PASS。
- `scripts/check-review-privacy-compliance.js`：全部指标 PASS，采音绕过路径 0。
- `scripts/check-privacy-consent-review.js`：24/24 PASS。
- 所有本轮修改 JS：`node --check` PASS。
- `app.json` JSON 解析 PASS。

关键指标：

```text
VOICE_CONSENT_AGREEMENT_PAGE_EXISTS = true
VOICE_CONSENT_IS_INDEPENDENT = true
VOICE_CONSENT_DEFAULT_ACCEPTED = false
RECORDING_WITHOUT_VOICE_CONSENT = blocked
RECORDING_AFTER_DECLINE = blocked
RECORDING_AFTER_ACCEPT = allowed_after_system_permission
VOICE_CONSENT_WITHDRAW_WORKS = true
ALL_RECORDING_ENTRY_POINTS_GATED = true
RECORDING_BYPASS_PATH_COUNT = 0
LOGIN_WECHAT_TEXT_COUNT = 0
LOGIN_WECHAT_LOGO_COUNT = 0
LOGIN_OFFICIAL_CONFUSION_ELEMENT_COUNT = 0
LOGIN_PRIMARY_TEXT = 手机号快捷登录
GET_PHONE_NUMBER_FLOW_WORKS = true
```

## 14. Login / getPhoneNumber 回归

- `scripts/check-phone-login-final.js`：74/74 PASS。
- `scripts/check-unified-auth.js`：PASS。
- `getPhoneNumber` 原生事件、code 传递、`bindPhoneWithCode`、PHONE_ALREADY_BOUND 和可信手机号服务端绑定契约均未回归。

## 15. Pre-registration entitlement 回归

CloudApi Node 测试覆盖预授权创建、领取、重复领取、撤销、到期、fixed/on_claim、并发绑定及可信手机号约束，全部 PASS。

`PRE_REGISTRATION_ENTITLEMENT_REGRESSION = 0`

## 16. 会员回归

- `scripts/check-quarterly-gate-sync.js`：PASS。
- 季度与年度门禁未被本轮改动。
- CloudApi 会员、有效期、支付履约与人工授权测试全部 PASS。

`MEMBERSHIP_REGRESSION = 0`

## 17. 七类训练录音入口回归

朗诵、复述、即兴话题、演讲、主持、普通话和领导发言均复用 `task-detail` 的统一录音入口；录像统一进入 `video-record`。专项扫描从生产代码反向枚举真实采音调用，确认所有调用均位于门禁之后。

- `scripts/check-training-access-policy.js`：PASS。
- `scripts/check-training-membership-policy.js`：PASS。
- 训练数据及路由结构未修改。

`TRAINING_REGRESSION = 0`

## 18. 390px 页面结果

微信开发者工具 iPhone 12/13 (Pro)，`390 × 753`，基础库 `3.16.1`：

- 登录页横向溢出：0
- 登录弹层横向溢出：0
- 声音授权弹层横向溢出：0
- 声纹授权协议页横向溢出：0
- 设置页横向溢出：0
- 默认未授权：PASS
- 拒绝阻止录像：PASS
- 同意后进入系统权限/录像链路：PASS
- 撤回后重新询问：PASS

## 19. 控制台错误

390px 自动化全过程：

```text
CONSOLE_ERROR_COUNT = 0
EXCEPTION_COUNT = 0
```

## 20. 微信开发者工具编译结果

- AppID：`wxbc1e41b9807bdb23`
- CLI preview：PASS
- 最终预览包体：`1,748,847 bytes（1.7 MB）`
- WXML/组件注册/页面注册均通过开发者工具编译。

本轮修改了 `cloudfunctions/cloudApi/index.js` 中两处中性登录错误文案；前端需重新编译上传，若希望云端错误文案同步生效，还需重新部署 `cloudApi`。无需部署 AI 或 ASR 云函数。

## 21. 审核截图路径

- `reports/privacy-review-remediation/login-page-390.png`
- `reports/privacy-review-remediation/login-gate-390.png`
- `reports/privacy-review-remediation/voice-consent-390.png`
- `reports/privacy-review-remediation/voiceprint-agreement-390.png`
- `reports/privacy-review-remediation/voice-settings-390.png`

自动化证据：`reports/privacy-review-remediation/automation-result.json`

## 最终审核指标

```text
VOICEPRINT_AGREEMENT_INDEPENDENT = true
VOICEPRINT_AGREEMENT_ENTRY_VISIBLE = true
VOICEPRINT_PURPOSE_DISCLOSED = true
VOICEPRINT_METHOD_DISCLOSED = true
VOICEPRINT_USAGE_DISCLOSED = true
VOICE_CONSENT_REQUIRED_BEFORE_RECORDING = true
VOICE_CONSENT_DEFAULT_CHECKED = false
VOICE_CONSENT_DECLINE_BLOCKS_RECORDING = true
VOICE_CONSENT_WITHDRAW_SUPPORTED = true
RECORDING_BYPASS_PATH_COUNT = 0
LOGIN_WECHAT_TEXT_COUNT = 0
LOGIN_WECHAT_OFFICIAL_LOGO_COUNT = 0
LOGIN_TENCENT_OFFICIAL_CONFUSION_COUNT = 0
LOGIN_PRIMARY_LABEL = 手机号快捷登录
GET_PHONE_NUMBER_REGRESSION = 0
PRE_REGISTRATION_ENTITLEMENT_REGRESSION = 0
MEMBERSHIP_REGRESSION = 0
TRAINING_REGRESSION = 0
390PX_HORIZONTAL_OVERFLOW = 0
CONSOLE_ERROR_COUNT = 0
GIT_DIFF_CHECK = PASS
BLOCKER = 0
```

VOICEPRINT_AUTHORIZATION_COMPLIANCE_FIXED

LOGIN_OFFICIAL_CONFUSION_FIXED

PRIVACY_REVIEW_REMEDIATION_COMPLETE

READY_FOR_CODE_REVIEW

BLOCKER = 0
