const fs = require('fs')
const path = require('path')
const { createFontSizePageStyle } = require('../utils/font-size')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const appConfig = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8'))
const generatedStyle = createFontSizePageStyle(100)
const failures = []
const readingSelectorPattern = /(desc|copy|content|text|tip|hint|message|error|alert|toast|material|feedback|comment|reason|suggestion|analysis|summary|intro|help|privacy|agreement|notice|paragraph|question|answer|requirement|prompt|instruction|empty|meta|detail|body|caption|rich|note|remark|warning|caution|encouragement|topic|module-value|info|phone|field|cell|editor|file|timeline|fact|state|package|history|picker|indicator|pager|btn|button)/i
const fixedVisualPattern = /(icon|arrow|badge|tag|score|number|dot|avatar|logo|radar|glyph|switch|spinner|progress|medal|rank|duration|timer|countdown|close)/i

for (const route of appConfig.pages) {
  const wxmlPath = path.join(PROJECT_ROOT, `${route}.wxml`)
  const source = fs.readFileSync(wxmlPath, 'utf8')
  const firstLine = source.split(/\r?\n/, 1)[0]
  if (!firstLine.startsWith('<page-meta') || !firstLine.includes('fontSizePageStyle')) {
    failures.push(`${route}.wxml 首节点未注入 fontSizePageStyle`)
  }
}

for (const rootName of ['app.wxss', 'pages', 'components']) {
  const rootPath = path.join(PROJECT_ROOT, rootName)
  const files = fs.statSync(rootPath).isDirectory()
    ? collectFiles(rootPath, '.wxss')
    : [rootPath]

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8')
    const tokenPattern = /--font-(?:reading|ui)-(\d+(?:\.\d+)?)/g
    for (const match of source.matchAll(tokenPattern)) {
      const size = match[1]
      if (!generatedStyle.includes(`--font-reading-${size}:`) || !generatedStyle.includes(`--font-ui-${size}:`)) {
        failures.push(`${path.relative(PROJECT_ROOT, filePath)} 使用了未生成的字号 token ${size}`)
      }
    }

    for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1]
      const declarations = block[2]
      if (
        readingSelectorPattern.test(selector) &&
        !fixedVisualPattern.test(selector) &&
        /font-size:\s*\d+(?:\.\d+)?rpx/.test(declarations)
      ) {
        failures.push(`${path.relative(PROJECT_ROOT, filePath)} 的主要阅读选择器仍使用硬编码字号: ${selector.trim().replace(/\s+/g, ' ')}`)
      }
    }
  }
}

if (failures.length) {
  failures.forEach(message => console.error(message))
  process.exitCode = 1
} else {
  console.log(`font-size accessibility checks passed (${appConfig.pages.length} app pages)`)
}

function collectFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(entryPath, extension)
    return entry.name.endsWith(extension) ? [entryPath] : []
  })
}
