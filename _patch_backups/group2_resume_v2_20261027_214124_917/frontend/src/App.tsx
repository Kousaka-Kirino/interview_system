import { useEffect, useState } from 'react'
import {
  BookOpenText,
  FileText,
  Files,
  LayoutDashboard,
  Play,
} from 'lucide-react'
import DashboardPage from './pages/DashboardPage'
import MaterialsPage from './pages/MaterialsPage'
import ResumesPage from './pages/ResumesPage'
import InterviewConfigPage from './pages/InterviewConfigPage'
import InterviewSessionPage from './pages/InterviewSessionPage'
import InterviewReportPage from './pages/InterviewReportPage'

type Tab = 'dashboard' | 'resumes' | 'materials' | 'configure' | 'session' | 'report'

type Route = { tab: Tab; sessionId?: string }

function readRoute(): Route {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  if (hash === 'resumes' || hash === 'materials') return { tab: hash }
  if (hash === 'configure' || hash === 'interview') return { tab: 'configure' }
  if (hash.startsWith('session/') && hash.slice('session/'.length)) {
    return { tab: 'session', sessionId: hash.slice('session/'.length) }
  }
  if (hash.startsWith('report/') && hash.slice('report/'.length)) {
    return { tab: 'report', sessionId: hash.slice('report/'.length) }
  }
  return { tab: 'dashboard' }
}

const navigation = [
  { tab: 'dashboard', hash: '#dashboard', label: '数据概览', icon: LayoutDashboard },
  { tab: 'resumes', hash: '#resumes', label: '简历管理', icon: FileText },
  { tab: 'materials', hash: '#materials', label: '我的材料', icon: Files },
  { tab: 'configure', hash: '#configure', label: '开始答辩', icon: Play },
] as const

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    function update() {
      setRoute(readRoute())
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <nav aria-label="主导航" className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BookOpenText className="size-5 text-cyan-300" /> AI 答辩陪练
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {navigation.map(({ tab, hash, label, icon: Icon }) => (
              <a
                key={tab}
                href={hash}
                aria-current={route.tab === tab ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${route.tab === tab ? 'bg-cyan-400/15 font-semibold text-cyan-200' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}
              >
                <Icon className="size-4" aria-hidden="true" /> {label}
              </a>
            ))}
          </div>
        </div>
      </nav>
      {route.tab === 'dashboard' && <DashboardPage />}
      {route.tab === 'resumes' && <ResumesPage />}
      {route.tab === 'materials' && <MaterialsPage />}
      {route.tab === 'configure' && <InterviewConfigPage />}
      {route.tab === 'session' && route.sessionId && <InterviewSessionPage key={route.sessionId} sessionId={route.sessionId} />}
      {route.tab === 'report' && route.sessionId && <InterviewReportPage key={route.sessionId} sessionId={route.sessionId} />}
    </div>
  )
}
