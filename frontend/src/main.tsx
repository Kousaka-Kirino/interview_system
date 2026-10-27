import DefenseVoiceTimer from './components/speech/DefenseVoiceTimer'
import AuthGate from './components/auth/AuthGate'
import ReviewWorkspace from './components/review/ReviewWorkspace'
import RuntimeGuard from './components/RuntimeGuard'
import SystemHealthPanel from './components/SystemHealthPanel'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeGuard><App /><AuthGate /></RuntimeGuard><SystemHealthPanel /><DefenseVoiceTimer /><ReviewWorkspace />
  </StrictMode>,
)
