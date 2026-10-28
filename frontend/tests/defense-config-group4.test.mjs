import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assessTime, bindSessionTiming, DEFAULT_PREFERENCES, PRACTICE_PRESETS,
  loadPreferences, preferencesKey, savePreferences, validPreferences } from '../src/lib/defenseConfiguration.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(path.join(root, name), 'utf8')
const user1 = '00000000-0000-4000-a000-000000000001'
const user2 = '00000000-0000-4000-a000-000000000002'
function store() {
  const values = new Map()
  return { values, getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }
}

test('11 · 10题×2分钟，总计6分钟会提醒不足', () => {
  const estimate = assessTime(10, '2', '6', 0)
  assert.equal(estimate.kind, 'short')
  assert.equal(estimate.minimum, 20)
  assert.match(estimate.message, /20 分钟/)
})
test('11 · 追问预计额外耗时；上限不足时提示紧张', () => {
  assert.equal(assessTime(3, '2', '6', 1).kind, 'tight')
  assert.equal(assessTime(5, '2', '15', 1).kind, 'enough')
  assert.equal(assessTime(5, '0', '15', 1).kind, 'unlimited')
  assert.equal(assessTime(5, '2', '0', 1).kind, 'unlimited')
})
test('11 · 题量与时间非法时不允许配置', () => {
  for (const timing of [['-1','10'],['2.5','10'],['61','10'],['2','100'],['','20']]) {
    assert.equal(assessTime(3,timing[0],timing[1],0).kind,'invalid')
  }
  assert.equal(assessTime(2,'2','10',0).kind, 'invalid')
})
test('13 · 三套预设符合后端题量限制与计时上下限', () => {
  assert.deepEqual(PRACTICE_PRESETS.map(p=>p.id), ['quick','mock','pressure'])
  for (const preset of PRACTICE_PRESETS) assert.ok(validPreferences(preset))
  assert.deepEqual(PRACTICE_PRESETS.map(p=>p.timing.totalMinutes), ['5','15','30'])
})
test('13 · 本机保存按账户 UUID 隔离', () => {
  const storage = store()
  const adjusted = { config: {...DEFAULT_PREFERENCES.config, question_count: 4}, timing: {questionMinutes: '3', totalMinutes: '20'} }
  assert.ok(savePreferences(user1, adjusted, storage))
  assert.notEqual(preferencesKey(user1), preferencesKey(user2))
  assert.equal(loadPreferences(user1, storage).config.question_count, 4)
  assert.equal(loadPreferences(user2, storage).config.question_count, 8)
  assert.equal(loadPreferences(user2, storage).timing.questionMinutes, '2')
})
test('13 · 无效/损坏缓存回退默认值，存储被禁用时也不会崩溃', () => {
  const storage = store()
  storage.setItem(preferencesKey(user1), '{bad json')
  assert.deepEqual(loadPreferences(user1,storage), DEFAULT_PREFERENCES)
  storage.setItem(preferencesKey(user1), JSON.stringify({config:{question_count:999},timing:{}}))
  assert.deepEqual(loadPreferences(user1,storage), DEFAULT_PREFERENCES)
  const broken = {getItem(){throw Error('disabled')}, setItem(){throw Error('disabled')}}
  assert.deepEqual(loadPreferences(user1,broken), DEFAULT_PREFERENCES)
  assert.equal(savePreferences(user1,DEFAULT_PREFERENCES,broken), false)
  assert.throws(()=>preferencesKey('../other'),/无效/)
})
test('13 · 只绑定新会话计时，不改已有会话计时及截止时间', () => {
  const storage = store()
  const oldId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const newId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  storage.setItem(`stage9c:minutes:${oldId}`, '8')
  storage.setItem(`stage9d:total-deadline:${oldId}`, '1800000000000')
  assert.equal(bindSessionTiming(newId,{questionMinutes:'2',totalMinutes:'15'},storage),true)
  assert.equal(storage.getItem(`stage9c:minutes:${newId}`), '2')
  assert.equal(storage.getItem(`stage9d:total-minutes:${newId}`), '15')
  assert.equal(storage.getItem(`stage9c:minutes:${oldId}`), '8')
  assert.equal(storage.getItem(`stage9d:total-deadline:${oldId}`), '1800000000000')
})
test('13 · 无效会话标识不能写计时设置', () => {
  const storage=store()
  assert.equal(bindSessionTiming('../fake', {questionMinutes:'2',totalMinutes:'5'},storage), false)
  assert.equal(storage.values.size,0)
})
test('配置页统一负责时间输入，旧计时组件不再插入 Portal 配置区', () => {
  const config=read('src/pages/InterviewConfigPage.tsx')
  const timer=read('src/components/speech/DefenseVoiceTimer.tsx')
  const auth=read('src/components/auth/AuthGate.tsx')
  assert.match(config, /assessTime\(/)
  assert.match(config, /bindSessionTiming\(session\.id/)
  assert.match(config, /PRACTICE_PRESETS\.map/)
  assert.match(config, /aria-label="答辩时间设置"/)
  assert.match(config, /\/api\/auth\/profile/)
  assert.match(config, /window.addEventListener\('interview-auth-change', authChanged\)/)
  assert.match(auth, /new CustomEvent\('interview-auth-change'/)
  assert.doesNotMatch(timer, /DefenseTimeSetting|setInterval\(position|stage9c-config-slot/)
  assert.match(timer,/durationForSession\(sessionId, window\.localStorage\)/)
})
