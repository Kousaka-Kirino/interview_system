import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clampSlidePage, slideImageUrl } from '../src/lib/presentation.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root,p),'utf8')

test('11 · 页码限制和无效输入保护', () => {
  assert.equal(clampSlidePage(-10, 15), 1)
  assert.equal(clampSlidePage(99, 15), 15)
  assert.equal(clampSlidePage(4.9, 15), 4)
  assert.equal(clampSlidePage(NaN, 15), 1)
  assert.equal(clampSlidePage(1, 0), 1)
})
test('11 · PNG 地址使用后端的归属保护资料路径', () => {
  assert.equal(slideImageUrl('uuid-123', 4), '/api/materials/uuid-123/slides/4/image')
  assert.match(slideImageUrl('a/b', 2), /a%2Fb/)
})
test('11 · PPT 展示在答辩页面，具有翻页、跳页、放大', () => {
  const page=read('src/pages/InterviewSessionPage.tsx')
  const deck=read('src/components/presentation/SlideDeck.tsx')
  assert.match(page, /<SlideDeck materialIds=\{session\.material_ids\}/)
  assert.match(deck, /上一页/);assert.match(deck,/下一页/);assert.match(deck,/跳转页码/)
  assert.match(deck, /requestFullscreen/)
  assert.match(deck, /onError=\{\(\) => setImageFailed\(true\)\}/)
})
test('11 · 我的材料页也能打开本地 PPT', () => {
  const page=read('src/pages/MaterialsPage.tsx')
  assert.match(page, /本地幻灯片展示/)
  assert.match(page, /<SlideDeck materialIds=\{\[slideMaterialId\]\}/)
})
test('11 · 本地 PPT 文字翻页不会自动调用大模型', () => {
  const deck=read('src/components/presentation/SlideDeck.tsx')
  assert.match(deck, /analyzeSlide\(selectedDeck\.material_id, page\)/)
  assert.match(deck, /onClick=\{\(\) => void reviewCurrent\(\)\}/)
  assert.match(deck, /不会把 PPT 图片发送给模型/)
})
test('11 · 自我陈述模式必须用户点击生成，支持打字和分段本地录音', () => {
  const page=read('src/components/presentation/OpeningStatement.tsx')
  assert.match(page, /analyzeOpening\(sessionId, text\.trim\(\)\)/)
  assert.match(page, /onClick=\{\(\) => void submit\(\)\}/)
  assert.match(page, /\/api\/speech\/transcribe/)
  assert.match(page, /105_000/)
  assert.match(page, /5–8 分钟/)
})
test('11 · 语音 Portal 指向原答题框而非自我陈述框', () => {
  const voice=read('src/components/speech/DefenseVoiceTimer.tsx')
  assert.match(voice,/querySelector<HTMLTextAreaElement>\('#current-answer'\)/)
  assert.doesNotMatch(voice,/main textarea:not\(\.stage9-textarea\)/)
})
test('11 · 后端原始 PPTX 和 DOCX 并存且无数据库迁移', () => {
  const importPpt=read('../backend/app/stage10_pptx.py')
  const local=read('../backend/app/services/presentation_local.py')
  assert.match(importPpt,/original_path\(account_settings\(require_owner_id\(request\)\)/)
  assert.match(importPpt,/converted_name/)
  assert.match(local,/get_pixmap/)
  assert.match(local,/PowerPoint.Application/)
})

test('11 · 答辩时幻灯片与当前回答并排且可固定展示', () => {
  const page = read('src/pages/InterviewSessionPage.tsx')
  assert.match(page, /mt-6 grid items-start gap-5 xl:grid-cols-2/)
  assert.match(page, /xl:sticky xl:top-4/)
  assert.match(page, /<SlideDeck materialIds=\{session.material_ids\}/)
  assert.match(page, /id="current-answer"/)
})
