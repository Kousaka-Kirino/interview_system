import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Expand, LoaderCircle, Presentation } from 'lucide-react'
import {
  analyzeSlide, slideImageUrl, slidesFor, clampSlidePage, parseSlidePageInput, stepSlidePage,
} from '../../lib/presentation'
import type { SlideSet, SlideReview } from '../../lib/presentation'

/** The deck is only served from the currently authenticated local account. */
export default function SlideDeck({ materialIds }: { materialIds: string[] }) {
  const [decks, setDecks] = useState<SlideSet[]>([])
  const [selected, setSelected] = useState('')
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [imageFailed, setImageFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<SlideReview | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const root = useRef<HTMLElement>(null)
  const selectedDeck = decks.find((item) => item.material_id === selected)
  const pageCount = selectedDeck?.pages.length ?? 0
  const currentPage = clampSlidePage(page, Math.max(1, pageCount))
  const current = selectedDeck?.pages[currentPage - 1]

  // Primitive signature, not the parent-created materialIds array (which may change identity).
  const materialSignature = materialIds.join('|')
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const results = await Promise.all(materialSignature.split('|').filter(Boolean).map(async (id) => {
        try { return { deck: await slidesFor(id, signal), error: '' } }
        catch (e) { if (signal.aborted) throw e; return { deck: null, error: e instanceof Error ? e.message : '读取失败' } }
      }))
      if (signal.aborted) return
      const found = results.map((entry) => entry.deck).filter((item): item is SlideSet => item !== null)
      setDecks(found)
      setSelected((previous) => found.some((item) => item.material_id === previous) ? previous : (found[0]?.material_id ?? ''))
      if (!found.length) setError(results.map((item) => item.error).filter(Boolean).join('；') || '没有可展示的 PPTX')
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : '无法读取幻灯片') }
    finally { if (!signal.aborted) setLoading(false) }
  }, [materialSignature])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
  useEffect(() => { setPage(1); setPageDraft('1'); setImageFailed(false); setReview(null); setReviewError('') }, [selected])
  useEffect(() => { setPageDraft(String(page)); setImageFailed(false); setReview(null); setReviewError('') }, [page])
  useEffect(() => {
    if (pageCount > 0 && page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  if (!materialIds.length) return null
  if (!loading && !selectedDeck && !error) return null
  const canRender = !!selectedDeck?.has_original && !!selectedDeck.render_supported && !imageFailed

  function goToPage(value: number) {
    if (pageCount < 1) return
    const next = clampSlidePage(value, pageCount)
    setPage(next)
    setPageDraft(String(next))
  }
  function commitPageInput() {
    const next = parseSlidePageInput(pageDraft, pageCount)
    if (next !== null) goToPage(next)
    else setPageDraft(String(currentPage))
  }
  function handleDeckKey(event: KeyboardEvent<HTMLElement>) {
    // Do not intercept typing, number inputs, selectors, or other editing controls.
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'PageDown') next = stepSlidePage(currentPage, 1, pageCount)
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') next = stepSlidePage(currentPage, -1, pageCount)
    if (event.key === 'Home') next = 1
    if (event.key === 'End') next = pageCount
    if (next !== null && pageCount) { event.preventDefault(); goToPage(next) }
  }
  async function reviewCurrent() {
    if (!selectedDeck || !current || reviewBusy) return
    setReviewBusy(true); setReviewError('')
    try { setReview(await analyzeSlide(selectedDeck.material_id, currentPage)) }
    catch (e) { setReviewError(e instanceof Error ? e.message : '分析失败') }
    finally { setReviewBusy(false) }
  }

  return (
    <section ref={root} tabIndex={0} onKeyDown={handleDeckKey}
      className="rounded-2xl border border-cyan-400/20 bg-slate-900 p-4 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 sm:p-5"
      aria-label="本地 PPT 幻灯片展示">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold"><Presentation className="size-5 text-cyan-300" /> 本地 PPT 演示</h2>
        {decks.length > 1 && <select aria-label="选择幻灯片资料" value={selected} onChange={(e) => setSelected(e.target.value)} className="rounded-md bg-slate-800 p-2 text-xs">
          {decks.map((deck, index) => <option key={deck.material_id} value={deck.material_id}>PPT {index + 1}（{deck.page_count} 页）</option>)}
        </select>}
        <button type="button" onClick={() => void root.current?.requestFullscreen?.()} className="flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"><Expand className="size-4" /> 放大</button>
      </div>
      {loading && <p role="status" className="text-sm text-slate-400">正在读取本地幻灯片…</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}。请到“我的材料”检查是否为 PPTX。</p>}
      {selectedDeck && <>
        <p className="mb-3 text-xs text-amber-200">{selectedDeck.notice} 翻页不会调用 DeepSeek。</p>
        <p aria-live="polite" className="mb-2 text-sm font-medium text-cyan-100">当前第 {currentPage} 页，共 {pageCount} 页</p>
        <div className="mx-auto flex min-h-52 items-center justify-center rounded-xl border border-white/10 bg-slate-950" style={{ aspectRatio: '16/9' }}>
          {canRender ? <img key={`${selected}-${currentPage}`} src={slideImageUrl(selected, currentPage)} alt={`第 ${currentPage} 页幻灯片`} onError={() => setImageFailed(true)} className="max-h-full w-full object-contain" /> :
            <div key={`${selected}-text-${currentPage}`} className="max-h-full w-full overflow-auto px-8 py-6 text-center">
              <p className="mb-5 text-xs text-amber-300">文字预览（不包含原始图片、排版或图表）</p>
              <p className="max-h-[50vh] overflow-auto whitespace-pre-wrap text-left text-sm leading-7 text-slate-200">{current?.text || '这一页没有可选中文字。'}</p>
            </div>}
        </div>
        {imageFailed && <p role="status" className="mt-2 text-xs text-amber-300">这一页原版渲染失败，已改用文字版。仍可继续翻页。请检查本机 PowerPoint / LibreOffice。</p>}
        {pageCount === 1 && <p role="status" className="mt-3 rounded-lg border border-amber-400/20 p-3 text-sm text-amber-200">当前资料只识别到 1 页，因此“下一页”无法使用。{selectedDeck.has_original ? '请确认上传的 PPTX 确实包含多张幻灯片；可重新导出 PPTX 后上传。' : '这可能是旧版仅保存的 DOCX 文字提取版，建议从“我的材料”重新上传原始 PPTX。'}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" aria-label="上一页幻灯片" disabled={currentPage <= 1} onClick={() => goToPage(stepSlidePage(currentPage, -1, pageCount))} className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="size-4" /> 上一页</button>
          <label className="flex items-center gap-2 text-xs text-slate-300">第 <input aria-label="跳转页码" type="text" inputMode="numeric" pattern="[0-9]*" value={pageDraft}
            onChange={(e) => setPageDraft(e.target.value)} onBlur={commitPageInput}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitPageInput(); e.currentTarget.blur() } else if (e.key === 'Escape') { setPageDraft(String(currentPage)); e.currentTarget.blur() } }}
            className="w-16 rounded bg-slate-800 px-2 py-1 text-center" /> / {pageCount} 页</label>
          <button type="button" aria-label="下一页幻灯片" disabled={currentPage >= pageCount} onClick={() => goToPage(stepSlidePage(currentPage, 1, pageCount))} className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40">下一页 <ChevronRight className="size-4" /></button>
        </div>
        {pageCount > 1 && <p className="mt-2 text-xs text-slate-400">可点击“上一页 / 下一页”；点击幻灯片区域后，也可使用 ← → 或 PageUp / PageDown。输入页码后按 Enter 跳转。</p>}
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
