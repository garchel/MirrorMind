import { useEffect, useState, type ReactNode } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, Square, X } from 'lucide-react'
import logoUrl from '../../assets/logo.svg'
import './TitleBar.css'

/** Marca do app (logo + nome). No workspace ela e renderizada no topo da
 * rail (acima da barra de ferramentas); nos demais shells, dentro da barra. */
export function TitleBarBrand() {
  return (
    <div className="app-titlebar-brand" data-tauri-drag-region>
      <img className="app-titlebar-logo" src={logoUrl} alt="" draggable={false} />
      <span className="app-titlebar-name">MirrorMind</span>
    </div>
  )
}

/** Barra de titulo do app (janela sem decoracoes nativas no Tauri). Ocupa a
 * linha do topo da janela, permite arrastar a janela pelo `data-tauri-drag-region`
 * e expoe os controles de janela (minimizar, maximizar/restaurar, fechar)
 * com a identidade visual do app. Fora do runtime Tauri (ex.: URL do Vite no
 * navegador) os controles ficam inertes sem derrubar a aplicacao. */
export function TitleBar({ children }: { children?: ReactNode }) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    try {
      const appWindow = getCurrentWindow()
      void appWindow.isMaximized()
        .then((value) => setIsMaximized(value))
        .catch(() => undefined)
      void appWindow.onResized(() => {
        void appWindow.isMaximized()
          .then((value) => setIsMaximized(value))
          .catch(() => undefined)
      })
        .then((stop) => { unlisten = stop })
        .catch(() => undefined)
    } catch {
      // Fora do runtime Tauri: sem controles nativos de janela.
    }
    return () => unlisten?.()
  }, [])

  function windowOrNull() {
    try {
      return getCurrentWindow()
    } catch {
      return null
    }
  }

  function minimize() {
    const appWindow = windowOrNull()
    if (appWindow) void appWindow.minimize()
  }

  function toggleMaximize() {
    const appWindow = windowOrNull()
    if (appWindow) void appWindow.toggleMaximize()
  }

  function close() {
    const appWindow = windowOrNull()
    if (appWindow) void appWindow.close()
  }

  return (
    <header className="app-titlebar" data-tauri-drag-region>
      <TitleBarBrand />
      {children ? <div className="app-titlebar-tabs" data-tauri-drag-region>{children}</div> : null}
      <div className="app-titlebar-controls">
        <button
          type="button"
          className="app-titlebar-control"
          onClick={minimize}
          aria-label="Minimizar janela"
          title="Minimizar"
        >
          <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="app-titlebar-control"
          onClick={toggleMaximize}
          aria-label={isMaximized ? 'Restaurar janela' : 'Maximizar janela'}
          title={isMaximized ? 'Restaurar' : 'Maximizar'}
        >
          {isMaximized
            ? <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
            : <Square size={12} strokeWidth={1.5} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="app-titlebar-control app-titlebar-control--close"
          onClick={close}
          aria-label="Fechar janela"
          title="Fechar"
        >
          <X size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
