import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const folder = path.dirname(fileURLToPath(import.meta.url))
const page = readFileSync(path.join(folder, '../src/pages/InterviewReportPage.tsx'), 'utf8')

test('24C: AI 复盘页提供唯一官方价格链接，且新窗口打开使用安全 rel', () => {
  const links = [...page.matchAll(/<a\s+href="https:\/\/api-docs\.deepseek\.com\/zh-cn\/quick_start\/pricing"[^>]*>/g)]
  assert.equal(links.length, 1, '应有且仅有一个官方价格链接')
  assert.match(links[0][0], /target="_blank"/)
  assert.match(links[0][0], /rel="noopener noreferrer"/)
})

test('24C: Token 费用示例不能虚构固定价格', () => {
  assert.match(page, /输入 3000、输出 2000 Token/)
  assert.match(page, /并非每次固定费用/)
  assert.match(page, /缓存命中/)
  assert.match(page, /峰谷时段/)
  assert.match(page, /官方价格和账单/)
})

test('24C: 优先复用缓存，并对重新生成再次计费予以提醒', () => {
  assert.match(page, /已缓存的复盘直接读取/)
  assert.match(page, /重新生成 AI 复盘（再次计费）/)
  assert.match(page, /requestAi\(true\)/)
  assert.match(page, /window\.confirm\(warning\)/)
})
