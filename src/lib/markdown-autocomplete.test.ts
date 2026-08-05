import { describe, expect, it } from 'vitest'
import { getMarkdownAutocompleteResult } from './markdown-autocomplete'

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
