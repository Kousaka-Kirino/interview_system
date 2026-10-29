import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent } from 'react'
import './authGate.css'

type Account = { username: string; must_change_password: boolean; registration_enabled: boolean }
type Mode = 'checking' | 'login' | 'register' | 'change' | 'ready' | 'offline'
type Profile = { user_id: string; username: string; display_name: string; email: string; email_verified: boolean }

async function api(path: string, payload?: Record<string, string>): Promise<Account | { ok: boolean }> {
  const response = await fetch(`/api/auth/${path}`, {
    method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  })
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`
    try { const body = await response.json() as { detail?: string }; if (typeof body.detail === 'string') message = body.detail }
    catch { /* keep HTTP error */ }
    throw new Error(message)
  }
  return await response.json() as Account | { ok: boolean }
}
async function profileApi<T>(method: 'GET' | 'PATCH' | 'POST', path: string, payload?: Record<string, string>): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  })
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`
    try { const body = await response.json() as { detail?: string }; if (typeof body.detail === 'string') message = body.detail }
    catch { /* keep status error */ }
    throw new Error(message)
  }
  return await response.json() as T
}
function clearSavedSession() {
  try { window.localStorage.removeItem('interview_system:last_session_id') } catch { /* restricted browser */ }
}

export default function AuthGate() {
  const [mode, setMode] = useState<Mode>('checking')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerConfirm, setRegisterConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [nickname, setNickname] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [profilePassword, setProfilePassword] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null)

  async function check() {
    setError(''); setMode('checking')
    try {
      const result = await api('me') as Account
      setUsername(result.username)
      setMode(result.must_change_password ? 'change' : 'ready')
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : '无法连接服务。'
      if (msg.includes('401') || msg.includes('尚未登录')) setMode('login')
      else { setError(msg); setMode('offline') }
    }
  }
  useEffect(() => { void check() }, [])
  // Notify active pages when a user logs in, signs out or changes accounts.
  // The event carries no profile details; each page verifies the current user with the server.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('interview-auth-change', { detail: { ready: mode === 'ready' } }))
  }, [mode])
  useEffect(() => {
    if (mode !== 'ready') return
    const timer = window.setInterval(async () => {
      try {
        const account = await api('me') as Account
        if (account.must_change_password) setMode('change')
      } catch {
        setError('登录状态已过期或后端连接中断，请重新登录。')
        setMode('login')
      }
    }, 60000)
    return () => window.clearInterval(timer)
  }, [mode])

  // Keep account controls in the navigation flow so they do not obscure other links.
  useEffect(() => {
    if (mode !== 'ready') {
      setNavSlot(null)
      return
    }
    const slot = document.createElement('span')
    slot.className = 'stage8d-nav-account-slot'
    slot.setAttribute('data-stage8d-nav-slot', 'true')
    let queued = false
    let active = true
    let pendingFrame: number | null = null

    const placeSlot = () => {
      if (!active) return
      const nav = document.querySelector<HTMLElement>('nav[aria-label="主导航"]')
        ?? document.querySelector<HTMLElement>('nav')
      if (!nav) return
      const items = Array.from(nav.querySelectorAll<HTMLElement>('a,button'))
      const start = items.find((item) => item.textContent?.trim() === '开始答辩')
        ?? items.find((item) => item.getAttribute('href') === '#configure')
      const parent = start?.parentElement
      if (parent && (slot.parentElement !== parent || slot.previousElementSibling !== start)) {
        start.insertAdjacentElement('afterend', slot)
      } else if (!start && slot.parentElement !== nav) {
        // Fail visibly but safely if the main navigation structure changes.
        nav.appendChild(slot)
      }
      if (slot.isConnected) setNavSlot((current) => current === slot ? current : slot)
    }

    placeSlot()
    const observer = new MutationObserver(() => {
      if (queued) return
      queued = true
      pendingFrame = window.requestAnimationFrame(() => { queued = false; pendingFrame = null; placeSlot() })
    })
    observer.observe(document.body, { subtree: true, childList: true })
    return () => {
      active = false
      observer.disconnect()
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame)
      slot.remove()
      setNavSlot((current) => current === slot ? null : current)
    }
  }, [mode])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      const result = await api('login', { username: username.trim(), password }) as Account
      setUsername(result.username)
      if (result.must_change_password) setMode('change')
      else window.location.reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败。') }
    finally { setBusy(false) }
  }

  async function registerLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const name = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,32}$/.test(name) || name === 'aslan') {
      setError('用户名需为 3～32 位小写英文字母、数字或下划线，且不能使用保留账号。'); return
    }
    if (registerPassword.length < 12 || new TextEncoder().encode(registerPassword).length > 128) {
      setError('密码至少 12 位且不能超过 128 字节。'); return
    }
    if (registerPassword !== registerConfirm) { setError('两次输入的密码不一致。'); return }
    setBusy(true); setError('')
    try {
      await api('register', { username: name, password: registerPassword })
      clearSavedSession()
      setPassword(''); setRegisterPassword(''); setRegisterConfirm('')
      window.location.hash = '#dashboard'
      window.location.reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '注册失败。') }
    finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    if (nextPassword.length < 12) { setError('新密码至少需要 12 位。'); return }
    if (nextPassword !== confirmation) { setError('两次输入的新密码不一致。'); return }
    setBusy(true); setError('')
    try {
      await api('change-password', { current_password: password, new_password: nextPassword })
      setPassword(''); setNextPassword(''); setConfirmation('')
      clearSavedSession(); window.location.hash = '#dashboard'; window.location.reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '密码更新失败。') }
    finally { setBusy(false) }
  }

  async function logout() {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api('logout', {})
      clearSavedSession(); window.location.hash = '#dashboard'; window.location.reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '退出失败，请重试。'); setBusy(false) }
  }

  async function openProfile() {
    if (busy) return
    setProfileError(''); setProfileMessage(''); setProfileOpen(true); setBusy(true)
    try {
      const item = await profileApi<Profile>('GET', 'profile')
      setProfile(item); setNickname(item.display_name); setContactEmail(item.email)
    } catch (cause) { setProfileError(cause instanceof Error ? cause.message : '加载个人资料失败。') }
    finally { setBusy(false) }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setProfileError(''); setProfileMessage('')
    try {
      const item = await profileApi<Profile>('PATCH', 'profile', { display_name: nickname.trim(), email: contactEmail.trim() })
      setProfile(item); setNickname(item.display_name); setContactEmail(item.email)
      setProfileMessage('个人资料已保存。')
    } catch (cause) { setProfileError(cause instanceof Error ? cause.message : '保存失败。') }
    finally { setBusy(false) }
  }

  async function saveProfilePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    if (!profilePassword) { setProfileError('新密码不能为空。'); return }
    setBusy(true); setProfileError(''); setProfileMessage('')
    try {
      await profileApi<{ ok: boolean }>('POST', 'profile/password', { new_password: profilePassword })
      setProfilePassword(''); setProfileMessage('密码已更新，其他登录会话已退出。')
    } catch (cause) { setProfileError(cause instanceof Error ? cause.message : '修改密码失败。') }
    finally { setBusy(false) }
  }

  if (mode === 'ready') return <>
    {navSlot && createPortal(
      <div className="stage8b-account-control" role="group" aria-label="当前账户">
        <span>账号：{username}</span>
        <button type="button" onClick={() => void openProfile()} disabled={busy}>个人资料</button>
        <button type="button" onClick={() => void logout()} disabled={busy}>{busy ? '请稍候…' : '退出登录'}</button>
        {error && <span className="stage8b-account-error" role="alert">{error}</span>}
      </div>,
      navSlot,
    )}
    {profileOpen && <div className="stage8c-profile-overlay" role="dialog" aria-modal="true" aria-label="个人信息设置">
      <div className="stage8c-profile-card">
        <div className="stage8c-profile-head">
          <div><p className="stage8b-eyebrow">ACCOUNT SETTINGS</p><h2>个人信息</h2><p>当前账号：{username} · 资料仅保存在本机</p></div>
          <button type="button" className="stage8c-profile-close" onClick={() => setProfileOpen(false)} aria-label="关闭设置">×</button>
        </div>
        {profileError && <p className="stage8b-message stage8b-error" role="alert">{profileError}</p>}
        {profileMessage && <p className="stage8c-profile-success" role="status">{profileMessage}</p>}
        {profile && <form className="stage8b-fields" onSubmit={(event) => void saveProfile(event)}>
          <label htmlFor="stage8c-nickname">昵称</label>
          <input id="stage8c-nickname" value={nickname} maxLength={80} required onChange={(e) => setNickname(e.target.value)} />
          <label htmlFor="stage8c-email">联系邮箱（不验证，仅作为备注）</label>
          <input id="stage8c-email" value={contactEmail} maxLength={254} onChange={(e) => setContactEmail(e.target.value)} placeholder="选填" />
          <button type="submit" className="stage8b-primary" disabled={busy}>保存个人信息</button>
        </form>}
        <div className="stage8c-profile-divider" />
        <form className="stage8b-fields" onSubmit={(event) => void saveProfilePassword(event)}>
          <h3>修改登录密码</h3>
          <p className="stage8c-profile-note">修改密码后请妥善保存；当前不提供邮箱找回密码服务。</p>
          <label htmlFor="stage8c-new-password">新密码</label>
          <input id="stage8c-new-password" type="password" autoComplete="new-password" value={profilePassword} onChange={(e) => setProfilePassword(e.target.value)} required />
          <button type="submit" className="stage8b-primary" disabled={busy}>更新密码</button>
        </form>
      </div>
    </div>}
  </>

  return <div className="stage8b-overlay" role="dialog" aria-modal="true" aria-label="答辩训练账户认证">
    <div className="stage8b-auth-card">
      <div className="stage8b-brand-mark">D2</div>
      <p className="stage8b-eyebrow">DEFENSE TRAINING</p>
      <h1>AI 答辩训练系统</h1>
      <p className="stage8b-intro">登录或注册本机账号，管理自己的简历、答辩记录与复习资料。不同用户的数据分开保存。</p>
      {mode === 'checking' && <div className="stage8b-status" role="status">正在验证登录状态…</div>}
      {mode === 'offline' && <div className="stage8b-fields">
        <p className="stage8b-message stage8b-error" role="alert">{error || '无法连接账号服务。'}</p>
        <button className="stage8b-primary" type="button" onClick={() => void check()}>重新连接</button>
      </div>}
      {mode === 'login' && <form className="stage8b-fields" onSubmit={(event) => void signIn(event)}>
        <label htmlFor="stage8b-name">用户名</label>
        <input id="stage8b-name" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} maxLength={80} required />
        <label htmlFor="stage8b-password">密码</label>
        <input id="stage8b-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
        {error && <p className="stage8b-message stage8b-error" role="alert">{error}</p>}
        <button className="stage8b-primary" type="submit" disabled={busy}>{busy ? '验证中…' : '登录'}</button>
        <button className="stage11-mode-switch" type="button" disabled={busy} onClick={() => { setMode('register'); setUsername(''); setPassword(''); setError('') }}>没有账号？在本机注册</button>
        <p className="stage8b-hint">账号仅创建在本机，其他电脑无法直接登录本机账号。</p>
      </form>}
      {mode === 'register' && <form className="stage8b-fields" onSubmit={(event) => void registerLocal(event)}>
        <label htmlFor="stage11-username">新用户名（3～32 位英文字母、数字或下划线）</label>
        <input id="stage11-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} required />
        <label htmlFor="stage11-password">设置密码（至少 12 位）</label>
        <input id="stage11-password" type="password" autoComplete="new-password" value={registerPassword} onChange={event => setRegisterPassword(event.target.value)} minLength={12} required />
        <label htmlFor="stage11-confirm">确认密码</label>
        <input id="stage11-confirm" type="password" autoComplete="new-password" value={registerConfirm} onChange={event => setRegisterConfirm(event.target.value)} minLength={12} required />
        {error && <p className="stage8b-message stage8b-error" role="alert">{error}</p>}
        <button className="stage8b-primary" type="submit" disabled={busy}>{busy ? '创建账号中…' : '创建本地账号'}</button>
        <button className="stage11-mode-switch" type="button" disabled={busy} onClick={() => { setMode('login'); setUsername(''); setRegisterPassword(''); setRegisterConfirm(''); setError('') }}>已有账号？返回登录</button>
        <p className="stage8b-hint">新账号的简历、PPT、答辩记录与向量索引单独存放在本地；请妥善保管密码，当前没有邮箱找回功能。</p>
      </form>}
      {mode === 'change' && <form className="stage8b-fields" onSubmit={(event) => void changePassword(event)}>
        <p className="stage8b-message stage8b-warning">首次登录必须更换初始密码。新密码至少 12 位。</p>
        <label htmlFor="stage8b-old">当前密码</label>
        <input id="stage8b-old" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
        <label htmlFor="stage8b-new">新密码（至少 12 位）</label>
        <input id="stage8b-new" type="password" autoComplete="new-password" value={nextPassword} onChange={event => setNextPassword(event.target.value)} minLength={12} required />
        <label htmlFor="stage8b-confirm">确认新密码</label>
        <input id="stage8b-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={12} required />
        {error && <p className="stage8b-message stage8b-error" role="alert">{error}</p>}
        <button className="stage8b-primary" type="submit" disabled={busy}>{busy ? '保存中…' : '设置新密码并进入工作台'}</button>
      </form>}
      <p className="stage8b-footer">本机模式 · SQLite 账号 · 新用户独立资料空间</p>
    </div>
  </div>
}
