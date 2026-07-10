import { describe, expect, it } from 'vitest'
import {
  buildNoteTree,
  buildVaultPathPreview,
  formatNoteTitleAsPath,
  formatVaultNameError,
  getVaultModeLabel,
  parseNoteDocument,
  parseNoteList,
  parseRecentVaultPreference,
  parseVaultSummary,
} from './vault'
import { formatShortcut, matchesShortcut } from './keyboard-shortcuts'

describe('vault helpers', () => {
  it('formats and matches configurable keyboard shortcuts', () => {
    const keyboardEvent = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true })

    expect(formatShortcut(keyboardEvent)).toBe('Ctrl+N')
    expect(matchesShortcut(keyboardEvent, 'ctrl+n')).toBe(true)
  })
  it('rejects invalid vault names', () => {
    expect(formatVaultNameError('')).toBeTruthy()
    expect(formatVaultNameError('Meu:Vault')).toContain('nao pode')
  })

  it('builds a readable preview path', () => {
    expect(buildVaultPathPreview('C:\\Vaults', 'Estudos')).toBe('C:\\Vaults\\Estudos')
    expect(buildVaultPathPreview('', 'Estudos')).toContain('Nenhuma pasta pai')
  })

  it('labels obsidian vaults explicitly', () => {
    expect(
      getVaultModeLabel({
        name: 'Notes',
        path: 'C:\\Notes',
        noteCount: 2,
        notePreviews: [],
        isObsidianVault: true,
        metadata: {
          isInitialized: false,
          rootPath: 'C:\\Notes\\.mirmind',
          missing: [],
        },
      }),
    ).toBe('Vault Obsidian suportado')
  })

  it('validates vault payloads at runtime', () => {
    expect(() =>
      parseVaultSummary({
        name: 'Vault',
        path: 'C:\\Vault',
        noteCount: 1,
        notePreviews: [{ name: 'note.md', relativePath: 'note.md' }],
        isObsidianVault: false,
        metadata: {
          isInitialized: true,
          rootPath: 'C:\\Vault\\.mirmind',
          missing: [],
        },
      }),
    ).not.toThrow()

    expect(() => parseVaultSummary({ noteCount: '1' })).toThrow()
  })

  it('validates note payloads at runtime', () => {
    expect(() =>
      parseNoteList([{ name: 'Note', relativePath: 'folder/note.md' }]),
    ).not.toThrow()
    expect(() =>
      parseNoteDocument({
        name: 'Note',
        relativePath: 'note.md',
        content: '# Teste',
      }),
    ).not.toThrow()
    expect(() => parseNoteDocument({ name: 'Note' })).toThrow()
  })

  it('validates the persisted recent vault preference', () => {
    expect(() =>
      parseRecentVaultPreference({
        lastVaultPath: 'C:\\Vaults\\Estudos',
        askBeforeReopen: true,
      }),
    ).not.toThrow()
    expect(() => parseRecentVaultPreference({ lastVaultPath: 42 })).toThrow()
  })

  it('formats note titles into markdown paths', () => {
    expect(formatNoteTitleAsPath('Minha Nota Nova')).toBe('minha-nota-nova.md')
    expect(formatNoteTitleAsPath('')).toBeNull()
  })

  it('builds a folder tree from note paths', () => {
    const tree = buildNoteTree([
      { name: 'root.md', relativePath: 'root.md' },
      { name: 'aula.md', relativePath: 'biologia/aula.md' },
      { name: 'mapa.md', relativePath: 'biologia/mapa.md' },
    ])

    expect(tree[0]).toMatchObject({
      type: 'folder',
      name: 'biologia',
    })
    expect(tree[0].children?.map((node) => node.name)).toEqual(['aula.md', 'mapa.md'])
    expect(tree[1]).toMatchObject({
      type: 'note',
      name: 'root.md',
    })
  })
})
