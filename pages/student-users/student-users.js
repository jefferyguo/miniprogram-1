Page({
  onLoad() {
    wx.redirectTo({
      url: '/pages/admin-members/admin-members',
      fail: () => {
        wx.showToast({ title: '用户数据中心打开失败', icon: 'none' })
      }
    })
  }
})
