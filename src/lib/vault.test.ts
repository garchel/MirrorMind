import { describe, expect, it } from 'vitest'
import {
  buildNoteTree,
  buildVaultPathPreview,
  formatDailyNotePath,
  formatNoteTitleAsPath,
  formatVaultNameError,
  getVaultModeLabel,
  parseNoteDocument,
  parseNoteList,
  parseRecentVaultPreference,
  parseVaultSummary,
} from './vault'
import { formatShortcut, matchesShortcut } from './keyboard-shortcuts'
import { extractMarkdownTags, formatMarkdownSelection, renderWikiLinksAsMarkdown, splitMarkdownBlocks } from './markdown'

describe('vault helpers', () => {
  it('formats and matches configurable keyboard shortcuts', () => {
    const keyboardEvent = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true })

    expect(formatShortcut(keyboardEvent)).toBe('Ctrl+N')
    expect(matchesShortcut(keyboardEvent, 'ctrl+n')).toBe(true)
  })

  it('splits Markdown into editable mixed-mode blocks', () => {
    expect(splitMarkdownBlocks('# Titulo\n\nTexto\n\n## Secao')).toEqual([
      '# Titulo',
      'Texto',
      '## Secao',
    ])
  })

  it('formats the selected Markdown text', () => {
    expect(formatMarkdownSelection('texto', 0, 5, 'bold')).toBe('**texto**')
    expect(formatMarkdownSelection('texto', 0, 5, 'heading1')).toBe('# texto')
    expect(formatMarkdownSelection('texto', 0, 5, 'orderedList')).toBe('1. texto')
    expect(formatMarkdownSelection('texto', 0, 5, 'quote')).toBe('> texto')
    expect(formatMarkdownSelection('texto', 0, 5, 'codeBlock')).toBe('```\ntexto\n```')
  })

  it('renders wiki links as safe internal Markdown links', () => {
    expect(renderWikiLinksAsMarkdown('Leia [[escola/portugues|Portugues]].')).toBe(
      'Leia [Portugues](https://mirrormind.local/note/escola%2Fportugues.md).',
    )
  })

  it('extracts unique Markdown tags', () => {
    expect(extractMarkdownTags('#Portugues #revisao #portugues')).toEqual(['portugues', 'revisao'])
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

  it('creates daily note paths using the local calendar date', () => {
    expect(formatDailyNotePath(new Date(2026, 6, 13, 12))).toBe('Diarias/2026-07-13.md')
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

  it('keeps empty folders in the explorer tree', () => {
    const tree = buildNoteTree([], ['projetos', 'projetos/rascunhos'])

    expect(tree[0]).toMatchObject({ type: 'folder', name: 'projetos' })
    expect(tree[0].children?.[0]).toMatchObject({ type: 'folder', name: 'rascunhos' })
  })
})
