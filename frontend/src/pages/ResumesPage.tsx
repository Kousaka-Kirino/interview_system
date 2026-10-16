import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  LoaderCircle,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { resumeApi } from '../lib/api'
import { formatDate, formatSize, messageOf, validateDocument } from '../lib/resources'
import type { ResumeDetail, ResumeInfo } from '../types/resources'

function sectionLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((part): part is string => typeof part === 'string')
}

export default function ResumesPage() {
  const [items, setItems] = useState<ResumeInfo[]>([])
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ResumeDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
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
      .catch((error: unknown) => {
        if (live) setListError(messageOf(error))
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [refresh])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }
    const controller = new AbortController()
    let live = true
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    resumeApi.get(selectedId, controller.signal)
      .then((data) => { if (live) setDetail(data) })
      .catch((error: unknown) => { if (live) setDetailError(messageOf(error)) })
      .finally(() => { if (live) setDetailLoading(false) })
    return () => { live = false; controller.abort() }
  }, [selectedId])

  async function upload() {
    setActionError(null)
    setNotice(null)
    const invalid = validateDocument(file, 8)
    if (invalid) { setActionError(invalid); return }
    if (!file) return
    setUploading(true)
    try {
      const created = await resumeApi.upload(file)
      setNotice(`简历“${created.original_filename}”上传成功。`)
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

  const structured = detail?.structured_data ?? {}
  const rawSections = structured.sections
  const sections = rawSections && typeof rawSections === 'object' && !Array.isArray(rawSections)
    ? Object.entries(rawSections as Record<string, unknown>)
    : []
  const extractionMethod = structured.extraction_method

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-9 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-7">
        <div>
          <p className="text-sm font-medium text-cyan-300">STAGE 5B · RESUMES</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">简历管理</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            上传可提取文本的 PDF 或 DOCX，解析结果保存在本机。上载和查看无需 DeepSeek API Key。
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-slate-900 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><UploadCloud className="size-5 text-cyan-300" /> 上传简历</h2>
          <p className="mt-2 text-sm text-slate-400">支持 .pdf / .docx，单文件不超过 8 MiB；暂不支持扫描版 PDF 的 OCR。</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={inputRef}
              aria-label="选择简历文件"
              type="file"
              accept=".pdf,.docx"
              disabled={uploading}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block min-w-0 flex-1 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:text-white hover:file:bg-white/15"
            />
            <button
              type="button"
              disabled={uploading || !file}
              onClick={() => void upload()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
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
            <button
              type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-cyan-300 hover:bg-white/5 disabled:opacity-50"
            ><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 刷新</button>
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
                  </div>
                  <button type="button" onClick={() => setSelectedId(item.id)} className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10">查看解析</button>
                  <button
                    type="button" disabled={busyId !== null || uploading} onClick={() => void remove(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-400/25 px-3 py-2 text-sm text-rose-300 hover:bg-rose-400/10 disabled:opacity-50"
                  ><Trash2 className="size-4" /> 删除</button>
                </li>
              ))}
            </ul>}
        </section>

        {selectedId && (
          <section className="rounded-2xl border border-cyan-400/20 bg-slate-900 p-5 sm:p-6" aria-label="简历解析详情">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">解析详情</h2>
              <button type="button" aria-label="关闭简历详情" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><X className="size-5" /></button>
            </div>
            {detailLoading ? <p className="mt-5 text-slate-400">正在读取解析结果…</p>
              : detailError ? <p role="alert" className="mt-5 text-rose-300">{detailError}</p>
              : detail && <div className="mt-5 space-y-6">
                <div>
                  <p className="break-all font-semibold text-cyan-200">{detail.original_filename}</p>
                  <p className="mt-1 text-xs text-slate-400">解析方式：{typeof extractionMethod === 'string' ? extractionMethod : '未知'}</p>
                  <p className="mt-2 text-xs text-amber-200">简历包含个人信息，仅在可信的本地环境中查看。</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(['name', 'email', 'phone'] as const).map((key) => (
                    <div key={key} className="rounded-xl bg-white/5 p-3">
                      <p className="text-xs text-slate-400">{{ name: '姓名', email: '邮箱', phone: '电话' }[key]}</p>
                      <p className="mt-2 break-all text-sm">{typeof structured[key] === 'string' && structured[key] ? String(structured[key]) : '未识别'}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className="font-semibold">结构化章节</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {sections.map(([name, content]) => (
                      <div key={name} className="rounded-xl border border-white/10 p-4">
                        <h4 className="font-medium text-cyan-200">{name}</h4>
                        {sectionLines(content).length === 0 ? <p className="mt-2 text-sm text-slate-500">未提取到内容</p>
                          : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
                            {sectionLines(content).map((line, index) => <li key={`${name}-${index}`} className="break-words">{line}</li>)}
                          </ul>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold">原始提取文本</h3>
                  <pre className="mt-3 max-h-[440px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 font-sans text-sm leading-7 text-slate-300">{detail.full_text}</pre>
                </div>
              </div>}
          </section>
        )}
      </div>
    </main>
  )
}
