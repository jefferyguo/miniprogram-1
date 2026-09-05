# 统一登录最终差异摘要

## 本轮认证范围文件

- `app.js`：Cloud 初始化状态机、并发复用、失败/超时清理与重试、错误缓存恢复。
- `utils/auth-state.js`：Level 0/1/2 唯一语义和有效昵称/稳定服务端标识判断。
- `utils/auth.js`：统一认证 session、锁生命周期、stale 识别、安全恢复和高风险防重放。
- `utils/profile-auth.js`：Cloud 屏障、昵称校验、头像上传、云端权威身份/权限合并。
- `utils/phone-auth.js`、`utils/access-control.js`：统一 Level 2 判定和空值安全。
- `utils/login-gate-behavior.js`：tab 页面不再误清有效流程。
- `components/login-gate/login-gate.js/.wxml/.wxss`：昵称输入、手机号步骤、加载/关闭/原生面板状态。
- `components/profile-login-modal/profile-login-modal.js`：资料保存校验。
- `pages/mine/mine.js/.wxml`：常驻 gate、统一两阶段入口、防双击和单次快捷动作。
- `utils/cloud-api.js`、`utils/cloud-upload.js`、`utils/cloudbase-module.js`：Cloud 屏障和脱敏日志。
- `utils/cloud-user.js`：不输出完整身份/手机号或原始错误对象。
- `cloudfunctions/login/index.js`：身份只取 WXContext，新用户确定性文档 ID。
- `cloudfunctions/cloudApi/index.js`：手机号 code 绑定、Level 1 前置检查、错误返回脱敏。
- `scripts/check-unified-auth.js`：69 项回归和压力测试；已从运行包忽略。

## 包体与审计隔离

- `scripts` 与 `data/audit` 已由小程序 `packOptions.ignore` 排除。
- 最终预览包 1,929,017 bytes。

## 工作区状态

- 当前工作区仍包含大量用户此前的训练、AI、管理端、文档和资源修改。
- 本轮未重置、恢复、清理或覆盖这些无关修改。
- 最终统计时有 64 个 tracked 变更文件；另有较多既有未跟踪资料与脚本。
- 当前 diff 中仍可见与本轮无关的训练数据、AI 页面、文档删除/新增等未完成或待用户检查内容；本轮没有擅自处理。
- 未提交 commit。

## 安全

- 审计文件未记录 Cloud 环境 ID、openid、手机号、用户 `_id` 或密钥。
- 文件修复前 hash 见 `baseline.md`；最终文件 hash 已在本轮终端审计中核对。
