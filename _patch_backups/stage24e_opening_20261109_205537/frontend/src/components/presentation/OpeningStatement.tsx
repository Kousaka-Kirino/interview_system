import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square, Timer } from 'lucide-react'
import { analyzeOpening, getOpening } from '../../lib/presentation'
import type { OpeningAnalysis } from '../../lib/presentation'

export default function OpeningStatement({ sessionId, ready, onUpdated }: { sessionId: string; ready: boolean; onUpdated: () => void }) {
  const [text, setText] = useState('')
  const [analysis, setAnalysis] = useState<OpeningAnalysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cutoffRef = useRef<number | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setAnalysis(null)
    void getOpening(sessionId, controller.signal).then((data) => { if (!controller.signal.aborted) setAnalysis(data.analysis) })
      .catch(() => { /* Session page is authoritative; GET may be temporarily unavailable. */ })
    return () => { controller.abort(); recorderRef.current?.stop?.(); streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [sessionId])
  useEffect(() => {
    if (started === null) return
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500)
    return () => window.clearInterval(id)
  }, [started])
  function startPractice() { setStarted(Date.now()); setSeconds(0); setError('') }
  function stopRecording() {
    if (cutoffRef.current !== null) window.clearTimeout(cutoffRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }
  async function startRecording() {
    if (recording || transcribing || !navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) {
      setError('当前浏览器不可录音；可以直接粘贴陈述文字。'); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorderRef.current = recorder
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        setRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (!chunks.length) return
        void (async () => {
          setTranscribing(true); setError('')
          try {
            const ext = (recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm'
            const data = new FormData()
            data.append('file', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), `statement.${ext}`)
            const response = await fetch('/api/speech/transcribe', { method: 'POST', body: data, credentials: 'same-origin' })
            if (!response.ok) {
              const detail = await response.json().catch(() => ({})) as { detail?: string }
              throw new Error(detail.detail || `转写失败 HTTP ${response.status}`)
            }
            const result = await response.json() as { text?: string }
            if (!result.text?.trim()) throw new Error('此段没有识别到语音，请检查麦克风输入音量')
            setText((existing) => [existing.trim(), result.text?.trim()].filter(Boolean).join('\n'))
          } catch (e) { setError(`本地语音转写未成功：${e instanceof Error ? e.message : '未知异常'}。仍可手动填写陈述文字。`) }
          finally { setTranscribing(false) }
        })()
      }
      recorder.start()
      setRecording(true)
      // Existing local Whisper endpoint accepts at most 125 seconds.
      cutoffRef.current = window.setTimeout(() => stopRecording(), 105_000)
    } catch (e) { setError(`无法开始麦克风录音：${e instanceof Error ? e.message : '未知异常'}`) }
  }
  async function submit() {
    if (busy || !ready || text.trim().length < 30) return
    setBusy(true); setError('')
    try {
      const result = await analyzeOpening(sessionId, text.trim())
      setAnalysis(result); onUpdated()
    } catch (e) { setError(e instanceof Error ? e.message : '陈述分析失败') }
    finally { setBusy(false) }
  }
  const display = Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0')
  if (!ready && !analysis) return null
  return <section className="mt-6 rounded-2xl border border-white/10 bg-slate-900 p-5 sm:p-6" aria-label="自我陈述模拟">
    <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><Timer className="size-5 text-cyan-300" /> 5–8 分钟自我陈述模拟</h2>
    <p className="mb-4 text-sm leading-6 text-slate-400">可以边看上方 PPT 边口述。点击计时练习；每段录音最多约 105 秒，由本地 Whisper 转成文字后追加。麦克风不可用时可直接输入或粘贴文字，AI 仅在点击分析后调用。</p>
    {analysis ? <div className="space-y-2 rounded-xl bg-slate-950/60 p-4 text-sm leading-7">
      <p className="text-emerald-300">陈述分析已保存，第一道未答题目已更新为针对陈述的追问。</p>
      <p><strong>总体反馈：</strong>{analysis.summary}</p>
      <p><strong>表达优势：</strong>{analysis.strengths.join('；')}</p>
      <p><strong>改进点：</strong>{analysis.improvements.join('；')}</p>
      <p><strong>评委追问：</strong>{analysis.followup_question}</p>
    </div> : <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={startPractice} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200">{started === null ? '开始 5–8 分钟计时' : '重新计时'}</button>
        <span role="status" className="font-mono text-xl">{display}</span>
        <span className="text-xs text-slate-400">建议 05:00–08:00；计时不自动提交</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" disabled={transcribing || busy} onClick={() => recording ? stopRecording() : void startRecording()} className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">
          {recording ? <Square className="size-4" /> : <Mic className="size-4" />}{recording ? '停止当前片段' : '录一段并转文字（本地）'}
        </button>
        {transcribing && <span className="flex items-center gap-2 text-sm text-amber-300"><LoaderCircle className="size-4 animate-spin" />本机转写中…</span>}
      </div>
      <label htmlFor="opening-statement-text" className="text-sm text-slate-300">自我陈述文字（至少 30 字，最多 10000 字）</label>
      <textarea id="opening-statement-text" value={text} rows={6} maxLength={10000} onChange={(e) => setText(e.target.value)} placeholder="简述研究背景、方法、实验结果、创新点及不足…" className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-slate-950 p-3 text-sm leading-7" />
      <button type="button" onClick={() => void submit()} disabled={busy || recording || transcribing || text.trim().length < 30} className="mt-3 rounded-lg bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 disabled:opacity-40">{busy ? 'AI 分析中…' : '完成陈述并生成追问（会产生 AI 费用）'}</button>
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
  </section>
}
