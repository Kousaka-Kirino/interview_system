export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function validateDocument(file: File | null, maxMiB: number): string | null {
  if (!file) return '请先选择一个 PDF 或 DOCX 文件。'
  if (!/\.(pdf|docx)$/i.test(file.name)) return '只支持 .pdf 或 .docx 文件。'
  if (file.size === 0) return '文件为空，无法上传。'
  if (file.size > maxMiB * 1024 * 1024) return `文件不能超过 ${maxMiB} MiB。`
  return null
}

export function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : '操作失败，请稍后重试。'
}
