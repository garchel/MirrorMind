import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// O mock precisa existir antes do import de './useNoteSearch' (que importa
// o core estaticamente); vi.mock é içado (hoisted) e roda antes.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const { useNoteSearch } = await import('./useNoteSearch')
const { invoke: invokeMock } = (await import('@tauri-apps/api/core')) as unknown as {
  invoke: ReturnType<typeof vi.fn>
}

describe('useNoteSearch (extração do App)', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('lista vazia com busca desabilitada, sem vault ou query vazia', () => {
    const { result, rerender } = renderHook(
      ({ enabled, query }) => useNoteSearch('/vault', query, enabled, 0),
      { initialProps: { enabled: false, query: 'alvo' } },
    )
    expect(result.current).toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
    rerender({ enabled: true, query: '   ' })
    expect(result.current).toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('chama search_notes com debounce e devolve os resultados', async () => {
    invokeMock.mockResolvedValue([{ name: 'alvo.md', relativePath: 'alvo.md', excerpt: 'trecho' }])
    const { result } = renderHook(() => useNoteSearch('/vault', 'alvo', true, 0))
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(invokeMock).toHaveBeenCalledWith('search_notes', { path: '/vault', query: 'alvo' })
    expect(result.current[0].relativePath).toBe('alvo.md')
  })

  it('falha de backend = lista vazia (nunca vaza erro)', async () => {
    invokeMock.mockRejectedValue(new Error('vault fechado'))
    const { result } = renderHook(() => useNoteSearch('/vault', 'alvo', true, 0))
    await waitFor(() => expect(invokeMock).toHaveBeenCalled())
    // Aguarda o catch assíncrono assentar sem resultados.
    await waitFor(() => expect(result.current).toEqual([]))
  })
})
