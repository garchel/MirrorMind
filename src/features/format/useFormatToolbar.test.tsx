import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFormatToolbar, type UseFormatToolbarDeps } from './useFormatToolbar'

afterEach(() => {
  cleanup()
})

function renderToolbar(overrides: Partial<UseFormatToolbarDeps> = {}) {
  const onAddSelectionToDictionary = vi.fn()
  const deps: UseFormatToolbarDeps = {
    activeEditorSession: null,
    hasActiveNote: true,
    editorMode: 'edit',
    setDraftContent: vi.fn(),
    focusEditor: vi.fn(),
    editor: {
      getSelection: () => ({ value: '  estroma dos cloroplastos  ', selectionStart: 2, selectionEnd: 29 }),
      getSelectionRect: () => null,
      editorContent: () => null,
    },
    onAddSelectionToDictionary,
    ...overrides,
  }
  const view = renderHook(() => useFormatToolbar(deps))
  return { ...view, onAddSelectionToDictionary }
}

describe('useFormatToolbar', () => {
  it('entrega o trecho selecionado sem os espacos das pontas', () => {
    const { result, onAddSelectionToDictionary } = renderToolbar()

    act(() => result.current.addSelectionToDictionary())

    expect(onAddSelectionToDictionary).toHaveBeenCalledWith('estroma dos cloroplastos')
  })

  it('nao abre o dicionario sem selecao real', () => {
    const { result, onAddSelectionToDictionary } = renderToolbar({
      editor: {
        getSelection: () => ({ value: '   ', selectionStart: 0, selectionEnd: 3 }),
        getSelectionRect: () => null,
        editorContent: () => null,
      },
    })

    act(() => result.current.addSelectionToDictionary())

    expect(onAddSelectionToDictionary).not.toHaveBeenCalled()
  })

  it('nao abre o dicionario no modo Leitura', () => {
    const { result, onAddSelectionToDictionary } = renderToolbar({ editorMode: 'read' })

    act(() => result.current.addSelectionToDictionary())

    expect(onAddSelectionToDictionary).not.toHaveBeenCalled()
  })
})
