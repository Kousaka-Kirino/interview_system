// Shared types for the dashboard, sessions and both practice modes.
export type PracticeMode = 'interview' | 'defense'
export type InterviewStatus = 'active' | 'completed'

export interface HistoryItem {
  id: string
  mode?: PracticeMode
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

export interface CompletedScorePoint {
  session_id: string
  created_at: string
  average_score: number
  scored_answers: number
}

export interface CompletedScoreHistory {
  points: CompletedScorePoint[]
}

export interface HealthResponse {
  status: string
  service?: string
}

export type InterviewerStyle = 'friendly' | 'neutral' | 'pressure'
export type InterviewDifficulty = 'easy' | 'medium' | 'hard'
export type UserDifficultyFeedback = 'none' | 'too_easy' | 'just_right' | 'too_hard'

// The backend accepts numeric difficulty and adaptation values.
export interface BackendInterviewConfig {
  reviewer_style: InterviewerStyle
  initial_difficulty: number // 1..5
  adaptation_level: number // 0..3
  question_count: number // 3..30
  max_followups: number // 0..2
}

export interface InterviewConfig {
  resumeId: string
  materialIds: string[]
  interviewerStyle: InterviewerStyle
  difficulty: InterviewDifficulty
  adaptationLevel: number
}

// Retained for compatibility with the original interview form.
export interface InterviewCreateRequest {
  resume_id: string
  material_ids: string[]
  interviewer_style: InterviewerStyle
  difficulty: InterviewDifficulty
  adaptation_level: number // UI percent 0..100
}

export interface BackendInterviewCreateRequest {
  mode?: PracticeMode
  resume_id?: string
  material_ids: string[]
  config: BackendInterviewConfig
  focus_session_id?: string
}

export interface InterviewTurn {
  id: number
  question_number: number
  followup_number: number
  difficulty: number
  question: string
  answer: string | null
  score: number | null
  feedback: string | null
  user_feedback: UserDifficultyFeedback | null
}

export interface InterviewSession {
  id: string
  mode?: PracticeMode
  resume_id: string
  material_ids: string[]
  config: BackendInterviewConfig
  status: InterviewStatus
  current_difficulty: number
  main_questions_asked: number
  followups_used: number
  positive_streak: number
  negative_streak: number
  created_at: string
  turns: InterviewTurn[]
  practice_focus?: { source_session_id: string; weak_points: Array<{title: string; dimension: string; reason: string}> } | null
}

export type InterviewCreateResponse = InterviewSession

export interface InterviewAnswerRequest {
  turn_id: number
  answer: string
  user_feedback: UserDifficultyFeedback
}

export interface InterviewEvaluation {
  score: number
  feedback: string
  adaptation_reason: string
}

export interface InterviewAnswerResponse {
  session: InterviewSession
  evaluation: InterviewEvaluation
}

export interface ReportTurn {
  turn_id: number
  question_number: number
  followup_number: number
  difficulty: number
  question: string
  answer: string
  score: number | null
  feedback: string | null
}

export interface InterviewReport {
  session_id: string
  mode?: PracticeMode
  status: InterviewStatus
  reviewer_style: string
  planned_main_questions: number
  main_questions_asked: number
  answered_count: number
  unanswered_count: number
  average_score: number | null
  score_trend: Array<{ turn_id: number; question_number: number; followup_number: number; difficulty: number; score: number }>
  turns: ReportTurn[]
  strengths: string[]
  improvements: string[]
  suggestions: string[]
  ai_analysis: Record<string, unknown> | null
  ai_generated_at: string | null
  practice_focus?: { source_session_id: string; weak_points: Array<{title: string; dimension: string; reason: string}> } | null
  scoring_note: string
}
