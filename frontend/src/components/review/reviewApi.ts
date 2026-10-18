export const DIMENSIONS = ['理论依据', '论证逻辑', '研究方法', '数据证据', '创新价值', '答辩表达'] as const
export const ORIENTATIONS = ['概念辨析', '依据核验', '方法追问', '反例挑战', '边界条件', '应用延伸'] as const
export type Dimension = typeof DIMENSIONS[number]
export type Orientation = typeof ORIENTATIONS[number]
export type ReviewStatus = 'pending' | 'mastered' | 'disputed'

export interface KnowledgePoint {
  id: string
  session_id: string | null
  material_id: string | null
  source_name: string
  source_anchor: string
  source_text: string
  quote: string
  title: string
  dimension: Dimension
  orientation: Orientation
  severity: number
  important: boolean
  status: ReviewStatus
  note: string
  created_at: string
  updated_at: string
}

export type NewPoint = Omit<KnowledgePoint, 'id' | 'created_at' | 'updated_at'>
export type UpdatePoint = Partial<Pick<KnowledgePoint, 'title' | 'dimension' | 'orientation' | 'severity' | 'important' | 'status' | 'note'>>

export interface KnowledgeHit {
  source_id: string
  source_name: string
  source_anchor: string
  material_id: string | null
  source_text: string
  quote: string
  score: number
}

export interface Overview {
  source: string
  note: string
  total: number
  important: number
  pending: number
  mastered: number
  disputed: number
  radar: { dimension: Dimension; value: number | null; count: number }[]
  heatmap: Record<Dimension, { low: number; medium: number; high: number }>
  top_risks: Pick<KnowledgePoint, 'id' | 'title' | 'dimension' | 'orientation' | 'severity' | 'important' | 'status' | 'source_name'>[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    })
    if (!response.ok) {
      let detail = ''
      try { detail = (await response.json() as { detail?: string }).detail ?? '' } catch { /* no readable JSON */ }
      throw new Error(detail || `HTTP ${response.status}`)
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('请求超时，请检查后端连接。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const reviewApi = {
  overview: (sessionId?: string) => request<Overview>(`/api/study/overview${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`),
  points: (sessionId?: string) => request<{ items: KnowledgePoint[]; total: number }>(`/api/study/points${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`),
  create: (data: NewPoint) => request<KnowledgePoint>('/api/study/points', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: UpdatePoint) => request<KnowledgePoint>(`/api/study/points/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/api/study/points/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  search: (query: string, ids: string[]) => {
    const params = new URLSearchParams({ query, material_ids: ids.join(','), limit: '8' })
    return request<{ items: KnowledgeHit[]; status: string; message: string }>(`/api/study/search?${params.toString()}`)
  },
  session: (id: string) => request<{ material_ids?: string[]; turns?: { question?: string }[] }>(`/api/interviews/${encodeURIComponent(id)}`),
}

export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '未知错误'
}
