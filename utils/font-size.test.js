const assert = require('assert')

const {
  DEFAULT_FONT_SCALE_PERCENT,
  FONT_SCALE_MAX_PERCENT,
  FONT_SCALE_MIN_PERCENT,
  FONT_SCALE_STEP_PERCENT,
  FONT_SCALE_STORAGE_KEY,
  LEGACY_FONT_SIZE_STORAGE_KEY,
  createFontSizePageStyle,
  getFontScalePercent,
  initializeFontScale,
  installFontSizePageMixin,
  normalizeFontScalePercent,
  setFontScalePercent,
  snapFontScalePercent
} = require('./font-size')

function createStorage(initialValues = {}, options = {}) {
  const values = new Map(Object.entries(initialValues))

  return {
    values,
    getStorageSync(key) {
      if (options.throwOnRead || options.throwOnReadKey === key) throw new Error('storage read failed')
      return values.get(key)
    },
    setStorageSync(key, value) {
      if (options.throwOnWrite) throw new Error('storage write failed')
      values.set(key, value)
    },
    removeStorageSync(key) {
      values.delete(key)
    }
  }
}

assert.strictEqual(FONT_SCALE_MIN_PERCENT, 90)
assert.strictEqual(FONT_SCALE_MAX_PERCENT, 140)
assert.strictEqual(FONT_SCALE_STEP_PERCENT, 5)
assert.strictEqual(DEFAULT_FONT_SCALE_PERCENT, 100)

for (const percent of [90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140]) {
  assert.strictEqual(normalizeFontScalePercent(percent), percent)
}
assert.strictEqual(normalizeFontScalePercent('115'), 115)
assert.strictEqual(normalizeFontScalePercent(103), 100)
assert.strictEqual(normalizeFontScalePercent(85), 100)
assert.strictEqual(normalizeFontScalePercent(145), 100)
assert.strictEqual(normalizeFontScalePercent(null), 100)

assert.strictEqual(snapFontScalePercent(103), 105)
assert.strictEqual(snapFontScalePercent(117), 115)
assert.strictEqual(snapFontScalePercent(80), 90)
assert.strictEqual(snapFontScalePercent(160), 140)

const migratedLevels = {
  small: 90,
  standard: 100,
  large: 115,
  xlarge: 130
}
for (const [legacyLevel, expectedPercent] of Object.entries(migratedLevels)) {
  const storage = createStorage({ [LEGACY_FONT_SIZE_STORAGE_KEY]: legacyLevel })
  assert.strictEqual(initializeFontScale(storage), expectedPercent)
  assert.strictEqual(storage.values.get(FONT_SCALE_STORAGE_KEY), expectedPercent)
  assert.strictEqual(storage.values.has(LEGACY_FONT_SIZE_STORAGE_KEY), false)
}

const currentStorage = createStorage({ [FONT_SCALE_STORAGE_KEY]: 125 })
assert.strictEqual(initializeFontScale(currentStorage), 125)
assert.strictEqual(getFontScalePercent(), 125)

const canonicalStorageWithBrokenLegacyRead = createStorage(
  { [FONT_SCALE_STORAGE_KEY]: 125 },
  { throwOnReadKey: LEGACY_FONT_SIZE_STORAGE_KEY }
)
assert.strictEqual(initializeFontScale(canonicalStorageWithBrokenLegacyRead), 125)

const temporarilyUnreadableLegacyStorage = createStorage(
  { [LEGACY_FONT_SIZE_STORAGE_KEY]: 'large' },
  { throwOnReadKey: LEGACY_FONT_SIZE_STORAGE_KEY }
)
assert.strictEqual(initializeFontScale(temporarilyUnreadableLegacyStorage), 100)
assert.strictEqual(temporarilyUnreadableLegacyStorage.values.has(FONT_SCALE_STORAGE_KEY), false)
assert.strictEqual(temporarilyUnreadableLegacyStorage.values.get(LEGACY_FONT_SIZE_STORAGE_KEY), 'large')

const invalidStorage = createStorage({ [FONT_SCALE_STORAGE_KEY]: 103 })
assert.strictEqual(initializeFontScale(invalidStorage), 100)
assert.strictEqual(invalidStorage.values.get(FONT_SCALE_STORAGE_KEY), 100)

const invalidCanonicalWithLegacyStorage = createStorage({
  [FONT_SCALE_STORAGE_KEY]: 103,
  [LEGACY_FONT_SIZE_STORAGE_KEY]: 'large'
})
assert.strictEqual(initializeFontScale(invalidCanonicalWithLegacyStorage), 100)
assert.strictEqual(invalidCanonicalWithLegacyStorage.values.get(FONT_SCALE_STORAGE_KEY), 100)
assert.strictEqual(invalidCanonicalWithLegacyStorage.values.has(LEGACY_FONT_SIZE_STORAGE_KEY), false)

assert.strictEqual(initializeFontScale(createStorage({}, { throwOnRead: true })), 100)

const writableStorage = createStorage()
assert.strictEqual(setFontScalePercent(140, writableStorage), 140)
assert.strictEqual(writableStorage.values.get(FONT_SCALE_STORAGE_KEY), 140)
assert.strictEqual(getFontScalePercent(), 140)

const failingStorage = createStorage({}, { throwOnWrite: true })
assert.strictEqual(setFontScalePercent(115, failingStorage), 115)
assert.strictEqual(getFontScalePercent(), 115)

const standardStyle = createFontSizePageStyle(100)
assert.match(standardStyle, /--font-ui-17:17rpx;/)
assert.match(standardStyle, /--font-reading-28:28rpx;/)
assert.match(standardStyle, /--font-ui-30:30rpx;/)

const smallStyle = createFontSizePageStyle(90)
assert.match(smallStyle, /--font-reading-28:25\.2rpx;/)
assert.match(smallStyle, /--font-ui-30:28\.5rpx;/)

const largeStyle = createFontSizePageStyle(115)
assert.match(largeStyle, /--font-reading-28:32\.2rpx;/)
assert.match(largeStyle, /--font-ui-30:32\.4rpx;/)

const xlargeStyle = createFontSizePageStyle(140)
assert.match(xlargeStyle, /--font-reading-28:39\.2rpx;/)
assert.match(xlargeStyle, /--font-ui-30:36rpx;/)

let registeredPage = null
let originalOnShowCalled = false
global.Page = definition => {
  registeredPage = definition
  return definition
}
global.getCurrentPages = () => []
assert.strictEqual(installFontSizePageMixin(), true)
Page({
  data: { existingValue: true },
  onShow() {
    originalOnShowCalled = true
  }
})
assert.strictEqual(registeredPage.data.existingValue, true)
assert.strictEqual(registeredPage.data.fontScalePercent, 115)
assert.strictEqual(Object.hasOwn(registeredPage.data, 'fontSizeLevel'), false)

const pageInstance = {
  data: { ...registeredPage.data },
  setData(nextData) {
    this.data = { ...this.data, ...nextData }
  },
  __syncGlobalFontSize: registeredPage.__syncGlobalFontSize
}
registeredPage.onShow.call(pageInstance)
assert.strictEqual(originalOnShowCalled, true)
assert.match(pageInstance.data.fontSizePageStyle, /--font-reading-28:32\.2rpx;/)

global.getCurrentPages = () => [pageInstance]
const propagationStorage = createStorage()
setFontScalePercent(125, propagationStorage)
assert.strictEqual(pageInstance.data.fontScalePercent, 125)
assert.match(pageInstance.data.fontSizePageStyle, /--font-reading-28:35rpx;/)

initializeFontScale(createStorage({ [FONT_SCALE_STORAGE_KEY]: 140 }))
registeredPage.onShow.call(pageInstance)
assert.strictEqual(pageInstance.data.fontScalePercent, 140)
assert.match(pageInstance.data.fontSizePageStyle, /--font-reading-28:39\.2rpx;/)

console.log('font-size tests passed')
