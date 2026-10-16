import type {
  HealthResponse,
  HistoryPage,
  InterviewStatus,
  OverallStatistics,
} from '../types/interview'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError('无法连接后端，请检查 FastAPI 是否已启动。')
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError('服务器没有返回有效的 JSON。', response.status)
  }

  if (!response.ok) {
    const detail =
      body !== null && typeof body === 'object' && 'detail' in body
        ? (body as { detail: unknown }).detail
        : undefined
    const message =
      typeof detail === 'string' ? detail : `请求失败：HTTP ${response.status}`
    throw new ApiError(message, response.status)
  }

  return body as T
}

export const interviewApi = {
  health(signal?: AbortSignal) {
    return getJson<HealthResponse>('/api/health', signal)
  },

  statistics(signal?: AbortSignal) {
    return getJson<OverallStatistics>('/api/interviews/statistics', signal)
  },

  history(
    options: { status?: InterviewStatus; limit: number; offset: number },
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams({
      limit: String(options.limit),
      offset: String(options.offset),
    })
    if (options.status) params.set('status', options.status)
    return getJson<HistoryPage>(`/api/interviews/history?${params}`, signal)
  },
}