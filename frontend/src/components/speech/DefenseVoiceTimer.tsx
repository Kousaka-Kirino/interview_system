import { markCompleted } from '../../lib/autoReviewPreference'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './speechTimer.css'
import { announceTranscript, announceVoiceStatus, announceTimerGate } from '../../lib/answerDraftBridge'
import { DEFAULT_MINUTES, durationForSession, totalMinutesForSession,
  sessionTotalDeadlineKey,
  sessionTotalContinueKey, stableDeadline } from './defenseTime'

type Turn = {
  id: number | string
  question?: string
  question_number?: number
  followup_number?: number
  answer?: string | null
}
type Session = { id: string; status: string; turns: Turn[] }
type Transcription = { text: string; language: string; duration_seconds: number }

const MAX_CLIP_DURATION_MS = 120_000
const SKIP_TEXT = '【本题超时跳过：用户选择进入下一题，未实际作答】'

function sessionFromHash(): string | null {
  const matched = /^#session\/([0-9a-f-]{16,80})$/i.exec(window.location.hash)
  return matched ? matched[1] : null
}
function formatTimer(seconds: number): string {
  const time = Math.abs(seconds)
  return `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`
}
function messageOf(e: unknown): string { return e instanceof Error ? e.message : '操作失败，请重试。' }
async function apiError(response: Response): Promise<Error> {
  let explanation = `接口请求失败（HTTP ${response.status}）`
  try {
    const content = await response.json() as { detail?: unknown }
    if (typeof content.detail === 'string') explanation = content.detail
  } catch { /* keep status */ }
  return new Error(explanation)
}
function chooseFormat(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return undefined
}
function recordedFileExtension(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

/** Microphone and timing UI; the interview page owns the only editable answer and its submission. */
export default function DefenseVoiceTimer() {
  const [sessionId, setSessionId] = useState<string | null>(() => sessionFromHash())
  const [session, setSession] = useState<Session | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(DEFAULT_MINUTES * 60)
  const [continued, setContinued] = useState(false)
  const [totalDeadline, setTotalDeadline] = useState<number | null>(null)
  const [totalRemaining, setTotalRemaining] = useState(0)
  const [totalContinued, setTotalContinued] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const mediaRef = useRef<MediaStream | null>(null)
  const discardRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const recordTimeoutRef = useRef<number | null>(null)
  const turnRef = useRef<string | null>(null)

  const pendingTurn = session?.status === 'active'
    ? [...session.turns].reverse().find((turn) => turn.answer == null || turn.answer === '')
    : undefined
  const turnKey = sessionId && pendingTurn ? `stage9:deadline:${sessionId}:${pendingTurn.id}` : null
  turnRef.current = turnKey
  // Stage 9C: per-session setting, bound when leaving #configure for a newly created session.
  let answerMinutes = DEFAULT_MINUTES
  try { answerMinutes = durationForSession(sessionId, window.localStorage) }
  catch { /* storage may be restricted in private mode */ }
  const unlimited = answerMinutes === 0
  let totalMinutes = 0
  try { totalMinutes = totalMinutesForSession(sessionId, window.localStorage) }
  catch { /* storage may be restricted */ }
  const totalActive = session?.status === 'active' && !!turnKey && totalMinutes > 0

  useEffect(() => {
    const update = () => setSessionId(sessionFromHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    setSession(null)
    if (!sessionId) return
    let mounted = true
    let pending = false
    const poll = async () => {
      if (pending || !mounted || document.hidden) return
      pending = true
      try {
        const response = await fetch(`/api/interviews/${encodeURIComponent(sessionId)}`, {
          credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
        })
        if (!response.ok) { if (mounted) setSession(null); return }
        const value = await response.json() as Session
        if (mounted) setSession(value)
      } catch { /* Keep the existing session until connectivity resumes. */ }
      finally { pending = false }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 2400)
    const onVisible = () => { if (!document.hidden) void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { mounted = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [sessionId])

  useEffect(() => {
    if (!turnKey) { setSlot(null); return }
    const element = document.createElement('div')
    element.className = 'stage9-portal-slot'
    let active = true
    const place = () => {
      if (!active) return
      // Stage 9B: keep the countdown and microphone with the ORIGINAL answer field.
      // Never prepend the add-on to <main> (that puts it above the question).
      const answerField = document.querySelector<HTMLTextAreaElement>('#current-answer')
      const holder = answerField?.parentElement
      if (!holder || !answerField) {
        if (element.isConnected) element.remove()
        return
      }
      // DOM move only; the portal keeps its React state and its stored deadline.
      if (element.parentElement !== holder || element.nextElementSibling !== answerField) {
        holder.insertBefore(element, answerField)
      }
      if (element.isConnected) setSlot((previous) => previous === element ? previous : element)
    }
    place()
    const interval = window.setInterval(place, 550)
    return () => { active = false; window.clearInterval(interval); element.remove(); setSlot(null) }
  }, [turnKey])

  useEffect(() => {
    // A new question resets both the timer and voice draft. Refresh does not.
    discardRef.current = true
    if (recordTimeoutRef.current !== null) window.clearTimeout(recordTimeoutRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    mediaRef.current?.getTracks().forEach((track) => track.stop())
    abortRef.current?.abort()
    recorderRef.current = null; mediaRef.current = null; abortRef.current = null
    setRecording(false); setTranscribing(false); setError(''); setNotice('')
    if (!turnKey) { setDeadline(null); return }
    if (unlimited) {
      setDeadline(null); setContinued(true); setRemaining(0)
      return
    }
    let choseContinue = false
    try { choseContinue = window.localStorage.getItem(turnKey + ':continue') === '1' }
    catch { /* storage may be disabled */ }
    let endAt: number
    try { endAt = stableDeadline(turnKey, answerMinutes, window.localStorage, Date.now()) }
    catch { endAt = Date.now() + answerMinutes * 60_000 }
    setDeadline(endAt); setContinued(choseContinue)
    setRemaining(Math.ceil((endAt - Date.now()) / 1000))
  }, [turnKey, answerMinutes, unlimited])

  useEffect(() => {
    if (deadline === null) return
    const update = () => setRemaining(Math.ceil((deadline - Date.now()) / 1000))
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [deadline])

  useEffect(() => {
    if (!totalActive || !sessionId) {
      setTotalDeadline(null)
      setTotalRemaining(0)
      setTotalContinued(false)
      return
    }
    const key = sessionTotalDeadlineKey(sessionId)
    let endAt: number
    try { endAt = stableDeadline(key, totalMinutes, window.localStorage, Date.now()) }
    catch { endAt = Date.now() + totalMinutes * 60_000 }
    let choseContinue = false
    try { choseContinue = window.localStorage.getItem(sessionTotalContinueKey(sessionId)) === '1' }
    catch { /* storage may be disabled */ }
    setTotalDeadline(endAt)
    setTotalContinued(choseContinue)
    setTotalRemaining(Math.ceil((endAt - Date.now()) / 1000))
  }, [sessionId, totalMinutes, totalActive])

  useEffect(() => {
    if (totalDeadline === null) return
    const update = () => setTotalRemaining(Math.ceil((totalDeadline - Date.now()) / 1000))
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [totalDeadline])

  useEffect(() => () => {
    discardRef.current = true
    if (recordTimeoutRef.current !== null) window.clearTimeout(recordTimeoutRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    mediaRef.current?.getTracks().forEach((track) => track.stop())
    abortRef.current?.abort()
  }, [])

  async function transcribeAudio(data: Blob, recordingTurnKey: string, recordingSessionId: string, recordingTurnId: string) {
    if (recordingTurnKey !== turnRef.current) return
    if (data.size > 18 * 1024 * 1024) { setError('录音太大，请分段录制。'); return }
    if (data.size < 128) { setError('录音内容为空，请重新录制。'); return }
    const abort = new AbortController()
    abortRef.current = abort
    setTranscribing(true); setNotice('正在本地识别语音，首次使用 Whisper 需要下载模型，可能稍慢。')
    try {
      const form = new FormData()
      form.append('file', data, `answer.${recordedFileExtension(data.type)}`)
      const response = await fetch('/api/speech/transcribe', {
        method: 'POST', body: form, credentials: 'same-origin', signal: abort.signal,
      })
      if (!response.ok) throw await apiError(response)
      const result = await response.json() as Transcription
      if (abort.signal.aborted || recordingTurnKey !== turnRef.current) return
      if (!result.text.trim()) { setError('没有识别到有效中文语音，请重录或输入文字。'); return }
      announceTranscript({ sessionId: recordingSessionId, turnId: recordingTurnId, text: result.text })
      setNotice(`识别成功（约 ${Math.round(result.duration_seconds)} 秒）。请检查文字后再提交。`)
    } catch (cause) {
      if (!abort.signal.aborted) setError(`语音转写失败：${messageOf(cause)}`)
    } finally { if (!abort.signal.aborted) setTranscribing(false) }
  }

  async function startRecording() {
    if (recording || transcribing || skipping || !turnKey || !sessionId || !pendingTurn) return
    setError(''); setNotice('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音。请使用最新版 Chrome/Edge 并通过 localhost 或 127.0.0.1 访问。')
      return
    }
    const key = turnKey
    const recordingSessionId = sessionId
    const recordingTurnId = String(pendingTurn.id)
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (key !== turnRef.current) { media.getTracks().forEach((t) => t.stop()); return }
      discardRef.current = false
      mediaRef.current = media
      const mimeType = chooseFormat()
      const recorder = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media)
      recorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (event: BlobEvent) => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => { setError('录音中断，请重试。'); media.getTracks().forEach((t) => t.stop()) }
      recorder.onstop = () => {
        media.getTracks().forEach((t) => t.stop())
        if (recordTimeoutRef.current !== null) window.clearTimeout(recordTimeoutRef.current)
        recordTimeoutRef.current = null
        if (recorderRef.current === recorder) recorderRef.current = null
        setRecording(false)
        if (discardRef.current || key !== turnRef.current) return
        void transcribeAudio(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), key, recordingSessionId, recordingTurnId)
      }
      recorder.start(1000)
      setRecording(true)
      setNotice('录音中。停止录音后会自动转换为文字。')
      // Avoid excessively long recordings while the user is in overtime mode.
      recordTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, MAX_CLIP_DURATION_MS)
    } catch (cause) { setError(`无法使用麦克风：${messageOf(cause)}`) }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  function continueAnswer() {
    if (!turnKey) return
    try { window.localStorage.setItem(turnKey + ':continue', '1') } catch { /* ignored */ }
    setContinued(true)
  }

  function continueSession() {
    if (!sessionId) return
    try { window.localStorage.setItem(sessionTotalContinueKey(sessionId), '1') }
    catch { /* still works until refresh */ }
    setTotalContinued(true)
  }

  async function finishSession() {
    if (!sessionId || finishing || skipping) return
    setFinishing(true); setError(''); setNotice('正在结束本次答辩，请勿重复操作。')
    try {
      const live = await fetch(`/api/interviews/${encodeURIComponent(sessionId)}`, {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      })
      if (!live.ok) throw await apiError(live)
      const current = await live.json() as Session
      if (current.status !== 'active') { window.location.reload(); return }
      const response = await fetch(`/api/interviews/${encodeURIComponent(sessionId)}/finish`, {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw await apiError(response)
      markCompleted(sessionId, window.sessionStorage)
      window.location.reload()
    } catch (cause) {
      setError(`${messageOf(cause)} 如果服务端已完成，请刷新页面检查状态。`)
      setFinishing(false)
    }
  }

  async function submitAnswer(skip: boolean) {
    if (!skip || !sessionId || !pendingTurn || !turnKey || skipping) return
    const answer = SKIP_TEXT
    if (totalActive && totalDeadline !== null && totalRemaining <= 0 && !totalContinued) {
      setError('本次答辩总时间已到，请先选择继续本场或结束本场。'); return
    }
    const expected = turnKey
    setSkipping(true); setError(''); setNotice('正在跳过本题，请勿重复操作。')
    try {
      // Check the server turn before sending to avoid stale submissions after original UI actions.
      const current = await fetch(`/api/interviews/${encodeURIComponent(sessionId)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!current.ok) throw await apiError(current)
      const live = await current.json() as Session
      const open = live.status === 'active'
        ? [...live.turns].reverse().find((t) => t.answer == null || t.answer === '')
        : undefined
      if (!open || String(open.id) !== String(pendingTurn.id) || expected !== turnRef.current) {
        throw new Error('当前题目已经发生变化，未重复提交。请刷新查看最新题目。')
      }
      const id = Number(pendingTurn.id)
      if (!Number.isInteger(id)) throw new Error('无法识别题目编号，请刷新后重试。')
      discardRef.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      abortRef.current?.abort()
      setTranscribing(false)
      const response = await fetch(`/api/interviews/${encodeURIComponent(sessionId)}/answer`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ turn_id: id, answer, user_feedback: 'none' }),
      })
      if (!response.ok) throw await apiError(response)
      // A timeout skip is an explicit special action, not a second normal-answer submit path.
      window.location.reload()
    } catch (cause) {
      setError(`${messageOf(cause)} 若刚刚提交成功但网络中断，请刷新查看后端状态，不要重复点击。`)
      setSkipping(false)
    }
  }

  // Keep the single answer form aware of recording/transcribing and timeout decisions.
  const activeTurnId = pendingTurn ? String(pendingTurn.id) : null
  useEffect(() => {
    if (!sessionId || !activeTurnId) return
    announceVoiceStatus({ sessionId, turnId: activeTurnId, active: recording || transcribing || skipping })
    return () => announceVoiceStatus({ sessionId, turnId: activeTurnId, active: false })
  }, [sessionId, activeTurnId, recording, transcribing, skipping])
  const timerBlocksAnswer = (!unlimited && deadline !== null && remaining <= 0 && !continued) ||
    (totalActive && totalDeadline !== null && totalRemaining <= 0 && !totalContinued)
  useEffect(() => {
    if (!sessionId || !activeTurnId) return
    announceTimerGate({ sessionId, turnId: activeTurnId, active: timerBlocksAnswer })
    return () => announceTimerGate({ sessionId, turnId: activeTurnId, active: false })
  }, [sessionId, activeTurnId, timerBlocksAnswer])

  if (!turnKey || !pendingTurn || (!unlimited && deadline === null) || !slot) return null
  const wholeSessionTimeIsUp = totalActive && totalDeadline !== null && totalRemaining <= 0 && !totalContinued
  const totalTimeoutPrompt = wholeSessionTimeIsUp && !skipping
  const timeoutPrompt = !wholeSessionTimeIsUp && !unlimited && remaining <= 0 && !continued && !skipping && !finishing
  const late = !unlimited && remaining <= 0
  const totalLate = totalActive && totalRemaining <= 0
  return createPortal(<>
    <section className="stage9-panel" aria-label="语音答辩与每题倒计时">
      <div className="stage9-title">
        <h3>语音回答 · 第 {pendingTurn.question_number ?? '—'} 题</h3>
        <div className="stage9d-timer-pair">
          <div className="stage9d-timer-block">
            <span className="stage9d-timer-label">本题剩余</span>
            <div className={`stage9-timer${late ? ' expired' : !unlimited && remaining <= 30 ? ' warning' : ''}`} role="timer" aria-label="本题剩余时间">
              {unlimited ? '不限时' : late ? `超时 +${formatTimer(remaining)}` : formatTimer(remaining)}
            </div>
          </div>
          <div className="stage9d-timer-block">
            <span className="stage9d-timer-label">本场剩余</span>
            <div className={`stage9-timer${totalLate ? ' expired' : totalActive && totalRemaining <= 60 ? ' warning' : ''}`} role="timer" aria-label="本场剩余时间">
              {!totalActive ? '不限时' : totalLate ? `超时 +${formatTimer(totalRemaining)}` : formatTimer(totalRemaining)}
            </div>
          </div>
        </div>
      </div>
      {!unlimited && <div className="stage9-progress"><span style={{ width: `${Math.max(0, Math.min(100, remaining / (answerMinutes * 60) * 100))}%` }} /></div>}
      <p className="stage9-help">本题：{unlimited ? '不限时' : `${answerMinutes} 分钟`}；本场：{totalMinutes === 0 ? '不限时' : `${totalMinutes} 分钟`}。
        两个倒计时同时运行，录音、转写、修改文字均计时。刷新及换题不会重置本场时间；单段录音最长约 2 分钟。</p>
      <div className="stage9-row">
        {recording
          ? <button type="button" className="stage9-button stop" onClick={stopRecording}>■ 停止录音并识别</button>
          : <button type="button" className="stage9-button record" disabled={skipping || transcribing} onClick={() => void startRecording()}>🎙 开始语音回答</button>}
        {transcribing && <span className="stage9-status" role="status">正在本地转文字…</span>}
      </div>
      <p className="stage9-help">语音识别结果会自动追加到下方唯一的回答框，检查并编辑后点击“提交回答”。无需单独提交语音草稿。</p>
      {!!notice && <p role="status" className="stage9-status">{notice}</p>}
      {!!error && <p role="alert" className="stage9-error">{error}</p>}
    </section>
    {totalTimeoutPrompt && <div className="stage9-modal-bg" role="dialog" aria-modal="true" aria-label="本次答辩总时间已到">
      <div className="stage9-modal">
        <h3>本次答辩的 {totalMinutes} 分钟已结束</h3>
        <p>总时长已到。你可以继续本次答辩（显示超出时间），也可以结束本场并查看报告。</p>
        <p>结束本场会调用原有完成接口；尚未提交的文字不会自动保存。请先保存有需要的回答。</p>
        {!!error && <p role="alert" className="stage9-error">{error}</p>}
        <div className="stage9-row">
          <button type="button" className="stage9-button primary" disabled={finishing} onClick={continueSession}>继续本次答辩</button>
          <button type="button" className="stage9-button stop" disabled={finishing} onClick={() => void finishSession()}>
            {finishing ? '结束中…' : '结束本场答辩'}
          </button>
        </div>
      </div>
    </div>}
    {timeoutPrompt && <div className="stage9-modal-bg" role="dialog" aria-modal="true" aria-label="本题已超时">
      <div className="stage9-modal">
        <h3>本题 {answerMinutes} 分钟已结束</h3>
        <p>你还没有完成本题。可以继续回答（显示超时用时），或者跳过本题、进入下一题。</p>
        <p>跳过会把“本题超时跳过”作为文字记录交给原有答辩后端；原有评分逻辑可能仍会评价这条记录。</p>
        {!!error && <p role="alert" className="stage9-error">{error}</p>}
        <div className="stage9-row">
          <button type="button" className="stage9-button primary" onClick={continueAnswer}>继续完成本题</button>
          <button type="button" className="stage9-button stop" onClick={() => void submitAnswer(true)}>跳过并进入下一题</button>
        </div>
      </div>
    </div>}
  </>, slot)
}
