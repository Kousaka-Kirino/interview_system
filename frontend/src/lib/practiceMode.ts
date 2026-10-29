/** A mode is always validated server-side; this is just UI state. */
import type { PracticeMode } from '../types/interview.ts'

export function validPracticeMode(value: unknown): value is PracticeMode {
  return value === 'interview' || value === 'defense'
}

export function modeStorageKey(userId: string): string {
  if (!/^[0-9a-f-]{32,40}$/i.test(userId)) throw new Error('账户标识格式错误')
  return `interview_system:practice-mode:v1:${userId.toLowerCase()}`
}

export function loadPracticeMode(userId: string, storage: Pick<Storage, 'getItem'>): PracticeMode {
  try {
    const stored = storage.getItem(modeStorageKey(userId))
    return validPracticeMode(stored) ? stored : 'interview'
  } catch { return 'interview' }
}

export function savePracticeMode(userId: string, mode: PracticeMode, storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(modeStorageKey(userId), mode) } catch { /* local preference only */ }
}

export function canStartPractice(mode: PracticeMode, resumeId: string, materialIds: string[]): boolean {
  return mode === 'defense' ? materialIds.length > 0 : !!resumeId
}
