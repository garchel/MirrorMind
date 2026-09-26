import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatMarkdownSelection, type MarkdownFormat } from '../../lib/markdown'
import { nextPopoverShiftX } from '../../lib/selectionPopover'
import type { MarkdownEditorSession } from '../../components/MarkdownCodeEditor'

export type SelectionPopoverState = {
  flip: boolean
  shiftX: number
  x: number
  y: number
}

export type FormatToolbarEditorAccess = {
  getSelection: () => { value: string; selectionStart: number; selectionEnd: number } | null
  getSelectionRect: () => { bottom: number; left: number; right: number; top: number } | null
  editorContent: () => HTMLElement | null
}

export type UseFormatToolbarDeps = {
  activeEditorSession: MarkdownEditorSession | null
  hasActiveNote: boolean
  editorMode: 'mixed' | 'edit' | 'read'
  setDraftContent: React.Dispatch<React.SetStateAction<string>>
  focusEditor: () => void
  editor: FormatToolbarEditorAccess
}

/** Toolbar de formatacao da selecao (extraida do App): popover ancorado a
 * selecao com submenu de cores para cima (marca-texto e post-it). */
export function useFormatToolbar(deps: UseFormatToolbarDeps) {
  const { activeEditorSession, hasActiveNote, editorMode, setDraftContent } = deps
  // Canal ref para acesso ao editor dentro de efeitos (sempre fresco, sem
  // re-disparar — mesmo padrao dos handlers do App).
  const editorRef = useRef(deps.editor)
  editorRef.current = deps.editor
  const focusEditorRef = useRef(deps.focusEditor)
  focusEditorRef.current = deps.focusEditor

  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null)
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null)
  const [formatSubmenu, setFormatSubmenu] = useState<null | 'highlight' | 'postit'>(null)
  // Sem selecao, sem submenu: o popover desmonta e o estado nao vaza para a
  // proxima abertura.
  useEffect(() => {
    if (!selectionPopover) setFormatSubmenu(null)
  }, [selectionPopover])
  /** Fechamento com tolerancia do submenu de cores: atravessar o vao entre o
   * botao e o menu (ou um movimento diagonal rapido) nao pode fechar na
   * hora — agenda e cancela ao reentrar. */
  const formatSubmenuCloseTimerRef = useRef<number | null>(null)
  function cancelFormatSubmenuClose() {
    if (formatSubmenuCloseTimerRef.current !== null) {
      window.clearTimeout(formatSubmenuCloseTimerRef.current)
      formatSubmenuCloseTimerRef.current = null
    }
  }
  function openFormatSubmenu(which: 'highlight' | 'postit') {
    cancelFormatSubmenuClose()
    setFormatSubmenu(which)
  }
  function scheduleFormatSubmenuClose(which: 'highlight' | 'postit') {
    cancelFormatSubmenuClose()
    formatSubmenuCloseTimerRef.current = window.setTimeout(() => {
      formatSubmenuCloseTimerRef.current = null
      setFormatSubmenu((open) => open === which ? null : open)
    }, 180)
  }

  // Popover de formatacao: aparece nos modos com editor quando ha uma selecao
  // nao-colapsada, ancorado na linha do cursor inicial da selecao. Some quando
  // a selecao colapsa ou o texto sai da area visivel; o blur e o Escape sao
  // tratados abaixo (onBlur dos editores e listener global de teclado).
  useEffect(() => {
    if (editorMode === 'read' || !hasActiveNote) {
      setSelectionPopover(null)
      return
    }
    const session = activeEditorSession
    if (!session || session.selectionStart === session.selectionEnd) {
      setSelectionPopover(null)
      return
    }
    const container = editorRef.current.editorContent()
    if (!container) {
      setSelectionPopover(null)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const rect = editorRef.current.getSelectionRect()
    if (!rect) {
      // Sem geometria (ex.: testes/jsdom ou linha fora da area visivel): ancora
      // no topo central do painel para nao perder a acao por falta de layout.
      setSelectionPopover({ flip: false, shiftX: 0, x: Math.max(60, containerRect.width / 2), y: 12 })
      return
    }
    const centerX = (rect.left + rect.right) / 2 - containerRect.left
    const above = rect.top - containerRect.top - 8
    const flip = above < 0
    setSelectionPopover({
      flip,
      shiftX: 0,
      x: Math.min(Math.max(centerX, 60), Math.max(60, containerRect.width - 60)),
      y: flip ? rect.bottom - containerRect.top + 8 : above,
    })
  }, [activeEditorSession, hasActiveNote, editorMode])

  // Contencao horizontal: como o popover e centralizado no ponto de ancoragem
  // (translateX(-50%)), metade da sua largura pode estourar o painel quando a
  // selecao esta perto da borda (ex.: inicio da linha) e ficar cortada pelo
  // explorador. Mede o popover ja renderizado e desloca-o (incrementalmente,
  // via nextPopoverShiftX) para dentro dos limites do mesmo conteiner da busca
  // Ctrl+F (.editor-content) — sem oscilar, pois o delta vira 0 ao entrar.
  useLayoutEffect(() => {
    if (!selectionPopover) return
    const popover = selectionPopoverRef.current
    const container = editorRef.current.editorContent()
    if (!popover || !container) return
    const popoverRect = popover.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const shiftX = nextPopoverShiftX(
      popoverRect.left,
      popoverRect.right,
      containerRect.left,
      containerRect.right,
      selectionPopover.shiftX,
    )
    if (shiftX !== selectionPopover.shiftX) {
      setSelectionPopover((current) => (current ? { ...current, shiftX } : current))
    }
  }, [selectionPopover])

  // Escape fecha o popover de formatacao sem roubar o foco do editor.
  useEffect(() => {
    if (!selectionPopover) return
    const handlePopoverKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectionPopover(null)
        focusEditorRef.current()
      }
    }
    window.addEventListener('keydown', handlePopoverKeyDown)
    return () => window.removeEventListener('keydown', handlePopoverKeyDown)
  }, [selectionPopover])

  function applyMarkdownFormat(format: MarkdownFormat) {
    const selection = editorMode === 'read' ? null : editorRef.current.getSelection()
    if (!selection) return
    setDraftContent((currentContent) => formatMarkdownSelection(currentContent, selection.selectionStart, selection.selectionEnd, format))
    requestAnimationFrame(() => focusEditorRef.current())
  }

  /** Esconde a toolbar (blur dos editores). */
  function hideSelectionPopover() {
    setSelectionPopover(null)
  }

  return {
    selectionPopover,
    selectionPopoverRef,
    formatSubmenu,
    setFormatSubmenu,
    openFormatSubmenu,
    scheduleFormatSubmenuClose,
    cancelFormatSubmenuClose,
    applyMarkdownFormat,
    hideSelectionPopover,
  }
}
