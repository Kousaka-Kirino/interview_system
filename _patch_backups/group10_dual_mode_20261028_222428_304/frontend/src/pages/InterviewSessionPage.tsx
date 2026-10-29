import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Send,
  Square,
} from 'lucide-react'
import {
  answerInterview,
  finishInterview,
  getInterview,
  getInterviewReport,
  generateAIInterviewReport,
} from '../lib/interviews'
import { messageOf } from '../lib/resources'
import { autoReviewEnabled, completionReviewMarker, markCompleted } from '../lib/autoReviewPreference'
import { appendRecognizedText, VOICE_STATUS_EVENT, VOICE_TRANSCRIPT_EVENT, TIMER_GATE_EVENT } from '../lib/answerDraftBridge'
import type { TurnStatusDetail, VoiceTranscriptDetail } from '../lib/answerDraftBridge'
import type {
  InterviewEvaluation,
  InterviewReport,
  InterviewSession,
  InterviewTurn,
  UserDifficultyFeedback,
} from '../types/interview'

const difficultyFeedback: Array<{ value: UserDifficultyFeedback; label: string }> = [
  { value: 'too_hard', label: '😱 太难' },
  { value: 'just_right', label: '😐 刚好' },
  { value: 'too_easy', label: '😎 太简单' },
]

function answered(turn: InterviewTurn) {
  return turn.answer !== null
}

function scoreLabel(value: number | null) {
  return value === null ? '—' : value.toFixed(1)
}

export default function InterviewSessionPage({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<UserDifficultyFeedback>('none')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [timerBlocked, setTimerBlocked] = useState(false)
  const [busy, setBusy] = useState<'answer' | 'finish' | null>(null)
  const [evaluation, setEvaluation] = useState<InterviewEvaluation | null>(null)
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [reportError, setReportError] = useState('')
  const [reportRefresh, setReportRefresh] = useState(0)
  const [autoReviewState, setAutoReviewState] = useState('')
  const autoAttempted = useRef(new Set<string>())

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setLoading(true)
    setSession(null)
    setLoadError('')
    setActionError('')
    setEvaluation(null)
    setNotice('')
    setAnswer('')
    setFeedback('none')
    setVoiceBusy(false)
    setTimerBlocked(false)
    getInterview(sessionId, controller.signal)
      .then((data) => { if (live) setSession(data) })
      .catch((error: unknown) => {
        if (live && !(error instanceof Error && error.name === 'AbortError')) setLoadError(messageOf(error))
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [sessionId, refreshCounter])

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setReport(null)
    setReportError('')
    if (session?.status !== 'completed') return () => { live = false }
    getInterviewReport(sessionId, controller.signal)
      .then((data) => { if (live) setReport(data) })
      .catch((error: unknown) => {
        if (live && !(error instanceof Error && error.name === 'AbortError')) setReportError(messageOf(error))
      })
    return () => { live = false; controller.abort() }
  }, [sessionId, session?.status, reportRefresh])

  // Auto review is explicitly opt-in per username. On completion, request the
  // existing cache-aware endpoint once. This never delays or rolls back answers.
  useEffect(() => {
    if (session?.status !== 'completed' || !session.turns.some((turn) => turn.answer !== null) ||
        autoAttempted.current.has(sessionId)) return
    try { if (window.sessionStorage.getItem(completionReviewMarker(sessionId)) !== '1') return }
    catch { return }
    autoAttempted.current.add(sessionId)
    try { window.sessionStorage.removeItem(completionReviewMarker(sessionId)) } catch { /* ignored */ }
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) return
        const account = await response.json() as { username?: string }
        if (!account.username || !autoReviewEnabled(account.username, window.localStorage)) return
        if (live) setAutoReviewState('已启用自动 AI 复盘，正在检查缓存或生成…')
        await generateAIInterviewReport(sessionId, false)
        if (live) { setAutoReviewState('AI 复盘已保存，薄弱点已整理到复习库。'); setReportRefresh((prev) => prev + 1) }
      } catch (error) {
        if (live) setAutoReviewState(`自动复盘未完成：${messageOf(error)}。请进入复盘页重试。`)
      }
    })()
    return () => { live = false }
  }, [sessionId, session?.status])

  const pending = session?.status === 'active'
    ? session.turns[session.turns.length - 1]
    : undefined
  const currentQuestion = pending && !answered(pending) ? pending : null
  const completedTurns = session?.turns.filter(answered) ?? []

  useEffect(() => {
    // Do not carry busy/timing status from the previous question into the next one.
    setVoiceBusy(false)
    setTimerBlocked(false)
  }, [sessionId, currentQuestion?.id])

  useEffect(() => {
    const openTurnId = currentQuestion ? String(currentQuestion.id) : null
    function matches(detail: TurnStatusDetail | VoiceTranscriptDetail | undefined): boolean {
      return !!detail && !!openTurnId && detail.sessionId === sessionId && detail.turnId === openTurnId
    }
    const onTranscript = (event: Event) => {
      const detail = (event as CustomEvent<VoiceTranscriptDetail>).detail
      if (matches(detail)) setAnswer((existing) => appendRecognizedText(existing, detail.text).slice(0, 10000))
    }
    const onVoice = (event: Event) => {
      const detail = (event as CustomEvent<TurnStatusDetail>).detail
      if (matches(detail)) setVoiceBusy(detail.active)
    }
    const onTimer = (event: Event) => {
      const detail = (event as CustomEvent<TurnStatusDetail>).detail
      if (matches(detail)) setTimerBlocked(detail.active)
    }
    window.addEventListener(VOICE_TRANSCRIPT_EVENT, onTranscript)
    window.addEventListener(VOICE_STATUS_EVENT, onVoice)
    window.addEventListener(TIMER_GATE_EVENT, onTimer)
    return () => {
      window.removeEventListener(VOICE_TRANSCRIPT_EVENT, onTranscript)
      window.removeEventListener(VOICE_STATUS_EVENT, onVoice)
      window.removeEventListener(TIMER_GATE_EVENT, onTimer)
    }
  }, [sessionId, currentQuestion?.id])

  async function submitAnswer() {
    if (!session || !currentQuestion || busy || voiceBusy || timerBlocked) return
    const normalized = answer.trim()
    if (!normalized) { setActionError('请先输入回答。'); return }
    if (normalized.length > 10000) { setActionError('回答最多 10000 字符。'); return }
    setBusy('answer')
    setActionError('')
    setNotice('')
    try {
      const result = await answerInterview(sessionId, {
        turn_id: currentQuestion.id,
        answer: normalized,
        user_feedback: feedback,
      })
      if (result.session.status === 'completed') markCompleted(sessionId, window.sessionStorage)
      setSession(result.session)
      setEvaluation(result.evaluation)
      setAnswer('')
      setFeedback('none')
      setNotice('已提交回答并保存评分。')
    } catch (error) {
      setActionError(`${messageOf(error)} 如果网络中断，请先刷新会话检查这题是否已经提交，不要立即重复发送。`)
    } finally {
      setBusy(null)
    }
  }

  async function finish() {
    if (!session || busy || voiceBusy) return
    const open = session.turns.find((turn) => turn.answer === null)
    const pendingMessage = open
      ? `未答的第 ${open.question_number} 道主问题${open.followup_number ? `（第 ${open.followup_number} 次追问）` : ''}不会计入已回答题目，复盘中仍会记录未答数量。\n\n`
      : ''
    if (!window.confirm(`${pendingMessage}确定提前结束本次答辩？结束后无法继续回答。`)) return
    setBusy('finish')
    setActionError('')
    try {
      const next = await finishInterview(sessionId)
      markCompleted(sessionId, window.sessionStorage)
      setSession(next)
      setEvaluation(null)
      setNotice('答辩已结束，可查看离线规则复盘。')
      setReportRefresh((prev) => prev + 1)
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <a href="#dashboard" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-300">
          <ArrowLeft className="size-4" /> 返回工作台
        </a>
        <div className="mt-5 mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><BookOpenCheck className="size-7 text-cyan-300" /> 答辩会话</h1>
            <p className="mt-2 break-all font-mono text-xs text-slate-500">{sessionId}</p>
          </div>
          <button type="button" onClick={() => setRefreshCounter((prev) => prev + 1)} disabled={!!busy || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40">
            <RefreshCw className="size-4" /> 刷新会话
          </button>
        </div>

        {loading && <div role="status" className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-slate-400">正在加载会话…</div>}
        {loadError && (
          <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-rose-100">
            {loadError} <button type="button" className="ml-2 underline" onClick={() => setRefreshCounter((n) => n + 1)}>重试</button>
          </div>
        )}

        {session && (
          <>
            <div className="mb-6 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-3 py-1 ${session.status === 'completed' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-cyan-400/10 text-cyan-300'}`}>
                {session.status === 'completed' ? '已完成' : '进行中'}
              </span>
              <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">主问题 {session.main_questions_asked} / {session.config.question_count}</span>
              <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">当前难度 {session.current_difficulty} / 5</span>
              <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">已回答 {completedTurns.length} 题（含追问）</span>
            </div>

            <section className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 sm:p-6">
              <h2 className="mb-5 text-lg font-semibold">本场问答记录</h2>
              <div className="space-y-3">
                {completedTurns.length === 0 && <p className="text-sm text-slate-400">暂无已回答题目，请在下方回答当前题。</p>}
                {completedTurns.map((turn) => (
                  <details key={turn.id} className="group rounded-xl border border-white/10 bg-slate-950/40">
                    <summary className="cursor-pointer list-none rounded-xl px-4 py-3 text-sm text-slate-200 marker:hidden hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span>第 {turn.question_number} 道主问题{turn.followup_number ? ` · 第 ${turn.followup_number} 次追问` : ''} <span className="ml-1 text-emerald-300">✓ 已回答</span></span>
                        <span className="text-cyan-300">{scoreLabel(turn.score)} 分 <span className="ml-2 text-slate-400 group-open:hidden">展开详情 ▾</span><span className="ml-2 hidden text-slate-400 group-open:inline">收起 ▴</span></span>
                      </span>
                    </summary>
                    <div className="border-t border-white/10 px-4 py-4">
                      <p className="mb-1 text-xs text-slate-400">难度 {turn.difficulty} / 5</p>
                      <p className="whitespace-pre-wrap font-medium leading-7">{turn.question}</p>
                      <p className="mt-4 text-xs font-semibold text-cyan-300">你的回答</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{turn.answer}</p>
                      {turn.feedback && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-400">AI 给出的建议：{turn.feedback}</p>}
                    </div>
                  </details>
                ))}
              </div>
            </section>

            {evaluation && <div role="status" className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5">
              <p className="font-semibold text-emerald-200">上一题评分：{scoreLabel(evaluation.score)}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{evaluation.feedback}</p>
              <p className="mt-2 text-xs text-slate-400">难度调整：{evaluation.adaptation_reason}</p>
            </div>}

            {session.status === 'active' && currentQuestion && (
              <section className="mt-6 rounded-2xl border border-cyan-400/20 bg-slate-900 p-5 sm:p-6">
                <h2 className="mb-3 text-lg font-semibold">回答当前题目</h2>
                <div className="mb-5 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-4">
                  <p className="mb-2 text-xs text-cyan-300">第 {currentQuestion.question_number} 道主问题{currentQuestion.followup_number ? ` · 第 ${currentQuestion.followup_number} 次追问` : ''} · 难度 {currentQuestion.difficulty}/5</p>
                  <p className="whitespace-pre-wrap font-medium leading-7">{currentQuestion.question}</p>
                </div>
                <label htmlFor="current-answer" className="block text-sm text-slate-400">回答内容（最多 10000 字符）</label>
                <textarea id="current-answer" rows={7} maxLength={10000} value={answer} disabled={!!busy}
                  onChange={(event) => setAnswer(event.target.value)} placeholder="在此输入回答，或点击上方麦克风将识别文字追加到这里…"
                  className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-slate-950 p-4 text-sm leading-6 text-white focus:border-cyan-400 focus:outline-none disabled:opacity-50" />
                <div className="mt-2 text-right text-xs text-slate-500">{answer.length} / 10000</div>
                <fieldset className="mt-4">
                  <legend className="text-sm text-slate-300">这道题的难度感受（可选，提交时一并保存）</legend>
                  <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="难度感受">
                    {difficultyFeedback.map((item) => (
                      <button key={item.value} type="button" aria-pressed={feedback === item.value} disabled={!!busy}
                        onClick={() => setFeedback((previous) => previous === item.value ? 'none' : item.value)}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${feedback === item.value ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100' : 'border-white/15 bg-slate-950 text-slate-300 hover:bg-white/10'}`}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {(voiceBusy || timerBlocked) && <p role="status" className="mt-3 text-xs text-amber-200">{voiceBusy ? '录音、转写或跳过操作进行中，请完成后提交。' : '计时已到，请先在超时提示中选择继续或结束。'}</p>}
                {actionError && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{actionError}</p>}
                {notice && <p role="status" className="mt-4 text-sm text-emerald-300">{notice}</p>}
                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <button type="button" onClick={finish} disabled={!!busy || voiceBusy}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-400/30 px-4 py-3 text-sm text-rose-200 hover:bg-rose-400/10 disabled:opacity-40">
                    {busy === 'finish' ? <LoaderCircle className="size-4 animate-spin" /> : <Square className="size-4" />} 提前结束
                  </button>
                  <button type="button" onClick={submitAnswer} disabled={!!busy || voiceBusy || timerBlocked || !answer.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
                    {busy === 'answer' ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {busy === 'answer' ? '评估并生成下一题…' : '提交回答'}
                  </button>
                </div>
              </section>
            )}

            {session.status === 'active' && !currentQuestion && (
              <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
                当前会话没有待答题，可能存在状态不同步。请刷新会话查看服务器最新状态。
              </div>
            )}

            {session.status === 'completed' && (
              <section className="mt-6 rounded-2xl border border-emerald-400/20 bg-slate-900/75 p-5 sm:p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="size-5 text-emerald-300" /> 答辩已结束</h2>
                <p className="mt-2 text-sm text-slate-400">已结束本场练习。详细优势、不足、AI 参考答案及导出统一在完整复盘中查看。</p>
                {report && (
                  <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                    <div className="rounded-xl bg-slate-950/50 p-3">已答 <strong>{report.answered_count}</strong></div>
                    <div className="rounded-xl bg-slate-950/50 p-3">未答 <strong>{report.unanswered_count}</strong></div>
                    <div className="rounded-xl bg-slate-950/50 p-3">均分 <strong>{scoreLabel(report.average_score)}</strong></div>
                  </div>
                )}
                <a href={`#report/${encodeURIComponent(sessionId)}`} className="mt-5 inline-flex w-full justify-center rounded-xl bg-cyan-400 px-5 py-3 text-base font-semibold text-slate-950 hover:bg-cyan-300">查看完整复盘与导出</a>
                {autoReviewState && <p role="status" className="mt-3 text-sm text-cyan-200">{autoReviewState}</p>}
                {notice && <p className="mt-3 text-sm text-emerald-300">{notice}</p>}
                {reportError && <p role="alert" className="mt-4 text-sm text-rose-200">复盘加载失败：{reportError}</p>}
                {!report && !reportError && <p className="mt-3 text-sm text-slate-400">正在加载离线复盘…</p>}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
