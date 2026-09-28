import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEscapeToClose } from './escapeStack'

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

describe('useEscapeToClose', () => {
  it('fecha o topo primeiro (LIFO) e ignora outras teclas', () => {
    const calls: string[] = []
    renderHook(() => useEscapeToClose(true, () => void calls.push('primeiro')))
    const segundo = renderHook(() => useEscapeToClose(true, () => void calls.push('segundo')))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(calls).toEqual([])
    pressEscape()
    expect(calls).toEqual(['segundo'])
    // O topo segue no topo enquanto aberto: sair dele revela o de baixo.
    segundo.unmount()
    pressEscape()
    expect(calls).toEqual(['segundo', 'primeiro'])
  })

  it('fechado nao reage nem vaza apos desmontar', () => {
    const close = vi.fn()
    const { unmount } = renderHook(() => useEscapeToClose(false, close))
    pressEscape()
    expect(close).not.toHaveBeenCalled()
    const active = renderHook(() => useEscapeToClose(true, close))
    active.unmount()
    pressEscape()
    expect(close).not.toHaveBeenCalled()
    unmount()
  })
})
