/** Per-account opt-in to paid review. Shared by report and completion screens. */
export function autoReviewKey(username: string): string {
  return `interview_system:auto_ai_review:${username}`
}
export function autoReviewEnabled(username: string, storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(autoReviewKey(username)) === '1' } catch { return false }
}

/** Session-scoped completion signal: opening historical sessions must not trigger paid work. */
export function completionReviewMarker(sessionId: string): string {
  return `interview_system:just_completed:${sessionId}`
}
export function markCompleted(sessionId: string, storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(completionReviewMarker(sessionId), '1') } catch { /* safe: manual review remains */ }
}
