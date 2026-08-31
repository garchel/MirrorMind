import { useEffect } from 'react'

/**
 * Pilha global de handlers de Escape (fechar o dialog do TOPO primeiro).
 *
 * Cada dialog/modal do app registra seu fechamento quando esta aberto; o
 * listener global dispara apenas o topo da pilha — o dialog mais recente.
 * Assim, um popover aberto POR CIMA de um modal fecha so o popover no Escape,
 * e um segundo Escape fecha o modal por baixo (comportamento topmost esperado
 * de apps desktop). Dialogs que ja tratam Escape manualmente (command palette,
 * popover de formatacao do editor) nao precisam se registrar.
 */

type EscapeHandler = () => void

const escapeStack: EscapeHandler[] = []

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const close = escapeStack[escapeStack.length - 1]
  if (close) {
    event.stopPropagation()
    close()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleKeyDown, true)
}

/** Registra `close` enquanto `isOpen` for true. Devolve nada; o efeito
 * desregistra ao fechar/desmontar (a ordem da pilha e mantida). */
export function useEscapeToClose(isOpen: boolean, close: EscapeHandler) {
  useEffect(() => {
    if (!isOpen) return
    escapeStack.push(close)
    return () => {
      const index = escapeStack.indexOf(close)
      if (index !== -1) escapeStack.splice(index, 1)
    }
  }, [isOpen, close])
}
