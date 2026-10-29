import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Expand, LoaderCircle, Presentation } from 'lucide-react'
import { analyzeSlide, slideImageUrl, slidesFor, clampSlidePage } from '../../lib/presentation'
import type { SlideSet, SlideReview } from '../../lib/presentation'

/** An account-local deck. Rendering never sends slide bytes to the LLM. */
export default function SlideDeck({ materialIds }: { materialIds: string[] }) {
  const [decks, setDecks] = useState<SlideSet[]>([])
  const [selected, setSelected] = useState('')
  const [page, setPage] = useState(1)
  const [imageFailed, setImageFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<SlideReview | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const root = useRef<HTMLElement>(null)
  const selectedDeck = decks.find((item) => item.material_id === selected)
  const current = selectedDeck?.pages[page - 1]
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError('')
    try {
      const results = await Promise.all(materialIds.map(async (id) => {
        try { return await slidesFor(id, signal) }
        catch (e) { if (signal.aborted) throw e; return null }
      }))
      if (signal.aborted) return
      const found = results.filter((item): item is SlideSet => item !== null)
      setDecks(found)
      setSelected((previous) => found.some((item) => item.material_id === previous) ? previous : (found[0]?.material_id ?? ''))
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : '无法读取幻灯片') }
    finally { if (!signal.aborted) setLoading(false) }
  }, [materialIds.join('|')])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
  useEffect(() => { setPage(1); setImageFailed(false); setReview(null); setReviewError('') }, [selected])
  useEffect(() => { setImageFailed(false); setReview(null); setReviewError('') }, [page])
  if (!materialIds.length) return null
  if (!loading && !selectedDeck && !error) return null // No PPTX selected.
  const canRender = !!selectedDeck?.has_original && !!selectedDeck.render_supported && !imageFailed
  async function reviewCurrent() {
    if (!selectedDeck || !current || reviewBusy) return
    setReviewBusy(true); setReviewError('')
    try { setReview(await analyzeSlide(selectedDeck.material_id, page)) }
    catch (e) { setReviewError(e instanceof Error ? e.message : '分析失败') }
    finally { setReviewBusy(false) }
  }
  return (
    <section ref={root} className="rounded-2xl border border-cyan-400/20 bg-slate-900 p-4 sm:p-5" aria-label="本地 PPT 幻灯片展示">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold"><Presentation className="size-5 text-cyan-300" /> 本地 PPT 演示</h2>
        {decks.length > 1 && <select aria-label="选择幻灯片资料" value={selected} onChange={(e) => setSelected(e.target.value)} className="rounded-md bg-slate-800 p-2 text-xs">
          {decks.map((deck, index) => <option key={deck.material_id} value={deck.material_id}>PPT {index + 1}（{deck.page_count} 页）</option>)}
        </select>}
        <button type="button" onClick={() => void root.current?.requestFullscreen?.()} className="flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"><Expand className="size-4" /> 放大</button>
      </div>
      {loading && <p className="text-sm text-slate-400">正在读取本地幻灯片…</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {selectedDeck && <>
        <p className="mb-3 text-xs text-amber-200">{selectedDeck.notice} 本地翻页不会调用 DeepSeek。</p>
        <div className="mx-auto flex min-h-52 items-center justify-center rounded-xl border border-white/10 bg-slate-950" style={{ aspectRatio: '16/9' }}>
          {canRender ? <img key={`${selected}-${page}`} src={slideImageUrl(selected, page)} alt={`第 ${page} 页幻灯片`} onError={() => setImageFailed(true)} className="max-h-full w-full object-contain" /> :
            <div className="max-h-full w-full overflow-auto px-8 py-6 text-center">
              <p className="mb-5 text-xs text-amber-300">文字预览（不包含原始图片、排版或图表）</p>
              <p className="max-h-[50vh] overflow-auto whitespace-pre-wrap text-left text-sm leading-7 text-slate-200">{current?.text || '这一页没有可选中文字。'}</p>
            </div>}
        </div>
        {imageFailed && <p role="status" className="mt-2 text-xs text-amber-300">本机未能渲染原版幻灯片，已自动切换到文字版。请确认安装了 PowerPoint 或 LibreOffice。</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((v) => clampSlidePage(v - 1, selectedDeck.page_count))} className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40"><ChevronLeft className="size-4" /> 上一页</button>
          <label className="flex items-center gap-2 text-xs text-slate-300">第 <input aria-label="跳转页码" type="number" min={1} max={selectedDeck.page_count} value={page} onChange={(e) => setPage(clampSlidePage(Number(e.target.value), selectedDeck.page_count))} className="w-16 rounded bg-slate-800 px-2 py-1 text-center" /> / {selectedDeck.page_count} 页</label>
          <button type="button" disabled={page >= selectedDeck.page_count} onClick={() => setPage((v) => clampSlidePage(v + 1, selectedDeck.page_count))} className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">下一页 <ChevronRight className="size-4" /></button>
        </div>
        <div className="mt-4 border-t border-white/10 pt-4">
          <button type="button" disabled={reviewBusy || !(current?.text.trim())} onClick={() => void reviewCurrent()} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200 hover:bg-white/10 disabled:opacity-40">
            {reviewBusy ? <><LoaderCircle className="mr-1 inline size-4 animate-spin" />AI 分析中…</> : 'AI 体检本页（可能产生费用，结果会缓存）'}
          </button>
          <p className="mt-2 text-xs text-slate-500">分析仅使用此页提取的文字，不分析图像、柱状图或截图，也不会把 PPT 图片发送给模型。</p>
          {reviewError && <p role="alert" className="mt-2 text-sm text-rose-300">{reviewError}</p>}
          {review && <div className="mt-3 space-y-2 rounded-xl bg-slate-950/60 p-4 text-sm leading-7">
            <p><strong className="text-cyan-200">可能追问：</strong>{review.question}</p>
            <p><strong className="text-amber-200">潜在风险：</strong>{review.risk}</p>
            <p><strong className="text-emerald-200">改进建议：</strong>{review.suggestion}</p>
          </div>}
        </div>
      </>}
    </section>
  )
}
