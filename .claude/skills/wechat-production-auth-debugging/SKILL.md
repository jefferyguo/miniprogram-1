# 正式版登录诊断

## 诊断步骤
1. 确认appid与正式CloudBase环境一致
2. 确认wx.cloud.init在login调用前完成
3. 确认login云函数已部署到正式环境
4. 检查login返回结构（success/code/user/authState/profileCompleted/phoneBound）
5. 检查auth缓存结构（openid/_id/profileCompleted/nicknameSource/phoneBound）
6. 确认isAuthenticated不检查phoneBound
7. 确认requireLogin只检查基础登录
8. 确认requirePhoneBound只用于手机号业务
9. 检查login-gate组件实例和pendingAction
10. 检查老用户缓存兼容（manual→custom映射）

## 常见根因
- 云环境不一致（开发/体验/正式使用不同env）
- 云函数未部署到正式环境
- 旧auth缓存结构与新auth.js不兼容
- profileCompleted缺失或nicknameSource=default
- phoneBound被错误当作基础登录条件
- app.js onShow反复触发login-gate
