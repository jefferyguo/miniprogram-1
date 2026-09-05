# 训练内容解析与获取

## 链路规则
1. 本地轻量索引（contentId/day/title/titleStyle/preset/membershipLevel + 占位符material）
2. 按 exact contentId 从 CloudBase trainingContents 获取完整记录
3. 验证返回的 contentId 与请求完全一致，不一致则拒绝
4. 同一记录的 title/content/richContentHtml/style 整体更新
5. 有 richContentHtml 优先渲染，无则用 contentStylePreset 渲染纯文本
6. 缓存键: category + contentId，整体保存不分割
7. 失败可重试，不把占位符当正式正文

## 禁止
- 同Day错误回退（找不到exact contentId时不可用同Day其他记录）
- 标题正文混用（标题和正文必须来自同一contentId）
- placeholder进入AI/作品/快照/正式数据
- 加载失败仍然允许录音/AI/发布
