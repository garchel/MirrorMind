import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { DEFAULT_FONT_SIZE, DEFAULT_HISTORY_LIMIT } from './appearance'
import { DEFAULT_WORKSPACE_SHORTCUTS } from './keyboard-shortcuts'
import { useAppearanceSettings } from './useAppearanceSettings'

describe('useAppearanceSettings (extração do App)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('devolve os padrões com storage vazio', () => {
    const { result } = renderHook(() => useAppearanceSettings())
    expect(result.current.isAutoSaveEnabled).toBe(true)
    expect(result.current.themeMode).toBe('light')
    expect(result.current.editorFontFamily).toBe('sans')
    expect(result.current.editorFontSize).toBe(DEFAULT_FONT_SIZE)
    expect(result.current.historyLimit).toBe(DEFAULT_HISTORY_LIMIT)
    expect(result.current.readingFont).toBe('sans')
    expect(result.current.readingWidth).toBe('comfortable')
    expect(result.current.isReadingLineWrapEnabled).toBe(true)
    expect(result.current.isSpellCheckEnabled).toBe(true)
    expect(result.current.skipSoftDeleteConfirmation).toBe(false)
    expect(result.current.noteHoverColor).toBe('#171716')
    expect(result.current.tabHoverTextColor).toBe('#fbfaf6')
    expect(result.current.shortcuts).toEqual(DEFAULT_WORKSPACE_SHORTCUTS)
  })

  it('valores corrompidos caem nos padrões (paridade com o App antigo)', () => {
    localStorage.setItem('mirrormind.appearance.theme', 'rosa')
    localStorage.setItem('mirrormind.appearance.font-size', 'abc')
    localStorage.setItem('mirrormind.shortcuts', 'json-quebrado{')
    const { result } = renderHook(() => useAppearanceSettings())
    expect(result.current.themeMode).toBe('light')
    expect(result.current.editorFontSize).toBe(DEFAULT_FONT_SIZE)
    expect(result.current.shortcuts).toEqual(DEFAULT_WORKSPACE_SHORTCUTS)
  })

  it('migra o atalho antigo Ctrl+Shift+M para o padrão atual', () => {
    localStorage.setItem(
      'mirrormind.shortcuts',
      JSON.stringify({ ...DEFAULT_WORKSPACE_SHORTCUTS, cycleNoteViewMode: 'Ctrl+Shift+M' }),
    )
    const { result } = renderHook(() => useAppearanceSettings())
    expect(result.current.shortcuts.cycleNoteViewMode).toBe(
      DEFAULT_WORKSPACE_SHORTCUTS.cycleNoteViewMode,
    )
  })

  it('setter persiste nas mesmas chaves legadas (compatibilidade)', () => {
    const { result } = renderHook(() => useAppearanceSettings())
    act(() => {
      result.current.setThemeMode('dark')
    })
    act(() => {
      result.current.setEditorFontSize(19)
    })
    expect(localStorage.getItem('mirrormind.appearance.theme')).toBe('dark')
    expect(localStorage.getItem('mirrormind.appearance.font-size')).toBe('19')
    expect(result.current.themeMode).toBe('dark')
  })

  it('patchShortcuts mescla sem perder os demais atalhos', () => {
    const { result } = renderHook(() => useAppearanceSettings())
    act(() => {
      result.current.patchShortcuts({ saveNote: 'Ctrl+S' })
    })
    expect(result.current.shortcuts.saveNote).toBe('Ctrl+S')
    expect(result.current.shortcuts.createNote).toBe(DEFAULT_WORKSPACE_SHORTCUTS.createNote)
    expect(JSON.parse(localStorage.getItem('mirrormind.shortcuts') ?? '{}').saveNote).toBe('Ctrl+S')
  })
})
