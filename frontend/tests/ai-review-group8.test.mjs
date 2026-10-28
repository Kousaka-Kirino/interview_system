import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exampleAnswers, weakPoints, reviewMarkdown } from '../src/lib/aiReview.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(path.join(root, name), 'utf8')
const report = {
  session_id: 'test-report', average_score: 62,
  turns: [{ turn_id: 1, question_number: 1, followup_number: 0, score: 62, question: '项目如何测试？', answer: '用了一些测试', feedback: '说明不足' }],
  ai_analysis: { summary: '需改进', example_answers: [
    { turn_id: 1, answer: '说明单元测试、集成测试及覆盖率', explanation: '提供验证证据' },
    { turn_id: 999, answer: '虚构的答案', explanation: '无效' }],
    weak_points: [{ turn_id: 1, title: '测试依据不足', reason: '缺少测试数据', dimension: '数据证据' }],
  },
}

test('AI 参考答案仅匹配当前答辩真实题目', () => {
  assert.deepEqual(exampleAnswers(report).map((x) => x.turn_id), [1])
})
test('薄弱点列表过滤已删除或无效题号', () => {
  assert.equal(weakPoints(report).length, 1)
  assert.deepEqual(weakPoints({ ...report, ai_analysis: { weak_points: [{ ...report.ai_analysis.weak_points[0], turn_id: 999 }] } }), [])
})
test('Markdown 导出确实包含问题、作答、AI 示范和弱点', () => {
  const md = reviewMarkdown(report)
  assert.match(md, /项目如何测试/)
  assert.match(md, /说明单元测试、集成测试/)
  assert.match(md, /测试依据不足/)
  assert.match(md, /可能不准确/)
})
test('旧版本缓存没有新增字段仍能正常展示及导出', () => {
  const legacy = { ...report, ai_analysis: { summary: '旧AI总结' } }
  assert.deepEqual(exampleAnswers(legacy), [])
  assert.deepEqual(weakPoints(legacy), [])
  assert.match(reviewMarkdown(legacy), /旧AI总结/)
})
test('自动 AI 只在当前登录账号明确开启时触发', () => {
  const page = read('src/pages/InterviewReportPage.tsx')
  assert.match(page, /interview_system:auto_ai_review:/)
  assert.match(page, /!autoEnabled/) // no default paid calls
  assert.match(page, /setAutoEnabled\(false\)/)
  assert.match(page, /autoAttempted\.current\.has\(sessionId\)/)
})
test('AI 报告页提供参考答案、费用链接和完整导出', () => {
  const page = read('src/pages/InterviewReportPage.tsx')
  assert.match(page, /downloadMarkdown\(report\)/)
  assert.match(page, /示范回答/)
  assert.match(page, /api-docs\.deepseek\.com\/zh-cn\/quick_start\/pricing/)
  assert.match(page, /已缓存的复盘直接读取/)
})

test('调用费用用示例假设而非虚构固定单价', () => { const page = read('src/pages/InterviewReportPage.tsx'); assert.match(page, /输入 3000、输出 2000 Token/); assert.match(page, /并非每次固定费用/) })
