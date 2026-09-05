const FONT_SCALE_STORAGE_KEY = 'fontScalePercent'
const LEGACY_FONT_SIZE_STORAGE_KEY = 'fontSizeLevel'
const FONT_SCALE_MIN_PERCENT = 90
const FONT_SCALE_MAX_PERCENT = 140
const FONT_SCALE_STEP_PERCENT = 5
const DEFAULT_FONT_SCALE_PERCENT = 100

const LEGACY_LEVEL_PERCENT = Object.freeze({
  small: 90,
  standard: 100,
  large: 115,
  xlarge: 130
})

// 结构性 UI 使用温和缩放；四个旧档位在迁移后保持上一版实际视觉比例。
const UI_SCALE_ANCHORS = Object.freeze([
  Object.freeze({ percent: 90, scale: 0.95 }),
  Object.freeze({ percent: 100, scale: 1 }),
  Object.freeze({ percent: 115, scale: 1.08 }),
  Object.freeze({ percent: 130, scale: 1.15 }),
  Object.freeze({ percent: 140, scale: 1.2 })
])

const TOKEN_SIZE_MIN = 17
const TOKEN_SIZE_MAX = 60
let currentFontScalePercent = DEFAULT_FONT_SCALE_PERCENT
let pageMixinInstalled = false

function parseValidFontScalePercent(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const percent = Number(value)
  if (!Number.isInteger(percent)) return null
  if (percent < FONT_SCALE_MIN_PERCENT || percent > FONT_SCALE_MAX_PERCENT) return null
  if ((percent - FONT_SCALE_MIN_PERCENT) % FONT_SCALE_STEP_PERCENT !== 0) return null
  return percent
}

function normalizeFontScalePercent(value) {
  return parseValidFontScalePercent(value) ?? DEFAULT_FONT_SCALE_PERCENT
}

function snapFontScalePercent(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return DEFAULT_FONT_SCALE_PERCENT
  const clamped = Math.min(FONT_SCALE_MAX_PERCENT, Math.max(FONT_SCALE_MIN_PERCENT, numericValue))
  const steps = Math.round((clamped - FONT_SCALE_MIN_PERCENT) / FONT_SCALE_STEP_PERCENT)
  return FONT_SCALE_MIN_PERCENT + steps * FONT_SCALE_STEP_PERCENT
}

function resolveWxApi(wxApi) {
  if (wxApi) return wxApi
  return typeof wx !== 'undefined' ? wx : null
}

function persistFontScalePercent(storage, percent, removeLegacy = false) {
  if (!storage || typeof storage.setStorageSync !== 'function') return false
  storage.setStorageSync(FONT_SCALE_STORAGE_KEY, percent)
  if (removeLegacy && typeof storage.removeStorageSync === 'function') {
    storage.removeStorageSync(LEGACY_FONT_SIZE_STORAGE_KEY)
  }
  return true
}

function initializeFontScale(wxApi) {
  const storage = resolveWxApi(wxApi)
  let rawStoredPercent
  let storedPercent = null
  let legacyLevel = null
  let legacyReadFailed = false

  try {
    if (storage && typeof storage.getStorageSync === 'function') {
      rawStoredPercent = storage.getStorageSync(FONT_SCALE_STORAGE_KEY)
      storedPercent = parseValidFontScalePercent(rawStoredPercent)
    }
  } catch (error) {
    currentFontScalePercent = DEFAULT_FONT_SCALE_PERCENT
    console.warn('[font-size] 读取字号设置失败，已恢复 100%')
    return currentFontScalePercent
  }

  const hasCanonicalStorage = rawStoredPercent !== undefined && rawStoredPercent !== null && rawStoredPercent !== ''
  if (!hasCanonicalStorage) {
    try {
      if (storage && typeof storage.getStorageSync === 'function') {
        legacyLevel = storage.getStorageSync(LEGACY_FONT_SIZE_STORAGE_KEY)
      }
    } catch (error) {
      legacyReadFailed = true
      console.warn('[font-size] 读取旧字号设置失败，已恢复 100%')
    }
  }

  const migratedPercent = Object.prototype.hasOwnProperty.call(LEGACY_LEVEL_PERCENT, legacyLevel)
    ? LEGACY_LEVEL_PERCENT[legacyLevel]
    : null
  currentFontScalePercent = hasCanonicalStorage
    ? (storedPercent ?? DEFAULT_FONT_SCALE_PERCENT)
    : (migratedPercent ?? DEFAULT_FONT_SCALE_PERCENT)

  if (legacyReadFailed) return currentFontScalePercent

  try {
    persistFontScalePercent(storage, currentFontScalePercent, true)
  } catch (error) {
    console.warn('[font-size] 字号设置迁移保存失败，本次使用仍已生效')
  }
  return currentFontScalePercent
}

function getFontScalePercent() {
  return currentFontScalePercent
}

function resolveUiScale(percent) {
  for (let index = 1; index < UI_SCALE_ANCHORS.length; index += 1) {
    const lower = UI_SCALE_ANCHORS[index - 1]
    const upper = UI_SCALE_ANCHORS[index]
    if (percent <= upper.percent) {
      const progress = (percent - lower.percent) / (upper.percent - lower.percent)
      return lower.scale + (upper.scale - lower.scale) * progress
    }
  }
  return UI_SCALE_ANCHORS[UI_SCALE_ANCHORS.length - 1].scale
}

function formatRpx(value) {
  const rounded = Math.round(value * 100) / 100
  return `${rounded}rpx`
}

function createFontSizePageStyle(percent = currentFontScalePercent) {
  const normalizedPercent = normalizeFontScalePercent(percent)
  const readingScale = normalizedPercent / 100
  const uiScale = resolveUiScale(normalizedPercent)
  const declarations = []

  for (let size = TOKEN_SIZE_MIN; size <= TOKEN_SIZE_MAX; size += 1) {
    declarations.push(`--font-reading-${size}:${formatRpx(size * readingScale)};`)
    declarations.push(`--font-ui-${size}:${formatRpx(size * uiScale)};`)
  }

  return declarations.join('')
}

function createFontSizePageData(percent = currentFontScalePercent) {
  const normalizedPercent = normalizeFontScalePercent(percent)
  return {
    fontScalePercent: normalizedPercent,
    fontSizePageStyle: createFontSizePageStyle(normalizedPercent)
  }
}

function applyFontSizeToCurrentPages(percent = currentFontScalePercent) {
  if (typeof getCurrentPages !== 'function') return
  const pageData = createFontSizePageData(percent)
  const pages = getCurrentPages() || []
  pages.forEach(page => {
    if (page && typeof page.setData === 'function') page.setData(pageData)
  })
}

function setFontScalePercent(percent, wxApi) {
  const normalizedPercent = normalizeFontScalePercent(percent)
  currentFontScalePercent = normalizedPercent
  const storage = resolveWxApi(wxApi)

  try {
    persistFontScalePercent(storage, normalizedPercent, true)
  } catch (error) {
    console.warn('[font-size] 保存字号设置失败，本次使用仍已生效')
  }

  applyFontSizeToCurrentPages(normalizedPercent)
  return normalizedPercent
}

function installFontSizePageMixin() {
  if (pageMixinInstalled || typeof Page !== 'function') return false
  const nativePage = Page

  const fontSizeAwarePage = function (definition = {}) {
    const originalOnLoad = definition.onLoad
    const originalOnShow = definition.onShow
    const originalData = definition.data || {}

    definition.data = Object.assign({}, originalData, createFontSizePageData())
    definition.__syncGlobalFontSize = function () {
      const nextData = createFontSizePageData()
      if (
        this.data.fontScalePercent !== nextData.fontScalePercent ||
        this.data.fontSizePageStyle !== nextData.fontSizePageStyle
      ) {
        this.setData(nextData)
      }
    }
    definition.onLoad = function (...args) {
      this.__syncGlobalFontSize()
      if (typeof originalOnLoad === 'function') return originalOnLoad.apply(this, args)
    }
    definition.onShow = function (...args) {
      this.__syncGlobalFontSize()
      if (typeof originalOnShow === 'function') return originalOnShow.apply(this, args)
    }

    return nativePage(definition)
  }

  if (typeof globalThis !== 'undefined') globalThis.Page = fontSizeAwarePage
  else Page = fontSizeAwarePage
  pageMixinInstalled = true
  return true
}

module.exports = {
  DEFAULT_FONT_SCALE_PERCENT,
  FONT_SCALE_MAX_PERCENT,
  FONT_SCALE_MIN_PERCENT,
  FONT_SCALE_STEP_PERCENT,
  FONT_SCALE_STORAGE_KEY,
  LEGACY_FONT_SIZE_STORAGE_KEY,
  applyFontSizeToCurrentPages,
  createFontSizePageData,
  createFontSizePageStyle,
  getFontScalePercent,
  initializeFontScale,
  installFontSizePageMixin,
  normalizeFontScalePercent,
  setFontScalePercent,
  snapFontScalePercent
}
