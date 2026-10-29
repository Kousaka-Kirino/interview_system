export type SlidePage = { index: number; text: string }
export type SlideSet = {
  material_id: string
  page_count: number
  pages: SlidePage[]
  has_original: boolean
  render_supported: boolean
  notice: string
}
export type SlideReview = { question: string; risk: string; suggestion: string }
export type OpeningAnalysis = { summary: string; strengths: string[]; improvements: string[]; followup_question: string }

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error('无法连接本地服务，请检查 FastAPI 是否运行。')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: unknown }
    throw new Error(typeof data.detail === 'string' ? data.detail : `请求失败 HTTP ${response.status}`)
  }
  return await response.json() as T
}

export const slidesFor = (id: string, signal?: AbortSignal) =>
  request<SlideSet>(`/api/materials/${encodeURIComponent(id)}/slides`, 'GET', undefined, signal)
export const slideImageUrl = (id: string, page: number) =>
  `/api/materials/${encodeURIComponent(id)}/slides/${page}/image`
export const analyzeSlide = (id: string, page: number) =>
  request<SlideReview>(`/api/materials/${encodeURIComponent(id)}/slides/${page}/review`, 'POST')
export const getOpening = (id: string, signal?: AbortSignal) =>
  request<{ completed: boolean; analysis: OpeningAnalysis | null }>(`/api/interviews/${encodeURIComponent(id)}/opening`, 'GET', undefined, signal)
export const analyzeOpening = (id: string, text: string) =>
  request<OpeningAnalysis>(`/api/interviews/${encodeURIComponent(id)}/opening`, 'POST', { text })

/** Keep slide paging inside [1, pageCount], even when number input is empty. */
export function clampSlidePage(value: number, pageCount: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(pageCount)) return 1
  return Math.min(Math.max(1, Math.floor(pageCount)), Math.max(1, Math.floor(value)))
}


/** Page jump text is only committed on Enter/blur, never while typing. */
export function parseSlidePageInput(raw: string, pageCount: number): number | null {
  const text = raw.trim()
  if (!/^\d{1,6}$/.test(text)) return null
  const page = Number(text)
  if (!Number.isSafeInteger(page) || page < 1) return null
  return clampSlidePage(page, pageCount)
}

/** Pure step navigation used by buttons and keyboard controls. */
export function stepSlidePage(current: number, direction: -1 | 1, count: number): number {
  return clampSlidePage(current + direction, count)
}
