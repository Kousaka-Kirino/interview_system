import type {
  HealthResponse,
  HistoryPage,
  InterviewStatus,
  OverallStatistics,
} from '../types/interview'
import type {
  MaterialInfo,
  MaterialSearchRequest,
  MaterialSearchResponse,
  ResumeCorrections,
  ResumeDetail,
  ResumeInfo,
} from '../types/resources'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getErrorDetail(value: unknown, status: number): string {
  if (value && typeof value === 'object' && 'detail' in value) {
    const detail = (value as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      const messages = detail
        .slice(0, 3)
        .map((item: unknown) => {
          if (item && typeof item === 'object' && 'msg' in item) {
            const msg = (item as { msg?: unknown }).msg
            return typeof msg === 'string' ? msg : ''
          }
          return ''
        })
        .filter(Boolean)
      if (messages.length) return messages.join('；')
    }
  }
  return `请求失败（HTTP ${status}）`
}

async function request<T>(
  path: string,
  options: { method?: Method; body?: FormData | object; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  let requestBody: BodyInit | undefined

  if (body instanceof FormData) {
    requestBody = body
    // 不要手动设置 multipart/form-data；浏览器需要自动设置 boundary。
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    requestBody = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: requestBody,
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError('无法连接后端。请确认 FastAPI 正在 127.0.0.1:8000 运行。')
  }

  if (response.status === 204) {
    return undefined as T
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError(
      response.ok ? '服务器没有返回有效的 JSON。' : `请求失败（HTTP ${response.status}）`,
      response.status,
    )
  }

  if (!response.ok) throw new ApiError(getErrorDetail(payload, response.status), response.status)
  return payload as T
}

function fileBody(file: File): FormData {
  const form = new FormData()
  form.append('file', file)
  return form
}

export const interviewApi = {
  health: (signal?: AbortSignal) =>
    request<HealthResponse>('/api/health', { signal }),
  statistics: (signal?: AbortSignal) =>
    request<OverallStatistics>('/api/interviews/statistics', { signal }),
  history: (
    options: { status?: InterviewStatus; limit: number; offset: number },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      limit: String(options.limit),
      offset: String(options.offset),
    })
    if (options.status) params.set('status', options.status)
    return request<HistoryPage>(`/api/interviews/history?${params.toString()}`, { signal })
  },
}

export const resumeApi = {
  list: (signal?: AbortSignal) => request<ResumeInfo[]>('/api/resumes', { signal }),
  get: (id: string, signal?: AbortSignal) =>
    request<ResumeDetail>(`/api/resumes/${encodeURIComponent(id)}`, { signal }),
  upload: (file: File) =>
    request<ResumeDetail>('/api/resumes', { method: 'POST', body: fileBody(file) }),
  update: (id: string, changes: ResumeCorrections) =>
    request<ResumeDetail>(`/api/resumes/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  remove: (id: string) =>
    request<void>(`/api/resumes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export const materialApi = {
  list: (signal?: AbortSignal) => request<MaterialInfo[]>('/api/materials', { signal }),
  upload: (file: File) =>
    request<MaterialInfo>(
      // stage10:pptx-import -- DOCX derivative uses existing RAG pipeline
      file.name.toLowerCase().endsWith('.pptx') ? '/api/pptx-import' : '/api/materials',
      { method: 'POST', body: fileBody(file) },
    ),
  remove: (id: string) =>
    request<void>(`/api/materials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  search: (body: MaterialSearchRequest) =>
    request<MaterialSearchResponse>('/api/materials/search', { method: 'POST', body }),
}
