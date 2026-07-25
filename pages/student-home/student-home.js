Page({
  data: {
    // mock data：后续接后端时可替换为接口返回数据
    todayTask: {
      day: '第 3 天',
      title: '一分钟自我介绍训练',
      desc: '围绕姓名、特点和目标完成 60 秒表达打卡',
      progress: '已完成 2/21 天'
    },
    checkinCount: 2,
    teacherFeedbackEnabled: false,
    teacherComment: '表达结构清晰，下一次可以放慢语速，增强停顿感。',
    reportScore: 86
  },

  startRecord() {
    wx.showToast({
      title: '开始录音打卡',
      icon: 'none'
    })
  },

  openRecordList() {
    wx.showToast({
      title: '查看我的打卡记录',
      icon: 'none'
    })
  },

  openTeacherComment() {
    wx.showToast({
      title: '查看老师点评',
      icon: 'none'
    })
  },

  openGrowthReport() {
    wx.showToast({
      title: '查看成长报告',
      icon: 'none'
    })
  },

  openCampBuy() {
    wx.showToast({
      title: '进入21天训练营购买',
      icon: 'none'
    })
  }
})
