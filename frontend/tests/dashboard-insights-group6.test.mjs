import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { practiceRating, sessionChange, changeDescription, trendCoordinates } from '../src/lib/scoreInsights.ts'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const get = (name) => readFileSync(path.join(root, name), 'utf8')
const dashboard = get('src/pages/DashboardPage.tsx')
const chart = get('src/components/dashboard/ScoreHistoryChart.tsx')
const reports = get('../backend/app/api/reports.py')
const source = get('../backend/app/services/report_service.py')
const pt = (score, idx = 0) => ({session_id:`${idx}`, created_at:'2026-01-01', average_score:score, scored_answers:1})

test('01 · 评级边界、零分和无评分均有定义', () => {
  assert.equal(practiceRating(null), null)
  assert.equal(practiceRating(NaN), null)
  assert.deepEqual(practiceRating(0), {label:'需加强', tone:'low'})
  assert.equal(practiceRating(59.99).label, '需加强')
  assert.equal(practiceRating(60).label, '待提升')
  assert.equal(practiceRating(79.99).label, '待提升')
  assert.equal(practiceRating(80).label, '良好')
})

test('02 · 一场或者空数据不计算环比', () => {
  assert.equal(sessionChange([]), null)
  assert.equal(sessionChange([pt(85)]), null)
  assert.match(changeDescription(null), /至少完成两场/)
})

test('03 · 最新两场有效均分计算涨跌和持平', () => {
  assert.equal(sessionChange([pt(60, 0), pt(63.24, 1)]), 3.2)
  assert.equal(changeDescription(3.2), '较上次 +3.2 分')
  assert.equal(sessionChange([pt(80, 0), pt(76.8, 1)]), -3.2)
  assert.equal(changeDescription(-3.2), '较上次 −3.2 分')
  assert.equal(changeDescription(0), '与上次持平')
})

test('04 · 折线单点居中，多点等间距，纵轴限定0-100', () => {
  const one = trendCoordinates([pt(0)])[0]
  assert.equal(one.x, (50 + (720-24))/2)
  assert.equal(one.y, 194)
  const more = trendCoordinates([pt(100,0),pt(50,1),pt(0,2)])
  assert.deepEqual(more.map(p=>p.y), [20,107,194])
  assert.equal(more[0].x, 50)
  assert.equal(more[2].x, 696)
})

test('05 · 数据概览同时使用独立趋势接口与原统计值，错误/空数据不显示假数据', () => {
  assert.match(dashboard, /interviewApi\.scoreHistory\(controller\.signal\)/)
  assert.match(dashboard, /practiceRating\(stats\?\.average_score \?\? null\)/)
  assert.match(dashboard, /sessionChange\(scoreHistory\?\.points \?\? \[\]\)/)
  assert.match(dashboard, /ScoreHistoryChart history=\{scoreHistory\}/)
  assert.match(chart, /暂无有评分的已完成答辩/)
})

test('06 · 后端从当前账号 DB 获取最近20场有评分且已完成答辩，不调用模型', () => {
  assert.match(reports, /score_history\(db: Session = Depends\(get_db\)\)/)
  assert.match(source, /InterviewSession\.status == "completed"/)
  assert.match(source, /InterviewTurn\.answer\.is_not\(None\)/)
  assert.match(source, /InterviewTurn\.score\.is_not\(None\)/)
  assert.match(source, /\.limit\(limit\)/)
  assert.doesNotMatch(source.slice(source.indexOf('def get_completed_score_history'), source.indexOf('def build_report')), /DeepSeek|Ollama|get_interview_llm/)
})

test('07 · 保留历史列表的筛选分页、刷新和原统计数字', () => {
  assert.match(dashboard, /interviewApi\.history\(/)
  assert.match(dashboard, /setRefreshCount\(/)
  assert.match(dashboard, /setOffset\(0\)/)
  assert.match(dashboard, /stats\?\.total_sessions/)
  assert.match(dashboard, /stats\?\.answered_turns/)
  assert.doesNotMatch(dashboard, /本机单用户开发版本/)
})
