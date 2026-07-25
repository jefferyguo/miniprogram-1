Page({
  data: {
    versionText: '杨勤口才训练KEEP v1.0.2'
  },

  clearLocalCache() {
    wx.showModal({
      title: '清除本地缓存',
      content: '将清除本机训练草稿、临时记录和缓存数据，不会清除已提交作品、测评结果和登录信息。是否继续？',
      cancelText: '取消',
      confirmText: '确认清除',
      confirmColor: '#ff4d4f',
      success: res => {
        if (!res.confirm) return

        // 仅清除草稿和临时缓存，保留提交作品、测评结果和 userInfo。
        wx.removeStorageSync('trainingDrafts')
        wx.removeStorageSync('extraTrainingDrafts')
        wx.removeStorageSync('tempRecordings')

        wx.showToast({
          title: '缓存已清除',
          icon: 'success'
        })
      }
    })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后，本机将不再显示当前登录状态。是否确认退出？',
      cancelText: '取消',
      confirmText: '退出登录',
      confirmColor: '#ff4d4f',
      success: res => {
        if (!res.confirm) return

        // 只清除登录态，不清除训练作品和测评记录。
        wx.removeStorageSync('userInfo')

        wx.showToast({
          title: '已退出登录',
          icon: 'success'
        })

        setTimeout(() => {
          wx.switchTab({
            url: '/pages/mine/mine'
          })
        }, 500)
      }
    })
  }
})
