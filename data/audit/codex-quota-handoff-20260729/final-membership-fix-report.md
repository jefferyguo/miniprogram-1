# 训练会员权限最终修复报告

## 最终状态：READY_FOR_DEPLOYMENT

BLOCKER=0, HIGH=0（经三位独立 Reviewer 确认）

## 核心修复

### 问题1：`resolveTrainingMembershipLevel` 回退到 day/dayNumber
**修复**：废弃该函数。新建 `computeModuleAccessPolicy(activeItems)` — 仅使用 sortOrder 排序后的位置 index 决定权限。`resolveSingleItemPolicy(item)` 仅在已携带 policyPosition 时信任，否则 fail-closed 为 member。

### 问题2：sortOrder <= 3 不等价于"前三篇"
**修复**：`computeModuleAccessPolicy` 先筛选 active 内容，按 sortOrder + contentId 稳定排序，再根据数组下标（0/1/2 = free, >=3 = member）分配权限。完全消除 sortOrder 间隙/重复/缺失的影响。

## 修改文件

| 文件 | 变更 |
|------|------|
| utils/training-access-policy.js | 完全重写：+computeModuleAccessPolicy, +resolveSingleItemPolicy, +compareTrainingPosition, +ACCESS_POLICY_VERSION; -resolveTrainingMembershipLevel, -getDefaultMembershipLevel export, -getExplicitMembershipLevel export |
| cloudfunctions/cloudApi/training-access-policy.js | 同上，前后端完全一致 |
| cloudfunctions/cloudApi/index.js | +resolveDetailItemPolicy, +recomputeCategoryMembershipLevels; getTrainingContents 调用 computeModuleAccessPolicy; getTrainingContentById 调用 resolveDetailItemPolicy; adminSave/Reorder 调用 recomputeCategoryMembershipLevels; buildTrainingConfigInput 不再计算 membershipLevel |
| utils/training-data.js | getResolvedTrainingModules 调用 computeModuleAccessPolicy; normalizeTaskForDisplay/CloudTrainingTask 使用 resolveSingleItemPolicy |
| utils/access-control.js | canAccessTask 使用已 stamped 的 policy 字段 |
| utils/remote-training.js | ACCESS_POLICY_VERSION 缓存校验 |
| pages/admin-mini-config/admin-mini-config.js | buildTrainingLocalItems + mergeCloudItems 调用 computeModuleAccessPolicy |
| pages/task-detail/task-detail.js | 使用 resolveSingleItemPolicy 替换 getDefaultMembershipLevel |
| scripts/check-training-access-policy.js | 全面重写，使用 position-stamped items |
| scripts/check-training-membership-policy.js | 新建 16 项测试 |

## 测试结果

| 测试 | 结果 |
|------|------|
| check-training-access-policy.js | PASS (10 项) |
| check-training-content-full.js | PASS (966 篇) |
| check-training-content-id-consistency.js | PASS |
| check-training-content-legacy-compat.js | PASS |
| check-training-history.js | PASS |
| check-task-content-loading.js | PASS |
| check-task-detail-first-load.js | PASS |
| check-training-title-content-consistency.js | PASS |
| check-phone-login-final.js | PASS (74/74) |
| check-training-membership-policy.js | PASS (16 项) |

## 安全确认

- day/dayNumber/sourceIndex 不在任何权限代码路径中
- 存储的 membershipLevel 不参与权限计算
- 单条详情无 policyPosition 时 fail-closed 为 member
- sortOrder 间隙/重复/缺失时仍恰好前三篇免费
- 前后端 computeModuleAccessPolicy 结果一致
- 缓存版本不符时自动废弃
- 管理端保存/排序后自动重新计算模块权限
- 没有修改文章正文、数量、会员价格、手机号登录、AI次数
- 没有提交 commit
