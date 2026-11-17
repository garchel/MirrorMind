import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTypingPlaceholder } from './useTypingPlaceholder'

// O hook usa `window.matchMedia`; o jsdom nao implementa.
function comMovimentoNormal() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

function comMovimentoReduzido() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useTypingPlaceholder', () => {
  it('comeca com a primeira frase montada', () => {
    comMovimentoNormal()
    const { result } = renderHook(() => useTypingPlaceholder(['Buscar nota', 'Buscar tag'], { holdMs: 100, typeMs: 10, eraseMs: 5, pauseMs: 10 }))
    expect(result.current).toBe('Buscar nota')
  })

  it('apaga a primeira e escreve a segunda', () => {
    comMovimentoNormal()
    vi.useFakeTimers()
    const { result } = renderHook(() => useTypingPlaceholder(['Buscar nota', 'Buscar tag'], { holdMs: 100, typeMs: 10, eraseMs: 5, pauseMs: 10 }))

    // Segura 100ms e comeca a apagar (1 caractere por 5ms).
    act(() => { vi.advanceTimersByTime(120) })
    expect(result.current.length).toBeLessThan('Buscar nota'.length)

    // Apagar 11 (5ms) + pausa 10 + escrever 10 (10ms) fecha em ~265ms a partir
    // do inicio; o ciclo continua depois, entao o alvo e esse instante e nao
    // "esperar bastante" (em 520ms a segunda frase ja comecou a ser apagada).
    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current).toBe('Buscar tag')
  })

  it('com prefers-reduced-motion nao anima', () => {
    comMovimentoReduzido()
    vi.useFakeTimers()
    const { result } = renderHook(() => useTypingPlaceholder(['Buscar nota', 'Buscar tag'], { holdMs: 10, typeMs: 5, eraseMs: 5, pauseMs: 5 }))
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current).toBe('Buscar nota')
  })

  it('para os timers ao desmontar', () => {
    comMovimentoNormal()
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useTypingPlaceholder(['Buscar nota', 'Buscar tag'], { holdMs: 50, typeMs: 10, eraseMs: 5, pauseMs: 10 }))
    const antes = result.current
    unmount()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(antes)
  })
})
