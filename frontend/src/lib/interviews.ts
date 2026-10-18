import { ApiError } from './api'
import type {
  BackendInterviewCreateRequest,
  InterviewAnswerRequest,
  InterviewAnswerResponse,
  InterviewCreateResponse,
  InterviewReport,
  InterviewSession,
} from '../types/interview'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      const first = detail.find((item: unknown) => item && typeof item === 'object' && 'msg' in item)
      if (first && typeof first === 'object' && 'msg' in first && typeof first.msg === 'string') {
        return first.msg
      }
    }
  }
  return `请求失败（HTTP ${status}）`
}

async function send<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError('无法连接 FastAPI，请检查后端是否在 127.0.0.1:8000 运行。')
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ApiError(`服务器没有返回有效 JSON（HTTP ${response.status}）。`, response.status)
  }
  if (!response.ok) throw new ApiError(errorMessage(data, response.status), response.status)
  return data as T
}

export function createInterview(body: BackendInterviewCreateRequest): Promise<InterviewCreateResponse> {
  return send<InterviewCreateResponse>('/api/interviews', { method: 'POST', body })
}

export function getInterview(sessionId: string, signal?: AbortSignal): Promise<InterviewSession> {
  return send<InterviewSession>(`/api/interviews/${encodeURIComponent(sessionId)}`, { signal })
}

export function answerInterview(sessionId: string, body: InterviewAnswerRequest): Promise<InterviewAnswerResponse> {
  return send<InterviewAnswerResponse>(`/api/interviews/${encodeURIComponent(sessionId)}/answer`, {
    method: 'POST', body,
  })
}

export function finishInterview(sessionId: string): Promise<InterviewSession> {
  return send<InterviewSession>(`/api/interviews/${encodeURIComponent(sessionId)}/finish`, { method: 'POST' })
}

export function getInterviewReport(sessionId: string, signal?: AbortSignal): Promise<InterviewReport> {
  return send<InterviewReport>(`/api/interviews/${encodeURIComponent(sessionId)}/report`, { signal })
}

/** AI deep review is opt-in. Never call this from effects or automatic page loads. */
export function generateAIInterviewReport(sessionId: string, refresh = false): Promise<InterviewReport> {
  const encoded = encodeURIComponent(sessionId)
  return send<InterviewReport>(`/api/interviews/${encoded}/report/ai?refresh=${refresh ? 'true' : 'false'}`, {
    method: 'POST',
  })
}
