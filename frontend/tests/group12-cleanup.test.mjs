import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (name) => readFileSync(join(root, name), 'utf8')

test('configuration explains already shipped PPT and self-presentation features', () => {
  const page = read('frontend/src/pages/InterviewConfigPage.tsx')
  assert.match(page, /本地 PPT/)
  assert.match(page, /自我陈述/)
  assert.doesNotMatch(page, /自我陈述环节将在下一组开发/)
})
test('slide pagination and authenticated presentation contract remain in place', () => {
  const source = read('frontend/src/components/presentation/SlideDeck.tsx')
  assert.match(source, /parseSlidePageInput/)
  assert.match(source, /PageDown/)
  assert.match(source, /下一页/)
  assert.match(read('frontend/src/lib/presentation.ts'), /export function clampSlidePage/)
})
test('current manuals are shipped separately from historical change notes', () => {
  for (const name of ['STAGE24A_WINDOWS_INSTALL', 'STAGE24A_USER_GUIDE']) {
    assert.equal(existsSync(join(root, `docs/manuals/${name}.md`)), true)
    assert.equal(existsSync(join(root, `docs/manuals/${name}.pdf`)), true)
  }
  assert.match(read('frontend/README.md'), /Stage 24B/)
})
