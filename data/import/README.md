# 训练数据导入说明

本目录的 v3/v4 产物由 `scripts/parse_docx.py` 直接解析 2026-07-20 的三份源 DOCX 生成。

- `reading_import_v3.json`：朗诵 214 条。
- `retell_import_v3.json`：复述 255 条。
- `speech_items_v3.json`：演讲 111 条。
- `yangqin_training_v4_all.json`：三类云端导入汇总，共 580 条。
- `parse_summary.json`：数量、首尾、重复标题、正文长度和内容摘要校验结果。

`yangqin_training_replacement_reading_retelling_full.json` 是旧版 63/101 条数据，仅作历史参考，不得用于本轮正式导入。

正式写入 CloudBase 前先运行：

```bash
node scripts/import-reading-retelling-to-cloud.js --dry-run
```

正式模式必须显式添加 `--apply`，脚本会在写入前备份目标分类，并在写入后回查数量及其他分类变化。

为保证历史作品可按原 `contentId` 找回旧原文，导入脚本会将本轮 active 云端 ID 写为
`<category>-v4-day-<day>`；JSON 中经验证的源 `contentId` 保留在 `sourceContentId`。旧记录不删除，而是保留原文档 ID
和原 `contentId`，并标记为 `active=false` / `status=archived` / `visible=false`。
