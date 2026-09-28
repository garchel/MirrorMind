import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_SHORTCUTS,
  formatShortcut,
  matchesShortcut,
  type WorkspaceShortcuts,
} from './keyboard-shortcuts'

function keyEvent(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('keyboard-shortcuts', () => {
  it('tem padroes para todas as acoes', () => {
    const keys = Object.keys(DEFAULT_WORKSPACE_SHORTCUTS).sort()
    expect(keys).toEqual(
      ['createNote', 'cycleNoteViewMode', 'openCommandPalette', 'openNote', 'openTagFilter', 'saveNote'].sort(),
    )
    const values: string[] = Object.values(DEFAULT_WORKSPACE_SHORTCUTS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('formata modificadores + tecla (letra sempre maiuscula)', () => {
    expect(formatShortcut(keyEvent({ key: 'n', ctrlKey: true }))).toBe('Ctrl+N')
    expect(formatShortcut(keyEvent({ key: 'S', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+S')
    expect(formatShortcut(keyEvent({ key: 'F1' }))).toBe('F1')
    expect(formatShortcut(keyEvent({ key: 'm', ctrlKey: true, altKey: true, metaKey: true }))).toBe('Ctrl+Meta+Alt+M')
  })

  it('casa atalhos ignorando caixa', () => {
    expect(matchesShortcut(keyEvent({ key: 's', ctrlKey: true }), 'Ctrl+S')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: 'S', ctrlKey: true }), 'ctrl+s')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: 's', ctrlKey: true }), 'Ctrl+N')).toBe(false)
    expect(matchesShortcut(keyEvent({ key: 's' }), 'Ctrl+S')).toBe(false)
  })

  it('aceita mescla parcial sobre os padroes (contrato do usePref)', () => {
    const merged: WorkspaceShortcuts = { ...DEFAULT_WORKSPACE_SHORTCUTS, saveNote: 'Ctrl+Shift+S' }
    expect(merged.saveNote).toBe('Ctrl+Shift+S')
    expect(merged.createNote).toBe('Ctrl+N')
  })
})
