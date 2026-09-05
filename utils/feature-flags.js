const FEATURE_FLAGS = {
  teacherFeedbackEnabled: false,
  classEnabled: false,
  showVideoChannelEntry: false,
  showShareRecommendEntry: false,
  showSchedulePoster: false,
  // 上线版本默认隐藏，仅在本地排查云端连接时临时开启。
  cloudDebugEnabled: false,
  // 广场评论功能停用：学员端不显示评论UI，服务端拒绝新建评论/回复
  squareCommentsEnabled: false,
  // 季度会员购买门禁：微信后台价格未更新前临时关闭，防止旧价格误扣
  quarterlyPurchaseEnabled: true
}

module.exports = {
  FEATURE_FLAGS
}
