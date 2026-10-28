/** Events join the separately mounted microphone/timer with the single interview answer form. */
export const VOICE_TRANSCRIPT_EVENT = 'interview:voice-transcript'
export const VOICE_STATUS_EVENT = 'interview:voice-status'
export const TIMER_GATE_EVENT = 'interview:timer-gate'

export interface VoiceTranscriptDetail {
  sessionId: string
  turnId: string
  text: string
}
export interface TurnStatusDetail {
  sessionId: string
  turnId: string
  active: boolean
}

export function appendRecognizedText(original: string, recognized: string): string {
  const addition = recognized.trim()
  if (!addition) return original
  const gap = original.length && !original.endsWith('\n') ? '\n' : ''
  return original + gap + addition
}

export function announceTranscript(detail: VoiceTranscriptDetail): void {
  window.dispatchEvent(new CustomEvent<VoiceTranscriptDetail>(VOICE_TRANSCRIPT_EVENT, { detail }))
}
export function announceVoiceStatus(detail: TurnStatusDetail): void {
  window.dispatchEvent(new CustomEvent<TurnStatusDetail>(VOICE_STATUS_EVENT, { detail }))
}
export function announceTimerGate(detail: TurnStatusDetail): void {
  window.dispatchEvent(new CustomEvent<TurnStatusDetail>(TIMER_GATE_EVENT, { detail }))
}
