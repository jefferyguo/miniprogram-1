function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isActive(item = {}) {
  const status = String(item.status || '').trim()
  return item.active !== false && item.visible !== false && ['active', 'published'].includes(status)
}

function getPosition(item = {}) {
  return number(item.sortOrder || item.day)
}

// CloudBase 系统字段只能用于定位文档，不能放进 document.update/set 的 data。
function toWritableTrainingContentData(record = {}) {
  const { _id, _openid, ...data } = record
  return data
}

function sortActive(records = []) {
  return records
    .filter(isActive)
    .slice()
    .sort((left, right) => getPosition(left) - getPosition(right) || String(left.contentId || '').localeCompare(String(right.contentId || '')))
}

// 管理端只修改必要记录：新增末尾追加、删除保留空位、相邻移动交换两个排序值。
function planActiveSequence(records = [], primary = {}, requestedPosition = 1, nextStatus = 'active', operation = 'upsert') {
  const contentId = String(primary.contentId || '').trim()
  const activeBefore = sortActive(records)
  const existing = records.find(record => String(record.contentId || '').trim() === contentId) || null
  const existingActive = activeBefore.find(record => String(record.contentId || '').trim() === contentId) || null
  const otherActive = activeBefore.filter(record => String(record.contentId || '').trim() !== contentId)

  if (operation === 'reorder') {
    const targetPosition = number(requestedPosition)
    const target = otherActive.find(record => getPosition(record) === targetPosition)
    if (!existingActive || !target) throw new Error('只能与当前模块中的相邻已发布内容交换顺序')
    const currentPosition = getPosition(existingActive)
    return activeBefore.map(record => {
      const id = String(record.contentId || '').trim()
      const isPrimary = id === contentId
      const isTarget = id === String(target.contentId || '').trim()
      const sortOrder = isPrimary ? targetPosition : isTarget ? currentPosition : getPosition(record)
      return {
        record: isPrimary ? primary : record,
        day: sortOrder,
        sortOrder,
        changed: isPrimary || isTarget
      }
    }).sort((left, right) => left.sortOrder - right.sortOrder)
  }

  if (nextStatus !== 'active') {
    return otherActive.map(record => ({
      record,
      day: getPosition(record),
      sortOrder: getPosition(record),
      changed: false
    }))
  }

  const usedPositions = new Set(otherActive.map(getPosition))
  const previousPosition = existing ? getPosition(existing) : 0
  const maxPosition = Math.max(0, ...records.map(getPosition))
  const nextPosition = previousPosition > 0 && !usedPositions.has(previousPosition)
    ? previousPosition
    : maxPosition + 1
  const nextPrimary = { ...primary, day: nextPosition, sortOrder: nextPosition }
  return sortActive([...otherActive, nextPrimary]).map(record => ({
    record,
    day: getPosition(record),
    sortOrder: getPosition(record),
    changed: String(record.contentId || '').trim() === contentId
  }))
}

function verifyActiveSequence(records = []) {
  const active = sortActive(records)
  const ids = new Set()
  const positions = new Set()
  let previousPosition = 0
  return active.every(record => {
    const contentId = String(record.contentId || '').trim()
    const day = number(record.day)
    const sortOrder = number(record.sortOrder)
    const valid = Boolean(contentId) && !ids.has(contentId) &&
      Number.isInteger(day) && day > 0 && day === sortOrder &&
      !positions.has(sortOrder) && sortOrder > previousPosition
    ids.add(contentId)
    positions.add(sortOrder)
    previousPosition = sortOrder
    return valid
  })
}

module.exports = {
  isActive,
  planActiveSequence,
  toWritableTrainingContentData,
  verifyActiveSequence
}
