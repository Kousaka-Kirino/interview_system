import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { repeatDraft, repeatTiming } from '../src/lib/retryPractice.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (filename) => readFileSync(path.join(root, filename), 'utf8')
const source = {
  id: '77777777-7777-4777-8777-777777777777',
  status: 'completed',
  resume_id: 'resume-a',
  material_ids: ['material-a', 'missing-b', 'material-c'],
  config: { reviewer_style: 'pressure', initial_difficulty: 4, adaptation_level: 3, question_count: 6, max_followups: 2 },
}
const resumes = [{ id: 'resume-a' }, { id: 'resume-b' }]
const materials = [{ id: 'material-a' }, { id: 'material-c' }]

function storage(data = new Map()) {
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}

test('18 · 复用简历、现存材料与原场次评委和题量配置', () => {
  const draft = repeatDraft(source, resumes, materials)
  assert.equal(draft.resumeId, 'resume-a')
  assert.deepEqual(draft.materialIds, ['material-a', 'material-c'])
  assert.equal(draft.missingMaterialCount, 1)
  assert.deepEqual(draft.config, source.config)
  draft.config.question_count = 5
  assert.equal(source.config.question_count, 6, '新场次允许修改但不改变原场次')
})

test('18 · 只能复制已完成的答辩，不能把进行中会话作为练习模板', () => {
  assert.throws(() => repeatDraft({ ...source, status: 'active' }, resumes, materials), /已结束/)
})

test('18 · 原简历被删除时明确阻断，不自动选其他人的或另一份简历', () => {
  assert.throws(() => repeatDraft(source, [{ id: 'resume-b' }], materials), /简历已不存在/)
})

test('18 · 原材料全被删除可继续练习，但不会选择非原场次材料', () => {
  const draft = repeatDraft(source, resumes, [{ id: 'unrelated' }])
  assert.deepEqual(draft.materialIds, [])
  assert.equal(draft.missingMaterialCount, 3)
})

test('18 · 多余、重复材料最多选十份且去重，清楚提醒未选部分', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `mat-${i}`)
  const draft = repeatDraft({ ...source, material_ids: [...ids, ids[0]] }, resumes, ids.map((id) => ({ id })))
  assert.equal(draft.materialIds.length, 10)
  assert.equal(draft.missingMaterialCount, 3)
})

test('18 · 异常源配置不会自动带入新答辩', () => {
  assert.throws(() => repeatDraft({ ...source, config: { ...source.config, question_count: 99 } }, resumes, materials), /不再受支持/)
})

test('18 · 原场次两个本地时间设置都在才恢复，不复制任何截止时间', () => {
  const values = new Map([
    [`stage9c:minutes:${source.id}`, '3'],
    [`stage9d:total-minutes:${source.id}`, '30'],
    [`stage9d:total-deadline:${source.id}`, '1900000000000'],
  ])
  assert.deepEqual(repeatTiming(source.id, storage(values)), { questionMinutes: '3', totalMinutes: '30' })
  assert.equal(values.size, 3)
  values.delete(`stage9d:total-minutes:${source.id}`)
  assert.equal(repeatTiming(source.id, storage(values)), null)
})

test('18 · 时间非法、浏览器本地存储不可访问时回退到账号偏好', () => {
  const values = new Map([[`stage9c:minutes:${source.id}`, '4'], [`stage9d:total-minutes:${source.id}`, '-2']])
  assert.equal(repeatTiming(source.id, storage(values)), null)
  assert.equal(repeatTiming(source.id, { getItem() { throw Error('access denied') } }), null)
})

test('18 · 复盘按钮只导航至确认页，不直接提交新会话或生成 AI 结果', () => {
  const report = read('src/pages/InterviewReportPage.tsx')
  const app = read('src/App.tsx')
  const page = read('src/pages/InterviewConfigPage.tsx')
  assert.match(report, /#configure\/retry\/\$\{encodeURIComponent\(sessionId\)\}/)
  assert.match(report, /沿用本场资料再练一次/)
  assert.match(app, /hash\.startsWith\('configure\/retry\/'\)/)
  assert.match(app, /retrySessionId=\{route\.retrySessionId\}/)
  assert.match(page, /getInterview\(retrySessionId, controller\.signal\)/)
  assert.match(page, /repeatDraft\(previous, nextResumes, nextMaterials\)/)
  assert.match(page, /repeatAppliedAccount !== accountId/)
  assert.match(page, /try \{ previousTime = repeatTiming\(retrySessionId, window\.localStorage\) \}/)
  assert.match(page, /bindSessionTiming\(session\.id, timing/)
  assert.match(page, /createInterview\(/)
})
