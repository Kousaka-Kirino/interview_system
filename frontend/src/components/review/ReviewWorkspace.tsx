import './stage7c-dark.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, ChevronRight, Flag, RefreshCw, Search, ShieldQuestion, X } from 'lucide-react'
import RadarChart from './RadarChart'
import DashboardDock from './DashboardDock'
import { DIMENSIONS, ORIENTATIONS, getErrorMessage, reviewApi } from './reviewApi'
import type { Dimension, KnowledgeHit, KnowledgePoint, NewPoint, Orientation, Overview, ReviewStatus } from './reviewApi'

function sourceHighlight(text: string, quote: string) {
  const start = text.indexOf(quote)
  if (start < 0) return <span className="whitespace-pre-wrap">{text}</span>
  return <>
    <span className="whitespace-pre-wrap">{text.slice(0, start)}</span>
    <mark id="stage7-highlight" className="rounded bg-amber-500/30 px-0.5 text-slate-50 ring-1 ring-amber-400/60">{quote}</mark>
    <span className="whitespace-pre-wrap">{text.slice(start + quote.length)}</span>
  </>
}

function statusName(value: ReviewStatus) {
  if (value === 'mastered') return '已巩固'
  if (value === 'disputed') return '不认可'
  return '待复习'
}
function severityName(value: number) {
  return value >= 4 ? '高风险' : value >= 3 ? '中风险' : '低风险'
}
function severityStyle(value: number) {
  return value >= 4 ? 'bg-rose-950/70 text-rose-300' : value >= 3 ? 'bg-amber-950/70 text-amber-300' : 'bg-blue-950/70 text-cyan-300'
}

const primary = 'rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60'
const secondary = 'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50'
const field = 'w-full placeholder:text-slate-500 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-900/60'
const section = 'rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-sm'

function useReviewData(sessionId?: string) {
  const [points, setPoints] = useState<KnowledgePoint[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pointData, summary] = await Promise.all([reviewApi.points(sessionId), reviewApi.overview(sessionId)])
      setPoints(pointData.items)
      setOverview(summary)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally { setLoading(false) }
  }, [sessionId])
  useEffect(() => { void reload() }, [reload])
  return { points, overview, loading, error, reload }
}

function KnowledgeDetail({ point, onClose, onSaved }: { point: KnowledgePoint; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [note, setNote] = useState(point.note)
  const [severity, setSeverity] = useState(point.severity)
  const [orientation, setOrientation] = useState(point.orientation)
  useEffect(() => {
    setNote(point.note)
    setSeverity(point.severity)
    setOrientation(point.orientation)
    setMessage('')
  }, [point.id, point.note, point.severity, point.orientation])
  async function update(changes: Parameters<typeof reviewApi.update>[1]) {
    setBusy(true)
    setMessage('')
    try {
      await reviewApi.update(point.id, changes)
      await onSaved()
      setMessage('已保存到本地复习记录')
    } catch (e) { setMessage(`保存失败：${getErrorMessage(e)}`) }
    finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/65 p-3" role="dialog" aria-modal="true" aria-label="知识点原文定位与复习标记" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="stage7c-dark max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-slate-900 p-5 shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-cyan-300">原文定位 · {point.dimension} · {point.orientation}</p>
          <h3 className="mt-1 text-lg font-bold text-slate-50">{point.title}</h3>
          <p className="mt-1 break-all text-xs text-slate-400">来源：{point.source_name}{point.source_anchor ? ` · 位置 ${point.source_anchor}` : ''}</p>
        </div>
        <button className={secondary} aria-label="关闭原文" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 text-sm leading-7 text-slate-200">
        {sourceHighlight(point.source_text, point.quote)}
      </div>
      <p className="mt-2 text-xs text-slate-400">高亮基于保存的知识库原文片段，不代表 PDF/Word 阅读器的页内定位；来源名称及位置仅取自索引元数据。</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-200">风险严重度
          <select className={`${field} mt-1`} value={severity} onChange={e => setSeverity(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v} 级 · {severityName(v)}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-200">评委提问取向
          <select className={`${field} mt-1`} value={orientation} onChange={e => setOrientation(e.target.value as Orientation)}>
            {ORIENTATIONS.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <label className="mt-4 block text-sm text-slate-200">复习备注 / 不认可理由
        <textarea className={`${field} mt-1 min-h-[90px]`} maxLength={3000} value={note} onChange={e => setNote(e.target.value)} placeholder="记录推导过程、反驳理由或下次答辩时的回答要点" />
      </label>
      <div className="mt-5 flex flex-wrap gap-2">
        <button disabled={busy} className={primary} onClick={() => void update({ severity, orientation, note })}>保存修改</button>
        <button disabled={busy} className={secondary} onClick={() => void update({ important: !point.important })}>{point.important ? '取消重点' : '标记为重点'}</button>
        <button disabled={busy} className={secondary} onClick={() => void update({ status: 'mastered' })}><CheckCircle2 size={14} className="mr-1 inline" />已巩固</button>
        <button disabled={busy} className={secondary} onClick={() => void update({ status: 'disputed' })}><ShieldQuestion size={14} className="mr-1 inline" />不认可</button>
        <button disabled={busy} className={secondary} onClick={() => void update({ status: 'pending' })}>重新列入待复习</button>
      </div>
      {message && <p role="status" className="mt-3 text-sm text-cyan-300">{message}</p>}
      <p className="mt-4 text-xs text-slate-400">状态：{statusName(point.status)} · 更新：{new Date(point.updated_at).toLocaleString('zh-CN')}</p>
    </div>
  </div>
}

function AddKnowledge({ sessionId, onSaved, initialQuery }: { sessionId?: string; onSaved: () => Promise<void>; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [materialIds, setMaterialIds] = useState<string[]>([])
  const [hits, setHits] = useState<KnowledgeHit[]>([])
  const [searchStatus, setSearchStatus] = useState('')
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<KnowledgeHit | null>(null)
  const [manualText, setManualText] = useState('')
  const [manualSource, setManualSource] = useState('手动摘录')
  const [title, setTitle] = useState('')
  const [dimension, setDimension] = useState<Dimension>('理论依据')
  const [orientation, setOrientation] = useState<Orientation>('依据核验')
  const [severity, setSeverity] = useState(3)
  const [important, setImportant] = useState(true)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void reviewApi.session(sessionId).then(data => {
      if (cancelled) return
      setMaterialIds(Array.isArray(data.material_ids) ? data.material_ids.filter((v): v is string => typeof v === 'string') : [])
      const turns = Array.isArray(data.turns) ? data.turns : []
      const lastQuestion = [...turns].reverse().find(turn => typeof turn.question === 'string')?.question
      if (lastQuestion) setQuery(current => current || lastQuestion.slice(0, 160))
    }).catch(() => { /* Manual entry remains available when session is unreachable. */ })
    return () => { cancelled = true }
  }, [sessionId])

  async function search() {
    if (query.trim().length < 2) return
    setSearching(true)
    setSearchStatus('')
    setSelected(null)
    try {
      const result = await reviewApi.search(query.trim(), materialIds)
      setHits(result.items)
      setSearchStatus(result.message || (result.items.length ? `找到 ${result.items.length} 条原文` : '没有检索到匹配片段，可手动添加'))
    } catch (e) { setSearchStatus(`检索失败：${getErrorMessage(e)}；可手动添加`) }
    finally { setSearching(false) }
  }

  async function save() {
    const text = selected?.source_text ?? manualText.trim()
    const quote = selected?.quote ?? manualText.trim().slice(0, 500)
    if (!text || !quote || !title.trim()) { setNotice('请填写标题并选择知识库片段，或粘贴原文。'); return }
    const payload: NewPoint = {
      session_id: sessionId ?? null,
      material_id: selected?.material_id ?? null,
      source_name: selected?.source_name ?? (manualSource.trim() || '手动摘录'),
      source_anchor: selected?.source_anchor ?? '',
      source_text: text,
      quote,
      title: title.trim(), dimension, orientation, severity, important, status: 'pending', note,
    }
    setSaving(true)
    setNotice('')
    try {
      await reviewApi.create(payload)
      await onSaved()
      setNotice('保存成功：重点标记会在之后的复习中保留。')
      setSelected(null)
      setManualText('')
      setTitle('')
      setNote('')
    } catch (e) { setNotice(`保存失败：${getErrorMessage(e)}`) }
    finally { setSaving(false) }
  }

  return <div className="space-y-4">
    <div>
      <h3 className="text-base font-semibold text-slate-100">从知识库收集复习重点</h3>
      <p className="mt-1 text-xs leading-5 text-slate-400">读取本地 Chroma 已索引的原文片段，属于候选知识检索，不保证与答辩模型本轮真正引用的片段相同。</p>
      {sessionId && <p className="mt-1 text-xs text-cyan-300">当前会话：{sessionId.slice(0, 12)}… {materialIds.length ? `已关联 ${materialIds.length} 份资料` : '未发现关联资料 ID，允许搜索整个本地库'}</p>}
    </div>
    <div className="flex gap-2">
      <input className={field} value={query} onChange={e => setQuery(e.target.value)} placeholder="输入答辩问题、概念或知识关键词" maxLength={200} aria-label="知识库检索关键词" />
      <button className={primary} disabled={searching || query.trim().length < 2} onClick={() => void search()}><Search className="mr-1 inline" size={15}/>{searching ? '检索中' : '检索'}</button>
    </div>
    {searchStatus && <p role="status" className="text-xs text-slate-300">{searchStatus}</p>}
    {hits.length > 0 && <div className="max-h-60 space-y-2 overflow-y-auto">
      {hits.map(hit => <button key={hit.source_id} onClick={() => { setSelected(hit); setTitle(hit.quote.trim().slice(0, 45) || '知识点'); setNotice('') }} className={`w-full rounded-lg border p-3 text-left text-xs hover:border-cyan-400 ${selected?.source_id === hit.source_id ? 'border-cyan-400 bg-blue-950/60' : 'border-slate-700 bg-slate-800/70'}`}>
        <span className="font-semibold text-cyan-300">{hit.source_name}{hit.source_anchor && ` · ${hit.source_anchor}`}</span>
        <span className="mt-1 block line-clamp-3 text-slate-200">{hit.quote}</span>
      </button>)}
    </div>}
    {!selected && <div className="space-y-2 border-t border-slate-800 pt-3">
      <label className="block text-sm text-slate-200">或者手动粘贴原文片段
        <textarea className={`${field} mt-1 min-h-[90px]`} maxLength={12000} value={manualText} onChange={e => setManualText(e.target.value)} placeholder="知识库暂未检索到内容时，可将真实教材、论文或资料原文粘贴到这里" />
      </label>
      <input className={field} maxLength={260} value={manualSource} onChange={e => setManualSource(e.target.value)} placeholder="资料来源名称" aria-label="资料来源名称" />
    </div>}
    {selected && <p className="rounded-lg bg-blue-950/60 px-3 py-2 text-xs text-cyan-300">已选原文：{selected.source_name}。保存后可点击清单定位高亮。</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm text-slate-200 sm:col-span-2">复习点标题<input className={`${field} mt-1`} maxLength={150} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：为何选择这种研究方法？" /></label>
      <label className="text-sm text-slate-200">能力维度<select className={`${field} mt-1`} value={dimension} onChange={e => setDimension(e.target.value as Dimension)}>{DIMENSIONS.map(v => <option key={v}>{v}</option>)}</select></label>
      <label className="text-sm text-slate-200">提问取向<select className={`${field} mt-1`} value={orientation} onChange={e => setOrientation(e.target.value as Orientation)}>{ORIENTATIONS.map(v => <option key={v}>{v}</option>)}</select></label>
      <label className="text-sm text-slate-200">风险严重度<select className={`${field} mt-1`} value={severity} onChange={e => setSeverity(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v} 级 · {severityName(v)}</option>)}</select></label>
      <label className="mt-6 flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={important} onChange={e => setImportant(e.target.checked)} /> 这条知识是重点</label>
      <label className="text-sm text-slate-200 sm:col-span-2">备注<textarea className={`${field} mt-1 min-h-16`} maxLength={3000} value={note} onChange={e => setNote(e.target.value)} placeholder="可能被追问的点或自己的解答思路" /></label>
    </div>
    <button className={primary} disabled={saving} onClick={() => void save()}>{saving ? '保存中...' : '保存为复习知识点'}</button>
    {notice && <p role="status" className="text-sm text-cyan-300">{notice}</p>}
  </div>
}

function RiskTable({ summary, points, onOpen, onFilter }: {
  summary: Overview | null
  points: KnowledgePoint[]
  onOpen: (point: KnowledgePoint) => void
  onFilter: (key: { dimension: Dimension; tier: 'low' | 'medium' | 'high' } | null) => void
}) {
  const [filter, setFilter] = useState<{ dimension: Dimension; tier: 'low' | 'medium' | 'high' } | null>(null)
  const visible = useMemo(() => {
    const remaining = points.filter(p => p.status !== 'mastered')
    if (!filter) return remaining.sort((a, b) => (b.severity + (b.important ? 1 : 0)) - (a.severity + (a.important ? 1 : 0)))
    return remaining.filter(p => p.dimension === filter.dimension &&
      (filter.tier === 'high' ? p.severity >= 4 : filter.tier === 'medium' ? p.severity === 3 : p.severity <= 2))
  }, [points, filter])
  function select(dimension: Dimension, tier: 'low' | 'medium' | 'high') {
    const next = filter?.dimension === dimension && filter.tier === tier ? null : { dimension, tier }
    setFilter(next)
    onFilter(next)
  }
  const bins = [{ key: 'low', name: '低', style: 'bg-blue-950/70 text-cyan-300' }, { key: 'medium', name: '中', style: 'bg-amber-950/70 text-amber-300' }, { key: 'high', name: '高', style: 'bg-rose-950/70 text-rose-300' }] as const
  return <div className="space-y-4">
    <section className={section}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-semibold text-slate-100">风险热力图</h3><p className="mt-1 text-xs text-slate-400">未巩固知识点按维度和严重度计数 · 单击格子筛选</p></div>
        {filter && <button className={secondary} onClick={() => { setFilter(null); onFilter(null) }}>清除筛选</button>}
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-[330px] grid-cols-[100px_repeat(3,1fr)] gap-2 text-center text-sm">
          <span />{bins.map(tier => <span key={tier.key} className="font-medium text-slate-400">{tier.name}风险</span>)}
          {DIMENSIONS.map(dimension => <div key={dimension} className="contents">
            <span className="self-center text-left text-xs text-slate-200">{dimension}</span>
            {bins.map(tier => {
              const count = summary?.heatmap?.[dimension]?.[tier.key] ?? 0
              const active = filter?.dimension === dimension && filter.tier === tier.key
              return <button key={tier.key} type="button" title={`${dimension} · ${tier.name}风险 ${count} 条`} onClick={() => select(dimension, tier.key)} className={`rounded-lg px-2 py-3 text-sm font-semibold transition hover:brightness-95 ${count ? tier.style : 'bg-slate-800 text-slate-500'} ${active ? 'ring-2 ring-cyan-400' : ''}`}>
                {count}
              </button>
            })}
          </div>)}
        </div>
      </div>
    </section>
    <section className={section}>
      <h3 className="font-semibold text-slate-100">薄弱点清单 <span className="text-sm font-normal text-slate-400">({visible.length})</span></h3>
      <p className="mt-1 text-xs text-slate-400">按严重度与重点标记排序；“不认可”单独保留，不视作已巩固。</p>
      <div className="mt-4 max-h-[480px] space-y-2 overflow-y-auto">
        {visible.length === 0 && <p className="rounded-lg bg-slate-800/70 px-4 py-6 text-sm text-slate-400">当前没有待处理的风险知识点。你可以先从知识库添加。</p>}
        {visible.map(point => <button key={point.id} onClick={() => onOpen(point)} className="flex w-full items-start gap-2 rounded-xl border border-slate-700 p-3 text-left hover:border-cyan-500/60 hover:bg-slate-800">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className={`rounded px-2 py-0.5 ${severityStyle(point.severity)}`}>{severityName(point.severity)} · {point.severity}级</span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">{point.orientation}</span>
              {point.important && <span className="rounded bg-violet-950/70 px-2 py-0.5 text-violet-300">重点</span>}
              {point.status === 'disputed' && <span className="rounded bg-orange-950/70 px-2 py-0.5 text-orange-300">不认可</span>}
            </div>
            <p className="mt-2 font-medium text-slate-100">{point.title}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{point.dimension} · {point.source_name}</p>
          </div>
          <ChevronRight size={17} className="mt-3 shrink-0 text-cyan-400" />
        </button>)}
      </div>
    </section>
  </div>
}

function DashboardReview({ onOpen }: { onOpen: (point: KnowledgePoint) => void }) {
  const { points, overview, loading, error, reload } = useReviewData()
  const [showAdd, setShowAdd] = useState(false)
  return <section aria-label="答辩雷达图与风险复习看板" className="stage7c-dark my-6 space-y-4 rounded-2xl border border-slate-700 bg-slate-950/40 p-4 text-slate-100 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold tracking-widest text-cyan-300">STAGE 7 · 知识风险复习</p><h2 className="mt-1 text-xl font-bold">答辩能力与风险看板</h2><p className="mt-1 text-sm text-slate-400">一屏掌握重点知识、薄弱点与复习进展</p></div>
      <div className="flex gap-2"><button className={secondary} onClick={() => void reload()}><RefreshCw size={14} className="mr-1 inline" />刷新</button><button className={primary} onClick={() => setShowAdd(v => !v)}><BookOpen size={15} className="mr-1 inline" />{showAdd ? '收起录入' : '添加复习知识'}</button></div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-rose-950/60 p-3 text-sm text-rose-300">加载失败：{error}。请检查 FastAPI 是否已重启并加载 Stage 7。</p>}
    {loading && <p role="status" className="text-sm text-slate-400">正在读取本地复习记录…</p>}
    {overview && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["知识点总数", overview.total], ["重点知识", overview.important], ["待复习", overview.pending], ["已巩固", overview.mastered]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-cyan-300">{value}</p></div>)}
    </div>}
    {showAdd && <div className={section}><AddKnowledge onSaved={reload} /></div>}
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <RadarChart data={overview?.radar ?? []} />
      <RiskTable summary={overview} points={points} onOpen={onOpen} onFilter={() => {}} />
    </div>
    <p className="text-xs text-slate-400">风险等级由你设置；雷达图来自个人标注的“复习准备度”，并非模型对答辩能力的客观打分。</p>
  </section>
}

function SessionNotes({ sessionId, onOpen, onClose }: { sessionId: string; onOpen: (point: KnowledgePoint) => void; onClose: () => void }) {
  const { points, loading, error, reload } = useReviewData(sessionId)
  const [tab, setTab] = useState<'search' | 'saved'>('search')
  return <div className="fixed inset-0 z-[150] flex items-center justify-end bg-slate-900/45 p-0 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label="答辩知识点标记" className="stage7c-dark h-full w-full max-w-xl overflow-y-auto bg-slate-900 p-5 shadow-2xl sm:h-[min(92vh,900px)] sm:rounded-2xl sm:p-6">
      <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-bold text-slate-50">答辩知识重点</h2><p className="text-xs text-slate-400">本次会话的知识点保存至本地，之后仍可复习</p></div><button className={secondary} aria-label="关闭知识标记" onClick={onClose}><X size={17}/></button></div>
      <div className="mt-5 flex gap-2 border-b border-slate-700 pb-3"><button className={tab === 'search' ? primary : secondary} onClick={() => setTab('search')}>检索 / 标记</button><button className={tab === 'saved' ? primary : secondary} onClick={() => setTab('saved')}>本场已保存 ({points.length})</button></div>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      {loading && <p className="mt-3 text-xs text-slate-400">正在读取记录…</p>}
      {tab === 'search' ? <div className="mt-5"><AddKnowledge key={sessionId} sessionId={sessionId} onSaved={reload} /></div> : <div className="mt-4 space-y-2">
        {points.length === 0 && <p className="rounded-xl bg-slate-800/70 p-4 text-sm text-slate-400">本场答辩还没有标记知识点。</p>}
        {points.map(point => <button key={point.id} onClick={() => onOpen(point)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-700 p-3 text-left text-sm hover:bg-slate-800">
          <span className="min-w-0"><strong className="block truncate text-slate-100">{point.title}</strong><span className="mt-1 block text-xs text-slate-400">{point.dimension} · {statusName(point.status)} · {severityName(point.severity)}</span></span>
          <ChevronRight className="shrink-0 text-cyan-400" size={17}/>
        </button>)}
      </div>}
    </section>
  </div>
}

export default function ReviewWorkspace() {
  const [route, setRoute] = useState(window.location.hash)
  const [opened, setOpened] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<KnowledgePoint | null>(null)
  const [revision, setRevision] = useState(0)
  const dashboard = !route || route === '#' || route.startsWith('#dashboard')
  const sessionId = /^#session\/([a-zA-Z0-9-]{6,100})$/.exec(route)?.[1] ?? null

  useEffect(() => {
    const update = () => { setRoute(window.location.hash); setOpened(false); setSelectedPoint(null) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  const onSaved = async () => {
    setRevision(current => current + 1)
    if (selectedPoint) {
      const result = await reviewApi.points()
      setSelectedPoint(result.items.find(p => p.id === selectedPoint.id) ?? null)
    }
  }
  return <>
    {dashboard && <DashboardDock><DashboardReview key={revision} onOpen={setSelectedPoint}/></DashboardDock>}
    {sessionId && <button type="button" className="fixed bottom-4 left-4 z-[110] inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-xl hover:bg-blue-600" onClick={() => setOpened(true)}><Flag size={17}/>知识重点与复习</button>}
    {sessionId && opened && <SessionNotes key={`${sessionId}:${revision}`} sessionId={sessionId} onOpen={setSelectedPoint} onClose={() => setOpened(false)}/>}
    {selectedPoint && <KnowledgeDetail point={selectedPoint} onClose={() => setSelectedPoint(null)} onSaved={async () => { await onSaved() }} />}
  </>
}

