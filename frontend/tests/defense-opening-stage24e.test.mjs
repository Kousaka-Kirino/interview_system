import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const session = read('../src/pages/InterviewSessionPage.tsx')
const opening = read('../src/components/presentation/OpeningStatement.tsx')
const types = read('../src/types/interview.ts')

test('答辩模式先显示PPT和自我陈述，尚未完成时没有答题区', () => {
  assert.match(session, /const awaitingOpening = session\?\.mode === 'defense'/)
  assert.match(session, /data-defense-opening="required"/)
  assert.match(session, /<SlideDeck materialIds=\{session\.material_ids\} \/>/)
  assert.match(session, /session\.status === 'active' && currentQuestion && !awaitingOpening/)
})

test('前端不得在陈述阶段提交已有题目', () => {
  assert.match(session, /!currentQuestion \|\| awaitingOpening \|\| busy/)
  assert.match(session, /!currentQuestion && !awaitingOpening/)
})

test('陈述完成由用户主动确认，录音与文字均可作为输入', () => {
  assert.match(opening, /结束陈述并生成第一题/)
  assert.match(opening, /setText\(\(existing\) =>/)
  assert.match(opening, /analyzeOpening\(sessionId, text\.trim\(\)\)/)
})

test('会话类型使用后端已持久化的陈述状态', () => {
  assert.match(types, /opening_required\?: boolean/)
  assert.match(types, /opening_completed\?: boolean/)
})
