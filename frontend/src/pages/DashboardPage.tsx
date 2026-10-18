import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  ClipboardList,
  Clock3,
  RefreshCw,
  ExternalLink,
  Server,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { interviewApi } from '../lib/api'
import type {
  HistoryItem,
  HistoryPage,
  InterviewStatus,
  OverallStatistics,
} from '../types/interview'

const PAGE_SIZE = 8
type Filter = InterviewStatus | 'all'

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部答辩' },
  { value: 'active', label: '进行中' },
  { value: 'completed', label: '已完成' },
]

const reviewerNames: Record<string, string> = {
  friendly: '和善型',
  neutral: '标准型',
  pressure: '压力型',
}

function scoreText(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function dateText(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SummaryCard({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string
  value: number | string
  caption: string
  icon: LucideIcon
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-white tabular-nums">
            {value}
          </p>
        </div>
        <div className="rounded-xl bg-cyan-400/10 p-2.5 text-cyan-300">
          <Icon aria-hidden="true" className="size-5" />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{caption}</p>
    </section>
  )
}

function HistoryRow({ item }: { item: HistoryItem }) {
  return (
    <tr className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.035]">
      <td className="px-5 py-4">
        <div className="font-medium text-slate-100">{dateText(item.created_at)}</div>
        <div className="mt-1 font-mono text-xs text-slate-500" title={item.id}>
          会话 {item.id.slice(0, 8)}…
        </div>
      </td>
      <td className="px-5 py-4 text-slate-300">
        {reviewerNames[item.reviewer_style] ?? item.reviewer_style}
      </td>
      <td className="px-5 py-4">
        {item.status === 'completed' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300">
            <CheckCircle2 aria-hidden="true" className="size-3.5" />已完成
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200">
            <Clock3 aria-hidden="true" className="size-3.5" />进行中
          </span>
        )}
      </td>
      <td className="px-5 py-4 text-right text-slate-200 tabular-nums">
        {item.answered_count}
      </td>
      <td className="px-5 py-4 text-right font-semibold text-slate-100 tabular-nums">
        {scoreText(item.average_score)}
      </td>
      <td className="px-5 py-4 text-right">
        <a
          href={item.status === 'completed'
            ? `#report/${encodeURIComponent(item.id)}`
            : `#session/${encodeURIComponent(item.id)}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-cyan-400/20 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/10"
          aria-label={`${item.status === 'completed' ? '查看复盘' : '继续答辩'}：${item.id}`}
        >
          {item.status === 'completed' ? '查看复盘' : '继续答辩'}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </td>
    </tr>
  )
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [offset, setOffset] = useState(0)
  const [refreshCount, setRefreshCount] = useState(0)
  const [stats, setStats] = useState<OverallStatistics | null>(null)
  const [history, setHistory] = useState<HistoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    setLoading(true)
    setError(null)

    Promise.all([
      interviewApi.statistics(controller.signal),
      interviewApi.history(
        { limit: PAGE_SIZE, offset, status: filter === 'all' ? undefined : filter },
        controller.signal,
      ),
    ])
      .then(([nextStats, nextHistory]) => {
        if (!current) return
        setStats(nextStats)
        setHistory(nextHistory)
      })
      .catch((reason: unknown) => {
        if (!current) return
        if (reason instanceof Error && reason.name === 'AbortError') return
        setStats(null)
        setHistory(null)
        setError(reason instanceof Error ? reason.message : '未知错误，请重试。')
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
      controller.abort()
    }
  }, [filter, offset, refreshCount])

  const total = history?.total ?? 0
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function changeFilter(next: Filter) {
    setFilter(next)
    setOffset(0)
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-cyan-950/25 to-transparent" />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 p-3 shadow-lg shadow-cyan-950/40">
              <BookOpenText aria-hidden="true" className="size-7 text-slate-950" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Interview Studio</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">AI 模拟答辩工作台</h1>
              <p className="mt-1 text-sm text-slate-400">历史记录、表现概览与复盘 · Stage 5D</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRefreshCount((value) => value + 1)}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新数据
          </button>
        </header>

        <div className="mt-7 flex flex-wrap items-center gap-2 text-sm text-slate-400">
          <Server aria-hidden="true" className="size-4 text-cyan-400" />
          <span>数据来源：本机 FastAPI / SQLite</span>
          <span className="text-slate-600">·</span>
          <span>无需 DeepSeek API Key</span>
        </div>

        {error && (
          <div role="alert" className="mt-7 flex flex-col gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-rose-300" />
              <div>
                <p className="font-semibold text-rose-100">无法获取答辩数据</p>
                <p className="mt-1 text-sm text-rose-200/90">{error}</p>
              </div>
            </div>
            <button type="button" onClick={() => setRefreshCount((value) => value + 1)} className="rounded-lg bg-rose-400/15 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/25">重试</button>
          </div>
        )}

        <section aria-label="答辩统计" className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="答辩总场次" value={stats?.total_sessions ?? (loading ? '…' : '—')} caption="历史创建的所有会话" icon={ClipboardList} />
          <SummaryCard label="已完成" value={stats?.completed_sessions ?? (loading ? '…' : '—')} caption="正常完成或提前结束" icon={CheckCircle2} />
          <SummaryCard label="已回答题目" value={stats?.answered_turns ?? (loading ? '…' : '—')} caption="已记录的主问题与追问回答" icon={Activity} />
          <SummaryCard label="历史平均分" value={stats ? scoreText(stats.average_score) : loading ? '…' : '—'} caption="已评分回答均值，仅供练习参考" icon={BookOpenText} />
        </section>

        <section aria-label="历史答辩列表" className="mt-10 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl shadow-slate-950/20">
          <div className="flex flex-col gap-5 border-b border-white/10 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">历史答辩</h2>
              <p className="mt-1 text-sm text-slate-400">按创建时间排序，可按状态筛选</p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="筛选答辩状态">
              {filters.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={filter === entry.value}
                  onClick={() => changeFilter(entry.value)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${filter === entry.value ? 'bg-cyan-400 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div role="status" className="px-6 py-16 text-center text-sm text-slate-400">正在加载历史记录…</div>
          ) : error ? (
            <div className="px-6 py-16 text-center text-sm text-rose-200">加载失败，请检查上方提示后重试。</div>
          ) : history?.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="bg-white/[0.025] text-xs tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">创建时间 / 会话</th>
                    <th scope="col" className="px-5 py-3 font-medium">答辩风格</th>
                    <th scope="col" className="px-5 py-3 font-medium">状态</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">回答数</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">平均分</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((item) => <HistoryRow key={item.id} item={item} />)}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-16 text-center">
              <ClipboardList aria-hidden="true" className="mx-auto size-10 text-slate-600" />
              <h3 className="mt-4 font-semibold text-slate-200">暂无符合条件的答辩记录</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                当前只展示数据库中的真实数据；尚未进行正式答辩时，这里为空是正常的。
              </p>
            </div>
          )}

          <footer className="flex flex-col gap-4 border-t border-white/10 px-5 py-4 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>{loading ? '更新中…' : `共 ${total} 场 · 第 ${page} / ${pages} 页`}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loading || !!error || offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />上一页
              </button>
              <button
                type="button"
                disabled={loading || !!error || offset + PAGE_SIZE >= total}
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
              >
                下一页<ArrowRight aria-hidden="true" className="size-4" />
              </button>
            </div>
          </footer>
        </section>
        <p className="mt-8 text-center text-xs text-slate-500">本机单用户开发版本 · 复盘默认离线，AI 深度分析需主动触发</p>
      </div>
    </main>
  )
}
