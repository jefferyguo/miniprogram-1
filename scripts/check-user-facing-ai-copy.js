#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const TARGETS = [
  path.join(ROOT_DIR, 'pages'),
  path.join(ROOT_DIR, 'utils', 'ai-feedback.js'),
  path.join(ROOT_DIR, 'cloudfunctions', 'generateTrainingFeedback', 'index.js')
]
const FORBIDDEN = [
  '语音转写',
  '语音转写内容',
  '从转写内容来看',
  '根据转写内容',
  '基于转写内容',
  '训练可见'
]
const EXTENSIONS = new Set(['.js', '.wxml', '.wxss', '.json'])

function collectFiles(target) {
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  return fs.readdirSync(target, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) return collectFiles(child)
    return EXTENSIONS.has(path.extname(entry.name)) ? [child] : []
  })
}

const findings = []
TARGETS.flatMap(collectFiles).forEach(file => {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    FORBIDDEN.forEach(phrase => {
      if (line.includes(phrase)) {
        findings.push(`${path.relative(ROOT_DIR, file)}:${index + 1} ${phrase}`)
      }
    })
  })
})

if (findings.length) {
  console.error('[check-user-facing-ai-copy] 发现不自然的用户文案：')
  findings.forEach(item => console.error(`- ${item}`))
  process.exit(1)
}

console.log('[check-user-facing-ai-copy] 通过：未发现禁用的用户可见文案。')
