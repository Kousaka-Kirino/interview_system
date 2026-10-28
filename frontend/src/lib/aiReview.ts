import type { InterviewReport } from '../types/interview'

export interface ExampleAnswer { turn_id: number; answer: string; explanation: string }
export interface WeakPoint { turn_id: number; title: string; reason: string; dimension: string }

export function exampleAnswers(report: InterviewReport): ExampleAnswer[] {
  const raw = report.ai_analysis?.example_answers
  if (!Array.isArray(raw)) return []
  const ids = new Set(report.turns.map((turn) => turn.turn_id))
  return raw.filter((item): item is ExampleAnswer => !!item && typeof item === 'object' &&
    typeof item.turn_id === 'number' && ids.has(item.turn_id) &&
    typeof item.answer === 'string' && typeof item.explanation === 'string')
}

export function weakPoints(report: InterviewReport): WeakPoint[] {
  const raw = report.ai_analysis?.weak_points
  if (!Array.isArray(raw)) return []
  const ids = new Set(report.turns.map((turn) => turn.turn_id))
  return raw.filter((item): item is WeakPoint => !!item && typeof item === 'object' &&
    typeof item.turn_id === 'number' && ids.has(item.turn_id) &&
    typeof item.title === 'string' && typeof item.reason === 'string' && typeof item.dimension === 'string')
}

export function reviewMarkdown(report: InterviewReport): string {
  const answers = new Map(exampleAnswers(report).map((item) => [item.turn_id, item]))
  const lines = [
    '# AI 答辩复盘',
    '',
    `会话 ID：${report.session_id}`,
    `平均分：${report.average_score === null ? '暂无评分' : report.average_score.toFixed(1)}`,
    '',
    '## AI 总结（仅供练习，不代表真实能力认证）',
    '',
    report.ai_analysis?.summary && typeof report.ai_analysis.summary === 'string' ? report.ai_analysis.summary : '尚未生成 AI 复盘',
    '',
    '## 逐题复盘及示范回答',
  ]
  for (const turn of report.turns) {
    lines.push('', `### 第 ${turn.question_number} 题${turn.followup_number ? ` · 追问 ${turn.followup_number}` : ''}`, '',
      `**题目：** ${turn.question}`, '', `**你的回答：** ${turn.answer}`, '',
      `**评分：** ${turn.score === null ? '未评分' : turn.score.toFixed(1)}`, '',
      `**反馈：** ${turn.feedback ?? '无'}`, '')
    const example = answers.get(turn.turn_id)
    if (example) lines.push('**AI 参考回答（需核实事实）：**', '', example.answer, '', `**讲解：** ${example.explanation}`, '')
  }
  lines.push('', '## 自动归纳的薄弱点', '')
  for (const item of weakPoints(report)) lines.push(`- **${item.title}**（${item.dimension}）：${item.reason}`)
  lines.push('', '> AI 示范回答可能不准确；涉及个人经历、数据或实验结果请自行核实。', '')
  return lines.join('\n')
}
