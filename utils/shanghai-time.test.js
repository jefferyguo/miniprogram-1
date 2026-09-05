const assert = require('node:assert/strict')
const test = require('node:test')

const {
  formatShanghaiDateTime,
  getShanghaiUtcDayRange,
  isShanghaiToday
} = require('./shanghai-time')

test('UTC ISO timestamp displays as China Standard Time', () => {
  assert.equal(
    formatShanghaiDateTime('2026-08-29T01:12:01Z'),
    '2026-08-29 09:12:01'
  )
})

test('legacy cloud UTC string displays as China Standard Time', () => {
  assert.equal(
    formatShanghaiDateTime('2026-08-29 01:12:01'),
    '2026-08-29 09:12:01'
  )
})

test('Beijing day starts at 16:00 UTC on the previous date', () => {
  const range = getShanghaiUtcDayRange(Date.parse('2026-08-29T04:00:00Z'))
  assert.equal(range.startText, '2026-08-28 16:00:00')
  assert.equal(range.endText, '2026-08-29 16:00:00')
  assert.equal(isShanghaiToday('2026-08-28T16:00:00Z', Date.parse('2026-08-29T04:00:00Z')), true)
  assert.equal(isShanghaiToday('2026-08-28T15:59:59Z', Date.parse('2026-08-29T04:00:00Z')), false)
})
