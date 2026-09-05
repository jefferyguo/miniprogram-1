const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  FONT_SCALE_STORAGE_KEY,
  createFontSizePageData,
  initializeFontScale
} = require('../../utils/font-size')

const storageValues = new Map()
global.wx = {
  getStorageSync(key) {
    return storageValues.get(key)
  },
  setStorageSync(key, value) {
    storageValues.set(key, value)
  },
  removeStorageSync(key) {
    storageValues.delete(key)
  }
}

let pageDefinition = null
global.Page = definition => {
  pageDefinition = definition
  return definition
}
global.getCurrentPages = () => [pageInstance]

initializeFontScale(wx)
require('./settings')

const pageInstance = {
  data: { ...pageDefinition.data, ...createFontSizePageData(100) },
  setData(nextData) {
    this.data = { ...this.data, ...nextData }
  }
}

pageDefinition.onFontScaleChanging.call(pageInstance, { detail: { value: 123 } })
assert.strictEqual(pageInstance.data.fontScalePercent, 125)
assert.strictEqual(storageValues.get(FONT_SCALE_STORAGE_KEY), 100)
assert.match(pageInstance.data.fontSizePageStyle, /--font-reading-28:35rpx;/)

pageDefinition.onFontScaleChange.call(pageInstance, { detail: { value: 123 } })
assert.strictEqual(storageValues.get(FONT_SCALE_STORAGE_KEY), 125)

const wxml = fs.readFileSync(path.join(__dirname, 'settings.wxml'), 'utf8')
assert.match(wxml, /<slider/)
assert.match(wxml, /bindchanging="onFontScaleChanging"/)
assert.match(wxml, /bindchange="onFontScaleChange"/)
assert.match(wxml, /step="\{\{fontScaleStepPercent\}\}"/)
assert.match(wxml, /\{\{fontScaleMinPercent\}\}%/)
assert.match(wxml, /标准 \{\{fontScaleStandardPercent\}\}%/)
assert.match(wxml, /left: \{\{fontScaleStandardOffset\}\}%/)
assert.doesNotMatch(wxml, /font-size-option/)

console.log('settings font-scale slider tests passed')
