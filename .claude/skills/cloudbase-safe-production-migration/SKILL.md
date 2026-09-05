# CloudBase安全生产迁移

## 适用场景
将训练内容数据安全迁移至正式CloudBase trainingContents集合。

## 核心规则
1. 固定migrationId、category、预期条目数
2. 不接受客户端传入任意集合名或查询条件
3. 服务端requireAdmin鉴权，写操作需super_admin
4. 历史作品审计 → safeToMigrate判断
5. 真实CloudBase备份 + SHA-256 manifest
6. dry-run确认writeCount=0
7. 分批写入，每批回读校验
8. 旧记录归档（active=false, visible=false, status=archived），不硬删除
9. verify重新查询CloudBase
10. verify失败自动rollback
11. 完成后移除临时迁移入口

## 禁止
- 跳过审计/备份/dry-run/verify
- 通用数据库工具设计
- 接受任意集合名或查询条件
- 硬删除记录
- 修改其他category
- 弱化管理员鉴权
