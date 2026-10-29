import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canStartPractice, validPracticeMode, loadPracticeMode, savePracticeMode, modeStorageKey } from '../src/lib/practiceMode.ts'
import { repeatDraft } from '../src/lib/retryPractice.ts'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const read=(p)=>readFileSync(path.join(root,p),'utf8')
const uid='ba118cde-5fa6-445d-9b15-657ed5054703'
const cfg={reviewer_style:'neutral',initial_difficulty:3,adaptation_level:2,question_count:3,max_followups:0}
const draft={id:'session-1',status:'completed',resume_id:'hidden-system-resume',mode:'defense',config:cfg,material_ids:['m1','missing']}

test('10 · 练习模式只允许面试和答辩',()=>{
  assert.ok(validPracticeMode('interview'));assert.ok(validPracticeMode('defense'))
  assert.equal(validPracticeMode('test'),false)
})
test('10 · 面试必须选简历；答辩必须选至少一份资料',()=>{
  assert.equal(canStartPractice('interview','', ['m1']),false)
  assert.equal(canStartPractice('interview','r1',[]),true)
  assert.equal(canStartPractice('defense','',[]),false)
  assert.equal(canStartPractice('defense','',['m1']),true)
})
test('10 · 模式偏好按账号隔离，坏数据回退为面试',()=>{
  const values=new Map();const store={setItem:(a,b)=>values.set(a,b),getItem:(a)=>values.get(a)??null}
  savePracticeMode(uid,'defense',store)
  assert.equal(loadPracticeMode(uid,store),'defense')
  assert.equal(loadPracticeMode('1bb18cde-5fa6-445d-9b15-657ed5054703',store),'interview')
  values.set(modeStorageKey(uid),'bad-mode')
  assert.equal(loadPracticeMode(uid,store),'interview')
})
test('10 · 答辩再练不需内部简历，原材料不存在时会阻止',()=>{
  const r=repeatDraft(draft,[],[{id:'m1'}])
  assert.equal(r.resumeId,'');assert.equal(r.mode,'defense')
  assert.deepEqual(r.materialIds,['m1']);assert.equal(r.missingMaterialCount,1)
  assert.throws(()=>repeatDraft(draft,[],[]),/材料已不可用/)
})
test('10 · 旧会话没有 mode 时保留面试再练规则',()=>{
  assert.throws(()=>repeatDraft({...draft,mode:undefined},[],[{id:'m1'}]),/简历已不存在/)
})
test('10 · 模式切换放在原开始答辩页面，不增加导航菜单',()=>{
  const page=read('src/pages/InterviewConfigPage.tsx')
  const app=read('src/App.tsx')
  assert.match(page,/data-practice-modes="true"/)
  assert.match(page,/aria-pressed=\{mode === 'interview'\}/)
  assert.match(page,/aria-pressed=\{mode === 'defense'\}/)
  assert.match(page,/mode === 'defense' \? '1\. 答辩项目材料（必选）'/)
  assert.match(page,/canStartPractice\(mode, resumeId, materialIds\)/)
  assert.match(page,/\.\.\.\(mode === 'interview' \? \{ resume_id: resumeId \} : \{\}\)/)
  assert.match(app,/InterviewConfigPage/)
  assert.doesNotMatch(app,/tab: 'defense'/)
})
test('10 · 后端强制验证模式并隔离系统内部简历',()=>{
  const sessions=read('../backend/app/api/sessions.py')
  const resumes=read('../backend/app/api/resumes.py')
  assert.match(sessions,/body\.mode == "defense" and not ids/)
  assert.match(sessions,/if body\.mode == "defense" and not evidence/)
  assert.match(sessions,/practice_mode": body\.mode/)
  assert.match(resumes,/if not is_internal_resume\(r\)/)
})
test('10 · 原有计时、模型、专项再练调用仍然存在',()=>{
  const page=read('src/pages/InterviewConfigPage.tsx')
  assert.match(page,/bindSessionTiming\(session\.id, timing/)
  assert.match(page,/focus_session_id: retrySessionId/)
  assert.match(page,/assessTime\(/)
})
