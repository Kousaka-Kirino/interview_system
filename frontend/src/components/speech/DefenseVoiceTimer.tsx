import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './speechTimer.css'
import { DEFAULT_MINUTES, MAX_MINUTES, PREFERRED_MINUTES_KEY, durationForSession,
  parseMinutes, sessionMinutesKey, stableDeadline } from './defenseTime'

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

/** The existing #configure form remains unchanged; this one field is added through a portal. */
function DefenseTimeSetting() {
  const [isConfig, setIsConfig] = useState(() => /^#(?:configure|interview)(?:\?.*)?$/.test(window.location.hash))
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [minutesText, setMinutesText] = useState(() => {
    try { return String(parseMinutes(window.localStorage.getItem(PREFERRED_MINUTES_KEY)) ?? DEFAULT_MINUTES) }
    catch { return String(DEFAULT_MINUTES) }
  })
  const inputRef = useRef(minutesText)
  inputRef.current = minutesText
  const valid = parseMinutes(minutesText) !== null
  const noLimitSelected = parseMinutes(minutesText) === 0

  useEffect(() => {
    const sync = () => setIsConfig(/^#(?:configure|interview)(?:\?.*)?$/.test(window.location.hash))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (!isConfig) { setSlot(null); return }
    const node = document.createElement('div')
    node.className = 'stage9c-config-slot'
    let active = true
    const position = () => {
      if (!active) return
      const forms = Array.from(document.querySelectorAll<HTMLFormElement>('main form'))
      const form = forms.find((item) => item.getClientRects().length > 0)
      const main = Array.from(document.querySelectorAll<HTMLElement>('main'))
        .find((item) => item.getClientRects().length > 0)
      const host = form ?? main
      if (!host) { node.remove(); return }
      // Prefer immediately before the main action row, otherwise append to the config body.
      const createButton = form && Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => /开始答辩|创建答辩|开始面试|创建面试/.test(button.textContent || ''))
      const actionRow = createButton?.parentElement
      const anchor = actionRow && actionRow.parentElement === host ? actionRow : null
      if (node.parentElement !== host || node.nextElementSibling !== anchor) {
        if (anchor) host.insertBefore(node, anchor)
        else if (node.parentElement !== host || node !== host.lastElementChild) host.appendChild(node)
      }
      if (node.isConnected) setSlot((current) => current === node ? current : node)
    }
    position()
    const interval = window.setInterval(position, 750)
    // This listener is alive on the configure screen when its create call navigates to #session/{id}.
    // Only that direct transition commits a setting to a new session; existing sessions are untouched.
    const bindNewSession = () => {
      const nextSession = sessionFromHash()
      const entered = parseMinutes(inputRef.current)
      if (!nextSession || entered === null) return
      try { window.localStorage.setItem(sessionMinutesKey(nextSession), String(entered)) }
      catch { /* Private browsing can disable persistence; default still works. */ }
    }
    window.addEventListener('hashchange', bindNewSession)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('hashchange', bindNewSession)
      node.remove()
      setSlot(null)
    }
  }, [isConfig])

  function setMinutes(value: string) {
    inputRef.current = value
    setMinutesText(value)
    const number = parseMinutes(value)
    if (number !== null) {
      try { window.localStorage.setItem(PREFERRED_MINUTES_KEY, String(number)) }
      catch { /* allow the form to keep working */ }
    }
  }

  function restoreInvalid() {
    if (valid) return
    let last = DEFAULT_MINUTES
    try { last = parseMinutes(window.localStorage.getItem(PREFERRED_MINUTES_KEY)) ?? DEFAULT_MINUTES }
    catch { /* keep default */ }
    setMinutes(String(last))
  }

  if (!isConfig || !slot) return null
  return createPortal(<section className="stage9c-config" aria-label="每题答辩时间设置">
    <div className="stage9c-config-head">
      <label htmlFor="stage9c-minutes">答辩时间（每题，分钟）</label>
      <span>0 ～ 60</span>
    </div>
    <div className="stage9c-config-row">
      <input id="stage9c-minutes" type="number" inputMode="numeric" min={0} max={MAX_MINUTES} step={1}
        value={minutesText} onChange={(event) => setMinutes(event.target.value)} onBlur={restoreInvalid}
        aria-invalid={!valid} aria-describedby="stage9c-minute-help" />
      <span className="stage9c-unit">分钟</span>
      <span className="stage9c-config-hint">{noLimitSelected ? '当前为不限时' : '当前为每题倒计时'}</span>
    </div>
    <p id="stage9c-minute-help" className="stage9c-help">
      0 表示不限时，1～60 表示每道题的倒计时。默认 2 分钟；创建答辩后本次会话固定使用所选值。
      已有会话不受影响。每段语音录音最长约 2 分钟，可多次录音。
    </p>
    {!valid && <p className="stage9c-error" role="alert">请输入 0～60 的整数；离开输入框会恢复为上次有效值。</p>}
  </section>, slot)
}

/**
 * Standalone add-on: leave InterviewSessionPage.tsx and its scoring logic untouched.
 * The current unanswered turn comes from the existing authenticated session API.
 */
export default function DefenseVoiceTimer() {
  const [sessionId, setSessionId] = useState<string | null>(() => sessionFromHash())
  const [session, setSession] = useState<Session | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(DEFAULT_MINUTES * 60)
  const [continued, setContinued] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
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
      } catch { /* offline hint is shown by existing Stage 5E health panel */ }
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
      const fields = Array.from(document.querySelectorAll<HTMLTextAreaElement>('main textarea:not(.stage9-textarea)'))
      const answerField = fields.find((field) => field.getClientRects().length > 0 && !field.disabled)
        ?? fields.find((field) => field.getClientRects().length > 0)
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
    setRecording(false); setTranscribing(false); setTranscript(''); setError(''); setNotice('')
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

  useEffect(() => () => {
    discardRef.current = true
    if (recordTimeoutRef.current !== null) window.clearTimeout(recordTimeoutRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    mediaRef.current?.getTracks().forEach((track) => track.stop())
    abortRef.current?.abort()
  }, [])

  async function transcribeAudio(data: Blob, recordingTurnKey: string) {
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
      setTranscript((old) => old.trim() ? `${old.trim()}\n${result.text}` : result.text)
      setNotice(`识别成功（约 ${Math.round(result.duration_seconds)} 秒）。请检查文字后再提交。`)
    } catch (cause) {
      if (!abort.signal.aborted) setError(`语音转写失败：${messageOf(cause)}`)
    } finally { if (!abort.signal.aborted) setTranscribing(false) }
  }

  async function startRecording() {
    if (recording || transcribing || submitting || !turnKey) return
    setError(''); setNotice('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音。请使用最新版 Chrome/Edge 并通过 localhost 或 127.0.0.1 访问。')
      return
    }
    const key = turnKey
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
        void transcribeAudio(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), key)
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

  async function submitAnswer(skip: boolean) {
    if (!sessionId || !pendingTurn || !turnKey || submitting) return
    const answer = skip ? SKIP_TEXT : transcript.trim()
    if (!answer) { setError('请先录音识别或输入回答文字。'); return }
    if (!skip && !unlimited && remaining <= 0 && !continued) { setError('请先在超时提示中选择继续作答。'); return }
    const expected = turnKey
    setSubmitting(true); setError(''); setNotice('正在提交给本地答辩后端，请勿重复提交。')
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
      if (!Number.isInteger(id)) throw new Error('无法识别题目编号，请使用原回答框提交。')
      if (skip) {
        discardRef.current = true
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
        abortRef.current?.abort()
        setTranscribing(false)
      }
      const response = await fetch(`/api/interviews/${encodeURIComponent(sessionId)}/answer`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ turn_id: id, answer, user_feedback: 'none' }),
      })
      if (!response.ok) throw await apiError(response)
      // The original interview page owns question/feedback rendering; reload from the server.
      window.location.reload()
    } catch (cause) {
      setError(`${messageOf(cause)} 若刚刚提交成功但网络中断，请刷新查看后端状态，不要重复点击。`)
      setSubmitting(false)
    }
  }

  if (!turnKey || !pendingTurn || (!unlimited && deadline === null) || !slot) return <DefenseTimeSetting />
  const timeoutPrompt = !unlimited && remaining <= 0 && !continued && !submitting
  const late = !unlimited && remaining <= 0
  return <><DefenseTimeSetting />{createPortal(<>
    <section className="stage9-panel" aria-label="语音答辩与每题倒计时">
      <div className="stage9-title">
        <h3>语音回答 · 第 {pendingTurn.question_number ?? '—'} 题</h3>
        <div className={`stage9-timer${late ? ' expired' : !unlimited && remaining <= 30 ? ' warning' : ''}`} role="timer" aria-label="剩余答辩时间">
          {unlimited ? '不限时' : late ? `超时 +${formatTimer(remaining)}` : formatTimer(remaining)}
        </div>
      </div>
      {!unlimited && <div className="stage9-progress"><span style={{ width: `${Math.max(0, Math.min(100, remaining / (answerMinutes * 60) * 100))}%` }} /></div>}
      <p className="stage9-help">本次设置：{unlimited ? '不限时' : `每题 ${answerMinutes} 分钟`}；录音、转写、文字修改均计入答题时间。刷新不重置倒计时。单段语音最长约 2 分钟，可分段录制。</p>
      <div className="stage9-row">
        {recording
          ? <button type="button" className="stage9-button stop" onClick={stopRecording}>■ 停止录音并识别</button>
          : <button type="button" className="stage9-button record" disabled={submitting || transcribing} onClick={() => void startRecording()}>🎙 开始语音回答</button>}
        {transcribing && <span className="stage9-status" role="status">正在本地转文字…</span>}
      </div>
      <label htmlFor="stage9-draft" className="stage9-help">识别后可编辑；也可以直接在这里输入回答：</label>
      <textarea id="stage9-draft" className="stage9-textarea" value={transcript} onChange={(event) => setTranscript(event.target.value)}
        placeholder="点击麦克风回答，停止录音后这里会出现识别文字…" aria-label="可编辑的语音识别回答草稿" />
      <div className="stage9-row">
        <button type="button" className="stage9-button primary" disabled={submitting || transcribing || recording || !transcript.trim() || timeoutPrompt}
          onClick={() => void submitAnswer(false)}>{submitting ? '提交中…' : '提交本题回答'}</button>
        <span className="stage9-help">原有文字回答框仍可正常使用。</span>
      </div>
      {!!notice && <p role="status" className="stage9-status">{notice}</p>}
      {!!error && <p role="alert" className="stage9-error">{error}</p>}
    </section>
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
  </>, slot)}</>
}
