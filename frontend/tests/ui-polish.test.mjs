/** UI text and navigation contract checks; no network or test framework required. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (relative) => readFileSync(path.join(root, relative), 'utf8')
const materials = source('src/pages/MaterialsPage.tsx')
const resume = source('src/pages/ResumesPage.tsx')
const app = source('src/App.tsx')
const config = source('src/pages/InterviewConfigPage.tsx')
const dashboard = source('src/pages/DashboardPage.tsx')
const session = source('src/pages/InterviewSessionPage.tsx')
const auth = source('src/components/auth/AuthGate.tsx')
const review = source('src/components/review/ReviewWorkspace.tsx')
const html = source('index.html')

test('02 · 历史平均分说明只保留练习参考', () => {
  assert.match(dashboard, /caption="仅供练习参考"/)
  assert.doesNotMatch(dashboard, /已评分回答均值，仅供练习参考/)
})

test('07 · 项目材料说明与页面名称', () => {
  assert.match(materials, /上传你的项目报告 \/ 答辩 PPT \/ 论文/)
  assert.match(materials, />我的材料</)
})

test('08 · 两类材料用途有明确区分', () => {
  assert.match(resume, /用于基本信息类提问/)
  assert.match(materials, /用于项目深挖类提问/)
})

test('10 · 检索为默认折叠的辅助工具', () => {
  assert.match(materials, /useState\(false\)/)
  assert.match(materials, /\[showSearch, setShowSearch\] = useState\(false\)/)
  assert.match(materials, /aria-expanded=\{showSearch\}/)
  assert.match(materials, /aria-controls="material-search-tools"/)
  assert.match(materials, /\{showSearch && <div id="material-search-tools"/)
  assert.match(materials, /正常答辩时不需要操作/)
  assert.match(materials, /先在上方资料列表勾选 1～10 份文件/)
  assert.match(materials, /\{showSearch \? '收起检索工具' : '展开检索工具'\}/)
})

test('10 · 既有检索限制与上传入口保留', () => {
  assert.match(materials, /materialApi\.search\(/)
  assert.match(materials, /material_ids: selectedIds/)
  assert.match(materials, /trimmed\.length < 2 \|\| trimmed\.length > 500/)
  assert.match(materials, /materialApi\.upload\(file\)/)
  assert.match(materials, /\.pptx/)
})

test('14 · 答辩时显示 AI 建议来源', () => {
  assert.match(session, /AI 给出的建议：\{turn\.feedback\}/)
})

test('导航文案更新但 URL 保持不变', () => {
  assert.match(app, /hash: '#materials', label: '我的材料'/)
  assert.match(config, /href="#materials" className="text-cyan-300 underline">我的材料/)
  assert.match(app, /if \(hash === 'resumes' \|\| hash === 'materials'\)/)
})

test('清理面向用户的开发阶段编号与临时页面提示', () => {
  for (const [name, value] of [
    ['dashboard', dashboard], ['resumes', resume], ['materials', materials],
    ['config', config], ['review', review],
  ]) {
    assert.doesNotMatch(value, />STAGE\s+\d/i, name)
    assert.doesNotMatch(value, /加载 Stage\s+\d|使用 Stage\s+\d|· Stage\s+\d/i, name)
  }
  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /<title>AI 答辩训练系统<\/title>/)
  assert.doesNotMatch(html, /<title>frontend<\/title>/)
})

test('登录页不再自动填写历史账号', () => {
  assert.match(auth, /\[username, setUsername\] = useState\(''\)/)
  assert.doesNotMatch(auth, /setUsername\('aslan'\)/)
  assert.doesNotMatch(auth, /本地测试模式/)
  assert.match(auth, /新账号使用独立|不同用户的数据分开保存/)
})

test('不改变已有路由、登录和账号接口实现', () => {
  assert.match(app, /hash\.startsWith\('session\/'\)/)
  assert.match(app, /hash\.startsWith\('report\/'\)/)
  assert.match(auth, /\/api\/auth\/\$\{path\}/)
})
