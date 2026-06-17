Page({
  data: {
    logoLoadError: false,
    principles: [
      '先敢开口，再追求表达质量',
      '每天 3 分钟，也能建立表达训练习惯',
      '录下来、听回去、再改进，表达能力会逐步提升',
      '训练不是为了说得花哨，而是为了说得清楚、自然、有力量'
    ]
  },

  onLogoError() {
    this.setData({
      logoLoadError: true
    })
  }
})
