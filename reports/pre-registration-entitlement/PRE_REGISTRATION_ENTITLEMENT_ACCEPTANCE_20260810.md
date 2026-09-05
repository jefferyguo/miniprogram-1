# PRE-REGISTRATION ENTITLEMENT FINAL REPORT

## Status

**READY_FOR_APPROVAL**

尚未注册小程序的学员可以由管理员按可信手机号预先授予会员权益。正式实现、CloudBase 写入链路、自动领取、统计隔离、导出、PDF、权限回归、390px 页面和生产环境清理均已完成。

## Initial Audit

- 注册用户身份继续只保存在 `users`，待注册授权不会伪造用户。
- 待注册授权复用现有 `phoneEntitlements` 集合，以 `entitlementKind: pre_registration` 区分业务类型。
- 领取入口没有公开 action，只挂接在微信可信手机号绑定事务和受控的服务端 reconciliation 链路。
- 用户端会员内部类型继续只有 `monthly` 和 `yearly`；没有新增 `quarterly` 用户会员类型。
- 支付订单、收入统计和预授权相互隔离，待注册授权不产生支付收入。

## Data Model

预授权记录具备以下核心信息：

- 规范化手机号及脱敏手机号
- 确定性预授权文档 ID
- `pending / claimed / revoked / expired` 四态
- `on_claim / fixed` 两种激活方式
- `monthly / yearly` 会员类型
- 标准套餐周期：季度会员 90 天、年度会员 365 天
- 固定授权起止日期、备注、创建/更新管理员信息
- 领取用户、领取时间、可信领取来源
- 撤销时间、撤销人和撤销原因

同手机号的当前记录固定落在确定性文档 ID；历史归档不会挤掉当前可领取记录。管理员编辑手机号被禁止，录入错误必须撤销后重建。

## Admin UX

管理端“用户与会员管理”新增“待注册授权”工作区，支持：

- 待注册、已领取、已撤销、已过期状态统计
- 手机号/备注搜索、套餐筛选、创建日期筛选和分页
- 创建、编辑、撤销
- 注册后激活与固定时间授权
- 季度会员 90 天、年度会员 365 天
- CSV 导出和经营报告 PDF 汇总
- 管理操作审计

预授权表单不再提供自定义会员天数。固定时间授权仍可由管理员选择真实起止日期；注册后激活由云端强制执行标准套餐周期。

## Claim Flow

1. 管理员按手机号创建待注册授权，仅写入 entitlement 和审计日志。
2. 用户之后通过微信可信手机号完成绑定。
3. 绑定事务按服务端可信手机号读取确定性预授权记录。
4. 事务内原子写入领取状态、用户会员权益和 `PREAUTH_CLAIM` 审计。
5. 重复 reconciliation 保持幂等，不重复延长会员。
6. 管理员保存与用户注册并发时，保存后会立即重试 reconciliation，避免遗留 pending。
7. 未来 fixed 授权保持 scheduled；到达生效时间后由受控读取路径完成成熟同步。

客户端传入的手机号不能作为领取依据，也不存在公开领取 action。

## Membership Timing

- `monthly` 对外为季度会员，注册后激活固定 90 天。
- `yearly` 对外为年度会员，注册后激活固定 365 天。
- 历史预授权即使残留自定义 `durationDays`，领取时也会按 90/365 天收口。
- fixed 授权严格保持管理员配置的起止日期，不重新增加套餐天数。
- 已有有效会员领取新授权时不会缩短原权益。
- 会员到期边界按 Asia/Shanghai 自然日解析，前端与云端一致。

## Statistics

- 待注册授权不会增加总用户数。
- pending 不会增加有效会员数。
- 后台赠送人数按真实领取用户去重。
- 支付会员、后台人工会员和预授权领取来源保持可区分。
- 日/周/月/年趋势和上海时区边界保持原有口径。

## Revenue

生产验收前后收入保持完全一致：

| 范围 | 验收前（分） | 验收后（分） |
| --- | ---: | ---: |
| 今日 | 0 | 0 |
| 本周 | 0 | 0 |
| 本月 | 17970 | 17970 |
| 本年 | 26950 | 26950 |
| 全部 | 26950 | 26950 |

预授权创建、领取、撤销和过期均不计入支付收入。

## Security

- 所有管理员 action 在读取敏感数据前完成管理员鉴权。
- 领取只使用微信服务端返回且已经绑定成功的可信手机号。
- 手机号审计字段只保存脱敏值；CSV 完整手机号仅在管理员导出中出现。
- CSV 包含 UTF-8 BOM，并对公式注入进行转义。
- PDF 不包含手机号明细，中文字体使用项目内最小化 Noto Sans SC 子集及 OFL 许可。
- 当前确定性记录优先读取，`historyArchive` 不参与领取或保存冲突判断。
- 没有公开 claim、测试 fixture 或临时维护 action 留在正式云函数中。

## E2E

真实 CloudBase 生产链路覆盖：

- on_claim 创建、编辑、重复创建拒绝、领取、幂等重复领取
- 季度会员领取后生成 90 天权益并获得训练访问权限
- 已有季度会员领取年度权益，不缩短原到期日
- fixed 生效授权保持配置日期
- 已过期 fixed 不发放有效会员
- 已撤销授权不可领取
- 已注册手机号拒绝创建 pending
- 审计包含 `PREAUTH_CREATE / PREAUTH_UPDATE / PREAUTH_REVOKE / PREAUTH_CLAIM`
- CSV 和真实 CloudBase PDF 生成、下载、渲染
- pending 不改变用户数、会员数或收入

生产测试清理结果：

- 测试用户：6 条已删除
- 测试预授权：5 条已删除
- 测试审计：12 条已删除
- 测试导出文件：2 个已删除
- 用户总数恢复为基线 97
- 测试用户剩余 0
- 测试预授权剩余 0

最终正式部署后只读烟测再次确认：临时 action 返回 `unknown_action`，测试授权为 0，用户总数为 97。

## Regression

- 预授权不会创建伪用户。
- 预授权不会污染收入。
- 普通注册、可信手机号绑定、支付履约和后台人工会员调整保持可用。
- 训练访问规则仍为每模块前三篇免费，会员和管理员权限不受影响。
- 前端与云端仅识别 `monthly / yearly`，没有 `quarterly` 会员类型。
- 390px 页面宽度为 390px，标题、添加按钮和搜索区无横向溢出。
- 390px 预授权套餐仅显示季度 90 天和年度 365 天。
- 页面控制台错误 0，运行时异常 0。

## Second Code Review

独立工程/安全复审最初发现并修复：

1. 同手机号历史记录可能因 20 条查询上限遮挡当前记录。
2. 日期型会员到期时间依赖运行环境时区。
3. 预授权自定义天数可能偏离季度 90 天/年度 365 天规则。

修复后两条独立复审轴再次检查，结果均为：**P0-P2 NONE**。

## Tests

- `node --test cloudfunctions/cloudApi/*.test.js`：65/65 PASS
- 预授权安全、领取、固定日期、幂等、并发和导出测试：PASS
- 上海时区会员到期边界（前端与云端）：PASS
- `node scripts/check-training-access-policy.js`：PASS
- `node scripts/check-training-membership-policy.js`：PASS
- `node scripts/check-quarterly-gate-sync.js`：PASS
- 相关 JS `node --check`：PASS
- `git diff --check`：PASS
- 生产 `cloudApi` 部署：PASS，24 个文件，156.4 KB

## Workspace Boundary

- Git Root：`/Users/jefferyguo/WeChatProjects/miniprogram-1`
- Modified outside miniprogram-1：NONE
- Created outside miniprogram-1：NONE
- Runtime dependency introduced outside miniprogram-1：NONE
- External project modifications：NONE
- Temporary production fixture：REMOVED
- Temporary CloudBase data/files：REMOVED

## Files Changed This Round

### CloudBase and domain logic

- `cloudfunctions/cloudApi/index.js`
- `cloudfunctions/cloudApi/user-membership-admin-service.js`
- `cloudfunctions/cloudApi/pre-registration-entitlement-utils.js`
- `cloudfunctions/cloudApi/operations-report-pdf.js`
- `cloudfunctions/cloudApi/training-access-policy.js`

### Frontend

- `utils/cloud-api.js`
- `utils/training-access-policy.js`
- `pages/admin-members/admin-members.js`
- `pages/admin-members/admin-members.wxml`
- `pages/admin-members/admin-members.wxss`

### Tests and report assets

- `cloudfunctions/cloudApi/pre-registration-entitlement-utils.test.js`
- `cloudfunctions/cloudApi/pre-registration-entitlement-security.test.js`
- `cloudfunctions/cloudApi/user-membership-admin-service.test.js`
- `cloudfunctions/cloudApi/operations-report-pdf.test.js`
- `cloudfunctions/cloudApi/training-access-policy.test.js`
- `cloudfunctions/cloudApi/NotoSansCJKsc-AdminReport.ttf`
- `cloudfunctions/cloudApi/NotoSansCJKsc-AdminReport.LICENSE.txt`
- `reports/pre-registration-entitlement/PRE_REGISTRATION_ENTITLEMENT_ACCEPTANCE_20260810.md`

## Remaining Issues

NONE

**READY_FOR_APPROVAL**
