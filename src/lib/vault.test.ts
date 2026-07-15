import { describe, expect, it } from 'vitest'
import {
  buildNoteTree,
  buildVaultPathPreview,
  formatDailyNotePath,
  formatNoteTitleAsPath,
  formatVaultNameError,
  getVaultModeLabel,
  isVaultPathAffected,
  normalizeRecoveredNotePath,
  parseNoteDocument,
  parseNoteList,
  parseRecentVaultPreference,
  parseSpecialVaultInventory,
  parseVaultSummary,
  remapVaultPath,
} from './vault'
import { formatShortcut, matchesShortcut } from './keyboard-shortcuts'
import { extractMarkdownTags, extractObsidianWikiLinks, formatMarkdownSelection, parseObsidianWikiLink, renderWikiLinksAsMarkdown, resolveObsidianAttachmentPath, resolveObsidianWikiLinkPath, splitMarkdownBlocks } from './markdown'

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
    expect(renderWikiLinksAsMarkdown('\\[[escapado]] e \\![[embed-escapado]]')).toBe(
      '\\[[escapado]] e \\![[embed-escapado]]',
    )
    expect(extractObsidianWikiLinks('[[real]] \\[[escapado]] `[[codigo]]`\n\n```\n[[bloco]]\n```')).toEqual([
      { alias: 'real', fragment: null, path: 'real.md' },
    ])
  })

  it('preserves headings and block references in Obsidian wiki links', () => {
    expect(parseObsidianWikiLink('pasta/Nota especial#Resumo|Ver resumo')).toEqual({
      alias: 'Ver resumo',
      fragment: 'Resumo',
      path: 'pasta/Nota especial.md',
    })
    expect(parseObsidianWikiLink('nota#^bloco-123')).toEqual({
      alias: 'nota',
      fragment: '^bloco-123',
      path: 'nota.md',
    })
    expect(parseObsidianWikiLink('#Principal#Detalhes')).toEqual({
      alias: 'Principal#Detalhes',
      fragment: 'Principal#Detalhes',
      path: '',
    })
    expect(renderWikiLinksAsMarkdown('[[pasta/Nota especial#Resumo|Ver resumo]]')).toBe(
      '[Ver resumo](https://mirrormind.local/note/pasta%2FNota%20especial.md?fragment=Resumo)',
    )
    expect(renderWikiLinksAsMarkdown('![[assets/diagrama.png|Diagrama]] ![[notas/alvo#Resumo]]')).toBe(
      '![Diagrama](https://mirrormind.local/asset/assets%2Fdiagrama.png) ![alvo](https://mirrormind.local/embed/notas%2Falvo.md?fragment=Resumo)',
    )
    expect(renderWikiLinksAsMarkdown('![[#Principal#Detalhes]]', () => 'notas/atual.md')).toBe(
      '![Principal#Detalhes](https://mirrormind.local/embed/notas%2Fatual.md?fragment=Principal%23Detalhes)',
    )
  })

  it('resolves relative wiki links and duplicate names near the current note', () => {
    const notePaths = ['projetos/aula.md', 'projetos/revisao.md', 'arquivo/aula.md', 'sub/aula.md', 'projetos/sub/aula.md', 'a/x/c/aula.md', 'a/y/z/aula.md', 'Árvore.md']

    expect(resolveObsidianWikiLinkPath('aula.md', 'projetos/revisao.md', notePaths)).toBe('projetos/aula.md')
    expect(resolveObsidianWikiLinkPath('arquivo/aula.md', 'projetos/revisao.md', notePaths)).toBe('arquivo/aula.md')
    expect(resolveObsidianWikiLinkPath('sub/aula.md', 'projetos/revisao.md', notePaths)).toBe('sub/aula.md')
    expect(resolveObsidianWikiLinkPath('', 'projetos/revisao.md', notePaths)).toBe('projetos/revisao.md')
    expect(resolveObsidianWikiLinkPath('aula.md', 'a/y/c/referencia.md', notePaths)).toBe('a/y/z/aula.md')
    expect(resolveObsidianWikiLinkPath('árvore.md', 'referencia.md', notePaths)).toBe('Árvore.md')
    expect(resolveObsidianWikiLinkPath('nota.md', 'raiz/referencia.md', ['raiz/😀/nota.md', 'raiz/\uE000/nota.md'])).toBe(
      'raiz/\uE000/nota.md',
    )
  })

  it('resolves attachment embeds by path and filename', () => {
    const attachments = ['media/diagrama.png', 'materias/imagem.png', 'outra/imagem.png', 'materias/media/mapa.png', 'mapa.png']

    expect(resolveObsidianAttachmentPath('diagrama.png', 'materias/aula.md', attachments)).toBe('media/diagrama.png')
    expect(resolveObsidianAttachmentPath('imagem.png', 'materias/aula.md', attachments)).toBe('materias/imagem.png')
    expect(resolveObsidianAttachmentPath('materias/imagem.png', 'materias/aula.md', attachments)).toBe('materias/imagem.png')
    expect(resolveObsidianAttachmentPath('inexistente/imagem.png', 'materias/aula.md', attachments)).toBe('inexistente/imagem.png')
    expect(resolveObsidianAttachmentPath('./media/mapa.png', 'materias/aula.md', attachments)).toBe('materias/media/mapa.png')
    expect(resolveObsidianAttachmentPath('../media/diagrama.png', 'materias/sub/aula.md', [...attachments, 'materias/media/diagrama.png'])).toBe('materias/media/diagrama.png')
    expect(resolveObsidianAttachmentPath('../media/diagrama.png', 'materias/sub/aula.md', attachments)).toBe('../media/diagrama.png')
    expect(resolveObsidianAttachmentPath('../../../segredo.png', 'materias/aula.md', attachments)).toBe('../../../segredo.png')
    expect(resolveObsidianAttachmentPath('ac\u0327a\u0303o.png', 'materias/aula.md', ['mídia/ação.png'])).toBe('mídia/ação.png')
  })

  it('renders safe relative attachment embeds for the attachment resolver', () => {
    expect(renderWikiLinksAsMarkdown(
      '![[../media/diagrama.png]]',
      undefined,
      (path) => resolveObsidianAttachmentPath(path, 'materias/sub/aula.md', ['materias/media/diagrama.png']),
    )).toContain('https://mirrormind.local/asset/materias%2Fmedia%2Fdiagrama.png')
  })

  it('extracts unique Markdown tags', () => {
    expect(extractMarkdownTags('#Portugues #revisao #portugues')).toEqual(['portugues', 'revisao'])
    expect(extractMarkdownTags('#estudo/portugues #ação')).toEqual(['ação', 'estudo/portugues'])
  })

  it('includes complex Obsidian frontmatter tags in every frontend filter', () => {
    const content = `﻿---
shared: &shared
  - Estudo/Quimica
  - "#Ação"
tags:
  - *shared
  - Revisão
  - on
  - off
  - yes
  - no
---

#Corpo #ac\u0327a\u0303o #pai/ #pai//filho café#privado

\`#codigo-inline\`

\`\`\`
#codigo-bloco
\`\`\`

<!-- #comentario-html -->
%% #comentario-obsidian %%
https://exemplo.test/#fragmento`

    expect(extractMarkdownTags(content)).toEqual([
      'ação',
      'corpo',
      'estudo/quimica',
      'no',
      'off',
      'on',
      'revisão',
      'yes',
    ])
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
        obsidianPreferences: null,
        metadata: {
          isInitialized: false,
          rootPath: 'C:\\Notes\\.mirmind',
          missing: [],
        },
      }),
    ).toBe('Vault Obsidian suportado')
  })

  it('validates vault payloads at runtime', () => {
    const parsed = parseVaultSummary({
        name: 'Vault',
        path: 'C:\\Vault',
        noteCount: 1,
        notePreviews: [{ name: 'note.md', relativePath: 'note.md' }],
        isObsidianVault: false,
        obsidianPreferences: {
          newFileLocation: 'folder',
          newFileFolderPath: 'Notas',
          attachmentFolderPath: './media',
          newLinkFormat: 'relative',
          useMarkdownLinks: true,
          alwaysUpdateLinks: false,
          showUnsupportedFiles: true,
          promptDelete: false,
          trashOption: 'local',
          userIgnoreFilters: ['Arquivo/'],
        },
        metadata: {
          isInitialized: true,
          rootPath: 'C:\\Vault\\.mirmind',
          missing: [],
        },
      })

    expect(parsed.obsidianPreferences?.attachmentFolderPath).toBe('./media')
    expect(parsed.obsidianPreferences?.userIgnoreFilters).toEqual(['Arquivo/'])

    const legacy = parseVaultSummary({
      name: 'Vault antigo',
      path: 'C:\\Vault',
      noteCount: 0,
      notePreviews: [],
      isObsidianVault: true,
      metadata: { isInitialized: false, rootPath: 'C:\\Vault\\.mirmind', missing: [] },
    })
    expect(legacy.obsidianPreferences).toBeNull()

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

  it('validates read-only special vault file payloads', () => {
    expect(parseSpecialVaultInventory({
      files: [
        { name: 'Mapa.canvas', relativePath: 'projetos/Mapa.canvas', kind: 'canvas' },
        { name: 'Quadro.excalidraw', relativePath: 'Quadro.excalidraw', kind: 'excalidraw' },
        { name: 'dados.bin', relativePath: 'dados.bin', kind: 'unknown' },
      ],
      truncated: false,
    }).files).toHaveLength(3)

    for (const relativePath of ['../script.js', 'C:\\Vault\\script.js', '\\\\server\\script.js', '.obsidian/plugins/data.json', '.mirmind/state.json']) {
      expect(() => parseSpecialVaultInventory({
        files: [{ name: 'script.js', relativePath, kind: 'unknown' }],
        truncated: false,
      })).toThrow()
    }
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

  it('remaps notes nested below an externally renamed folder', () => {
    expect(remapVaultPath('estudos/biologia/aula.md', 'estudos', 'arquivo')).toBe(
      'arquivo/biologia/aula.md',
    )
    expect(remapVaultPath('outra.md', 'estudos', 'arquivo')).toBe('outra.md')
  })

  it('identifies notes removed directly or through a parent folder', () => {
    expect(isVaultPathAffected('estudos/aula.md', 'estudos')).toBe(true)
    expect(isVaultPathAffected('estudos/aula.md', 'outra')).toBe(false)
  })

  it('normalizes a recovery destination as a Markdown path', () => {
    expect(normalizeRecoveredNotePath(' recuperadas\\aula ')).toBe('recuperadas/aula.md')
    expect(normalizeRecoveredNotePath('')).toBeNull()
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
