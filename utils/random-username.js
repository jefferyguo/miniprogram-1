/**
 * 随机用户名生成器
 *
 * 生成格式："形容词+的+名词"
 * 例如：勇敢的小松鼠、闪亮的小星星、认真的小熊猫
 *
 * 所有词汇均为安全、积极、适合口才训练产品的中文词汇。
 */

const ADJECTIVES = [
  '自信', '勇敢', '闪亮', '温暖', '认真', '坚持', '努力', '积极',
  '阳光', '开朗', '乐观', '聪明', '可爱', '踏实', '勤奋', '热情',
  '真诚', '善良', '独立', '坚强', '温柔', '活泼', '冷静', '专注',
  '灵活', '好奇', '大方', '谦虚', '幽默', '机智', '敏捷', '稳重',
  '坚定', '自由', '快乐', '优雅', '从容', '洒脱', '豁达', '上进',
  '细心', '灵动', '敏锐', '朝气', '蓬勃', '进取', '拼搏', '求索',
  '沉静', '坦然', '勇敢向前', '不断进步', '热爱表达', '敢于开口',
  '乐于分享', '善于倾听', '勤于思考', '勇于尝试'
]

const NOUNS = [
  '小海豚', '小松鼠', '小星星', '小狐狸', '小熊猫', '小太阳', '小月亮',
  '小燕子', '小蝴蝶', '小蜜蜂', '小火苗', '小浪花', '小树苗', '小雨滴',
  '小云朵', '小溪流', '小山峰', '小石头', '小青藤', '小白鸽', '小花鹿',
  '小斑马', '小企鹅', '小海鸥', '小贝壳', '小露珠', '小竹笋', '小铃铛',
  '小灯塔', '小彩虹', '小种子', '小舵手', '小船长', '探索者', '追梦人',
  '前行者', '攀登者', '践行者', '思考者', '领航员', '开拓者', '奔跑者',
  '小蒲公英', '小向日葵', '小四叶草', '小满天星', '小含羞草'
]

/**
 * 生成一个随机用户名。
 * 每次调用可能产生不同的结果。
 *
 * @returns {string} "形容词+的+名词"
 */
function generateRandomUsername() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}的${noun}`
}

/**
 * 带去重后缀的随机用户名生成。
 * 如果用户名已被占用，追加 2-4 位随机数字。
 *
 * @param {Set<string>|Array<string>} existingNames - 已有用户名集合
 * @returns {string}
 */
function generateUniqueUsername(existingNames = []) {
  const existingSet = existingNames instanceof Set
    ? existingNames
    : new Set(Array.isArray(existingNames) ? existingNames : [])

  // 最多尝试 100 次
  for (let i = 0; i < 100; i++) {
    const name = generateRandomUsername()
    if (!existingSet.has(name)) return name
  }

  // 如果仍重复，追加随机数字
  const base = generateRandomUsername()
  const suffix = String(Math.floor(Math.random() * 9000) + 1000) // 1000-9999
  return `${base}${suffix}`
}

/**
 * 验证自定义用户名是否合法。
 *
 * @param {string} value - 用户输入
 * @returns {{ valid: boolean, sanitized: string, error?: string }}
 */
function validateCustomUsername(value) {
  const trimmed = String(value || '').trim()

  if (!trimmed) {
    return { valid: false, sanitized: '', error: '用户名不能为空' }
  }

  // 长度 2-16 个可见字符
  const visible = trimmed.replace(/[\s​‌‍﻿]/g, '')
  if (visible.length < 2) {
    return { valid: false, sanitized: '', error: '用户名至少需要 2 个字符' }
  }
  if (visible.length > 16) {
    return { valid: false, sanitized: '', error: '用户名不能超过 16 个字符' }
  }

  // 禁止纯空格
  if (!visible) {
    return { valid: false, sanitized: '', error: '用户名不能为纯空格' }
  }

  // 安全检查：禁止 HTML、脚本、控制字符
  if (/<[^>]*>/.test(trimmed)) {
    return { valid: false, sanitized: '', error: '用户名不能包含 HTML 标签' }
  }
  if (/[<>"'&]/.test(trimmed) && /<\/?[a-zA-Z]/.test(trimmed)) {
    return { valid: false, sanitized: '', error: '用户名包含不安全的字符' }
  }

  // 允许：中文、英文、数字、空格、常用符号
  if (!/^[一-鿿㐀-䶿a-zA-Z0-9\s\.\-_·•·]+$/.test(visible)) {
    return { valid: false, sanitized: '', error: '用户名包含不被支持的字符' }
  }

  return { valid: true, sanitized: visible }
}

module.exports = {
  ADJECTIVES,
  NOUNS,
  generateRandomUsername,
  generateUniqueUsername,
  validateCustomUsername
}
