import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RootErrorBoundary } from './components/RootErrorBoundary'
import { ReviewAiSettingsProvider } from './features/review/ReviewAiSettingsContext'

async function startApp() {
  if (import.meta.env.MODE === 'e2e') {
    await import('@wdio/tauri-plugin')
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RootErrorBoundary>
        <ReviewAiSettingsProvider>
          <App />
        </ReviewAiSettingsProvider>
      </RootErrorBoundary>
    </StrictMode>,
  )
}

void startApp()
