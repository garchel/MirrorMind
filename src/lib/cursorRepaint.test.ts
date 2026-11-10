import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCursorRepaint, shouldRepaintCursor } from './cursorRepaint'

/** Contador global que o proprio nudgeCursor incrementa. */
function nudgeCount(): number {
  return (window as unknown as { __mirrormindNudgeCount?: number }).__mirrormindNudgeCount ?? 0
}

function styled(cursor: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cursor = cursor
  document.body.appendChild(el)
  return el
}

function moveOver(el: Element) {
  el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
}

describe('shouldRepaintCursor', () => {
  it('dispara ao entrar e sair do I-beam', () => {
    expect(shouldRepaintCursor('auto', 'text')).toBe(true)
    expect(shouldRepaintCursor('text', 'auto')).toBe(true)
  })

  it('nao dispara em transicoes fora do I-beam nem na primeira leitura', () => {
    expect(shouldRepaintCursor(null, 'text')).toBe(false)
    expect(shouldRepaintCursor('auto', 'pointer')).toBe(false)
    expect(shouldRepaintCursor('text', 'text')).toBe(false)
  })
})

describe('installCursorRepaint', () => {
  let cleanup: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    ;(window as unknown as { __mirrormindNudgeCount?: number }).__mirrormindNudgeCount = 0
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.useRealTimers()
    document.head.querySelectorAll('style').forEach((style) => {
      if (style.textContent?.includes('cursor: auto')) style.remove()
    })
    document.body.innerHTML = ''
  })

  it('reemite o cursor ao entrar e sair do editor (I-beam)', () => {
    cleanup = installCursorRepaint()
    const texto = styled('text')
    const common = styled('auto')

    moveOver(common)
    expect(nudgeCount()).toBe(0)

    vi.advanceTimersByTime(100)
    moveOver(texto)
    expect(nudgeCount()).toBe(1)

    vi.advanceTimersByTime(150)
    moveOver(common)
    expect(nudgeCount()).toBe(2)
  })

  it('nao reemite a cada pixel: le no maximo a cada 80ms', () => {
    cleanup = installCursorRepaint()
    const texto = styled('text')
    const common = styled('auto')

    moveOver(common)
    vi.advanceTimersByTime(100)
    moveOver(texto)
    expect(nudgeCount()).toBe(1)

    // Movimento continuo dentro do I-beam nao reemite.
    for (let i = 0; i < 5; i++) moveOver(texto)
    expect(nudgeCount()).toBe(1)
  })

  it('reemite quando um portal e anexado ao body sob o ponteiro', async () => {
    cleanup = installCursorRepaint()
    const portal = document.createElement('div')
    document.body.appendChild(portal)
    await Promise.resolve()
    expect(nudgeCount()).toBe(1)
  })

  it('a limpeza remove os vigias', () => {
    const local = installCursorRepaint()
    local()
    const texto = styled('text')
    const common = styled('auto')
    moveOver(common)
    vi.advanceTimersByTime(100)
    moveOver(texto)
    expect(nudgeCount()).toBe(0)
  })
})
