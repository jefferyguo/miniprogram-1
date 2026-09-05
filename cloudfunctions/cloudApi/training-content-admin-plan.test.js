const assert = require('node:assert/strict')
const test = require('node:test')

const {
  planActiveSequence,
  toWritableTrainingContentData,
  verifyActiveSequence
} = require('./training-content-admin-plan')

function fixture(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    contentId: `tc_${String(index + 1).padStart(32, '0')}`,
    day: index + 1,
    sortOrder: index + 1,
    status: 'active',
    active: true,
    visible: true
  }))
}

test('新增内容默认末尾追加且只修改新记录', () => {
  const before = fixture()
  const created = { contentId: `tc_${'f'.repeat(32)}`, status: 'active', active: true, visible: true }
  const plan = planActiveSequence(before, created, 3, 'active')
  assert.equal(plan.length, 6)
  assert.equal(plan[5].record.contentId, created.contentId)
  assert.equal(plan[5].sortOrder, 6)
  assert.equal(plan.filter(item => item.changed).length, 1)
  assert.equal(verifyActiveSequence(plan.map(item => ({ ...item.record, day: item.day, sortOrder: item.sortOrder }))), true)
})

test('删除或归档 active 内容时不重排其余记录', () => {
  const before = fixture()
  const removed = { ...before[1], status: 'deleted', active: false, visible: false }
  const plan = planActiveSequence(before, removed, 2, 'deleted')
  assert.equal(plan.length, 4)
  assert.equal(plan.some(item => item.record.contentId === removed.contentId), false)
  assert.equal(plan.filter(item => item.changed).length, 0)
  assert.deepEqual(plan.map(item => item.sortOrder), [1, 3, 4, 5])
  assert.equal(verifyActiveSequence(plan.map(item => ({ ...item.record, day: item.day, sortOrder: item.sortOrder }))), true)
})

test('相邻移动只改变两条记录的位置', () => {
  const before = fixture()
  const moving = before[1]
  const plan = planActiveSequence(before, moving, 3, 'active', 'reorder')
  const changed = plan.filter(item => item.changed)
  assert.deepEqual(changed.map(item => item.record.contentId), [before[2].contentId, before[1].contentId])
  assert.equal(verifyActiveSequence(plan.map(item => ({ ...item.record, day: item.day, sortOrder: item.sortOrder }))), true)
})

test('216 条模块的常见操作最多修改两条排序记录', () => {
  const before = fixture(216)
  const created = { contentId: `tc_${'e'.repeat(32)}`, status: 'active', active: true, visible: true }
  const appendPlan = planActiveSequence(before, created, 1, 'active', 'upsert')
  assert.equal(appendPlan.filter(item => item.changed).length, 1)
  assert.equal(appendPlan.at(-1).sortOrder, 217)

  const reorderPlan = planActiveSequence(before, before[214], 216, 'active', 'reorder')
  assert.equal(reorderPlan.filter(item => item.changed).length, 2)

  const deleted = { ...before[0], status: 'deleted', active: false, visible: false }
  const deletePlan = planActiveSequence(before, deleted, 1, 'deleted', 'delete')
  assert.equal(deletePlan.filter(item => item.changed).length, 0)
  assert.equal(verifyActiveSequence(deletePlan.map(item => ({ ...item.record, day: item.day, sortOrder: item.sortOrder }))), true)
})

test('末尾新增不会复用已删除记录保留的排序值', () => {
  const before = fixture(3)
  before.push({
    contentId: `tc_${'d'.repeat(32)}`,
    day: 8,
    sortOrder: 8,
    status: 'deleted',
    active: false,
    visible: false
  })
  const created = { contentId: `tc_${'c'.repeat(32)}`, status: 'active', active: true, visible: true }
  const plan = planActiveSequence(before, created, 1, 'active', 'upsert')
  assert.equal(plan.find(item => item.record.contentId === created.contentId).sortOrder, 9)
})

test('CloudBase 更新数据剥离不可写系统字段', () => {
  const writable = toWritableTrainingContentData({
    _id: 'cloud-document-id',
    _openid: 'cloud-openid',
    contentId: `tc_${'a'.repeat(32)}`,
    title: '保留业务字段'
  })
  assert.deepEqual(writable, {
    contentId: `tc_${'a'.repeat(32)}`,
    title: '保留业务字段'
  })
})
