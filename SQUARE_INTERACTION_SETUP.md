# 表达广场点赞、评论与违禁词配置

## 1. CloudBase 集合

部署新版 `cloudApi` 前，请手动创建以下集合：

```text
squareLikes
squareComments
commentForbiddenWords
```

建议集合权限统一设置为“所有用户不可直接读写”，只允许 `cloudApi` 云函数访问。小程序前端不应直接调用数据库。

建议索引：

- `squareLikes`：`workId + status`、`userOpenid + status`。
- `squareComments`：`workId + status + createdAt`。
- `commentForbiddenWords`：`status + updatedAt`、`normalizedWord`。

点赞记录使用由 `workId + userOpenid` 计算出的确定性文档 ID，因此同一用户对同一作品只会有一条点赞记录；重复点击只切换 `active / canceled`。

## 2. 违禁词初始化

集合不会在云函数启动时自动写入。管理员可调用一次：

```json
{
  "action": "adminInitForbiddenWords"
}
```

该 action 复用小程序管理员鉴权，只补充尚不存在的建议初始词，不会覆盖管理员已经维护的记录。

管理员维护 action：

- `adminListForbiddenWords`
- `adminUpsertForbiddenWord`
- `adminEnableForbiddenWord`
- `adminDisableForbiddenWord`
- `adminDeleteForbiddenWord`

`disabled / deleted` 状态的规则不会参与评论匹配。删除为软删除。

## 3. 发布与验证

1. 创建三个集合并配置权限、索引。
2. 上传并部署 `cloudfunctions/cloudApi`，选择云端安装依赖。
3. 使用管理员账号调用 `adminInitForbiddenWords`。
4. 重新编译小程序。
5. 使用已绑定手机号的普通账号测试点赞、取消点赞、评论和删除自己的评论。
6. 验证“加微信了解”“加 微 信”“加-微信”均被拦截，普通评论可以发布。

评论拦截只返回统一提示，不会把命中的具体违禁词、openid 或手机号返回给普通用户。
