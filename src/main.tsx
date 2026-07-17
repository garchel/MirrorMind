import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function startApp() {
  if (import.meta.env.MODE === 'e2e') {
    await import('@wdio/tauri-plugin')
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void startApp()
