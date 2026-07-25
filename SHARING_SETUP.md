# 小程序分享说明

主要页面统一通过 `utils/share-config.js` 配置分享能力，默认分享落地页是 `app.json` 中的真实首页 `/pages/training/training`。

- 分享给朋友使用页面生命周期 `onShareAppMessage`。
- 分享到朋友圈使用页面生命周期 `onShareTimeline`。
- 页面进入时调用 `wx.showShareMenu`，并同时声明 `shareAppMessage`、`shareTimeline`。
- `onShareTimeline` 不支持普通 `path`，来源参数通过 `query` 传递，当前默认为 `source=timeline`。
- 朋友圈入口可能因微信版本、基础库、运行平台或小程序审核状态而不可见。公共工具已做能力判断和异常兜底，不会因此导致页面报错。

默认分享标题为“杨勤口才训练 KEEP｜每天练一点，表达更自信”，使用项目现有图片 `/images/yangqin-logo.jpg`。页面需要专属标题时，可向公共方法传入 `title`、`path`、`query` 或 `imageUrl` 覆盖默认值。
