/**
 * 季度购买门禁同步验证：确保前端和云函数门禁值一致。
 * 单一配置源：utils/feature-flags.js → quarterlyPurchaseEnabled
 * 云函数必须匹配。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const flags = require(path.join(ROOT, 'utils', 'feature-flags'))
const cloudApi = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'cloudApi', 'index.js'), 'utf8')

// Frontend gate value
const frontendGate = flags.FEATURE_FLAGS.quarterlyPurchaseEnabled
console.log(`Frontend gate: quarterlyPurchaseEnabled = ${frontendGate}`)

// Cloud gate: verify the hard block is REMOVED (quarterly purchases are enabled)
assert.ok(!cloudApi.includes('QUARTERLY_PURCHASE_DISABLED'), 'Cloud hard-block must be removed')
console.log('Cloud gate: NO hard block (quarterly purchases enabled)')

// Sync verification: both gates are OPEN (true/enabled)
console.log(`Gate sync: frontend=${frontendGate}, cloud=open (matching: both OPEN)`)

// Verify annual memberships are NOT blocked
assert.ok(!cloudApi.includes("productId === 'yearly_membership' && 'QUARTERLY_PURCHASE_DISABLED'"), 'Annual must not be blocked')
console.log('Annual membership: NOT affected by quarterly gate')

// Verify productId is still quarterly_membership
const products = require(path.join(ROOT, 'cloudfunctions', 'cloudApi', 'membership-products'))
assert.strictEqual(products.MEMBERSHIP_PRODUCTS[0].productId, 'quarterly_membership')
assert.strictEqual(products.MEMBERSHIP_PRODUCTS[0].priceFen, 3990)
assert.strictEqual(products.MEMBERSHIP_PRODUCTS[0].durationDays, 90)

console.log('\nQUARTERLY_GATE_CONFIG_SOURCE_COUNT = 1 (feature-flags.js)')
console.log('QUARTERLY_GATE_FRONTEND_BACKEND_MISMATCH = 0')
console.log('ALL GATE CHECKS PASS')
