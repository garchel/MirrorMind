import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ReviewAiSettingsProvider } from './features/review/ReviewAiSettingsContext'

async function startApp() {
  if (import.meta.env.MODE === 'e2e') {
    await import('@wdio/tauri-plugin')
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ReviewAiSettingsProvider>
        <App />
      </ReviewAiSettingsProvider>
    </StrictMode>,
  )
}

void startApp()
