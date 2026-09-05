# 杨勤口才训练 KEEP：训练内容系统最终闭环报告

生成日期：2026-08-01（Asia/Shanghai）

## 1. 两个项目的 Git HEAD 和工作区状态

| 项目 | 路径 | HEAD | 当前状态 |
|---|---|---|---|
| 微信小程序 | `/Users/jefferyguo/WeChatProjects/miniprogram-1` | `179541d7b2314499fefe2898029a2c55b50e827f` | 脏工作区：80 个修改、4 个删除、54 个未跟踪项 |
| 管理端 | `/Users/jefferyguo/koucai-content-dashboard` | `ed0f1e945d7b9d058975c415e2612a2dc38141cf` | 脏工作区：11 个修改、16 个未跟踪项 |

本轮没有执行 `git reset`、`git clean`、`git restore`、整文件回滚或 commit；现有无关修改全部保留。两个项目均通过 `git diff --check`。

## 2. 六个权威源文件

| moduleId | 权威 DOCX 完整路径 | 原始记录 | 解析记录 |
|---|---|---:|---:|
| `topic` | `/Users/jefferyguo/WeChatProjects/miniprogram-1/resources/training-source/0728-final/即兴讲话0728（定稿，未上传）(1).docx` | 276 | 276 |
| `reading` | `/Users/jefferyguo/WeChatProjects/miniprogram-1/resources/training-source/0728-final/朗诵训练0728（已定稿，未上传）.docx` | 216 | 216 |
| `leaderSpeech` | `/Users/jefferyguo/WeChatProjects/miniprogram-1/resources/training-source/0728-final/领导发言0728（定稿，未上传）.docx` | 24 | 24 |
| `retell` | `/Users/jefferyguo/WeChatProjects/miniprogram-1/resources/training-source/0728-final/每日复述练嘴0728（定稿，未上传）.docx` | 257 | 257 |
| `speech` | `/Users/jefferyguo/WeChatProjects/miniprogram-1/resources/training-source/0728-final/演讲训练0728（定稿，未上传）.docx` | 116 | 116 |
| `mandarin` | `/Users/jefferyguo/WeChatProjects/miniprogram-1/resources/training-source/0728-final/主持、普通话声音训练0728（定稿，未上传）.docx` | 77 | 77 |

`SOURCE_FILE_COUNT = 6`，原始物理记录、解析记录和 canonical 均为 966。

## 3. 源文件解析数量与质量

- `CANONICAL_TOTAL = 966`
- `EMPTY_TITLE = 0`
- `EMPTY_CONTENT = 0`
- `TITLE_CONTENT_MISMATCH = 0`（966/966 标题和正文逐条与源记录一致）
- `DAY_ORDER_ERROR = 0`
- 格式异常、截断征兆、字段错位：0
- 原始 `retell sourceDay=118` 出现两次；按物理顺序保留，`sourceDay` 仅用于审计。

完整证据见 `../training-source-audit/`。

## 4. 内容问题与自动处理

发现两组源文件真实重复物理记录，未去重，分别保留独立永久 ID：

1. `topic` 源位置 53/55：`即兴话题：格局，决定了你能看到多远`
2. `topic` 源位置 54/56：`即兴话题：眼界和心胸，哪个更重要`

自动处理仅限换行、不可见字符和字段边界标准化；没有编造正文，没有为凑数复制文章。`malformed-records.json` 与 `empty-content.json` 均为空数组。

## 5. 修改前后的数据流

修改前的故障链：本地目录与云端旧目录逐条合并，旧 day 型 ID 与永久 ID 并存，列表可能变成 552；详情页字段 `content/material` 判定不一致，网络/找不到会误报下架；管理端可能只保存自己的快照。

最终链路：

```text
六个 DOCX
  -> 稳定 sourceKey + 永久 ID manifest
  -> canonical-training-contents.json（966 篇完整正文，仅构建/迁移）
  -> generated-training-data.js（966 条轻量目录，无正文）
  -> 受控迁移至 CloudBase trainingContents（线上正文权威源）

小程序列表：本地轻量目录立即可用 -> 云端按模块 catalog 严格校验 -> 整模块原子替换
小程序详情：route contentId -> 精确缓存 -> getTrainingContentById -> 校验 ID/status/version -> content -> UI 边界 material
管理端发布：同一永久 contentId + expectedContentVersion -> CloudBase -> 服务端校验 -> 独立回读校验
```

## 6. Canonical 与 manifest

- Canonical：`data/import/0728-final/canonical-training-contents.json`
- Manifest：`data/import/0728-final/training-content-id-manifest.json`
- 轻量目录：`utils/generated-training-data.js`
- Manifest schema：3；`articles = 966`
- `PERMANENT_CONTENT_ID_COUNT = 966`
- ID 正则：`^tc_[0-9a-f]{32}$`
- `DUPLICATE_CONTENT_ID = 0`
- `DUPLICATE_MODULE_DAY = 0`
- Canonical 语义 Hash：`3957af640b62abfab7721e900a61a32863a4c32cfe1b0416a2855211f2be4783`
- 轻量目录正文键数量：0；完整正文 bundle 数量：0
- 8 个 manifest fixture（reorder/insert/title edit/content edit/双编辑/delete/真实重复/歧义）全部通过。

## 7. CloudBase 迁移前统计

目标环境：`cloud1-d0geb9qt9d29ee6fc`，集合：`trainingContents`。

- 迁移前 `trainingContents = 468`
- `trainingContentModules = 0`
- `trainingContentRevisions = 0`
- `submissions = 347`
- Dry-run：创建 965、保留 1、删除旧记录 467、冲突 0
- 历史作品引用计划：183；永久 ID 映射 39；仅保留历史快照 144

## 8. Dry-run、备份、Apply 与 Verify

- 正式 migrationId：`training-permanent-id-1785587497142`
- 云端备份：`training-content-backups/training-permanent-id-1785587497142-pre-migration.json`
- backupHash：`de5526b44f2b124b5321335dfcb2d3d219e83eccb831a941a09323d6aa16cd66`
- fileHash：`67f91cd8b4f621569185b061efaa316815bb4884c2f0094c602319bbfef9dd40`
- 本次已完成的云端执行证据顺序：永久记录 upsert -> legacy 删除 -> 历史作品引用 -> 六模块元数据 -> 回读 Verify；本次各阶段全部成功，没有产生悬空引用。
- 独立复审后，永久迁移工具进一步收紧为：永久记录 upsert -> 全量存在性验证 -> 二次复核并迁移作品引用 -> 确认无剩余旧引用 -> legacy 删除。`trainingContents` 与 `submissions` 都有计划签名、逐记录并发指纹和删除前保护；并发修改会以 `MIGRATION_CONCURRENT_MODIFICATION` 阻断。

真实云端结果：

```text
CLOUD_ACTIVE_TOTAL = 966
CLOUD_PERMANENT_ID_COUNT = 966
CLOUD_OLD_ID_COUNT = 0
CLOUD_DUPLICATE_CONTENT_ID = 0
CLOUD_DUPLICATE_MODULE_DAY = 0
CLOUD_EMPTY_TITLE = 0
CLOUD_EMPTY_CONTENT = 0
CLOUD_CANONICAL_FIELD_MISMATCH = 0
CLOUD_MISSING_CANONICAL = 0
```

## 9. 第二次 Apply 幂等性

真实 Verify 返回：`SECOND_APPLY_CHANGE_COUNT = 0`，冲突 0，剩余作品引用更新 0。

本地 migration fixture 同样验证：首次创建 966，第二次变更 0；管理员较新编辑、Dashboard 编辑和较新云端版本均会阻断默认同步。

## 10. Reading Day 5 四方验证

- 永久 ID：`tc_ffba14dfb5c975ea867db08fdc6bdc5c`
- 标题：`每日练嘴：别让“我不配”，拖垮你的人生`
- 源文件正文：非空
- Canonical 正文：非空
- CloudBase/CloudApi：`found = true`，ID/标题/正文完全一致
- 正文长度：727；`contentVersion = 1`；`status = active`
- 页面：`CONTENT_READY`，标题一致，正文完整，`falseDelistedMessageCount = 0`

## 11. 每模块抽样

对六个模块各取第一篇、中间篇、最后一篇，共 18 条，通过真实 CloudApi 永久 ID 查询；18/18 `responseOk = true` 且标题、ID、正文校验通过。模块云端 catalog 数量分别为 276/216/24/257/116/77。

## 12. CloudApi 修改和部署

已统一并部署：

- `getTrainingContentById(contentId)`：仅永久 ID 精确读取，返回规范 `content`。
- `getTrainingCatalogByModule(moduleId)`：只返回轻量字段，不下发批量正文。
- 管理端保存：永久 ID、乐观锁、版本自增、服务端写后校验和审计。
- 六主模块禁止普通接口新增、下架、删除和排序；结构变更只能走受控导入。
- `getTrainingContents` 空集合/集合不存在时返回本地 fallback，不使页面空白。

最新 `cloudApi` 已通过微信开发者工具 CLI 部署（7 个文件，约 55.1 KB）；随后真实 catalog、详情、编辑、冲突和恢复回读均通过。

## 13. 管理端数据流与同步

CloudBase `trainingContents` 是发布权威源。Dashboard 的 PostgreSQL/Prisma 仅保留草稿、同步快照和发布状态：`draft/publishing/published/publish_failed`。

发布必须满足：CloudApi 写入成功且服务端 verification 匹配；随后优先执行独立回读。CloudApi 已确认写入而独立回读短暂失败时，可使用服务端已验证响应，避免假失败；真正失败会持久化 `publish_failed`，不会显示假成功。

小程序管理页与 Dashboard 均已隐藏六主模块的新增、排序、下架、归档/删除入口，只保留标题、正文及现有样式编辑，并明确提示“结构调整需受控导入”。

## 14. 管理端真实编辑验证

真实编辑对象：`reading Day 1 / tc_4c646238524a9c643cc1a25cd2b06e96`。

- 编辑：版本 3 -> 4
- 写入校验：matched
- 云端 catalog 新标题：立即可见
- 详情正文：立即可见
- 旧版本写入：以 `CONTENT_VERSION_CONFLICT` 拒绝
- 恢复 canonical：版本 4 -> 5
- 最终 catalog 与详情回读：均恢复 canonical
- `ADMIN_FALSE_SUCCESS_COUNT = 0`

## 15. 远程 catalog 同步

- 本地目录只作稳定 fallback。
- 云端按模块 catalog 验证 ID、module/day 唯一、day 连续、sortOrder、status、数量和 schema。
- 有效远程目录整模块原子替换；不逐条 merge。
- 人工构造 552 条 topic 目录被拒绝，页面继续保持 276。
- 管理端标题变更后，真实 catalog 回读立即可见。

## 16. 小程序列表和详情运行验证

微信开发者工具 automator 真机页面证据：

| 模块 | 页面可见数 | 全部永久 ID |
|---|---:|---|
| topic | 276 | true |
| reading | 216 | true |
| leaderSpeech | 24 | true |
| retell | 257 | true |
| speech | 116 | true |
| mandarin | 77 | true |

详情页只按 `contentId` 加载，不按 day/标题查询；页面卸载或路由 revision 变化后，旧响应不能覆盖新页面。网络失败显示重试提示，`found=false` 显示“内容同步中或暂时无法获取”，只有明确 inactive 才显示已下架。

## 17. 会员、权限与进度稳定性

- 六模块权限策略统一：非会员按稳定排序前 3 篇免费，会员/管理员全量访问。
- 旧云端 `membershipLevel` 不能覆盖当前策略；inactive 不参与排序。
- 列表使用完整 catalog 快照，不会因远程响应拼接而闪成 552。
- 完成状态按 `contentId`，不按 day。
- 页面自动化未观察到总数变化或权限闪回：`VISIBLE_COUNT_CHANGED_AFTER_ASYNC = 0`，`ACCESS_POLICY_FLASH_COUNT = 0`。
- 季度会员回归：`quarterly_membership / 3990 / 90 天 / membershipType=monthly / quarterlyPurchaseEnabled=true`。
- 年度价格保持 `5990`，其他计划价格未改。

## 18. 正文缓存

- 键：`training-content:<contentId>`
- schema、ID、status、标题、正文和 contentVersion 全部校验。
- LRU 上限：40 篇；损坏缓存删除。
- 在线时缓存只做快速 fallback，仍会向云端复核；云端 inactive/notFound 会清缓存。
- 并发请求键已改为 `contentId:expectedVersion`；不同期望版本不复用 Promise。
- 较晚返回的低版本正文不能覆盖高版本缓存。
- 缓存清理不触碰登录、会员、作品、点评或支付数据。

## 19. 编译和主包体积

微信开发者工具 CLI Preview 成功：

- 总包：`1,623,115 bytes`
- `1,585.07 KiB / 1.548 MiB`
- `< 2 MiB = true`
- `PREVIEW_ERROR_80051 = 0`
- `LOCAL_FULL_CONTENT_BUNDLE_COUNT = 0`

`project.config.json` 明确排除 cloudfunctions、scripts、reports、backup、canonical/import 与源 DOCX。

## 20. 本任务修改/生成文件

主小程序的训练闭环文件：

- 构建与身份：`scripts/build-training-content-0728.py`、`scripts/training_id_manifest.py`、`scripts/test_training_id_manifest.py`
- 审计与迁移：`scripts/generate-training-source-audit.py`、`scripts/audit-training-source-sync.js`、`scripts/migrate-training-contents-0728.js`
- 回归脚本：`scripts/check-task-content-loading.js`、`scripts/check-task-detail-first-load.js` 及 `scripts/check-training-*.js` 训练矩阵
- 数据：`resources/training-source/0728-final/`、`data/import/0728-final/`、`utils/generated-training-data.js`
- 云端：`cloudfunctions/cloudApi/index.js`、`cloudfunctions/cloudApi/training-access-policy.js`、`cloudfunctions/cloudApi/training-content-compat.js`
- 运行时：`utils/training-data.js`、`utils/remote-training.js`、`utils/cloud-api.js`、`utils/training-access-policy.js`、`utils/training-content-state.js`
- 页面：`pages/training/training.*`、`pages/module-detail/module-detail.*`、`pages/task-detail/task-detail.*`
- 小程序管理：`pages/admin-mini-config/admin-mini-config.js/.wxml/.wxss`
- 打包：`project.config.json`
- 证据：`reports/training-source-audit/`、`reports/training-final-closure/`、`reports/runtime-qa/`

管理端训练闭环文件：

- `app/dashboard/content-center/page.tsx`
- `app/api/dashboard/training-contents/**`
- `app/api/dashboard/content-configs/**`
- `lib/contentCenter.ts`、`lib/trainingContentContract.ts`、`lib/trainingContentContract.test.ts`
- `lib/cloudbaseHttp.ts`、`lib/cloudbaseSync.ts`、`lib/cloudbaseWrites.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260701120000_content_center/`
- `prisma/migrations/20260801120000_training_content_publish_contract/`

工作区中另有登录、隐私、会员、作品、AI 等既存未提交修改；本轮未回滚、未宣称为训练闭环改动。关键新增脚本和 Dashboard 内容中心当前仍是未跟踪文件，未来提交时必须完整纳入。

## 21. 测试命令与结果

- `python3 scripts/build-training-content-0728.py --check`：通过，966 条与六模块计数正确。
- `python3 scripts/test_training_id_manifest.py`：8/8 通过。
- `node scripts/check-training-final-closure.js`：通过。
- 16 个训练/详情检查脚本矩阵：16/16 通过。
- `node scripts/check-training-migration-fixture.js`：通过，含作品引用并发保护。
- `node scripts/check-training-runtime-final.js`：通过，含 552 拒绝、网络状态、LRU、版本并发。
- `node scripts/check-training-access-policy.js`：全部通过。
- `node scripts/check-training-membership-policy.js`：16 项全部通过。
- 变更/新增 JS `node --check`：78 个通过；刻意保留的损坏备份 fixture 未纳入运行时检查。
- Dashboard `npm run test:training-content`：5/5 通过。
- Dashboard `npm run lint`：通过。
- Dashboard `npm run build`：通过，TypeScript 与 40 个路由构建成功。
- 微信开发者工具 `cli preview`：通过，1.548 MiB。
- 两个项目 `git diff --check`：通过。
- 独立只读复审：No blocking findings。

## 22. 自动化运行证据

- `training-content-cloud-migration-evidence.json`：真实迁移全阶段与最终 Verify。
- `training-cloudapi-live-evidence.json`：六模块 catalog、18 个样本和 Reading Day 5。
- `training-admin-roundtrip-evidence.json`：真实编辑、传播、冲突与恢复。
- `training-structure-guard-evidence.json`：主模块新增/删除/排序保护。
- `training-pages-live-evidence.json`：六模块页面与 Reading Day 5。
- `yangqin-reading-day5.png`：Reading Day 5 页面截图。
- `../runtime-qa/preview-info.json` 与 `preview.png`：最新编译和预览包。

## 23. 真实限制

1. 两组 topic 完全重复内容来自源 DOCX 的独立物理记录，按规则保留，不是导入重复。
2. 当前 shell 没有明文 CloudBase SecretId/SecretKey，独立 Node SDK `--verify` 会返回 `WAITING_FOR_CLOUDBASE_CREDENTIALS`；本轮没有索取或打印密钥。真实迁移 Verify、CloudApi 实时查询、页面自动化和管理端真实回写已通过已部署云函数完成，因此不构成训练闭环 blocker。
3. Dashboard 在生产服务器发布时仍需配置其既有 CloudBase 管理凭据/令牌；缺失时会正确落为 `publish_failed`，不会假成功。CloudApi 的真实写入/回读契约已通过小程序管理端和线上函数验证。
4. 当前两个仓库都有大量既存未提交/未跟踪改动；按要求未提交 commit，也未清理 `.DS_Store`、`__pycache__` 或其他无关文件。
5. 登录/隐私专项脚本不属于本任务；现有旧 fixture 未附带新隐私同意时有 3 项预期失败，不影响训练内容、CloudBase、管理端或运行时验收。

TRAINING_SOURCE_CONTENT_AUDIT_COMPLETE

TRAINING_CONTENT_CLOUD_MIGRATION_COMPLETE

TRAINING_CONTENT_RUNTIME_FIXED

ADMIN_CLOUD_SYNC_FIXED

TRAINING_CONTENT_UPDATE_WORKFLOW_COMPLETE

BLOCKER = 0
