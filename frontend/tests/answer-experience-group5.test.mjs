import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendRecognizedText, VOICE_TRANSCRIPT_EVENT, VOICE_STATUS_EVENT, TIMER_GATE_EVENT,
  announceTranscript, announceVoiceStatus, announceTimerGate,
} from '../src/lib/answerDraftBridge.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (file) => readFileSync(path.join(root, file), 'utf8')
const page = source('src/pages/InterviewSessionPage.tsx')
const timer = source('src/components/speech/DefenseVoiceTimer.tsx')
const css = source('src/components/speech/speechTimer.css')
const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const turnId = '42'

test('15 · 语音分段识别可以追加，保留已输入文字及空白', () => {
  assert.equal(appendRecognizedText('', ' 你好 '), '你好')
  assert.equal(appendRecognizedText('文字回答', ' 第一段 '), '文字回答\n第一段')
  assert.equal(appendRecognizedText('文字回答\n', '第二段'), '文字回答\n第二段')
  assert.equal(appendRecognizedText(' 原有空白 ', '   '), ' 原有空白 ')
})

test('15 · 语音消息只包含当前会话及题目 ID，供单一草稿过滤过期回调', () => {
  const oldWindow = globalThis.window
  const oldCustomEvent = globalThis.CustomEvent
  globalThis.window = new EventTarget()
  if (!globalThis.CustomEvent) globalThis.CustomEvent = class extends Event { constructor(name, opts) { super(name); this.detail = opts.detail } }
  const observed = []
  const listen = (name) => (event) => observed.push([name, event.detail])
  for (const name of [VOICE_TRANSCRIPT_EVENT, VOICE_STATUS_EVENT, TIMER_GATE_EVENT]) globalThis.window.addEventListener(name, listen(name))
  try {
    announceTranscript({sessionId, turnId, text:'测试转写'})
    announceVoiceStatus({sessionId, turnId, active:true})
    announceTimerGate({sessionId, turnId, active:false})
    assert.deepEqual(observed.map((x) => x[0]), [VOICE_TRANSCRIPT_EVENT, VOICE_STATUS_EVENT, TIMER_GATE_EVENT])
    assert.deepEqual(observed[0][1], {sessionId, turnId, text:'测试转写'})
    assert.equal(observed[1][1].active, true)
  } finally {
    globalThis.window = oldWindow
    globalThis.CustomEvent = oldCustomEvent
  }
})

test('15 · 只有一个可编辑回答框，语音控件没有第二草稿或正常提交按钮', () => {
  assert.equal((page.match(/<textarea\b/g) || []).length, 1)
  assert.equal((timer.match(/<textarea\b/g) || []).length, 0)
  assert.doesNotMatch(timer, /stage9-draft|setTranscript|<button[^>]*>提交本题回答/)
  assert.doesNotMatch(css, /\.stage9-textarea/)
  assert.match(page, /answerInterview\(sessionId, \{/)
  assert.match(page, /user_feedback: feedback/)
  assert.match(timer, /announceTranscript\(\{ sessionId: recordingSessionId, turnId: recordingTurnId/)
})

test('15 · 遇到错误或旧题转写，不应清空用户原有草稿或绕开 10000 字符长度限制', () => {
  assert.match(page, /detail\.sessionId === sessionId && detail\.turnId === openTurnId/)
  assert.match(page, /appendRecognizedText\(existing, detail\.text\)\.slice\(0, 10000\)/)
  assert.match(timer, /recordingTurnKey !== turnRef\.current/)
  assert.match(timer, /abortRef\.current\?\.abort\(\)/)
  assert.match(page, /setVoiceBusy\(detail\.active\)/)
  assert.match(page, /setTimerBlocked\(detail\.active\)/)
  assert.match(page, /voiceBusy \|\| timerBlocked \|\| !answer\.trim\(\)/)
})

test('15 · 原有超时跳过保留独立特殊操作，但普通语音内容不从计时控件直接提交', () => {
  assert.match(timer, /const answer = SKIP_TEXT/)
  assert.match(timer, /if \(!skip \|\| !sessionId/)
  assert.match(timer, /"?\/answer"?|`\/api\/interviews\/\$\{encodeURIComponent\(sessionId\)\}\/answer`/)
  assert.match(timer, /user_feedback: 'none'/)
  assert.match(page, /function submitAnswer\(\)/)
})

test('16 · 已答题目默认折叠，当前问题显示在唯一输入框附近', () => {
  assert.match(page, /completedTurns\.map\(\(turn\) => \(\s*<details/)
  assert.match(page, /<summary/)
  assert.match(page, /<p className="whitespace-pre-wrap font-medium leading-7">\{currentQuestion\.question\}<\/p>/)
  assert.match(page, /已回答/)
})

test('16 · 反馈用三枚可撤销快捷按钮，默认不反馈并保持后端枚举', () => {
  for (const entry of ['too_easy', 'just_right', 'too_hard']) assert.match(page, new RegExp(entry))
  assert.match(page, /aria-pressed=\{feedback === item\.value\}/)
  assert.match(page, /previous === item\.value \? 'none' : item\.value/)
  assert.match(page, /setFeedback\('none'\)/)
  assert.doesNotMatch(page, /<select id="difficulty-feedback"/)
})

test('16 · 提前结束提示当前未回答题目，不谎称未答题完全消失', () => {
  assert.match(page, /session\.turns\.find\(\(turn\) => turn\.answer === null\)/)
  assert.match(page, /不会计入已回答题目，复盘中仍会记录未答数量/)
  assert.match(page, /window\.confirm\(`\$\{pendingMessage\}确定提前结束/)
  assert.match(page, /disabled=\{!!busy \|\| voiceBusy\}/)
})

test('16 · 本轮未改动模型服务、数据库模式和答辩评分契约', () => {
  assert.match(timer, /\/api\/speech\/transcribe/)
  assert.match(page, /getInterviewReport\(sessionId/)
  assert.match(page, /finishInterview\(sessionId\)/)
})
