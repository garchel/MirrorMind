import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mesmo padrão de mock içado dos demais testes de lib com backend.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const { useTrashItems } = await import('./useTrashItems')
const { invoke: invokeMock } = (await import('@tauri-apps/api/core')) as unknown as {
  invoke: ReturnType<typeof vi.fn>
}

const ITEM = {
  id: 'abc123',
  originalRelativePath: 'nota.md',
  trashedName: 'nota.md',
  itemType: 'note',
  deletedAtDay: 20000,
} as const

function setup() {
  const deps = {
    vaultPath: '/vault',
    refreshNotes: vi.fn(async () => undefined),
    goToTrashPage: vi.fn(),
    reportStatus: vi.fn(),
    reportError: vi.fn(),
    setBusy: vi.fn(),
  }
  const hook = renderHook(() => useTrashItems(deps))
  return { deps, ...hook }
}

describe('useTrashItems (extração do App)', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('openTrashPage lista e navega; sem vault não faz nada', async () => {
    invokeMock.mockResolvedValue([ITEM])
    const { result, deps } = setup()
    await act(async () => {
      await result.current.openTrashPage()
    })
    expect(invokeMock).toHaveBeenCalledWith('list_trash', { path: '/vault' })
    expect(result.current.trashItems).toEqual([ITEM])
    expect(deps.goToTrashPage).toHaveBeenCalled()
    expect(deps.setBusy).toHaveBeenNthCalledWith(1, true)
    expect(deps.setBusy).toHaveBeenLastCalledWith(false)
  })

  it('falha ao abrir = erro reportado, sem navegação', async () => {
    invokeMock.mockRejectedValue(new Error('sumiu'))
    const { result, deps } = setup()
    await act(async () => {
      await result.current.openTrashPage()
    })
    expect(deps.reportError).toHaveBeenCalledWith('sumiu')
    expect(deps.goToTrashPage).not.toHaveBeenCalled()
    expect(result.current.trashItems).toEqual([])
  })

  it('restore filtra, avisa e atualiza as notas', async () => {
    invokeMock
      .mockResolvedValueOnce([ITEM])
      .mockResolvedValueOnce(undefined)
    const { result, deps } = setup()
    await act(async () => {
      await result.current.openTrashPage()
    })
    await act(async () => {
      await result.current.restoreTrashItem('abc123')
    })
    expect(invokeMock).toHaveBeenCalledWith('restore_trash_item', { path: '/vault', id: 'abc123' })
    expect(result.current.trashItems).toEqual([])
    expect(deps.reportStatus).toHaveBeenCalledWith('Item restaurado no local original.')
    expect(deps.refreshNotes).toHaveBeenCalledWith('/vault')
  })

  it('exclusão permanente limpa o alvo só no sucesso', async () => {
    invokeMock
      .mockResolvedValueOnce([ITEM])
      .mockResolvedValueOnce(undefined)
    const { result } = setup()
    await act(async () => {
      await result.current.openTrashPage()
    })
    act(() => {
      result.current.setPermanentDeleteTarget({ ...ITEM })
    })
    await act(async () => {
      await result.current.permanentlyDeleteTrashItem()
    })
    expect(invokeMock).toHaveBeenCalledWith('permanently_delete_trash_item', { path: '/vault', id: 'abc123' })
    expect(result.current.trashItems).toEqual([])
    expect(result.current.permanentDeleteTarget).toBeNull()
  })

  it('exclusão permanente com falha mantém o alvo (modal segue aberto)', async () => {
    invokeMock
      .mockResolvedValueOnce([ITEM])
      .mockRejectedValueOnce(new Error('travou'))
    const { result, deps } = setup()
    await act(async () => {
      await result.current.openTrashPage()
    })
    act(() => {
      result.current.setPermanentDeleteTarget({ ...ITEM })
    })
    await act(async () => {
      await result.current.permanentlyDeleteTrashItem()
    })
    expect(result.current.permanentDeleteTarget).toEqual({ ...ITEM })
    expect(result.current.trashItems).toEqual([{ ...ITEM }])
    expect(deps.reportError).toHaveBeenCalledWith('travou')
  })
})
