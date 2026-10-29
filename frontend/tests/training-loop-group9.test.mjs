import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { autoReviewEnabled, autoReviewKey, markCompleted, completionReviewMarker } from '../src/lib/autoReviewPreference.ts'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root,file),'utf8')
test('22 · 账号默认不允许自动付费复盘，偏好独立保存',()=>{
 const data = new Map()
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}
 assert.equal(autoReviewEnabled('a',storage),false)
 storage.setItem(autoReviewKey('a'),'1')
 assert.equal(autoReviewEnabled('a',storage),true)
 assert.equal(autoReviewEnabled('b',storage),false)
})
test('22 · 完成标记只保存在 sessionStorage，同一历史记录不会因为普通访问再次触发',()=>{
 const data=new Map()
 markCompleted('abc',{setItem:(k,v)=>data.set(k,v)})
 assert.equal(data.get(completionReviewMarker('abc')),'1')
 assert.notEqual(completionReviewMarker('abc'),completionReviewMarker('def'))
 const page=read('src/pages/InterviewSessionPage.tsx')
 assert.match(page,/sessionStorage\.getItem\(completionReviewMarker\(sessionId\)\)/)
 assert.match(page,/sessionStorage\.removeItem\(completionReviewMarker\(sessionId\)\)/)
 assert.match(page,/generateAIInterviewReport\(sessionId, false\)/)
 assert.match(page,/autoReviewEnabled/)
 assert.match(page,/markCompleted\(sessionId, window\.sessionStorage\)/)
})
test('22 · 倒计时触发的提前结束也产生完成标记',()=>{
 const timer=read('src/components/speech/DefenseVoiceTimer.tsx')
 assert.match(timer,/markCompleted\(sessionId, window\.sessionStorage\)/)
})
test('22 · 训练模式路由与后端来源 ID 一致',()=>{
 const app=read('src/App.tsx'),config=read('src/pages/InterviewConfigPage.tsx'),report=read('src/pages/InterviewReportPage.tsx')
 assert.match(app,/configure\/focus\//)
 assert.match(config,/focus_session_id: retrySessionId/)
 assert.match(config,/focusMode && retrySessionId/)
 assert.match(report,/#configure\/focus\/\$\{encodeURIComponent\(sessionId\)\}/)
 assert.match(report,/weaknesses\.length > 0/)
})
test('22 · 结束页只显示统计和主按钮，复盘详细建议集中在完整复盘页',()=>{
 const page=read('src/pages/InterviewSessionPage.tsx')
 assert.match(page,/查看完整复盘与导出/)
 assert.doesNotMatch(page,/<h3 className="font-semibold text-emerald-200">优势<\/h3>/)
 assert.doesNotMatch(page,/<h3 className="font-semibold text-amber-200">需要加强<\/h3>/)
})
