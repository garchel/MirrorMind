import { describe, expect, it } from 'vitest'
import { getMarkdownAutocompleteResult, resolveMarkdownAutocompleteData } from './markdown-autocomplete'

const data = {
  attachments: ['media/img.png', 'media/doc.pdf'],
  notePaths: ['notas/alpha.md', 'notas/beta.md', 'notas/gamma.md'],
  tags: ['revisao/prova', 'revisao/manter'],
}

describe('getMarkdownAutocompleteResult', () => {
  it('sugere notas para [[ com o alcance do cursor', () => {
    const result = getMarkdownAutocompleteResult('Veja [[bet', 'Veja [[bet'.length, data)
    expect(result).not.toBeNull()
    // O match da consulta (bet) comeca em 7; `from` e esse offset absoluto.
    expect(result!.from).toBe(7)
    expect(result!.options.map((option) => option.label)).toEqual(['notas/beta'])
  })

  it('sugere anexos para ![[', () => {
    const result = getMarkdownAutocompleteResult('![[media/do', '![[media/do'.length, data)
    expect(result).not.toBeNull()
    expect(result!.options.map((option) => option.label)).toEqual(['media/doc.pdf'])
  })

  it('sugere tags por prefixo (nao substring)', () => {
    const text = 'texto #revisao/p'
    const result = getMarkdownAutocompleteResult(text, text.length, data)
    expect(result).not.toBeNull()
    expect(result!.options.map((option) => option.label)).toEqual(['revisao/prova'])
  })

  it('ranqueia notas conectadas antes das demais, mantendo o resto estavel', () => {
    const result = getMarkdownAutocompleteResult('[[a', 3, { ...data, connectedNotePaths: ['notas/gamma.md'] })
    const labels = result!.options.map((option) => option.label)
    expect(labels).toEqual(['notas/gamma', 'notas/alpha', 'notas/beta'])
    expect(result!.options[0].detail).toBe('Nota conectada')
  })

  it('mantem a ordem original sem notas conectadas', () => {
    const result = getMarkdownAutocompleteResult('[[a', 3, data)
    expect(result!.options.map((option) => option.label)).toEqual(['notas/alpha', 'notas/beta', 'notas/gamma'])
  })
})

const baseInput = {
  notePaths: ['notas/alpha.md', 'notas/beta.md'],
  activeNotePath: 'notas/alpha.md',
  isNewNoteDraft: false,
  draftContent: 'Liga para [[beta]] e [[inexistente]].',
  attachments: ['media/img.png'],
  tags: ['revisao/prova'],
  vaultBacklinks: new Map([['notas/alpha.md', new Set(['notas/beta.md'])]]),
  graphBacklinks: null,
}

describe('resolveMarkdownAutocompleteData', () => {
  it('une alvos do rascunho + backlinks, sem a propria nota', () => {
    const resolved = resolveMarkdownAutocompleteData(baseInput)
    // [[beta]] resolve para notas/beta.md; a propria nota nunca entra; o
    // backlink beta->alpha soma beta (ja la). Fiel ao App: [[inexistente]]
    // tambem entra como 'inexistente.md' (dangling, sem efeito no ranking).
    expect(new Set(resolved.connectedNotePaths)).toEqual(new Set(['notas/beta.md', 'inexistente.md']))
    expect(resolved.notePaths).toEqual(baseInput.notePaths)
    expect(resolved.tags).toEqual(['revisao/prova'])
  })

  it('usa o backlink do grafo quando o indice do vault nao esta pronto', () => {
    const resolved = resolveMarkdownAutocompleteData({
      ...baseInput,
      draftContent: 'Sem links.',
      vaultBacklinks: null,
      graphBacklinks: new Map([['notas/alpha.md', new Set(['notas/beta.md'])]]),
    })
    expect(resolved.connectedNotePaths).toEqual(['notas/beta.md'])
  })

  it('zera conectados em rascunho novo ou sem nota ativa', () => {
    expect(resolveMarkdownAutocompleteData({ ...baseInput, isNewNoteDraft: true }).connectedNotePaths).toEqual([])
    expect(resolveMarkdownAutocompleteData({ ...baseInput, activeNotePath: null }).connectedNotePaths).toEqual([])
  })
})
