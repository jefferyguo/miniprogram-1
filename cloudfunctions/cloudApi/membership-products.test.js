'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { MEMBERSHIP_PRODUCTS: serverProducts } = require('./membership-products')
const { MEMBERSHIP_PRODUCTS: clientProducts } = require('../../utils/membership-products')

test('会员展示价与支付服务端唯一计价配置一致', () => {
  const expected = {
    quarterly_membership: 3990,
    yearly_membership: 5990
  }
  for (const [productId, priceFen] of Object.entries(expected)) {
    const server = serverProducts.find(item => item.productId === productId)
    const client = clientProducts.find(item => item.productId === productId)
    assert.equal(server.priceFen, priceFen)
    assert.equal(client.priceFen, priceFen)
    assert.equal(client.priceText, `¥${(priceFen / 100).toFixed(1)}`)
  }
})
