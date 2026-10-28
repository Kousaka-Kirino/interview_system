import { useEffect, useState } from 'react'
import { FileText, LoaderCircle, X } from 'lucide-react'
import { materialApi, resumeApi } from '../lib/api'
import type { DocumentPreviewResult } from '../lib/api'
import { messageOf } from '../lib/resources'

type PreviewFile = { id: string; name: string }
type Props = { kind: 'resume' | 'material'; file: PreviewFile; onClose: () => void }
type View = { type: 'pdf'; url: string } | { type: 'text'; text: string }

export default function DocumentPreview({ kind, file, onClose }: Props) {
  const [view, setView] = useState<View | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    let alive = true
    const load = kind === 'resume' ? resumeApi.preview : materialApi.preview
    setView(null)
    setLoading(true)
    setError(null)
    void load(file.id, controller.signal).then((result: DocumentPreviewResult) => {
      if (!alive) return
      if (result.kind === 'pdf') {
        objectUrl = URL.createObjectURL(result.blob)
        setView({ type: 'pdf', url: objectUrl })
      } else {
        setView({ type: 'text', text: result.text })
      }
    }).catch((reason: unknown) => {
      if (alive && !(reason instanceof Error && reason.name === 'AbortError')) setError(messageOf(reason))
    }).finally(() => { if (alive) setLoading(false) })
    return () => {
      alive = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [kind, file.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const isPptxText = kind === 'material' && /_PPTX文字提取版\.docx$/i.test(file.name)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-3 sm:p-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={`预览原文：${file.name}`}
        className="flex h-[min(88vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><FileText className="size-5 text-cyan-300" /> 预览原文</h2>
            <p className="mt-1 break-all text-sm text-slate-300">{file.name}</p>
          </div>
          <button type="button" aria-label="关闭预览" onClick={onClose}
            className="rounded-lg p-2 text-slate-200 hover:bg-white/10"><X className="size-5" /></button>
        </header>
        {isPptxText && <p className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-3 text-sm text-amber-200">
          此文件由 PPTX 转换，仅显示按幻灯片顺序提取的文字，不包含原始图片、图表或幻灯片版式。
        </p>}
        {!isPptxText && file.name.toLowerCase().endsWith('.docx') && <p className="border-b border-white/10 px-5 py-2 text-xs text-slate-400">
          DOCX 显示原文件提取出的正文文字，不保留 Word 排版和图片。
        </p>}
        <div className="min-h-0 flex-1 bg-slate-950 p-3 sm:p-4">
          {loading && <p role="status" className="flex items-center justify-center gap-2 p-10 text-slate-300"><LoaderCircle className="size-5 animate-spin" /> 正在读取原文件…</p>}
          {error && <p role="alert" className="rounded-xl border border-rose-400/30 p-5 text-rose-200">{error}</p>}
          {view?.type === 'pdf' && <iframe title={`PDF 原文：${file.name}`} src={view.url} className="h-full w-full rounded-lg bg-white" />}
          {view?.type === 'text' && <pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900 p-4 font-sans text-sm leading-7 text-slate-100">{view.text}</pre>}
        </div>
        <footer className="border-t border-white/10 px-5 py-3 text-xs text-slate-400">
          预览仅从当前账号保存的本地文件读取；关闭窗口后会释放临时 PDF 地址。PDF 可使用浏览器自带的翻页与缩放。
        </footer>
      </section>
    </div>
  )
}
