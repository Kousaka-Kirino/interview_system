import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
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
} from '../lib/interviews'
import { messageOf } from '../lib/resources'
import type {
  InterviewEvaluation,
  InterviewReport,
  InterviewSession,
  InterviewTurn,
  UserDifficultyFeedback,
} from '../types/interview'

const difficultyFeedback: Array<{ value: UserDifficultyFeedback; label: string }> = [
  { value: 'none', label: '无特别反馈' },
  { value: 'too_easy', label: '这题偏简单' },
  { value: 'just_right', label: '难度合适' },
  { value: 'too_hard', label: '这题偏困难' },
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
  const [busy, setBusy] = useState<'answer' | 'finish' | null>(null)
  const [evaluation, setEvaluation] = useState<InterviewEvaluation | null>(null)
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [reportError, setReportError] = useState('')
  const [reportRefresh, setReportRefresh] = useState(0)

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

  const pending = session?.status === 'active'
    ? session.turns[session.turns.length - 1]
    : undefined
  const currentQuestion = pending && !answered(pending) ? pending : null
  const completedTurns = session?.turns.filter(answered) ?? []

  async function submitAnswer() {
    if (!session || !currentQuestion || busy) return
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
    if (!session || busy) return
    if (!window.confirm('确认提前结束本次答辩？结束后无法继续回答。')) return
    setBusy('finish')
    setActionError('')
    try {
      const next = await finishInterview(sessionId)
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
              <div className="space-y-5">
                {session.turns.map((turn) => (
                  <article key={turn.id} className={`rounded-xl border p-4 ${turn.id === currentQuestion?.id ? 'border-cyan-400/40 bg-cyan-400/5' : 'border-white/10 bg-slate-950/40'}`}>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>第 {turn.question_number} 道主问题{turn.followup_number ? ` · 第 ${turn.followup_number} 次追问` : ''}</span>
                      <span>难度 {turn.difficulty} / 5</span>
                    </div>
                    <p className="whitespace-pre-wrap text-base font-medium leading-7 text-slate-100">{turn.question}</p>
                    {turn.answer !== null && (
                      <div className="mt-4 border-t border-white/10 pt-4">
                        <p className="mb-2 text-xs font-semibold text-cyan-300">你的回答</p>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{turn.answer}</p>
                        <p className="mt-3 text-sm font-semibold text-slate-100">评分：{scoreLabel(turn.score)}</p>
                        {turn.feedback && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">建议：{turn.feedback}</p>}
                      </div>
                    )}
                    {turn.id === currentQuestion?.id && <p className="mt-3 text-xs text-cyan-300">请在下方输入这道题的回答</p>}
                  </article>
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
                <label htmlFor="current-answer" className="block text-sm text-slate-400">回答内容（最多 10000 字符）</label>
                <textarea id="current-answer" rows={7} maxLength={10000} value={answer} disabled={!!busy}
                  onChange={(event) => setAnswer(event.target.value)} placeholder="在此输入你的回答…"
                  className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-slate-950 p-4 text-sm leading-6 text-white focus:border-cyan-400 focus:outline-none disabled:opacity-50" />
                <div className="mt-2 text-right text-xs text-slate-500">{answer.length} / 10000</div>
                <label htmlFor="difficulty-feedback" className="mt-4 block text-sm text-slate-300">这道题的难度感受（可选）</label>
                <select id="difficulty-feedback" value={feedback} disabled={!!busy}
                  onChange={(event) => setFeedback(event.target.value as UserDifficultyFeedback)}
                  className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white sm:w-auto">
                  {difficultyFeedback.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                {actionError && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{actionError}</p>}
                {notice && <p role="status" className="mt-4 text-sm text-emerald-300">{notice}</p>}
                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <button type="button" onClick={finish} disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-400/30 px-4 py-3 text-sm text-rose-200 hover:bg-rose-400/10 disabled:opacity-40">
                    {busy === 'finish' ? <LoaderCircle className="size-4 animate-spin" /> : <Square className="size-4" />} 提前结束
                  </button>
                  <button type="button" onClick={submitAnswer} disabled={!!busy || !answer.trim()}
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
                <a href={`#report/${encodeURIComponent(sessionId)}`} className="mt-3 inline-flex items-center rounded-lg border border-cyan-400/30 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/10">查看完整复盘与导出</a>
                {notice && <p className="mt-3 text-sm text-emerald-300">{notice}</p>}
                {reportError && <p role="alert" className="mt-4 text-sm text-rose-200">复盘加载失败：{reportError}</p>}
                {!report && !reportError && <p className="mt-3 text-sm text-slate-400">正在加载离线复盘…</p>}
                {report && (
                  <div className="mt-5 space-y-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-950/50 p-4"><p className="text-xs text-slate-400">已回答</p><p className="mt-1 text-2xl font-semibold">{report.answered_count}</p></div>
                      <div className="rounded-xl bg-slate-950/50 p-4"><p className="text-xs text-slate-400">未回答</p><p className="mt-1 text-2xl font-semibold">{report.unanswered_count}</p></div>
                      <div className="rounded-xl bg-slate-950/50 p-4"><p className="text-xs text-slate-400">平均分</p><p className="mt-1 text-2xl font-semibold">{scoreLabel(report.average_score)}</p></div>
                    </div>
                    <div><h3 className="font-semibold text-emerald-200">优势</h3><ul className="mt-2 space-y-2 text-sm text-slate-300">{report.strengths.map((value, i) => <li key={i} className="whitespace-pre-wrap">• {value}</li>)}</ul></div>
                    <div><h3 className="font-semibold text-amber-200">需要加强</h3><ul className="mt-2 space-y-2 text-sm text-slate-300">{report.improvements.map((value, i) => <li key={i} className="whitespace-pre-wrap">• {value}</li>)}</ul></div>
                    <div><h3 className="font-semibold text-cyan-200">下一步建议</h3><ul className="mt-2 space-y-2 text-sm text-slate-300">{report.suggestions.map((value, i) => <li key={i} className="whitespace-pre-wrap">• {value}</li>)}</ul></div>
                    <p className="flex gap-2 text-xs leading-5 text-slate-500"><CircleHelp className="size-4 shrink-0" />{report.scoring_note}</p>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
