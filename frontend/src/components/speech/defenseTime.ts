/** Stage 9C - pure timing helpers. No backend contracts or database changes. */
export const DEFAULT_MINUTES = 2
export const MAX_MINUTES = 60
export const PREFERRED_MINUTES_KEY = 'stage9c:preferred-minutes'
export function sessionMinutesKey(sessionId: string): string {
  return `stage9c:minutes:${sessionId}`
}

/** Return null for invalid, empty, fractional or out-of-range input. */
export function parseMinutes(input: unknown): number | null {
  if (input === null || input === undefined) return null
  const value = String(input).trim()
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_MINUTES ? parsed : null
}

export interface TimingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Settings are local to each browser and session; old sessions default to 2 minutes. */
export function durationForSession(sessionId: string | null, storage: TimingStorage): number {
  if (!sessionId) return DEFAULT_MINUTES
  try { return parseMinutes(storage.getItem(sessionMinutesKey(sessionId))) ?? DEFAULT_MINUTES }
  catch { return DEFAULT_MINUTES }
}

/** Reuse the existing Stage 9 per-question deadline; refresh must never grant extra time. */
export function stableDeadline(turnKey: string, minutes: number, storage: TimingStorage, now: number): number {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new RangeError('Timed questions must use 1-60 minutes.')
  }
  const maxFuture = now + minutes * 60_000 + 2_000
  try {
    const original = storage.getItem(turnKey)
    if (original !== null) {
      const parsed = Number(original)
      if (Number.isFinite(parsed) && parsed > 1_600_000_000_000 && parsed <= maxFuture) return parsed
    }
  } catch { /* storage may be blocked */ }
  const deadline = now + minutes * 60_000
  try { storage.setItem(turnKey, String(deadline)) } catch { /* still usable this page */ }
  return deadline
}

/** Stage 9D: second setting + persistent whole-session timer. Existing keys remain stable. */
export const DEFAULT_TOTAL_MINUTES = 0
export const PREFERRED_TOTAL_MINUTES_KEY = 'stage9d:preferred-total-minutes'
export function sessionTotalMinutesKey(sessionId: string): string {
  return `stage9d:total-minutes:${sessionId}`
}
export function sessionTotalDeadlineKey(sessionId: string): string {
  return `stage9d:total-deadline:${sessionId}`
}
export function sessionTotalContinueKey(sessionId: string): string {
  return `stage9d:total-continue:${sessionId}`
}
export function totalMinutesForSession(sessionId: string | null, storage: TimingStorage): number {
  if (!sessionId) return DEFAULT_TOTAL_MINUTES
  try { return parseMinutes(storage.getItem(sessionTotalMinutesKey(sessionId))) ?? DEFAULT_TOTAL_MINUTES }
  catch { return DEFAULT_TOTAL_MINUTES }
}
