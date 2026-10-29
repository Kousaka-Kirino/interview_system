/** Build a safe repeat-practice draft from a finished session. No API or AI calls. */
import type { BackendInterviewConfig, InterviewSession, PracticeMode } from '../types/interview.ts'
import type { DefenseTiming } from './defenseConfiguration.ts'
import { validPreferences } from './defenseConfiguration.ts'
import { parseMinutes, sessionMinutesKey, sessionTotalMinutesKey } from '../components/speech/defenseTime.ts'

export type RepeatDraft = {
  mode: PracticeMode
  resumeId: string
  materialIds: string[]
  missingMaterialCount: number
  config: BackendInterviewConfig
}

/** Never substitute a different resume when the source resume is missing. */
export function repeatDraft(
  session: InterviewSession,
  resumes: ReadonlyArray<{ id: string }>,
  materials: ReadonlyArray<{ id: string }>,
): RepeatDraft {
  if (session.status !== 'completed') throw new Error('只有已结束的答辩才能沿用配置再练。')
  const mode = session.mode === 'defense' ? 'defense' : 'interview'
  if (mode === 'interview' && !resumes.some((item) => item.id === session.resume_id)) {
    throw new Error('原答辩使用的简历已不存在。请返回普通配置页重新选择简历。')
  }
  if (!validPreferences({ config: session.config, timing: { questionMinutes: '2', totalMinutes: '0' } })) {
    throw new Error('原答辩的配置不再受支持，请使用普通配置页重新设置。')
  }
  const available = new Set(materials.map((item) => item.id))
  const original = Array.isArray(session.material_ids) ? session.material_ids : []
  const selected = [...new Set(original.filter((id) => available.has(id)))].slice(0, 10)
  if (mode === 'defense' && selected.length === 0) {
    throw new Error('原答辩的材料已不可用。请先在“我的材料”中上传项目资料。')
  }
  return {
    mode,
    resumeId: mode === 'defense' ? '' : session.resume_id,
    materialIds: selected,
    missingMaterialCount: original.length - selected.length,
    config: { ...session.config },
  }
}

/** Session timers are browser-local; do not infer missing values or copy deadlines. */
export function repeatTiming(
  sessionId: string,
  storage: Pick<Storage, 'getItem'>,
): DefenseTiming | null {
  try {
    const question = storage.getItem(sessionMinutesKey(sessionId))
    const total = storage.getItem(sessionTotalMinutesKey(sessionId))
    if (question === null || total === null || parseMinutes(question) === null || parseMinutes(total) === null) return null
    return { questionMinutes: String(parseMinutes(question)), totalMinutes: String(parseMinutes(total)) }
  } catch { return null }
}
