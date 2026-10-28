import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(path.join(root, name), 'utf8')
const api = read('src/lib/api.ts')
const resumes = read('src/pages/ResumesPage.tsx')
const materials = read('src/pages/MaterialsPage.tsx')
const modal = read('src/components/DocumentPreview.tsx')

test('06/09 · 简历与材料各有预览入口，复用同一组件', () => {
  assert.match(resumes, /<DocumentPreview kind="resume"/)
  assert.match(materials, /<DocumentPreview kind="material"/)
  assert.match(resumes, /预览原文/)
  assert.match(materials, /预览原文/)
})

test('06/09 · API 请求受账号权限保护的相对路径', () => {
  assert.match(api, /\/api\/resumes\/\$\{encodeURIComponent\(id\)\}\/preview/)
  assert.match(api, /\/api\/materials\/\$\{encodeURIComponent\(id\)\}\/preview/)
  assert.match(api, /application\/pdf, text\/plain, application\/json/)
})

test('06/09 · PDF 使用浏览器内嵌，DOCX 显示纯文本', () => {
  assert.match(modal, /<iframe title=/)
  assert.match(modal, /<pre className=/)
  assert.match(modal, /URL\.createObjectURL/)
  assert.match(modal, /URL\.revokeObjectURL/)
  assert.match(modal, /controller\.abort\(\)/)
})

test('09 · PPTX 不误称原件预览', () => {
  assert.match(modal, /_PPTX文字提取版/)
  assert.match(modal, /不包含原始图片、图表或幻灯片版式/)
})
