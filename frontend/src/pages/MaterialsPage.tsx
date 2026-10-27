import { useEffect, useRef, useState } from 'react'
import {
  FileSearch,
  Files,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { materialApi } from '../lib/api'
import { formatDate, formatSize, messageOf, validateDocument } from '../lib/resources'
import type { MaterialInfo, MaterialSearchHit } from '../types/resources'

// PPTX files use a separate upload endpoint but follow the same size limit.
function validateMaterialFile(file: File | null): string | null {
  if (file?.name.toLowerCase().endsWith('.pptx')) {
    if (file.size === 0) return 'PPTX 文件为空。'
    if (file.size > 12 * 1024 * 1024) return 'PPTX 大小不能超过 12 MiB。'
    return null
  }
  return validateDocument(file, 12)
}

export default function MaterialsPage() {
  const [items, setItems] = useState<MaterialInfo[]>([])
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(5)
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState<MaterialSearchHit[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setLoading(true)
    setListError(null)
    materialApi.list(controller.signal)
      .then((data) => {
        if (!live) return
        setItems(data)
        setSelectedIds((prev) => prev.filter((id) => data.some((item) => item.id === id)))
      })
      .catch((error: unknown) => { if (live) setListError(messageOf(error)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [refresh])

  function toggleSelection(id: string) {
    setHits(null)
    setSelectedIds((previous) => {
      if (previous.includes(id)) return previous.filter((value) => value !== id)
      if (previous.length >= 10) return previous
      return [...previous, id]
    })
  }

  async function upload() {
    setActionError(null)
    setNotice(null)
    const invalid = validateMaterialFile(file)
    if (invalid) { setActionError(invalid); return }
    if (!file) return
    setUploading(true)
    try {
      const created = await materialApi.upload(file)
      setNotice(`资料“${created.original_filename}”上传并索引成功，共 ${created.chunk_count} 个文本块。`)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      setRefresh((value) => value + 1)
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setUploading(false)
    }
  }

  async function remove(item: MaterialInfo) {
    if (!window.confirm(`确定删除资料“${item.original_filename}”吗？\n\n系统将尝试删除该资料的向量索引和原文件，此操作不可撤销。`)) return
    setActionError(null)
    setNotice(null)
    setDeletingId(item.id)
    try {
      await materialApi.remove(item.id)
      setSelectedIds((prev) => prev.filter((id) => id !== item.id))
      setHits(null)
      setNotice(`已删除资料“${item.original_filename}”。`)
      setRefresh((value) => value + 1)
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setDeletingId(null)
    }
  }

  async function search() {
    setActionError(null)
    setNotice(null)
    setHits(null)
    const trimmed = query.trim()
    if (trimmed.length < 2 || trimmed.length > 500) {
      setActionError('检索问题长度必须是 2～500 个字符。')
      return
    }
    if (selectedIds.length < 1 || selectedIds.length > 10) {
      setActionError('请先选择 1～10 份资料。')
      return
    }
    if (!Number.isInteger(topK) || topK < 1 || topK > 10) {
      setActionError('返回片段数量必须是 1～10。')
      return
    }
    setSearching(true)
    try {
      const result = await materialApi.search({
        query: trimmed,
        material_ids: selectedIds,
        top_k: topK,
      })
      setHits(result.hits)
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setSearching(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-9 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-7">
        <header>
          <p className="text-sm font-medium text-cyan-300">项目与答辩资料</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">我的材料</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            上传你的项目报告 / 答辩 PPT / 论文，AI 答辩时会针对这些材料向你深挖提问。
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-slate-900 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><UploadCloud className="size-5 text-cyan-300" /> 上传材料</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            用于项目深挖类提问，例如具体项目、论文和答辩 PPT。支持 PDF / DOCX / PPTX，单文件不超过 12 MiB；PDF 最多 150 页。首次建立索引可能较慢。
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={inputRef}
              type="file"
              aria-label="选择补充资料文件"
              accept=".pdf,.docx,.pptx"
              disabled={uploading}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block min-w-0 flex-1 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:text-white hover:file:bg-white/15"
            />
            <button
              type="button" disabled={uploading || !file} onClick={() => void upload()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              {uploading ? '建立索引中，请勿关闭…' : '上传并建立索引'}
            </button>
          </div>
          {file && <p className="mt-3 text-xs text-slate-400">已选：{file.name}（{formatSize(file.size)}）</p>}
        </section>

        {actionError && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{actionError}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200">{notice}</p>}

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Files className="size-5 text-cyan-300" /> 资料列表 <span className="text-sm font-normal text-slate-400">（{items.length}）</span></h2>
            <button
              type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-cyan-300 hover:bg-white/5 disabled:opacity-50"
            ><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 刷新</button>
          </div>
          {loading ? <p role="status" className="p-8 text-center text-slate-400">正在加载资料…</p>
            : listError ? <p role="alert" className="p-8 text-center text-rose-300">{listError}</p>
            : items.length === 0 ? <p className="p-10 text-center text-slate-400">暂无补充资料，请先上传文件。</p>
            : <ul className="divide-y divide-white/10">
              {items.map((item) => {
                const chosen = selectedIds.includes(item.id)
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-white/[0.025]">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={chosen}
                        disabled={searching || (!chosen && selectedIds.length >= 10)}
                        onChange={() => toggleSelection(item.id)}
                        className="size-4 shrink-0 accent-cyan-400"
                      />
                      <div className="min-w-0">
                        <p className="break-all font-medium">{item.original_filename}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatSize(item.file_size)} · {item.chunk_count} 个片段 · {formatDate(item.created_at)}</p>
                      </div>
                    </label>
                    <button
                      type="button" disabled={deletingId !== null || uploading || searching} onClick={() => void remove(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-400/25 px-3 py-2 text-sm text-rose-300 hover:bg-rose-400/10 disabled:opacity-50"
                    ><Trash2 className="size-4" /> 删除</button>
                  </li>
                )
              })}
            </ul>}
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold"><FileSearch className="size-5 text-cyan-300" /> 测试资料检索</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">此功能用于检查上传材料中的文字能否被找到。正常答辩时不需要操作，系统会自动检索已选材料。</p>
            </div>
            <button type="button" aria-expanded={showSearch} aria-controls="material-search-tools"
              onClick={() => setShowSearch((previous) => !previous)}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-cyan-200 hover:bg-white/10">
              {showSearch ? '收起检索工具' : '展开检索工具'}
            </button>
          </div>
          {showSearch && <div id="material-search-tools" className="mt-5">
          <p className="text-sm text-slate-400">先在上方资料列表勾选 1～10 份文件，再输入材料里出现过的词句，例如“系统架构”。已选 {selectedIds.length} / 10 份资料。</p>
          <label htmlFor="rag-query" className="mt-5 block text-sm font-medium text-slate-200">想查找的内容</label>
          <textarea
            id="rag-query" value={query} onChange={(event) => { setQuery(event.target.value); setHits(null) }}
            maxLength={500} rows={3}
            placeholder="例如：系统架构、项目目标、实验结果"
            className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-sm leading-6 outline-none focus:border-cyan-400"
          />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <label className="text-sm text-slate-300">
              返回片段数
              <select value={topK} onChange={(event) => { setTopK(Number(event.target.value)); setHits(null) }} className="ml-3 rounded-lg border border-white/15 bg-slate-950 p-2 text-slate-100">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button
              type="button" disabled={searching || loading || selectedIds.length === 0}
              onClick={() => void search()}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
              {searching ? '检索中…' : '开始检索'}
            </button>
          </div>
          {hits !== null && <div className="mt-7 space-y-4" aria-live="polite">
            <h3 className="font-semibold">检索结果（{hits.length} 条）</h3>
            {hits.length === 0 ? <p className="rounded-xl bg-slate-950 p-5 text-sm text-slate-400">当前没有返回片段。</p>
              : hits.map((hit, index) => (
                <article key={`${hit.material_id}-${hit.chunk_index}-${index}`} className="rounded-xl border border-white/10 bg-slate-950 p-4">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-cyan-200">
                    <span className="break-all">{hit.original_filename}</span>
                    <span>片段 #{hit.chunk_index}</span>
                    <span>余弦距离 {Number.isFinite(hit.distance) ? hit.distance.toFixed(4) : '—'}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">{hit.text}</p>
                </article>
              ))}
            <p className="text-xs text-slate-400">“余弦距离”是技术参考值，越小通常表示文字越接近，不代表准确率。检索片段仅供核对，不能保证完全匹配。</p>
          </div>}
          </div>}
        </section>
      </div>
    </main>
  )
}
