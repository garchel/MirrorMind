import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFormatToolbar, type UseFormatToolbarDeps } from './useFormatToolbar'

afterEach(() => {
  cleanup()
})

/** A mesma forma que o editor devolve: `value` e o documento inteiro e os
 * offsets delimitam a selecao (ver `MarkdownCodeEditor.getSelection`). */
function selectionOf(doc: string, text: string) {
  const selectionStart = doc.indexOf(text)
  if (selectionStart < 0) throw new Error(`trecho fora do documento: ${text}`)
  return { value: doc, selectionStart, selectionEnd: selectionStart + text.length }
}

function renderToolbar(overrides: Partial<UseFormatToolbarDeps> = {}) {
  const onAddSelectionToDictionary = vi.fn()
  const deps: UseFormatToolbarDeps = {
    activeEditorSession: null,
    hasActiveNote: true,
    editorMode: 'edit',
    setDraftContent: vi.fn(),
    focusEditor: vi.fn(),
    editor: {
      getSelection: () =>
        selectionOf('# Nota\n\n  estroma dos cloroplastos  \n', '  estroma dos cloroplastos  '),
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

  it('entrega so a selecao, nunca o frontmatter da nota', () => {
    // O relato: selecionar `eletrons` abria o modal com o frontmatter (post-its
    // e tudo) no campo Termo. O editor devolve o documento inteiro em `value`;
    // quem recorta o trecho sao os offsets.
    const doc = [
      '---',
      'postits:',
      '  - id: postit-20260921235004-l0osxr',
      '    anchorText: Processo autotrofico realizado por plantas',
      '---',
      '',
      '# Fotossintese',
      '',
      'A fase clara gera ATP e os eletrons seguem para a cadeia transportadora.',
      '',
    ].join('\n')
    const { result, onAddSelectionToDictionary } = renderToolbar({
      editor: {
        getSelection: () => selectionOf(doc, 'eletrons'),
        getSelectionRect: () => null,
        editorContent: () => null,
      },
    })

    act(() => result.current.addSelectionToDictionary())

    expect(onAddSelectionToDictionary).toHaveBeenCalledWith('eletrons')
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
