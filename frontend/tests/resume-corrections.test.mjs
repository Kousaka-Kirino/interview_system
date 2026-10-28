/** 第二组静态 UI/API 契约；真实业务闭环由后端隔离回归测试保证。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (name) => readFileSync(path.join(root, name), 'utf8')
const resume = source('src/pages/ResumesPage.tsx')
const config = source('src/pages/InterviewConfigPage.tsx')
const api = source('src/lib/api.ts')
const types = source('src/types/resources.ts')
const app = source('src/App.tsx')

test('04 · 七个简历章节都显示中文，不再显示英文 key', () => {
  for (const label of ['基本信息', '教育经历', '实习 / 工作经历', '项目经历', '专业技能', '获奖情况', '其他']) {
    assert.ok(resume.includes(label), label)
  }
  assert.match(resume, /sectionKeys\.map\(\(key\)/)
  assert.doesNotMatch(resume, /<h4 className="font-medium text-cyan-200">\{name\}<\/h4>/)
})

test('05 · 可编辑个人资料及七个章节；保存走真实 PATCH 接口', () => {
  assert.match(resume, /saveCorrections/)
  assert.match(resume, /resumeApi\.update\(detail\.id, draft\)/)
  assert.match(resume, /value=\{draft\.sections\[key\]\.join\('\\n'\)\}/)
  assert.match(resume, /保存简历修正/)
  assert.match(api, /method: 'PATCH'/)
  assert.match(api, /ResumeCorrections/)
  assert.match(types, /export interface ResumeCorrections/)
})

test('05 · 解析完整度准确表述为章节填写情况而非识别率', () => {
  assert.match(resume, /已填写 \$\{quality\.filled\}\/\$\{quality\.total\} 个章节/)
  assert.match(resume, /不是简历真实识别准确率/)
  assert.match(resume, /原始提取文本（只读，供核对）/)
})

test('12 · 创建答辩前显示健康度和直达简历的补全链接', () => {
  assert.match(config, /missing_sections/)
  assert.match(config, /去补全这份简历/)
  assert.match(config, /#resumes\/\$\{encodeURIComponent\(selected\.id\)\}/)
  assert.match(app, /hash\.startsWith\('resumes\/'\)/)
  assert.match(app, /initialResumeId=\{route\.resumeId\}/)
})
