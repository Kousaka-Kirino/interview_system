import type { Overview } from './reviewApi'
import { DIMENSIONS } from './reviewApi'

type RadarDatum = Overview['radar'][number]

export default function RadarChart({ data }: { data: RadarDatum[] }) {
  const values = DIMENSIONS.map(key => data.find(item => item.dimension === key)?.value ?? null)
  const cx = 180
  const cy = 165
  const r = 106
  const angle = (index: number) => (Math.PI * 2 * index / 6) - Math.PI / 2
  const vertex = (index: number, scale: number) => {
    const a = angle(index)
    return `${(cx + Math.cos(a) * scale).toFixed(1)},${(cy + Math.sin(a) * scale).toFixed(1)}`
  }
  const available = values.filter((x): x is number => x !== null).length
  // Null dimensions do not get fabricated ratings. Polygon only if all six have observations.
  const complete = available === DIMENSIONS.length
  const shape = complete ? values.map((v, i) => vertex(i, r * ((v ?? 0) / 100))).join(' ') : ''
  return (
    <section aria-label="六维复习准备度雷达图" className="rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">六维复习准备度</h3>
          <p className="mt-1 text-xs text-slate-400">依据个人知识标记推算 · 非 AI 正式能力评分</p>
        </div>
        <span className="rounded-full bg-blue-950/70 px-3 py-1 text-xs font-medium text-cyan-300">已覆盖 {available}/6 维</span>
      </div>
      <svg role="img" aria-label={`雷达图，已有 ${available} 个维度有数据`} viewBox="0 0 360 332" className="mx-auto mt-2 block w-full max-w-[420px]">
        {[.25, .5, .75, 1].map(level => (
          <polygon key={level} points={DIMENSIONS.map((_, i) => vertex(i, r * level)).join(' ')} fill="none" stroke="#293952" strokeWidth="1.2" />
        ))}
        {DIMENSIONS.map((dimension, i) => {
          const a = angle(i)
          const x = cx + Math.cos(a) * (r + 36)
          const y = cy + Math.sin(a) * (r + 27)
          return <g key={dimension}>
            <line x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r} stroke="#293952" />
            <text x={x} y={y} textAnchor="middle" fill="#b3c0d6" fontSize="12">{dimension}</text>
            {values[i] !== null && <text x={x} y={y + 15} textAnchor="middle" fill="#22d3ee" fontWeight="bold" fontSize="11">{values[i]}%</text>}
          </g>
        })}
        {complete && <polygon points={shape} fill="#22d3ee" fillOpacity="0.20" stroke="#22d3ee" strokeWidth="2.5" />}
        {values.map((value, i) => value !== null && (
          <circle key={i} cx={cx + Math.cos(angle(i)) * r * value / 100} cy={cy + Math.sin(angle(i)) * r * value / 100} r="4.5" fill="#22d3ee" />
        ))}
        {available === 0 && <text x={cx} y={cy + 5} textAnchor="middle" fill="#94a3b8" fontSize="13">标记知识点后生成雷达图</text>}
        {available > 0 && !complete && <text x={cx} y={cy + 5} textAnchor="middle" fill="#94a3b8" fontSize="11">未覆盖的维度不会虚构分数</text>}
      </svg>
    </section>
  )
}
