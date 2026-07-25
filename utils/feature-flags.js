const FEATURE_FLAGS = {
  teacherFeedbackEnabled: false,
  classEnabled: false,
  showVideoChannelEntry: false,
  showShareRecommendEntry: false,
  showSchedulePoster: false,
  // 上线版本默认隐藏，仅在本地排查云端连接时临时开启。
  cloudDebugEnabled: false
}

module.exports = {
  FEATURE_FLAGS
}
