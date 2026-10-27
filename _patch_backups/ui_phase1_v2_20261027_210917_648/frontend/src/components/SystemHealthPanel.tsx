import { useCallback, useEffect, useState } from 'react'
import { Activity, ClipboardCopy, RefreshCw, X } from 'lucide-react'

type Connection = 'checking' | 'online' | 'offline'
type ProbeResult = { label: string; path: string; ok: boolean; status: string }
type SessionSnapshot = { status: 'active' | 'completed'; answered: number; total: number }

const STORAGE_KEY = 'interview_system:last_session_id'
const PROBE_PATHS = [
  { label: '健康检查', path: '/api/health' },
  { label: '简历列表', path: '/api/resumes' },
  { label: '补充资料', path: '/api/materials' },
  { label: '历史统计', path: '/api/interviews/statistics' },
  { label: '历史列表', path: '/api/interviews/history?limit=1&offset=0' },
] as const

function rememberedSessionId(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

async function requestJson(path: string, timeoutMs = 7000): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as unknown
  } finally {
    window.clearTimeout(timer)
  }
}

function sessionIdFromHash(): string | null {
  const match = /^#(?:session|report)\/([a-zA-Z0-9-]{6,80})$/.exec(window.location.hash)
  return match?.[1] ?? null
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '请求超时（7 秒）'
    return error.message
  }
  return '未知错误'
}

export default function SystemHealthPanel() {
  const [opened, setOpened] = useState(false)
  const [connection, setConnection] = useState<Connection>('checking')
  const [checking, setChecking] = useState(false)
  const [probes, setProbes] = useState<ProbeResult[] | null>(null)
  const [lastCheck, setLastCheck] = useState<string>('尚未检查')
  const [lastSessionId, setLastSessionId] = useState(rememberedSessionId)
  const [sessionSnapshot, setSessionSnapshot] = useState<SessionSnapshot | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [sessionLoading, setSessionLoading] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')

  useEffect(() => {
    const remember = () => {
      const id = sessionIdFromHash()
      if (id === null) return
      setLastSessionId(id)
      setSessionSnapshot(null)
      setSessionError('')
      try {
        window.localStorage.setItem(STORAGE_KEY, id)
      } catch {
        // Local storage may be blocked by browser privacy settings.
      }
    }
    remember()
    window.addEventListener('hashchange', remember)
    return () => window.removeEventListener('hashchange', remember)
  }, [])

  const ping = useCallback(async () => {
    setConnection('checking')
    try {
      const result = await requestJson('/api/health')
      const payload = result as { status?: unknown } | null
      if (payload === null || typeof payload !== 'object' || payload.status !== 'ok') {
        throw new Error('健康检查格式不符合预期')
      }
      setConnection('online')
    } catch {
      setConnection('offline')
    }
  }, [])

  useEffect(() => {
    void ping()
    const timer = window.setInterval(() => {
      if (!document.hidden) void ping()
    }, 30000)
    return () => window.clearInterval(timer)
  }, [ping])

  async function runDiagnostics() {
    if (checking) return
    setChecking(true)
    setCopyNotice('')
    try {
      const results = await Promise.all(
        PROBE_PATHS.map(async ({ label, path }): Promise<ProbeResult> => {
          try {
            await requestJson(path)
            return { label, path, ok: true, status: 'HTTP 200' }
          } catch (error) {
            return { label, path, ok: false, status: readableError(error) }
          }
        }),
      )
      setProbes(results)
      setConnection(results[0]?.ok ? 'online' : 'offline')
      setLastCheck(new Date().toLocaleString('zh-CN'))
    } finally {
      setChecking(false)
    }
  }

  async function checkSession() {
    if (!lastSessionId || sessionLoading) return
    setSessionLoading(true)
    setSessionError('')
    setSessionSnapshot(null)
    try {
      const payload = await requestJson(`/api/interviews/${encodeURIComponent(lastSessionId)}`)
      if (payload === null || typeof payload !== 'object') {
        throw new Error('会话响应不是对象')
      }
      const session = payload as { status?: unknown; turns?: unknown }
      if (session.status !== 'active' && session.status !== 'completed') {
        throw new Error('会话状态不符合预期')
      }
      const turns = Array.isArray(session.turns) ? session.turns : []
      const answered = turns.filter((turn: unknown) => {
        return turn !== null && typeof turn === 'object' && 'answer' in turn &&
          typeof (turn as { answer: unknown }).answer === 'string'
      }).length
      setSessionSnapshot({ status: session.status, answered, total: turns.length })
    } catch (error) {
      setSessionError(readableError(error))
    } finally {
      setSessionLoading(false)
    }
  }

  async function copyDiagnostics() {
    const lines = [
      'AI 模拟答辩系统 — Stage 5E 接口自检',
      `检查时间：${lastCheck}`,
      `后端状态：${connection}`,
      ...(probes ?? []).map(item => `${item.ok ? 'OK' : 'FAIL'} | ${item.label} | ${item.path} | ${item.status}`),
      '注意：不包含简历、回答内容或 API Key。',
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopyNotice('已复制自检结果')
    } catch {
      setCopyNotice('浏览器不允许复制；请直接查看上方的检查结果。')
    }
  }

  function forgetSession() {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Do not block the UI if localStorage is unavailable.
    }
    setLastSessionId('')
    setSessionSnapshot(null)
    setSessionError('')
  }

  const label = connection === 'online'
    ? '后端在线'
    : connection === 'offline' ? '后端连接失败' : '检查连接中'
  const indicator = connection === 'online'
    ? 'bg-emerald-400' : connection === 'offline' ? 'bg-rose-400' : 'bg-amber-300'
  const resumeHref = lastSessionId
    ? `#${sessionSnapshot?.status === 'completed' ? 'report' : 'session'}/${lastSessionId}`
    : '#dashboard'

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3 text-slate-100">
      {opened && (
        <section
          aria-label="系统运行状态与故障恢复"
          className="max-h-[min(80vh,650px)] w-[min(92vw,430px)] overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-5 shadow-2xl shadow-black/50"
        >
          <header className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">运行状态与恢复</h2>
              <p className="mt-1 text-xs text-slate-400">仅执行本机 GET 请求，不调用 DeepSeek</p>
            </div>
            <button type="button" aria-label="关闭运行状态" onClick={() => setOpened(false)} className="rounded-lg p-2 hover:bg-white/10">
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          <div className="mt-5 flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${indicator}`} />
            <strong>{label}</strong>
          </div>
          {connection === 'offline' && (
            <p className="mt-2 text-xs leading-6 text-amber-200">
              请确认 FastAPI 在 127.0.0.1:8000 运行，并检查 Vite 代理。
              如果提交回答刚刚超时，不要立即重复提交。
            </p>
          )}
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">接口自检</h3>
              <button type="button" disabled={checking} onClick={() => void runDiagnostics()} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400/15 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-400/25 disabled:opacity-50">
                <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
                {checking ? '检查中' : '检查五个接口'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">上次检查：{lastCheck}</p>
            {probes && (
              <div className="mt-3 space-y-2" role="status">
                {probes.map(item => (
                  <div key={item.path} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-xs">
                    <span>{item.label}</span>
                    <span className={item.ok ? 'text-emerald-300' : 'text-rose-300'} title={item.status}>
                      {item.ok ? '正常' : item.status}
                    </span>
                  </div>
                ))}
                <button type="button" onClick={() => void copyDiagnostics()} className="inline-flex items-center gap-1 text-xs text-cyan-200 hover:underline">
                  <ClipboardCopy className="size-3.5" aria-hidden="true" />复制不含隐私数据的检查结果
                </button>
                {copyNotice && <p className="text-xs text-slate-400">{copyNotice}</p>}
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <h3 className="text-sm font-semibold">最近答辩会话</h3>
            {lastSessionId ? (
              <>
                <p className="mt-2 break-all font-mono text-xs text-slate-400">{lastSessionId}</p>
                <p className="mt-2 text-xs leading-6 text-slate-400">
                  回答提交后遇到网络错误时，先检查会话。系统只读取已保存状态，不自动重发回答。
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={sessionLoading} onClick={() => void checkSession()} className="rounded-lg border border-white/20 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50">
                    {sessionLoading ? '查询中…' : '检查已保存状态'}
                  </button>
                  <a href={resumeHref} className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300">
                    {sessionSnapshot?.status === 'completed' ? '查看复盘' : '返回会话'}
                  </a>
                  <button type="button" onClick={forgetSession} className="px-2 py-2 text-xs text-slate-400 hover:text-white">清除本机记录</button>
                </div>
                {sessionSnapshot && (
                  <p role="status" className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-xs leading-6 text-emerald-200">
                    服务端已记录 {sessionSnapshot.answered} 道回答，共 {sessionSnapshot.total} 条题目记录；
                    状态：{sessionSnapshot.status === 'completed' ? '已完成' : '进行中'}。
                  </p>
                )}
                {sessionError && <p role="alert" className="mt-3 text-xs text-rose-300">查询失败：{sessionError}</p>}
              </>
            ) : (
              <p className="mt-2 text-xs leading-6 text-slate-400">
                尚无最近会话记录。打开一次真实答辩会话后，会在本机浏览器保存其 ID，方便刷新后找回。
              </p>
            )}
          </div>
          <p className="mt-5 border-t border-white/10 pt-3 text-xs leading-5 text-slate-500">
            仅保存最近一个会话 ID，不保存简历、答案或密钥。清空浏览器数据会移除此记录。
          </p>
        </section>
      )}
      <button
        type="button"
        aria-label={`运行状态：${label}`}
        aria-expanded={opened}
        onClick={() => setOpened(value => !value)}
        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-800 px-4 py-3 text-xs font-semibold shadow-xl shadow-black/40 transition hover:bg-slate-700"
      >
        <span aria-hidden="true" className={`size-2.5 rounded-full ${indicator}`} />
        <Activity className="size-4" aria-hidden="true" />
        运行状态 · {label}
      </button>
    </div>
  )
}
