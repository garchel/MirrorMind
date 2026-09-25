import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nudgeCursor } from './nudgeCursor'

describe('nudgeCursor (recuperacao do cursor branco do WebView2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.head.querySelectorAll('style').forEach((style) => {
      if (style.textContent?.includes('cursor: auto')) style.remove()
    })
  })

  it('forca cursor auto e remove o estilo apos o tempo', () => {
    nudgeCursor(40)
    const injected = [...document.head.querySelectorAll('style')].find((style) =>
      style.textContent?.includes('cursor: auto'),
    )
    expect(injected).toBeDefined()

    vi.advanceTimersByTime(39)
    expect(injected?.isConnected).toBe(true)
    vi.advanceTimersByTime(1)
    expect(injected?.isConnected).toBe(false)
  })

  it('usa 40ms por padrao', () => {
    nudgeCursor()
    const injected = [...document.head.querySelectorAll('style')].find((style) =>
      style.textContent?.includes('cursor: auto'),
    )!
    vi.advanceTimersByTime(40)
    expect(injected.isConnected).toBe(false)
  })
})
