import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BookOpenCheck,
  ChevronLeft,
  FileText,
  Layers,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Clock3,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { materialApi, resumeApi } from '../lib/api'
import { createInterview, getInterview } from '../lib/interviews'
import { messageOf } from '../lib/resources'
import type { MaterialInfo, ResumeInfo } from '../types/resources'
import type { BackendInterviewConfig, InterviewerStyle } from '../types/interview'
import { parseMinutes } from '../components/speech/defenseTime'
import { DEFAULT_PREFERENCES, PRACTICE_PRESETS, assessTime, bindSessionTiming, loadPreferences, savePreferences } from '../lib/defenseConfiguration'
import type { DefenseTiming } from '../lib/defenseConfiguration'
import { repeatDraft, repeatTiming } from '../lib/retryPractice'
import type { RepeatDraft } from '../lib/retryPractice'

const reviewerStyles: Array<{ value: InterviewerStyle; title: string; description: string }> = [
  { value: 'friendly', title: '和善型', description: '温和引导，但不会放松评价标准' },
  { value: 'neutral', title: '标准型', description: '专业、客观，保持常规技术答辩节奏' },
  { value: 'pressure', title: '压力型', description: '重点追问论据与细节，不使用羞辱性语言' },
]

const adaptation = [
  { value: 0, name: '关闭', text: '固定当前难度' },
  { value: 1, name: '温和', text: '小幅调整' },
  { value: 2, name: '标准', text: '常规自适应' },
  { value: 3, name: '积极', text: '快速响应表现' },
]


export default function InterviewConfigPage({ retrySessionId, focusMode = false }: { retrySessionId?: string; focusMode?: boolean }) {
  const [resumes, setResumes] = useState<ResumeInfo[]>([])
  const [materials, setMaterials] = useState<MaterialInfo[]>([])
  const [resumeId, setResumeId] = useState('')
  const [materialIds, setMaterialIds] = useState<string[]>([])
  const [config, setConfig] = useState<BackendInterviewConfig>(() => ({ ...DEFAULT_PREFERENCES.config }))
  const [timing, setTiming] = useState<DefenseTiming>(() => ({ ...DEFAULT_PREFERENCES.timing }))
  const [accountId, setAccountId] = useState<string | null>(null)
  const [accountError, setAccountError] = useState('')
  const [loading, setLoading] = useState(true)
  const [fetchCounter, setFetchCounter] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [createError, setCreateError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [repeatSource, setRepeatSource] = useState<RepeatDraft | null>(null)
  const [repeatAppliedAccount, setRepeatAppliedAccount] = useState<string | null>(null)
  const [repeatTimingNotice, setRepeatTimingNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setLoading(true)
    setLoadError('')
    setRepeatSource(null)
    setRepeatAppliedAccount(null)
    Promise.all([
      resumeApi.list(controller.signal),
      materialApi.list(controller.signal),
      retrySessionId ? getInterview(retrySessionId, controller.signal) : Promise.resolve(null),
    ])
      .then(([nextResumes, nextMaterials, previous]) => {
        if (!live) return
        if (retrySessionId) {
          if (!previous) throw new Error('无法读取原答辩会话。')
          const draft = repeatDraft(previous, nextResumes, nextMaterials)
          setResumeId(draft.resumeId)
          setMaterialIds(draft.materialIds)
          setRepeatSource(draft)
        } else {
          setResumeId((prev) => nextResumes.some((r) => r.id === prev) ? prev : (nextResumes[0]?.id ?? ''))
          setMaterialIds((prev) => prev.filter((id) => nextMaterials.some((m) => m.id === id)))
        }
        setResumes(nextResumes)
        setMaterials(nextMaterials)
      })
      .catch((error: unknown) => {
        if (live && !(error instanceof Error && error.name === 'AbortError')) {
          setLoadError(messageOf(error))
        }
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [fetchCounter, retrySessionId])

  // Confirm the account with the server and re-load whenever auth state changes.
  // This prevents stale preferences being shown if A signs out and B signs in on the same screen.
  useEffect(() => {
    let controller: AbortController | null = null
    let active = true
    const resetAccount = () => {
      controller?.abort()
      setAccountId(null)
      setRepeatSource(null)
      setRepeatAppliedAccount(null)
      setRepeatTimingNotice('')
      setResumeId('')
      setMaterialIds([])
      setConfig({ ...DEFAULT_PREFERENCES.config })
      setTiming({ ...DEFAULT_PREFERENCES.timing })
      setAccountError('')
    }
    const loadAccount = () => {
      resetAccount()
      const current = new AbortController()
      controller = current
      void fetch('/api/auth/profile', { credentials: 'same-origin', cache: 'no-store', signal: current.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return await response.json() as { user_id?: string }
        })
        .then((profile) => {
          if (current.signal.aborted || !active) return
          if (!profile.user_id) throw new Error('账户标识缺失')
          let saved = DEFAULT_PREFERENCES
          try { saved = loadPreferences(profile.user_id, window.localStorage) }
          catch { /* Browser may deny localStorage; use defaults. */ }
          setConfig({ ...saved.config })
          setTiming({ ...saved.timing })
          setAccountId(profile.user_id)
        })
        .catch((error: unknown) => {
          if (!current.signal.aborted && active) setAccountError(`无法确认当前账号：${messageOf(error)}。请重新登录或刷新页面。`)
        })
    }
    const authChanged = (event: Event) => {
      const ready = (event as CustomEvent<{ ready: boolean }>).detail?.ready
      if (ready) {
        loadAccount()
        setFetchCounter((value) => value + 1)
      } else resetAccount()
    }
    window.addEventListener('interview-auth-change', authChanged)
    loadAccount()
    return () => {
      active = false
      controller?.abort()
      window.removeEventListener('interview-auth-change', authChanged)
    }
  }, [])

  // Apply a repeat draft only after the current account has been verified.
  // Source answers/scores/deadlines are never copied; users must confirm creation.
  useEffect(() => {
    if (!retrySessionId || !accountId || !repeatSource) return
    setConfig({ ...repeatSource.config })
    let previousTime: DefenseTiming | null = null
    try { previousTime = repeatTiming(retrySessionId, window.localStorage) }
    catch { /* Some browsers block access to the storage property itself. */ }
    if (previousTime) {
      setTiming(previousTime)
      setRepeatTimingNotice('已读取这场答辩在本浏览器中保存的时间设置。')
    } else {
      setRepeatTimingNotice('原场次时间设置未保存在当前浏览器，将使用当前账号的上次时间偏好；请重新核对。')
    }
    setRepeatAppliedAccount(accountId)
  }, [retrySessionId, accountId, repeatSource])

  useEffect(() => {
    if (!accountId || (retrySessionId && repeatAppliedAccount !== accountId)) return
    try { savePreferences(accountId, { config, timing }, window.localStorage) }
    catch { /* Browser denied storage access. */ }
  }, [accountId, config, timing, retrySessionId, repeatAppliedAccount])

  const timeAssessment = assessTime(config.question_count, timing.questionMinutes, timing.totalMinutes, config.max_followups)
  const invalidTime = timeAssessment.kind === 'invalid'

  function applyPreset(preset: typeof PRACTICE_PRESETS[number]) {
    setConfig({ ...preset.config })
    setTiming({ ...preset.timing })
  }

  function toggleMaterial(id: string) {
    setMaterialIds((selected) => selected.includes(id)
      ? selected.filter((value) => value !== id)
      : selected.length < 10 ? [...selected, id] : selected)
  }

  async function startInterview() {
    if (!resumeId || loading || submitting || loadError || !accountId || invalidTime ||
        (retrySessionId && (!repeatSource || repeatAppliedAccount !== accountId))) return
    setSubmitting(true)
    setCreateError('')
    try {
      const session = await createInterview({
        resume_id: resumeId,
        material_ids: materialIds,
        config,
        ...(focusMode && retrySessionId ? { focus_session_id: retrySessionId } : {}),
      })
      // Bind timers only after the API actually created a new session.
      // Existing session deadlines and per-session settings are never touched.
      try { bindSessionTiming(session.id, timing, window.localStorage) }
      catch { /* Storage unavailable: countdown uses its documented defaults. */ }
      window.location.hash = `#session/${encodeURIComponent(session.id)}`
    } catch (error) {
      setCreateError(messageOf(error))
    } finally {
      setSubmitting(false)
    }
  }

  const control = 'w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-cyan-400 focus:outline-none'

  return (
    <main data-defense-config="true" className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <a href="#dashboard" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-cyan-200">
          <ChevronLeft className="size-4" /> 返回概览
        </a>
        <header className="mt-5 mb-8">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-300"><BookOpenCheck className="size-7" /></span>
            <div>
              <h1 className="text-2xl font-bold">创建模拟答辩</h1>
              <p className="mt-1 text-sm text-slate-400">选择简历、补充材料及答辩设置，准备开始模拟练习。</p>
            </div>
          </div>
        </header>

        <section aria-label="答辩配置预设" className="mb-6 rounded-2xl border border-white/10 bg-slate-900/75 p-5">
          <h2 className="font-semibold">常用练习方案</h2>
          <p className="mt-1 text-xs text-slate-400">可一键套用，也可以逐项调整；你的设置会在当前账号的本机浏览器中记住。</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {PRACTICE_PRESETS.map((preset) => (
              <button key={preset.id} type="button" onClick={() => applyPreset(preset)}
                disabled={!!retrySessionId && (loading || !accountId || !repeatSource || repeatAppliedAccount !== accountId)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-3 text-left hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-40">
                <span className="block text-sm font-medium text-white">{preset.label}</span>
                <span className="mt-1 block text-xs text-slate-400">{preset.description}</span>
              </button>
            ))}
          </div>
        </section>

        {retrySessionId && (
          <section aria-label="沿用上次答辩配置" className="mb-6 rounded-2xl border border-cyan-400/30 bg-cyan-400/5 p-5">
            <h2 className="font-semibold text-cyan-200">{focusMode ? '针对上场薄弱点专项再练' : '沿用上一场资料，再练一次'}</h2>
            <p className="mt-2 text-sm text-slate-300">{focusMode ? '开始新答辩时，后端将检查原场次已缓存的 AI 薄弱点，并用于指导新问题；如果没有有效薄弱点则阻止专项模式，不会额外调用 AI 复盘。' : '只恢复原场次仍存在的简历、资料和评委/题量配置，不复制回答、评分或复盘；这一步不会调用 AI。'}</p>
            {loading && <p role="status" className="mt-2 text-sm text-slate-400">正在检查原场次和资料…</p>}
            {!loading && repeatSource && repeatAppliedAccount === accountId && (
              <div className="mt-2 text-sm text-slate-200">
                <p>已选择原简历和 {repeatSource.materialIds.length} 份仍可用的材料，请核对后再开始新答辩。</p>
                {repeatSource.missingMaterialCount > 0 && <p className="mt-1 text-amber-200">原场次有 {repeatSource.missingMaterialCount} 份资料已不可用，未自动替换，请手动检查。</p>}
                <p className="mt-1 text-slate-400">{repeatTimingNotice}</p>
              </div>
            )}
            <a href="#configure" className="mt-3 inline-block text-sm text-cyan-300 underline">取消沿用，改为普通配置</a>
          </section>
        )}

        {loadError && (
          <div role="alert" className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            无法加载简历或资料：{loadError}
            <button type="button" onClick={() => setFetchCounter((n) => n + 1)} className="ml-3 underline">重试</button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <section className="rounded-2xl border border-white/10 bg-slate-900/75 p-5">
              <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-5 text-cyan-300" /> 1. 答辩简历</h2>
              <p className="my-3 text-sm text-slate-400">答辩问题将结合所选简历。必须选择一份。</p>
              {loading ? <p className="text-sm text-slate-400">加载中…</p>
                : resumes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
                    尚未上传简历。先前往 <a href="#resumes" className="text-cyan-300 underline">简历管理</a> 上传 PDF/DOCX。
                  </div>
                ) : (
                  <label className="block">
                    <span className="sr-only">选择简历</span>
                    <select className={control} value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                      {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.original_filename}</option>)}
                    </select>
                  </label>
                )}
              {resumes.length > 0 && !loading && (() => {
                const selected = resumes.find((r) => r.id === resumeId)
                if (!selected) return null
                const { filled, total, missing_sections } = selected.quality
                const crucialMissing = missing_sections.filter((key) => ['projects', 'experience', 'skills'].includes(key))
                return (
                  <div className={`mt-3 rounded-lg border p-3 text-sm ${filled <= 2 || crucialMissing.length > 0 ? 'border-amber-400/30 bg-amber-400/5 text-amber-100' : 'border-emerald-400/20 bg-emerald-400/5 text-slate-200'}`}>
                    <p>{filled <= 2 || crucialMissing.length > 0 ? '⚠️' : '✓'} 已填写 {filled}/{total} 个章节（完整度参考）</p>
                    {crucialMissing.length > 0 && <p className="mt-1">项目经历、实习经历或技能信息存在缺项，可能影响出题针对性。</p>}
                    <a className="mt-2 inline-block font-medium text-cyan-300 underline" href={`#resumes/${encodeURIComponent(selected.id)}`}>去补全这份简历</a>
                  </div>
                )
              })()}
            </section>

            <section data-materials-card="true" className="rounded-2xl border border-white/10 bg-slate-900/75 p-5">
              <h2 className="flex items-center gap-2 font-semibold"><Layers className="size-5 text-cyan-300" /> 2. 补充资料（可选）</h2>
              <p className="my-3 text-sm text-slate-400">选中后会在答辩时进行 RAG 检索；最多 10 份。</p>
              {loading ? <p className="text-sm text-slate-400">加载中…</p>
                : materials.length === 0 ? <p className="text-sm text-slate-400">暂无资料，可在 <a href="#materials" className="text-cyan-300 underline">我的材料</a> 上传。</p>
                  : (
                    <div className="max-h-60 space-y-2 overflow-y-auto">
                      {materials.map((item) => {
                        const checked = materialIds.includes(item.id)
                        return (
                          <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 hover:bg-white/5">
                            <input type="checkbox" checked={checked}
                              disabled={!checked && materialIds.length >= 10}
                              onChange={() => toggleMaterial(item.id)} className="size-4 accent-cyan-400" />
                            <span className="min-w-0 flex-1 truncate text-sm" title={item.original_filename}>{item.original_filename}</span>
                            <span className="text-xs text-slate-500">{item.chunk_count} 块</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
              <p className="mt-3 text-xs text-slate-500">已选择 {materialIds.length} / 10</p>
            </section>

            <section aria-label="答辩时间设置" className="rounded-2xl border border-white/10 bg-slate-900/75 p-5">
              <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="size-5 text-cyan-300" /> 5. 答辩时间设置</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-slate-300">每题回答时间（分钟）
                  <input type="number" min={0} max={60} step={1} inputMode="numeric" value={timing.questionMinutes}
                    onChange={(event) => setTiming((old) => ({ ...old, questionMinutes: event.target.value }))}
                    aria-invalid={parseMinutes(timing.questionMinutes) === null}
                    className={`mt-2 ${control}`} />
                  <span className="mt-1 block text-xs text-slate-500">0 表示单题不限时；每道新题重新计时。</span>
                </label>
                <label className="block text-sm text-slate-300">整场总时间（分钟）
                  <input type="number" min={0} max={60} step={1} inputMode="numeric" value={timing.totalMinutes}
                    onChange={(event) => setTiming((old) => ({ ...old, totalMinutes: event.target.value }))}
                    aria-invalid={parseMinutes(timing.totalMinutes) === null}
                    className={`mt-2 ${control}`} />
                  <span className="mt-1 block text-xs text-slate-500">0 表示整场不限时；切题不重置。</span>
                </label>
              </div>
              <div role="status" className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
                invalidTime || timeAssessment.kind === 'short' ? 'border-rose-400/30 bg-rose-400/5 text-rose-200' :
                timeAssessment.kind === 'tight' ? 'border-amber-400/30 bg-amber-400/5 text-amber-200' :
                'border-cyan-400/20 bg-cyan-400/5 text-slate-200'
              }`}>
                {invalidTime || timeAssessment.kind === 'short' || timeAssessment.kind === 'tight'
                  ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
                <span>{timeAssessment.message}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">这是按单题上限估算的配置提醒，不是实际答辩时长；追问与模型响应可能额外占用时间。</p>
            </section>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <section className="rounded-2xl border border-white/10 bg-slate-900/75 p-5">
              <h2 className="mb-3 font-semibold">3. 评委风格</h2>
              <div className="space-y-2">
                {reviewerStyles.map((item) => (
                  <label key={item.value} className={`block cursor-pointer rounded-xl border p-3 ${config.reviewer_style === item.value ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-white/10'}`}>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <input type="radio" name="reviewer" checked={config.reviewer_style === item.value}
                        onChange={() => setConfig((prev) => ({ ...prev, reviewer_style: item.value }))} className="accent-cyan-400" />
                      {item.title}
                    </span>
                    <span className="mt-1 block pl-5 text-xs text-slate-400">{item.description}</span>
                  </label>
                ))}
              </div>
            </section>

            <section data-strength-card="true" className="rounded-2xl border border-white/10 bg-slate-900/75 p-5">
              <h2 className="mb-3 font-semibold">4. 答辩强度</h2>
              <label className="block text-sm text-slate-300">
                初始难度：<strong className="text-cyan-300">{config.initial_difficulty} / 5</strong>
                <input type="range" min={1} max={5} step={1} value={config.initial_difficulty}
                  onChange={(e) => setConfig((prev) => ({ ...prev, initial_difficulty: Number(e.target.value) }))}
                  className="mt-3 w-full accent-cyan-400" />
              </label>
              <label className="mt-4 block text-sm text-slate-300">
                自适应程度
                <select className={`mt-2 ${control}`} value={config.adaptation_level}
                  onChange={(e) => setConfig((prev) => ({ ...prev, adaptation_level: Number(e.target.value) }))}>
                  {adaptation.map((item) => <option key={item.value} value={item.value}>{item.name}（{item.text}）</option>)}
                </select>
              </label>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="block text-sm text-slate-300">主问题数量
                  <input className={`mt-2 ${control}`} type="number" min={3} max={30} step={1} value={config.question_count}
                    onChange={(e) => setConfig((prev) => ({ ...prev, question_count: Number(e.target.value) }))} />
                </label>
                <label className="block text-sm text-slate-300">每题最多追问
                  <select className={`mt-2 ${control}`} value={config.max_followups}
                    onChange={(e) => setConfig((prev) => ({ ...prev, max_followups: Number(e.target.value) }))}>
                    {[0, 1, 2].map((n) => <option key={n} value={n}>{n} 次</option>)}
                  </select>
                </label>
              </div>
            </section>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/75 p-5">
          <div className="flex items-start gap-2 text-sm text-slate-400">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <span>开始后会向当前配置的模型服务发送所选简历及必要的答辩上下文；使用云端模型可能产生费用，本地 Ollama 则由你的电脑运行。模型不可用时可能返回错误，不会生成虚假会话。</span>
          </div>
          {accountError && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{accountError}</p>}
          {createError && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{createError}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setFetchCounter((n) => n + 1)} disabled={loading || submitting}
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white disabled:opacity-50">
              <RefreshCw className="size-4" /> 刷新简历与资料
            </button>
            <button type="button" onClick={startInterview}
              disabled={loading || submitting || !!loadError || !accountId || invalidTime || !resumeId || (retrySessionId ? !repeatSource || repeatAppliedAccount !== accountId : false) || !Number.isInteger(config.question_count) || config.question_count < 3 || config.question_count > 30}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {submitting ? '正在生成第一题…' : '开始答辩'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
