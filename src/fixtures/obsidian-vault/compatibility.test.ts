import { describe, expect, it } from 'vitest'
import compatibilityVaultNote from './compatibility.md?raw'
import { getMarkdownBody, getMarkdownFrontmatterProperties, renderWikiLinksAsMarkdown, replaceMarkdownBody, setMarkdownFrontmatterSource } from '../../lib/markdown'

describe('Obsidian compatibility fixture', () => {
  it('opens advanced YAML without losing its semantic properties', () => {
    expect(getMarkdownFrontmatterProperties(compatibilityVaultNote)).toMatchObject({
      title: 'Nota com: aspas',
      tags: ['estudo/portugues'],
      review: { '<<': { status: 'active' } },
    })
  })

  it('preserves unsupported content when a note is saved without body edits', () => {
    expect(replaceMarkdownBody(compatibilityVaultNote, getMarkdownBody(compatibilityVaultNote))).toBe(compatibilityVaultNote)
    expect(setMarkdownFrontmatterSource(compatibilityVaultNote, compatibilityVaultNote.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? '')).toBe(compatibilityVaultNote)
  })

  it('renders links and embeds through internal safe URLs', () => {
    const rendered = renderWikiLinksAsMarkdown(compatibilityVaultNote)

    expect(rendered).toContain('https://mirrormind.local/note/pasta%2Fnota%20alvo.md?fragment=secao')
    expect(rendered).toContain('https://mirrormind.local/asset/imagem.png')
  })
})
