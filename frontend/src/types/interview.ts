export type InterviewStatus = 'active' | 'completed'

export interface HistoryItem {
  id: string
  resume_id: string
  status: InterviewStatus
  reviewer_style: string
  created_at: string
  answered_count: number
  average_score: number | null
}

export interface HistoryPage {
  total: number
  limit: number
  offset: number
  items: HistoryItem[]
}

export interface OverallStatistics {
  total_sessions: number
  active_sessions: number
  completed_sessions: number
  answered_turns: number
  average_score: number | null
}

export interface HealthResponse {
  status: string
  service?: string
}
