import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { generateAIInterviewReport, getInterviewReport } from '../lib/interviews'
import { messageOf } from '../lib/resources'
import { exampleAnswers, reviewMarkdown, weakPoints } from '../lib/aiReview'
import { autoReviewKey, autoReviewEnabled } from '../lib/autoReviewPreference'
import type { InterviewReport, ReportTurn } from '../types/interview'

function displayScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function scoreColor(value: number): string {
  if (value >= 80) return 'bg-emerald-400'
  if (value >= 60) return 'bg-cyan-400'
  return 'bg-amber-400'
}

function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function aiSummary(data: Record<string, unknown>): string {
  return typeof data.summary === 'string' ? data.summary : ''
}

function textExport(report: InterviewReport): string {
  const sections = [
    'AI 模拟答辩 · 本地复盘导出',
    `会话：${report.session_id}`,
    `评委风格：${report.reviewer_style}`,
    `主问题：已提出 ${report.main_questions_asked} / 计划 ${report.planned_main_questions}`,
    `已回答：${report.answered_count}  未回答：${report.unanswered_count}`,
    `平均分：${displayScore(report.average_score)}`,
    '',
    '【优势】',
    ...report.strengths.map((entry) => `- ${entry}`),
    '',
    '【需要加强】',
    ...report.improvements.map((entry) => `- ${entry}`),
    '',
    '【下一步建议】',
    ...report.suggestions.map((entry) => `- ${entry}`),
    '',
    '【逐题回顾】',
    ...report.turns.flatMap((turn) => [
      `第 ${turn.question_number} 题${turn.followup_number ? `（追问 ${turn.followup_number}）` : ''} · 难度 ${turn.difficulty} · 得分 ${displayScore(turn.score)}`,
      `题目：${turn.question}`,
      `回答：${turn.answer}`,
      `反馈：${turn.feedback ?? '无'}`,
      '',
    ]),
  ]

  if (report.ai_analysis) {
    sections.push('【已缓存 AI 复盘】', JSON.stringify(report.ai_analysis, null, 2), '')
  }
  sections.push('【评分说明】', report.scoring_note, '')
  return sections.join('\r\n')
}

function downloadLocalReport(report: InterviewReport): void {
  const blob = new Blob(['\uFEFF', textExport(report)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `interview-report-${report.session_id}.txt`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadMarkdown(report: InterviewReport): void {
  const blob = new Blob(['\uFEFF', reviewMarkdown(report)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `interview-review-${report.session_id}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function TextGroup({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5">
      <h2 className={`font-semibold ${tone}`}>{title}</h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
        {items.length ? items.map((item, index) => (
          <li key={index} className="whitespace-pre-wrap">• {item}</li>
        )) : <li className="text-slate-500">暂无记录</li>}
      </ul>
    </section>
  )
}

function QuestionCard({ turn }: { turn: ReportTurn }) {
  return (
    <article className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-400">
        <span>第 {turn.question_number} 题{turn.followup_number > 0 ? ` · 追问 ${turn.followup_number}` : ''} · 难度 {turn.difficulty}/5</span>
        <span className="font-semibold text-cyan-200">得分 {displayScore(turn.score)}</span>
      </div>
      <h3 className="mt-3 whitespace-pre-wrap font-medium leading-7 text-slate-100">{turn.question}</h3>
      <p className="mt-3 text-xs font-semibold text-slate-400">你的回答</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{turn.answer}</p>
      {turn.feedback && (
        <>
          <p className="mt-3 text-xs font-semibold text-cyan-300">反馈</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{turn.feedback}</p>
        </>
      )}
    </article>
  )
}

export default function InterviewReportPage({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshCounter, setRefreshCounter] = useState(0)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiNotice, setAiNotice] = useState('')
  const [autoAccountKey, setAutoAccountKey] = useState('')
  const [autoEnabled, setAutoEnabled] = useState(false)
  const autoAttempted = useRef(new Set<string>())

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setLoading(true)
    setError('')
    setReport(null)
    setAiError('')
    setAiNotice('')
    getInterviewReport(sessionId, controller.signal)
      .then((next) => { if (live) setReport(next) })
      .catch((reason: unknown) => {
        if (live && !(reason instanceof Error && reason.name === 'AbortError')) {
          setError(messageOf(reason))
        }
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [sessionId, refreshCounter])

  useEffect(() => {
    let live = true
    setAutoAccountKey('')
    setAutoEnabled(false)
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法确认当前账号')
        return await response.json() as { username?: string }
      })
      .then((account) => {
        if (!live || !account.username) return
        const key = autoReviewKey(account.username)
        setAutoAccountKey(key)
        setAutoEnabled(autoReviewEnabled(account.username, window.localStorage))
      }).catch(() => { if (live) setAutoAccountKey('') })
    return () => { live = false }
  }, [sessionId])

  useEffect(() => {
    if (!autoEnabled || !autoAccountKey || !report || report.session_id !== sessionId ||
        report.ai_analysis || report.answered_count === 0 || loading || aiBusy ||
        autoAttempted.current.has(sessionId)) return
    autoAttempted.current.add(sessionId)
    setAiBusy(true)
    setAiError('')
    generateAIInterviewReport(sessionId, false)
      .then((updated) => { setReport(updated); setAiNotice('已自动生成 AI 复盘，并将薄弱点归入复习知识库。') })
      .catch((reason: unknown) => setAiError(`自动生成失败：${messageOf(reason)}。可手动重试。`))
      .finally(() => setAiBusy(false))
  }, [autoEnabled, autoAccountKey, report, sessionId, loading, aiBusy])

  function changeAutoEnabled(checked: boolean) {
    if (!autoAccountKey) return
    try {
      window.localStorage.setItem(autoAccountKey, checked ? '1' : '0')
      setAutoEnabled(checked)
    } catch {
      setAiError('浏览器不允许保存自动生成偏好；请允许本地存储或手动生成 AI 复盘。')
    }
  }

  async function requestAi(refresh: boolean) {
    if (!report || aiBusy || !report.answered_count) return
    const warning = refresh
      ? '确定重新生成 AI 复盘？这会重新调用 DeepSeek，并可能产生新的费用。'
      : '确认请求 AI 复盘？答辩问答和评分可能发送至 DeepSeek，调用可能产生费用。未配置 API Key 时请求会失败。'
    if (!window.confirm(warning)) return
    setAiBusy(true)
    setAiError('')
    setAiNotice('')
    try {
      const updated = await generateAIInterviewReport(sessionId, refresh)
      setReport(updated)
      setAiNotice(refresh ? 'AI 复盘已重新生成并保存。' : 'AI 复盘已加载或生成并保存。')
    } catch (reason) {
      setAiError(messageOf(reason))
    } finally {
      setAiBusy(false)
    }
  }

  const ai = report?.ai_analysis ?? null
  const aiStrengths = ai ? stringItems(ai.strengths) : []
  const aiImprovements = ai ? stringItems(ai.improvements) : []
  const aiNextSteps = ai ? stringItems(ai.next_steps) : []
  const samples = report ? exampleAnswers(report) : []
  const weaknesses = report ? weakPoints(report).filter((point) =>
    report.turns.some((turn) => turn.turn_id === point.turn_id && turn.score !== null && turn.score < 80)) : []
  const recognizedAi = !!ai && (!!aiSummary(ai) || !!aiStrengths.length || !!aiImprovements.length || !!aiNextSteps.length)

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <a href="#dashboard" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-300">
          <ArrowLeft aria-hidden="true" className="size-4" /> 返回历史列表
        </a>
        <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold">
              <BookOpenCheck aria-hidden="true" className="size-7 text-cyan-300" /> {report?.mode === 'defense' ? '项目答辩复盘' : '模拟面试复盘'}
            </h1>
            <p className="mt-2 break-all font-mono text-xs text-slate-500">会话 {sessionId}</p>
            <p className="mt-2 text-sm text-slate-400">规则复盘不调用模型；AI 复盘仅在手动请求或此账号主动开启自动复盘时调用 DeepSeek。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={loading || aiBusy} onClick={() => setRefreshCounter((n) => n + 1)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-40">
              <RefreshCw aria-hidden="true" className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
            </button>
            <a href={`#session/${encodeURIComponent(sessionId)}`}
              className="inline-flex items-center rounded-xl border border-white/15 px-3 py-2 text-sm text-cyan-200 hover:bg-white/10">查看完整会话</a>
          </div>
        </header>

        {loading && <p role="status" className="mt-8 rounded-2xl bg-slate-900 p-6 text-slate-400">正在加载离线复盘…</p>}
        {error && (
          <section role="alert" className="mt-8 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5">
            <p className="flex items-center gap-2 font-semibold text-rose-200"><TriangleAlert className="size-5" />复盘暂时不可用</p>
            <p className="mt-2 text-sm text-rose-100">{error}</p>
            <p className="mt-2 text-sm text-slate-300">仅已结束的答辩可以查看复盘。如果答辩仍在进行，请点击“查看完整会话”继续或结束。</p>
            <button type="button" onClick={() => setRefreshCounter((n) => n + 1)} className="mt-4 rounded-lg bg-rose-300/15 px-3 py-2 text-sm text-rose-100">重试</button>
          </section>
        )}

        {report && (
          <>
            <section aria-label="复盘概览" className="mt-8 grid gap-3 sm:grid-cols-4">
              {([
                ['主问题', `${report.main_questions_asked}/${report.planned_main_questions}`],
                ['已回答', String(report.answered_count)],
                ['未回答', String(report.unanswered_count)],
                ['平均分', displayScore(report.average_score)],
              ] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-slate-900 p-4">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </section>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="size-4" /> 答辩已完成 · {report.reviewer_style}</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadLocalReport(report)} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-100 hover:bg-white/10">
                  <Download aria-hidden="true" className="size-4" /> 导出 TXT
                </button>
                <button type="button" onClick={() => downloadMarkdown(report)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-400/10">
                  <Download aria-hidden="true" className="size-4" /> 导出完整 Markdown（含 AI 示范答案）
                </button>
              </div>
            </div>

            <section className="mt-7 rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><BarChart3 className="size-5 text-cyan-300" />逐题得分趋势</h2>
              {report.score_trend.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">暂无评分记录（例如提前结束且尚未回答）。</p>
              ) : (
                <div className="mt-6 space-y-4">
                  {report.score_trend.map((entry) => (
                    <div key={entry.turn_id} className="grid grid-cols-[92px_1fr_48px] items-center gap-3 text-xs sm:grid-cols-[150px_1fr_56px]">
                      <span className="text-slate-300">第 {entry.question_number} 题{entry.followup_number ? `·追问${entry.followup_number}` : ''}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-950">
                        <div className={`h-full rounded-full ${scoreColor(entry.score)}`} style={{ width: `${Math.max(0, Math.min(100, entry.score))}%` }} />
                      </div>
                      <span className="text-right font-semibold tabular-nums text-white">{entry.score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-5 text-xs leading-5 text-slate-500">{report.scoring_note}</p>
            </section>

            {!recognizedAi && <div className="mt-6 grid gap-4 md:grid-cols-3">
              <TextGroup title="优势" items={report.strengths} tone="text-emerald-300" />
              <TextGroup title="需要加强" items={report.improvements} tone="text-amber-300" />
              <TextGroup title="下一步建议" items={report.suggestions} tone="text-cyan-300" />
            </div>}

            {report.practice_focus && (
              <section aria-label="专项练习记录" className="mt-7 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
                <h2 className="font-semibold text-amber-200">本场专项训练重点</h2>
                <p className="mt-2 text-sm text-slate-300">来源：上一场答辩 {report.practice_focus.source_session_id}。以下为出题参考重点，不等于逐维度的效果测量。</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-100">{report.practice_focus.weak_points.map((point, i) => <li key={i}>• {point.dimension}：{point.title}</li>)}</ul>
                <p className="mt-2 text-xs text-slate-400">可使用本场平均分与上场平均分比较总体变化；不同题目的分数不具备严格的逐维度可比性。</p>
              </section>
            )}
            <section aria-label="再练一次" className="mt-7 rounded-2xl border border-cyan-400/25 bg-cyan-400/5 p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-white">继续练习，巩固答辩表达</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">沿用本场仍然存在的简历、补充资料与答辩参数，先进入配置页核对，再决定是否开始新的一场。</p>
              <p className="mt-1 text-xs text-slate-400">沿用资料不会自动开始新答辩；专项再练仅在已有 AI 薄弱点时出现，开始后会指导下一场出题。</p>
              {weaknesses.length > 0 && (
                <a href={`#configure/focus/${encodeURIComponent(sessionId)}`} className="mt-4 mr-3 inline-flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-400/20">
                  <RotateCcw aria-hidden="true" className="size-4" /> 针对 {Math.min(3, weaknesses.length)} 个薄弱点专项再练
                </a>
              )}
              <a href={`#configure/retry/${encodeURIComponent(sessionId)}`}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300">
                <RotateCcw aria-hidden="true" className="size-4" /> 沿用本场资料再练一次
              </a>
            </section>

            <section className="mt-7 rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6">
              <h2 className="text-lg font-semibold">逐题回答与反馈</h2>
              <p className="mt-1 text-xs text-slate-400">仅展示已提交的回答。未回答的问题不会被当作零分。</p>
              <div className="mt-5 space-y-4">
                {report.turns.length ? report.turns.map((turn) => <QuestionCard key={turn.turn_id} turn={turn} />)
                  : <p className="text-sm text-slate-400">本场尚无已提交的回答。</p>}
              </div>
            </section>

            <section className="mt-7 rounded-2xl border border-cyan-400/15 bg-slate-900/80 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-cyan-300" />可选 AI 深度复盘</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                    AI 复盘可生成逐题示范答案并自动将有依据的薄弱点去重保存至本地复习库。调用云端模型时会上传答辩问答和评分；开启自动生成后，每场完成后自动尝试生成；已有缓存不会再次计费。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!ai ? (
                    <button type="button" onClick={() => requestAi(false)} disabled={aiBusy || report.answered_count === 0}
                      className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
                      {aiBusy && <LoaderCircle className="size-4 animate-spin" />} 生成 AI 复盘
                    </button>
                  ) : (
                    <button type="button" onClick={() => requestAi(true)} disabled={aiBusy}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-400/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-400/10 disabled:opacity-40">
                      {aiBusy && <LoaderCircle className="size-4 animate-spin" />} 重新生成 AI 复盘（再次计费）
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <label className="flex items-start gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={autoEnabled} disabled={!autoAccountKey} onChange={(event) => changeAutoEnabled(event.target.checked)} className="mt-1" />
                  <span>此账号启用答辩结束后自动 AI 复盘</span>
                </label>
                <p className="text-xs leading-5 text-slate-400">已缓存的复盘直接读取，不会再次请求模型；主动重新生成会重新调用模型，并可能产生新的费用。</p>
                <p className="text-xs leading-5 text-slate-400">费用计算示例：输入 3000、输出 2000 Token，仅用于说明计费所依据的用量。实际金额取决于模型、缓存命中情况及峰谷时段，并非每次固定费用；请以官方价格和账单为准。本地 Ollama 不产生 DeepSeek API 调用费。</p>
                <a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing" target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 underline">查看 DeepSeek 官方计费标准</a>
              </div>
              {!ai && <p className="mt-4 text-sm text-slate-400">尚未生成 AI 复盘。离线规则复盘已经可以正常使用。</p>}
              {report.answered_count === 0 && <p className="mt-3 text-xs text-amber-200">没有已回答题目，后端不允许生成 AI 复盘。</p>}
              {aiError && <p role="alert" className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{aiError}</p>}
              {aiNotice && <p role="status" className="mt-4 text-sm text-emerald-300">{aiNotice}</p>}
              {ai && (
                <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
                  <p className="text-xs text-slate-500">{report.ai_generated_at ? `生成于：${new Date(report.ai_generated_at).toLocaleString('zh-CN')}` : '已缓存 AI 分析'}</p>
                  {recognizedAi ? (
                    <>
                      {aiSummary(ai) && <div><h3 className="font-semibold text-white">整体总结</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{aiSummary(ai)}</p></div>}
                      {aiStrengths.length > 0 && <TextGroup title="AI 指出的优势" items={aiStrengths} tone="text-emerald-300" />}
                      {aiImprovements.length > 0 && <TextGroup title="AI 指出的改进方向" items={aiImprovements} tone="text-amber-300" />}
                      {aiNextSteps.length > 0 && <TextGroup title="AI 建议的下一步" items={aiNextSteps} tone="text-cyan-300" />}
                      {samples.length > 0 && <div className="space-y-3">
                        <h3 className="font-semibold text-white">逐题示范回答（示例，不代表真实经历）</h3>
                        {samples.map((item) => {
                          const turn = report.turns.find((entry) => entry.turn_id === item.turn_id)
                          return <article key={item.turn_id} className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                            <h4 className="text-sm font-semibold text-cyan-200">第 {turn?.question_number ?? '—'} 题参考回答</h4>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{item.answer}</p>
                            <p className="mt-2 text-xs leading-5 text-slate-400">推荐思路：{item.explanation}</p>
                          </article>
                        })}
                      </div>}
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                        <h3 className="font-semibold text-amber-200">自动识别的薄弱点 · 已归入本地复习库</h3>
                        {weaknesses.length ? <ul className="mt-2 space-y-2 text-sm text-slate-300">
                          {weaknesses.map((item) => <li key={`${item.turn_id}-${item.title}`}>• {item.title}（{item.dimension}）：{item.reason}</li>)}
                        </ul> : <p className="mt-2 text-sm text-slate-400">没有找到证据充分的薄弱点，未自动创建条目。</p>}
                        <p className="mt-2 text-xs text-slate-500">系统根据原题目锚点去重，可在答辩知识重点中继续管理。AI 内容请自行核实。</p>
                      </div>
                    </>
                  ) : (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-300">{JSON.stringify(ai, null, 2)}</pre>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
