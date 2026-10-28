/** Practice configuration helpers. No model call or backend schema change. */
import type { BackendInterviewConfig } from '../types/interview.ts'
import { parseMinutes, sessionMinutesKey, sessionTotalMinutesKey } from '../components/speech/defenseTime.ts'

export type DefenseTiming = { questionMinutes: string; totalMinutes: string }
export type PracticePreferences = { config: BackendInterviewConfig; timing: DefenseTiming }
export const DEFAULT_PREFERENCES: PracticePreferences = {
  config: { reviewer_style: 'neutral', initial_difficulty: 3, adaptation_level: 2, question_count: 8, max_followups: 1 },
  timing: { questionMinutes: '2', totalMinutes: '0' },
}

export const PRACTICE_PRESETS = [
  { id: 'quick', label: '⏱️ 5 分钟快速练', description: '3 道主问题，不追问',
    config: { reviewer_style: 'friendly', initial_difficulty: 2, adaptation_level: 1, question_count: 3, max_followups: 0 },
    timing: { questionMinutes: '1', totalMinutes: '5' } },
  { id: 'mock', label: '🎯 15 分钟模拟', description: '5 道主问题，最多追问 1 次',
    config: { reviewer_style: 'neutral', initial_difficulty: 3, adaptation_level: 2, question_count: 5, max_followups: 1 },
    timing: { questionMinutes: '2', totalMinutes: '15' } },
  { id: 'pressure', label: '🔥 30 分钟压力练', description: '8 道主问题，最多追问 2 次',
    config: { reviewer_style: 'pressure', initial_difficulty: 4, adaptation_level: 3, question_count: 8, max_followups: 2 },
    timing: { questionMinutes: '3', totalMinutes: '30' } },
] as const

/** Key contains only the server-reported UUID, never the display name. */
export function preferencesKey(userId: string): string {
  if (!/^[0-9a-f-]{32,40}$/i.test(userId)) throw new Error('无效的用户标识')
  return `interview_system:defense-preferences:v1:${userId.toLowerCase()}`
}

function validConfig(value: unknown): value is BackendInterviewConfig {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return ['friendly','neutral','pressure'].includes(String(c.reviewer_style)) &&
    typeof c.initial_difficulty === 'number' && Number.isInteger(c.initial_difficulty) && Number(c.initial_difficulty) >= 1 && Number(c.initial_difficulty) <= 5 &&
    typeof c.adaptation_level === 'number' && Number.isInteger(c.adaptation_level) && Number(c.adaptation_level) >= 0 && Number(c.adaptation_level) <= 3 &&
    typeof c.question_count === 'number' && Number.isInteger(c.question_count) && Number(c.question_count) >= 3 && Number(c.question_count) <= 30 &&
    typeof c.max_followups === 'number' && Number.isInteger(c.max_followups) && Number(c.max_followups) >= 0 && Number(c.max_followups) <= 2
}
export function validPreferences(value: unknown): value is PracticePreferences {
  if (!value || typeof value !== 'object') return false
  const p = value as { config?: unknown; timing?: unknown }
  if (!p.timing || typeof p.timing !== 'object') return false
  const t = p.timing as Record<string, unknown>
  return validConfig(p.config) &&
    typeof t.questionMinutes === 'string' && parseMinutes(t.questionMinutes) !== null &&
    typeof t.totalMinutes === 'string' && parseMinutes(t.totalMinutes) !== null
}
export function loadPreferences(userId: string, storage: Pick<Storage, 'getItem'>): PracticePreferences {
  try {
    const raw = storage.getItem(preferencesKey(userId))
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (validPreferences(parsed)) return parsed
    }
  } catch { /* disabled storage / malformed older preference */ }
  return structuredClone(DEFAULT_PREFERENCES)
}
export function savePreferences(userId: string, preferences: PracticePreferences, storage: Pick<Storage, 'setItem'>): boolean {
  if (!validPreferences(preferences)) return false
  try { storage.setItem(preferencesKey(userId), JSON.stringify(preferences)); return true }
  catch { return false }
}

export type TimeAssessment = { kind: 'invalid' | 'unlimited' | 'enough' | 'tight' | 'short'; message: string; minimum: number | null }
/** Lower-bound estimate only: follow-ups and evaluation time are not guaranteed durations. */
export function assessTime(questionCount: number, questionText: string, totalText: string, followups: number): TimeAssessment {
  const question = parseMinutes(questionText)
  const total = parseMinutes(totalText)
  if (!Number.isInteger(questionCount) || questionCount < 3 || questionCount > 30 ||
      !Number.isInteger(followups) || followups < 0 || followups > 2 || question === null || total === null) {
    return { kind: 'invalid', minimum: null, message: '请填写有效题量与时间（每项为 0～60 的整数）。' }
  }
  if (question === 0 || total === 0) {
    return { kind: 'unlimited', minimum: question === 0 ? null : questionCount * question,
      message: question === 0 ? '每题不限时，无法估算最短练习时长。' : `主问题按上限约 ${questionCount * question} 分钟；整场不限时。` }
  }
  const minimum = questionCount * question
  if (total < minimum) return { kind: 'short', minimum,
    message: `主问题按每题 ${question} 分钟估算约需 ${minimum} 分钟，总时间仅 ${total} 分钟，可能来不及完成。` }
  if (total === minimum || (followups > 0 && total < minimum + followups * question)) {
    return { kind: 'tight', minimum,
      message: `主问题预计约 ${minimum} 分钟，总时间 ${total} 分钟；追问、思考和模型响应可能需要额外时间。` }
  }
  return { kind: 'enough', minimum,
    message: `主问题预计约 ${minimum} 分钟，总时间 ${total} 分钟，尚有 ${total - minimum} 分钟余量（不含追问估算）。` }
}

/** Bind only the newly created session; this is intentionally not a global timer preference. */
export function bindSessionTiming(sessionId: string, timing: DefenseTiming, storage: Pick<Storage, 'setItem'>): boolean {
  if (!/^[0-9a-f-]{16,80}$/i.test(sessionId) || parseMinutes(timing.questionMinutes) === null || parseMinutes(timing.totalMinutes) === null) return false
  try {
    storage.setItem(sessionMinutesKey(sessionId), timing.questionMinutes)
    storage.setItem(sessionTotalMinutesKey(sessionId), timing.totalMinutes)
    return true
  } catch { return false }
}
