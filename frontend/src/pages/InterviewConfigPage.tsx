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
} from 'lucide-react'
import { materialApi, resumeApi } from '../lib/api'
import { createInterview } from '../lib/interviews'
import { messageOf } from '../lib/resources'
import type { MaterialInfo, ResumeInfo } from '../types/resources'
import type { BackendInterviewConfig, InterviewerStyle } from '../types/interview'

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


/**
 * Layout rules for the timer settings rendered by the voice/timer component.
 * Recording, countdown, and persistence are managed by that component.
 */
const durationLayoutCSS = `
[data-defense-config="true"] .stage9e-in-left.stage9c-config-slot {
  box-sizing: border-box;
  margin: 0 !important;
  width: 100%;
  max-width: 100%;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-config {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-height: 0 !important;
  padding: 15px 17px !important;
  border: 1px solid rgba(255,255,255,.10) !important;
  border-radius: 16px !important;
  background: rgba(15,23,42,.75) !important;
  color: #e8eefc;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-config::before {
  content: "5. 答辩时间设置";
  display: block;
  font-size: 16px;
  font-weight: 650;
  line-height: 1.4;
  color: #f8fafc;
}
[data-defense-config="true"] .stage9e-in-left .stage9d-duration-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0,1fr)) !important;
  gap: 12px !important;
  flex: 1 1 auto;
  align-items: stretch;
}
[data-defense-config="true"] .stage9e-in-left .stage9d-duration-item {
  min-width: 0;
  border-radius: 12px;
  padding: 11px 12px !important;
  background: #111e33 !important;
  border: 1px solid #293952 !important;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-config-head {
  font-size: 12px !important;
  font-weight: 650;
  gap: 6px;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-config-head span {
  font-size: 11px !important;
  white-space: nowrap;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-config-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px !important;
  margin-top: 7px !important;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-config input {
  box-sizing: border-box;
  width: 82px !important;
  min-height: 38px;
  padding: 6px 9px !important;
  font-size: 16px !important;
  border-radius: 9px;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-config-hint {
  font-size: 11px;
}
[data-defense-config="true"] .stage9e-in-left .stage9c-help:not(.stage9d-bottom-help) {
  display: block !important;
  font-size: 11px;
  line-height: 1.5;
  margin-top: 7px;
  color: #9aacc9;
}
[data-defense-config="true"] .stage9e-in-left .stage9d-bottom-help {
  display: none !important;
}
@media (max-width: 640px) {
  [data-defense-config="true"] .stage9e-in-left .stage9d-duration-grid {
    grid-template-columns: minmax(0,1fr) !important;
  }
}
`

export default function InterviewConfigPage() {
  const [resumes, setResumes] = useState<ResumeInfo[]>([])
  const [materials, setMaterials] = useState<MaterialInfo[]>([])
  const [resumeId, setResumeId] = useState('')
  const [materialIds, setMaterialIds] = useState<string[]>([])
  const [config, setConfig] = useState<BackendInterviewConfig>({
    reviewer_style: 'neutral',
    initial_difficulty: 3,
    adaptation_level: 2,
    question_count: 8,
    max_followups: 1,
  })
  const [loading, setLoading] = useState(true)
  const [fetchCounter, setFetchCounter] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [createError, setCreateError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setLoading(true)
    setLoadError('')
    Promise.all([resumeApi.list(controller.signal), materialApi.list(controller.signal)])
      .then(([nextResumes, nextMaterials]) => {
        if (!live) return
        setResumes(nextResumes)
        setMaterials(nextMaterials)
        setResumeId((prev) => nextResumes.some((r) => r.id === prev) ? prev : (nextResumes[0]?.id ?? ''))
        setMaterialIds((prev) => prev.filter((id) => nextMaterials.some((m) => m.id === id)))
      })
      .catch((error: unknown) => {
        if (live && !(error instanceof Error && error.name === 'AbortError')) {
          setLoadError(messageOf(error))
        }
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [fetchCounter])

  useEffect(() => {
    // Align the BOTTOM edges of the two lower cards on desktop.
    // Because the materials section is taller than the reviewer-style section,
    // forcing identical card heights would instead misalign their bottoms.
    const main = document.querySelector<HTMLElement>('[data-defense-config="true"]')
    const strength = main?.querySelector<HTMLElement>('[data-strength-card="true"]')
    const materials = main?.querySelector<HTMLElement>('[data-materials-card="true"]')
    if (!main || !strength) return

    const alignBottomEdges = () => {
      const timeCard = main.querySelector<HTMLElement>('.stage9e-in-left .stage9c-config')
      if (!timeCard) return

      // Remove stale heights before measuring the natural minimum height.
      timeCard.style.removeProperty('min-height')
      timeCard.style.height = 'auto'
      if (!window.matchMedia('(min-width: 1024px)').matches) return

      const naturalHeight = Math.ceil(timeCard.getBoundingClientRect().height)
      const targetHeight = Math.round(
        strength.getBoundingClientRect().bottom - timeCard.getBoundingClientRect().top,
      )
      // Never shrink the controls below their natural content size.
      if (targetHeight >= naturalHeight) {
        timeCard.style.height = `${targetHeight}px`
      }
    }

    let frame: number | null = null
    const scheduleAlign = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        alignBottomEdges()
      })
    }

    // The timer settings are mounted asynchronously through a portal.
    const domObserver = new MutationObserver(scheduleAlign)
    domObserver.observe(main, { childList: true, subtree: true })
    const sizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleAlign)
      : null
    sizeObserver?.observe(strength)
    if (materials) sizeObserver?.observe(materials)
    window.addEventListener('resize', scheduleAlign)
    scheduleAlign()
    return () => {
      domObserver.disconnect()
      sizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleAlign)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])

  function toggleMaterial(id: string) {
    setMaterialIds((selected) => selected.includes(id)
      ? selected.filter((value) => value !== id)
      : selected.length < 10 ? [...selected, id] : selected)
  }

  async function startInterview() {
    if (!resumeId || loading || submitting || loadError) return
    setSubmitting(true)
    setCreateError('')
    try {
      const session = await createInterview({
        resume_id: resumeId,
        material_ids: materialIds,
        config,
      })
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
      <style>{durationLayoutCSS}</style>
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
          {createError && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{createError}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setFetchCounter((n) => n + 1)} disabled={loading || submitting}
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white disabled:opacity-50">
              <RefreshCw className="size-4" /> 刷新简历与资料
            </button>
            <button type="button" onClick={startInterview}
              disabled={loading || submitting || !!loadError || !resumeId || !Number.isInteger(config.question_count) || config.question_count < 3 || config.question_count > 30}
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
