import type { CompletedScorePoint } from '../types/interview'

// These thresholds are practice-only display conventions, not validated assessment.
export function practiceRating(value: number | null): { label: string; tone: 'good' | 'medium' | 'low' } | null {
  if (value === null || !Number.isFinite(value)) return null
  if (value >= 80) return { label: '良好', tone: 'good' }
  if (value >= 60) return { label: '待提升', tone: 'medium' }
  return { label: '需加强', tone: 'low' }
}

export function sessionChange(points: CompletedScorePoint[]): number | null {
  if (points.length < 2) return null
  const current = points[points.length - 1].average_score
  const previous = points[points.length - 2].average_score
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  return Math.round((current - previous) * 10) / 10
}

export function changeDescription(delta: number | null): string {
  if (delta === null) return '至少完成两场有评分的答辩后显示比较'
  if (delta === 0) return '与上次持平'
  return `较上次 ${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} 分`
}

export function trendCoordinates(points: CompletedScorePoint[], width = 720, height = 230) {
  const left = 50
  const right = width - 24
  const top = 20
  const bottom = height - 36
  const spanX = right - left
  const spanY = bottom - top
  return points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? left + spanX / 2 : left + spanX * index / (points.length - 1),
    y: bottom - Math.max(0, Math.min(100, point.average_score)) / 100 * spanY,
  }))
}
