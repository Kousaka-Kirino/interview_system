import type { CompletedScoreHistory } from '../../types/interview'
import { trendCoordinates } from '../../lib/scoreInsights'

const WIDTH = 720
const HEIGHT = 230
const GRID = [0, 25, 50, 75, 100] as const

function shortDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '日期未知' : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default function ScoreHistoryChart({ history }: { history: CompletedScoreHistory }) {
  const points = trendCoordinates(history.points, WIDTH, HEIGHT)
  if (points.length === 0) {
    return <p className="py-12 text-center text-sm text-slate-400">暂无有评分的已完成答辩。完成并评分后，这里会出现历史走势。</p>
  }
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ')
  const first = points[0]
  const last = points[points.length - 1]
  return (
    <div>
      <div className="overflow-x-auto">
        <svg role="img" aria-label={`最近 ${points.length} 场已完成答辩的场均分走势，首场 ${first.average_score.toFixed(1)} 分，最近一场 ${last.average_score.toFixed(1)} 分`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[420px] w-full" xmlns="http://www.w3.org/2000/svg">
          {GRID.map((score) => {
            const y = 194 - score / 100 * 174
            return <g key={score}><line x1={50} x2={696} y1={y} y2={y} stroke="#475569" strokeOpacity={0.35} strokeDasharray="4 5" /><text x={40} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="12">{score}</text></g>
          })}
          {points.length > 1 && <polyline points={polyline} fill="none" stroke="#67e8f9" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
          {points.map((point, index) => <circle key={point.session_id} cx={point.x} cy={point.y} r={points.length === 1 ? 6 : 4.5} fill="#22d3ee" stroke="#082f49" strokeWidth="2"><title>{`第 ${index + 1} 场 · ${shortDate(point.created_at)} · ${point.average_score.toFixed(1)} 分（${point.scored_answers} 道已评分回答）`}</title></circle>)}
          <text x={50} y={220} fill="#94a3b8" fontSize="12">{shortDate(first.created_at)}</text>
          <text x={696} y={220} fill="#94a3b8" fontSize="12" textAnchor="end">{shortDate(last.created_at)}</text>
        </svg>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">最近 {points.length} 场有评分的已完成答辩 · 各点为该场已评分回答均值；鼠标悬停查看明细。未完成或没有有效评分的会话不计入走势。</p>
    </div>
  )
}
