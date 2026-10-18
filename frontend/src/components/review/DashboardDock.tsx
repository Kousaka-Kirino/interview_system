import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { History } from 'lucide-react'
import './dashboardDock.css'

/*
 * Stage 7B - Use the existing dashboard history slot; keep React-owned history
 * nodes in place and merely toggle their visibility. React still owns its list.
 * This is a conservative layout bridge because the dashboard's original
 * source may vary across the Stage 5A-5E installations.
 */
type Placement = {
  contentHost: HTMLDivElement
  tileHost: HTMLDivElement
  history: HTMLElement
  stats: HTMLElement
  previousDisplay: string
  scoreClass: string
}

const isOwned = (element: Element) => Boolean(element.closest('[data-stage7b-owned]'))

function findScoreGrid(root: HTMLElement): { grid: HTMLElement; scoreCard: HTMLElement } | null {
  const elements = Array.from(root.querySelectorAll('div, span, p, h2, h3, h4, strong, button'))
  const candidates = elements.filter(element => !isOwned(element) && /^\s*(历史平均分|历史均分|历史平均得分|平均得分)\s*$/.test(element.textContent?.trim() ?? ''))
  // The exact label normally appears on the smallest text node wrapper.
  candidates.sort((a, b) => (a.querySelectorAll('*').length - b.querySelectorAll('*').length))
  for (const element of candidates) {
    let descendant: HTMLElement | null = element as HTMLElement
    for (let i = 0; descendant && i < 7; i++, descendant = descendant.parentElement) {
      const grid = descendant.parentElement
      if (!grid || grid === root || isOwned(grid)) continue
      if (grid.children.length !== 4 && grid.children.length !== 5) continue
      const className = typeof grid.className === 'string' ? grid.className : ''
      const display = window.getComputedStyle(grid).display
      if (display !== 'grid' && display !== 'flex' && !/grid|flex/.test(className)) continue
      if (grid.children.length === 5 && !grid.querySelector('[data-stage7b-owned]')) continue
      return { grid, scoreCard: descendant }
    }
  }
  return null
}

const historyLabel = /(?:历史答辩|历史面试|最近答辩|最近面试|答辩历史|面试历史|历史记录|最近记录|最近答辩记录|最近面试记录)/

function findHistory(root: HTMLElement, stats: HTMLElement): HTMLElement | null {
  const heads = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))
  const matching = heads.filter(node => !isOwned(node) && historyLabel.test(node.textContent ?? '') && !/平均分|均分/.test(node.textContent ?? ''))
  for (const head of matching) {
    // Prefer the history panel's section/article rather than its heading row.
    let node: HTMLElement | null = head as HTMLElement
    let backup: HTMLElement | null = null
    for (let i = 0; node && i < 7; i++, node = node.parentElement) {
      if (node === root || node.tagName === 'MAIN' || node.contains(stats) || isOwned(node)) break
      if (node === head) continue
      const classes = typeof node.className === 'string' ? node.className : ''
      const isPanel = /^(SECTION|ARTICLE)$/.test(node.tagName) || /rounded|border|shadow|history|panel/.test(classes)
      if (isPanel && node.children.length >= 2) {
        backup = node
        if (/^(SECTION|ARTICLE)$/.test(node.tagName)) return node
      }
    }
    if (backup) return backup
    const wrap = head.parentElement?.parentElement
    if (wrap && wrap !== root && !wrap.contains(stats) && !isOwned(wrap)) return wrap
  }
  return null
}

function tryPlacement(root: HTMLElement): Placement | null {
  const score = findScoreGrid(root)
  if (!score) return null
  const history = findHistory(root, score.grid)
  if (!history?.parentElement || history.contains(score.grid)) return null

  const contentHost = document.createElement('div')
  contentHost.dataset.stage7bOwned = 'review'
  contentHost.id = 'stage7b-risk-at-history'
  contentHost.className = 'w-full'
  history.parentElement.insertBefore(contentHost, history)

  const tileHost = document.createElement('div')
  tileHost.dataset.stage7bOwned = 'tile'
  tileHost.id = 'stage7b-history-card-slot'
  tileHost.className = 'stage7b-tile-slot'
  score.grid.insertBefore(tileHost, score.scoreCard.nextSibling)
  score.grid.classList.add('stage7b-five-tile-grid')
  const previousDisplay = history.style.display
  history.style.display = 'none'
  return {
    contentHost, tileHost, history, stats: score.grid, previousDisplay,
    scoreClass: score.scoreCard.className ?? '',
  }
}

function removePlacement(p: Placement) {
  p.history.style.display = p.previousDisplay
  p.stats.classList.remove('stage7b-five-tile-grid')
  p.contentHost.remove()
  p.tileHost.remove()
}

export default function DashboardDock({ children }: { children: ReactNode }) {
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [view, setView] = useState<'review' | 'history'>('review')
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    let active = true
    let current: Placement | null = null
    let observer: MutationObserver | null = null
    let scheduled = 0
    const root = document.getElementById('root')
    if (!root) return

    const attach = () => {
      if (!active) return
      if (current && document.contains(current.tileHost) && document.contains(current.contentHost) && document.contains(current.history) && document.contains(current.stats)) return
      if (current) { removePlacement(current); current = null }
      current = tryPlacement(root)
      if (current) { setPlacement(current); setWaiting(false) }
      else { setPlacement(null); setWaiting(true) }
    }
    const requestAttach = () => {
      if (!scheduled) scheduled = window.setTimeout(() => { scheduled = 0; attach() }, 50)
    }
    attach()
    const delays = [180, 550, 1200]
    const timers = delays.map(delay => window.setTimeout(attach, delay))
    observer = new MutationObserver(requestAttach)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      active = false
      observer?.disconnect()
      window.clearTimeout(scheduled)
      timers.forEach(window.clearTimeout)
      if (current) removePlacement(current)
    }
  }, [])

  useEffect(() => {
    if (!placement) return
    placement.history.style.display = view === 'history' ? placement.previousDisplay : 'none'
    placement.contentHost.style.display = view === 'review' ? '' : 'none'
  }, [placement, view])

  const openHistory = () => setView(current => current === 'history' ? 'review' : 'history')
  return <>
    {placement && createPortal(
      <button type="button" aria-label={view === 'history' ? '返回雷达图与薄弱点' : '查看历史答辩记录'} aria-pressed={view === 'history'} onClick={openHistory}
        className={`${placement.scoreClass} stage7b-history-button ${view === 'history' ? 'stage7b-history-button-active' : ''}`}>
        <span className="stage7b-card-top"><span>历史答辩</span><History size={19} aria-hidden="true" /></span>
        <span className="stage7b-card-number">{view === 'history' ? '返回看板' : '查看记录'}</span>
        <span className="stage7b-card-hint">{view === 'history' ? '再次点击显示风险复习' : '点击显示原历史答辩列表'}</span>
      </button>, placement.tileHost,
    )}
    {placement && createPortal(
      view === 'history' ? null : children,
      placement.contentHost,
    )}
    {waiting && !placement && <p role="status" className="stage7b-placement-warning" data-stage7b-owned="warning">
      雷达图正在定位原“历史答辩”区域。如果此提示持续显示，说明现有仪表盘结构与布局适配规则不同，请提供 frontend/src/pages/DashboardPage.tsx 以便精确接入；原有历史列表不会被删除。
    </p>}
  </>
}
