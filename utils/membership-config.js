const NORMAL_USER_BENEFITS = [
  '前 3 天训练内容',
  '每天 1 次 AI 点评/测评',
  '可保存训练记录',
  '可浏览广场公开作品'
]

const MEMBER_USER_BENEFITS = [
  '解锁更多训练内容',
  '每天 5 次 AI 点评/测评',
  '优先体验深度点评',
  '更多训练记录与成长分析',
  '后续持续更新训练内容'
]

const MEMBERSHIP_PLANS = [
  {
    id: 'monthly',
    title: '季度会员',
    price: '¥39.9',
    unit: '/ 季',
    desc: '适合阶段性集中训练',
    membershipType: 'monthly'
  },
  {
    id: 'yearly',
    title: '年度会员',
    price: '¥59.9',
    unit: '/ 年',
    desc: '限时体验价，适合长期训练',
    membershipType: 'yearly'
  }
]

// AI 次数策略集中配置；当前执行每日上限，其余字段为后续收紧策略预留。
const FREE_DAILY_AI_LIMIT = 1
const FREE_MONTHLY_AI_LIMIT = 10
const FREE_NEW_USER_DAILY_LIMIT_DAYS = 7
const FREE_AFTER_TRIAL_WEEKLY_AI_LIMIT = 3
const MONTHLY_MEMBER_DAILY_AI_LIMIT = 5
const MONTHLY_MEMBER_MONTHLY_AI_LIMIT = 150
const YEARLY_MEMBER_DAILY_AI_LIMIT = 5
const YEARLY_MEMBER_MONTHLY_AI_LIMIT = 150
const MEMBER_DAILY_AI_LIMIT = 5
const MEMBER_MONTHLY_AI_LIMIT = 150

module.exports = {
  NORMAL_USER_BENEFITS,
  MEMBER_USER_BENEFITS,
  MEMBERSHIP_PLANS,
  FREE_DAILY_AI_LIMIT,
  FREE_MONTHLY_AI_LIMIT,
  FREE_NEW_USER_DAILY_LIMIT_DAYS,
  FREE_AFTER_TRIAL_WEEKLY_AI_LIMIT,
  MONTHLY_MEMBER_DAILY_AI_LIMIT,
  MONTHLY_MEMBER_MONTHLY_AI_LIMIT,
  YEARLY_MEMBER_DAILY_AI_LIMIT,
  YEARLY_MEMBER_MONTHLY_AI_LIMIT,
  MEMBER_DAILY_AI_LIMIT,
  MEMBER_MONTHLY_AI_LIMIT
}
