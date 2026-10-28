import { useEffect, useRef, useState } from 'react'
import { FileText, LoaderCircle, RefreshCw, Save, Trash2, UploadCloud, X } from 'lucide-react'
import { resumeApi } from '../lib/api'
import { formatDate, formatSize, messageOf, validateDocument } from '../lib/resources'
import type { ResumeCorrections, ResumeDetail, ResumeInfo, ResumeQuality, ResumeSectionKey } from '../types/resources'

const sectionNames: Record<ResumeSectionKey, string> = {
  profile: '基本信息',
  education: '教育经历',
  experience: '实习 / 工作经历',
  projects: '项目经历',
  skills: '专业技能',
  awards: '获奖情况',
  other: '其他',
}
const sectionKeys = Object.keys(sectionNames) as ResumeSectionKey[]

function sectionLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((part): part is string => typeof part === 'string')
}

function draftFromResume(resume: ResumeDetail): ResumeCorrections {
  const data = resume.structured_data
  const raw = data.sections && typeof data.sections === 'object' && !Array.isArray(data.sections)
    ? data.sections as Record<string, unknown> : {}
  const sections = {} as Record<ResumeSectionKey, string[]>
  sectionKeys.forEach((key) => { sections[key] = sectionLines(raw[key]) })
  return {
    name: typeof data.name === 'string' ? data.name : '',
    email: typeof data.email === 'string' ? data.email : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    sections,
  }
}

function healthText(quality: ResumeQuality): string {
  return `已填写 ${quality.filled}/${quality.total} 个章节`
}

export default function ResumesPage({ initialResumeId }: { initialResumeId?: string }) {
  const [items, setItems] = useState<ResumeInfo[]>([])
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialResumeId ?? null)
  const [detail, setDetail] = useState<ResumeDetail | null>(null)
  const [draft, setDraft] = useState<ResumeCorrections | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setLoading(true)
    setListError(null)
    resumeApi.list(controller.signal)
      .then((data) => { if (live) setItems(data) })
      .catch((error: unknown) => { if (live) setListError(messageOf(error)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [refresh])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDraft(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }
    const controller = new AbortController()
    let live = true
    setDetail(null)
    setDraft(null)
    setDetailError(null)
    setDetailLoading(true)
    resumeApi.get(selectedId, controller.signal)
      .then((data) => {
        if (live) {
          setDetail(data)
          setDraft(draftFromResume(data))
          if (initialResumeId) {
            window.requestAnimationFrame(() => document.getElementById('resume-editor')?.scrollIntoView({ block: 'start' }))
          }
        }
      })
      .catch((error: unknown) => { if (live) setDetailError(messageOf(error)) })
      .finally(() => { if (live) setDetailLoading(false) })
    return () => { live = false; controller.abort() }
  }, [selectedId, initialResumeId])

  async function upload() {
    setActionError(null)
    setNotice(null)
    const invalid = validateDocument(file, 8)
    if (invalid) { setActionError(invalid); return }
    if (!file) return
    setUploading(true)
    try {
      const created = await resumeApi.upload(file)
      setNotice(`简历“${created.original_filename}”上传成功。请核对识别结果。`)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      setRefresh((value) => value + 1)
      setSelectedId(created.id)
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setUploading(false)
    }
  }

  async function remove(item: ResumeInfo) {
    if (!window.confirm(`确定删除简历“${item.original_filename}”吗？\n\n这是不可撤销的操作，请先确认不再需要该简历。`)) return
    setActionError(null)
    setNotice(null)
    setBusyId(item.id)
    try {
      await resumeApi.remove(item.id)
      if (selectedId === item.id) setSelectedId(null)
      setNotice(`已删除“${item.original_filename}”。`)
      setRefresh((value) => value + 1)
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setBusyId(null)
    }
  }

  async function saveCorrections() {
    if (!detail || !draft || saving) return
    setActionError(null)
    setNotice(null)
    setSaving(true)
    try {
      const updated = await resumeApi.update(detail.id, draft)
      setDetail(updated)
      setDraft(draftFromResume(updated))
      setRefresh((value) => value + 1)
      setNotice('简历修正已保存。后续新建答辩将优先参考这份核对后的内容。')
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  function changeSection(key: ResumeSectionKey, value: string) {
    setDraft((prev) => prev ? {
      ...prev, sections: { ...prev.sections, [key]: value.split(/\r?\n/) },
    } : null)
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-9 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-7">
        <div>
          <p className="text-sm font-medium text-cyan-300">个人资料 · 简历</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">简历管理</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            用于基本信息类提问，例如你的专业、实习经历与个人技能。上传 PDF 或 DOCX 后，系统会在本机提取文字；如有遗漏可直接修正。
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-slate-900 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><UploadCloud className="size-5 text-cyan-300" /> 上传简历</h2>
          <p className="mt-2 text-sm text-slate-400">支持 .pdf / .docx，单文件不超过 8 MiB；暂不支持扫描版 PDF 的 OCR。</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input ref={inputRef} aria-label="选择简历文件" type="file" accept=".pdf,.docx" disabled={uploading}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block min-w-0 flex-1 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:text-white hover:file:bg-white/15" />
            <button type="button" disabled={uploading || !file} onClick={() => void upload()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
              {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              {uploading ? '上传及解析中…' : '上传并解析'}
            </button>
          </div>
          {file && <p className="mt-3 text-xs text-slate-400">已选：{file.name}（{formatSize(file.size)}）</p>}
        </section>

        {actionError && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{actionError}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200">{notice}</p>}

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <h2 className="text-lg font-semibold">已上传简历 <span className="text-sm font-normal text-slate-400">（{items.length}）</span></h2>
            <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-cyan-300 hover:bg-white/5 disabled:opacity-50">
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
            </button>
          </div>
          {loading ? <p role="status" className="p-8 text-center text-slate-400">正在加载简历…</p>
            : listError ? <div role="alert" className="p-8 text-center text-rose-300">{listError}</div>
              : items.length === 0 ? <p className="p-10 text-center text-slate-400">还没有上传简历。</p>
                : <ul className="divide-y divide-white/10">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-white/[0.025]">
                      <FileText className="size-6 shrink-0 text-cyan-300" />
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-medium">{item.original_filename}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatSize(item.file_size)} · {formatDate(item.created_at)}</p>
                        <p className={`mt-1 text-xs ${item.quality.filled <= 2 ? 'text-amber-300' : 'text-slate-300'}`}>{healthText(item.quality)}（仅表示内容完整度）</p>
                      </div>
                      <button type="button" onClick={() => setSelectedId(item.id)} className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10">查看与修正</button>
                      <button type="button" disabled={busyId !== null || uploading} onClick={() => void remove(item)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-400/25 px-3 py-2 text-sm text-rose-300 hover:bg-rose-400/10 disabled:opacity-50">
                        <Trash2 className="size-4" /> 删除
                      </button>
                    </li>
                  ))}
                </ul>}
        </section>

        {selectedId && (
          <section id="resume-editor" className="scroll-mt-28 rounded-2xl border border-cyan-400/20 bg-slate-900 p-5 sm:p-6" aria-label="简历解析详情">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">解析详情与修正</h2>
              <button type="button" aria-label="关闭简历详情" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><X className="size-5" /></button>
            </div>
            {detailLoading ? <p className="mt-5 text-slate-400">正在读取解析结果…</p>
              : detailError ? <p role="alert" className="mt-5 text-rose-300">{detailError}</p>
                : detail && draft && <div className="mt-5 space-y-6">
                  <div>
                    <p className="break-all font-semibold text-cyan-200">{detail.original_filename}</p>
                    <p className="mt-1 text-xs text-slate-400">识别方式：本地规则解析{detail.structured_data.manual_reviewed ? ' · 已人工核对' : ' · 尚未人工核对'}</p>
                    <p className="mt-2 text-xs text-amber-200">简历包含个人信息，请仅在可信的本地环境中查看和编辑。</p>
                  </div>
                  <div className={`rounded-xl border p-4 text-sm ${detail.quality.filled <= 2 ? 'border-amber-400/30 bg-amber-400/5 text-amber-100' : 'border-white/10 bg-slate-950/40 text-slate-200'}`}>
                    <p className="font-semibold">{healthText(detail.quality)}</p>
                    {detail.quality.missing_sections.length > 0 && <p className="mt-1">尚无内容：{detail.quality.missing_sections.map((key) => sectionNames[key]).join('、')}。</p>}
                    {detail.quality.filled <= 2 && <p className="mt-2">这份文档的结构化内容较少，建议对照下方原始文本手动补充，或换一份可复制文字的 PDF / DOCX。</p>}
                    <p className="mt-2 text-xs opacity-80">这只是七个章节的填写完整度，不是简历真实识别准确率。</p>
                  </div>
                  <form onSubmit={(event) => { event.preventDefault(); void saveCorrections() }} className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(['name', 'email', 'phone'] as const).map((key) => (
                        <label key={key} className="block text-sm text-slate-300">
                          {{ name: '姓名', email: '邮箱', phone: '电话' }[key]}
                          <input type="text" value={draft[key]} maxLength={key === 'email' ? 254 : key === 'phone' ? 50 : 80}
                            onChange={(event) => setDraft((prev) => prev ? { ...prev, [key]: event.target.value } : null)}
                            className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-slate-100" />
                        </label>
                      ))}
                    </div>
                    <div>
                      <h3 className="font-semibold">结构化章节（可以直接修改）</h3>
                      <p className="mt-1 text-xs text-slate-400">每行一条内容。请填写真实经历，不要将提示或示例当作个人事实。</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {sectionKeys.map((key) => (
                          <label key={key} className="block rounded-xl border border-white/10 p-4 text-sm">
                            <span className="font-medium text-cyan-200">{sectionNames[key]}</span>
                            <textarea rows={4} value={draft.sections[key].join('\n')}
                              onChange={(event) => changeSection(key, event.target.value)}
                              className="mt-3 w-full resize-y rounded-lg border border-white/15 bg-slate-950 p-3 leading-6 text-slate-200"
                              placeholder={`填写${sectionNames[key]}，可多行`} />
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="submit" disabled={saving}
                        className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">
                        {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                        {saving ? '保存中…' : '保存简历修正'}
                      </button>
                      <button type="button" disabled={saving} onClick={() => setDraft(draftFromResume(detail))}
                        className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10">撤销未保存的编辑</button>
                    </div>
                    <p className="text-xs text-slate-400">保存后仅更新结构化内容，原始提取文本和上传文件不变；新建答辩会优先使用保存后的内容。</p>
                  </form>
                  <div>
                    <h3 className="font-semibold">原始提取文本（只读，供核对）</h3>
                    <pre className="mt-3 max-h-[440px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 font-sans text-sm leading-7 text-slate-300">{detail.full_text}</pre>
                  </div>
                </div>}
          </section>
        )}
      </div>
    </main>
  )
}
