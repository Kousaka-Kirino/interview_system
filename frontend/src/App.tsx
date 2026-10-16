import { useEffect, useState } from 'react'
import { BookOpenText, FileText, Files, LayoutDashboard } from 'lucide-react'
import DashboardPage from './pages/DashboardPage'
import MaterialsPage from './pages/MaterialsPage'
import ResumesPage from './pages/ResumesPage'

type Tab = 'dashboard' | 'resumes' | 'materials'

function getTab(): Tab {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'resumes' || hash === 'materials') return hash
  return 'dashboard'
}

const navigation = [
  { tab: 'dashboard', label: '数据概览', icon: LayoutDashboard },
  { tab: 'resumes', label: '简历管理', icon: FileText },
  { tab: 'materials', label: '补充资料', icon: Files },
] as const

export default function App() {
  const [tab, setTab] = useState<Tab>(getTab)

  useEffect(() => {
    const updateTab = () => setTab(getTab())
    window.addEventListener('hashchange', updateTab)
    return () => window.removeEventListener('hashchange', updateTab)
  }, [])

  return (
    <div className="min-h-screen bg-slate-950">
      <nav aria-label="主导航" className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BookOpenText className="size-5 text-cyan-300" /> AI 面试陪练
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {navigation.map(({ tab: item, label, icon: Icon }) => (
              <a
                key={item}
                href={item === 'dashboard' ? '#dashboard' : `#${item}`}
                aria-current={tab === item ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                  tab === item
                    ? 'bg-cyan-400/15 font-semibold text-cyan-200'
                    : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />{label}
              </a>
            ))}
          </div>
        </div>
      </nav>
      {tab === 'dashboard' ? <DashboardPage /> : tab === 'resumes' ? <ResumesPage /> : <MaterialsPage />}
    </div>
  )
}
