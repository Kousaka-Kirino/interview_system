// stage9:voice - separate question-timer/voice panel (additive)
import DefenseVoiceTimer from './components/speech/DefenseVoiceTimer'
// stage8b:auth - login UI overlay
import AuthGate from './components/auth/AuthGate'
// stage7:workspace - additive dashboard and session notes
import ReviewWorkspace from './components/review/ReviewWorkspace'
// stage5e:runtime - additive entrypoint integration
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
