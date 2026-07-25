const { getStudentUsers, setStudentUsers } = require('../../utils/user-registry')

function maskOpenid(openid) {
  if (!openid) return '暂无'
  return `***${String(openid).slice(-6)}`
}

function buildUserView(item) {
  const isMember = item.isMember === true

  return {
    ...item,
    maskedOpenid: maskOpenid(item.openid),
    memberText: isMember ? '会员' : '非会员',
    memberClass: isMember ? 'member-on' : 'member-off',
    classText: item.currentClass && item.currentClass.className ? item.currentClass.className : '暂无班级',
    memberExpireText: item.memberExpireAt || '暂无'
  }
}

Page({
  data: {
    users: [],
    totalCount: 0,
    hasUsers: false
  },

  onShow() {
    this.loadUsers()
  },

  loadUsers() {
    const users = getStudentUsers().map(buildUserView)

    this.setData({
      users,
      totalCount: users.length,
      hasUsers: users.length > 0
    })
  },

  clearUsers() {
    wx.showModal({
      title: '清空本地学员名单？',
      content: '该操作只会清空本机开发测试数据，不会影响线上数据库。',
      confirmText: '清空',
      cancelText: '取消',
      confirmColor: '#d84d4d',
      success: res => {
        if (!res.confirm) return

        setStudentUsers([])
        this.loadUsers()
        wx.showToast({
          title: '已清空',
          icon: 'none'
        })
      }
    })
  }
})
