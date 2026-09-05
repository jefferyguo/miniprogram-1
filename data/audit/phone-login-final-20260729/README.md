# 手机号即登录最终审计

日期：2026-07-29

## 范围

- 新增 `scripts/check-phone-login-final.js`：登记 74 项最终验收要求，并执行其中可静态/单元验证的项目。
- 新增 `scripts/audit-users-placeholder-nicknames.js`：users 占位昵称迁移审计脚本，默认 dry-run，不访问云端。
- 本轮只新增认证验证/迁移脚本与审计文档；未修改业务代码和云函数。

## 自动化覆盖

`check-phone-login-final.js` 覆盖：

- Guest/手机号即登录两态模型，旧 Level 1 缓存回 Guest。
- `manual_retry` 高风险动作不自动重放，`safe_navigation` 只用于安全刷新。
- 客户端手机号授权只上传一次性 `code`，不传 openid 或手机号。
- 服务端 `PHONE_ALREADY_BOUND` 契约、手机号掩码日志、随机用户名格式、占位昵称替换策略。
- users 占位昵称迁移脚本的随机名格式、占位判断、幂等、重复避让、apply 防护和日志脱敏。

## 未能静态/单元验证

以下项目必须在微信开发者工具体验版或真机中单独验证，本脚本不声称完成：

- 真机微信昵称建议条不再作为必需入口。
- 真实 `getPhoneNumber` 同意、拒绝、取消。
- 全新微信账号冷启动首次手机号登录。
- 真实手机号已绑定其他微信账号的端到端冲突。
- 真实会员权益匹配、弱网时序、iOS/Android 原生授权面板表现。
- 正式 users 数据迁移只读抽样和任何 apply 演练。

## 迁移脚本安全边界

- 默认 dry-run：未提供 `--input` 时只输出空审计结果，未访问云端。
- `--apply` 必须同时提供 `--env`、`--confirm-env`、`--backup`，并设置 `USERS_NICKNAME_MIGRATION_CONFIRM=<env>`。
- `--apply` 拒绝 app.js 当前 `CLOUD_ENV`，避免误操作生产环境。
- 日志只输出脱敏 id 引用、脱敏 openid 引用和 `138****5678` 形式手机号；不输出 openid、完整手机号或完整 `_id`。

## 本轮执行

- 未访问生产云。
- 未执行 `--apply`。
- 未提交真实用户数据备份。
