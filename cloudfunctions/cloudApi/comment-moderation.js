const DEFAULT_FORBIDDEN_WORDS = [
  { word: '加微信', category: 'contact', level: 'high', action: 'block' },
  { word: '微信号', category: 'contact', level: 'high', action: 'block' },
  { word: '手机号', category: 'contact', level: 'high', action: 'block' },
  { word: '联系方式', category: 'contact', level: 'high', action: 'block' },
  { word: '私聊', category: 'contact', level: 'medium', action: 'block' },
  { word: '转账', category: 'contact', level: 'high', action: 'block' },
  { word: '付款码', category: 'contact', level: 'high', action: 'block' },
  { word: '二维码', category: 'contact', level: 'medium', action: 'block' },
  { word: '代理', category: 'ad', level: 'medium', action: 'block' },
  { word: '刷单', category: 'ad', level: 'high', action: 'block' },
  { word: '兼职赚钱', category: 'ad', level: 'high', action: 'block' },
  { word: '贷款', category: 'ad', level: 'medium', action: 'block' },
  { word: '色情广告', category: 'ad', level: 'high', action: 'block' },
  { word: '傻逼', category: 'abuse', level: 'high', action: 'block' },
  { word: '滚', category: 'abuse', level: 'medium', action: 'block' },
  { word: '垃圾', category: 'abuse', level: 'medium', action: 'block' },
  { word: '去死', category: 'abuse', level: 'high', action: 'block' },
  { word: '违法', category: 'other', level: 'medium', action: 'review' },
  { word: '赌博', category: 'other', level: 'high', action: 'block' },
  { word: '博彩', category: 'other', level: 'high', action: 'block' }
]

/**
 * 评论匹配归一化：兼容全角、空格及常见中英文标点分隔。
 */
function normalizeText(text) {
  let value = String(text == null ? '' : text).trim().toLowerCase()
  if (typeof value.normalize === 'function') value = value.normalize('NFKC')
  return value.replace(/[\s\u3000`~!@#$%^&*()_+\-=\[\]{};:'"\\|,.<>/?，。！？；：“”‘’（）【】《》、·…—]+/g, '')
}

function findForbiddenMatch(content, rules = []) {
  const normalizedContent = normalizeText(content)
  if (!normalizedContent) return null

  return (Array.isArray(rules) ? rules : []).find(rule => {
    if (!rule || rule.status !== 'active') return false
    const normalizedWord = normalizeText(rule.normalizedWord || rule.word)
    return Boolean(normalizedWord && normalizedContent.includes(normalizedWord))
  }) || null
}

function validateCommentContent(content) {
  const trimmed = String(content == null ? '' : content).trim()
  if (!trimmed) {
    return { valid: false, code: 'COMMENT_EMPTY', message: '评论内容不能为空。', content: '' }
  }
  if (Array.from(trimmed).length > 200) {
    return { valid: false, code: 'COMMENT_TOO_LONG', message: '评论内容不能超过 200 字。', content: trimmed }
  }
  return { valid: true, code: '', message: '', content: trimmed }
}

module.exports = {
  DEFAULT_FORBIDDEN_WORDS,
  findForbiddenMatch,
  normalizeText,
  validateCommentContent
}
