import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/** Keep a recoverable UI when a React page crashes during rendering. */
export default class RuntimeGuard extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Details stay in the local developer console, never uploaded.
    console.error('[interview-system] 页面渲染异常', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
          <section role="alert" className="w-full max-w-lg rounded-2xl border border-amber-400/25 bg-slate-900 p-8 shadow-2xl">
            <h1 className="text-xl font-semibold">页面出现异常</h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              可以尝试重新加载页面，或返回仪表盘。答辩数据保存在后端，
              此提示本身不会删除服务器中的会话。
            </p>
            <p className="mt-2 text-xs leading-6 text-amber-200">
              如果刚提交过回答，请先通过右下角“运行状态”检查会话是否已保存，避免重复提交。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false })}
                className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
              >
                重试页面
              </button>
              <button
                type="button"
                onClick={() => { window.location.hash = '#dashboard'; window.location.reload() }}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10"
              >
                返回仪表盘
              </button>
            </div>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
