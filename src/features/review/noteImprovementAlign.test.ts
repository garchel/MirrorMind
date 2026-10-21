import { describe, expect, it } from 'vitest'
import { alignSuggestions } from './noteImprovementAlign'

const NOTA = `# Ciclo de Calvin

A fixacao de carbono ocorre no estroma dos cloroplastos.

A glicose e o produto final.`

describe('alignSuggestions', () => {
  it('alinha o antes e o depois 1:1 mais o bloco inserido', () => {
    const aligned = alignSuggestions(NOTA, [
      {
        term: 'estroma',
        definition: 'O fluido interno do cloroplasto.',
        sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
      },
    ])

    expect(aligned).toHaveLength(1)
    const suggestion = aligned[0]
    // O "antes" tem os 3 blocos da nota.
    expect(suggestion.before).toHaveLength(3)
    // O "depois" tem os 3 + o inserido.
    expect(suggestion.after).toHaveLength(4)
    const inserted = suggestion.after.filter((block) => block.kind === 'inserted')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].text).toBe('O fluido interno do cloroplasto.')
    expect(inserted[0].suggestionId).toBe(0)
  })

  it('o bloco inserido vem antes do bloco ancorado', () => {
    // A definicao entra ANTES do uso. Se viesse depois, seria inutil.
    const aligned = alignSuggestions(NOTA, [
      {
        term: 'estroma',
        definition: 'O fluido interno do cloroplasto.',
        sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
      },
    ])
    const texts = aligned[0].after.map((block) => block.text)
    const insertedAt = texts.findIndex((text) => text === 'O fluido interno do cloroplasto.')
    const anchorAt = texts.findIndex((text) =>
      text.includes('A fixacao de carbono ocorre no estroma'),
    )
    expect(insertedAt).toBeLessThan(anchorAt)
  })

  it('os blocos comuns sao identicos nos dois lados', () => {
    // E o que garante que o painel e uma comparacao e nao duas notas
    // diferentes.
    const aligned = alignSuggestions(NOTA, [
      {
        term: 'estroma',
        definition: 'O fluido interno do cloroplasto.',
        sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
      },
    ])
    const comunsAntes = aligned[0].before.filter((block) => !block.kind)
    const comunsDepois = aligned[0].after.filter((block) => !block.kind)
    expect(comunsAntes.map((block) => block.text)).toEqual(
      comunsDepois.map((block) => block.text),
    )
  })

  it('uma sugestao sem ancora nao entra na comparacao', () => {
    // Sem a citacao na nota, nao ha onde mostrar a sugestao lado a lado.
    const aligned = alignSuggestions(NOTA, [
      {
        term: 'ribulose',
        definition: 'Um acucar de cinco carbonos.',
        sourceQuote: 'Uma frase que nao esta na nota.',
      },
    ])
    expect(aligned).toHaveLength(0)
  })

  it('cada sugestao tem o seu proprio indice', () => {
    // O indice liga o hover entre os dois lados: passar o mouse no bloco
    // inserido destaca o bloco ancorado, e vice-versa.
    const aligned = alignSuggestions(NOTA, [
      {
        term: 'estroma',
        definition: 'Definicao do estroma.',
        sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
      },
      {
        term: 'glicose',
        definition: 'Definicao da glicose.',
        sourceQuote: 'A glicose e o produto final.',
      },
    ])
    expect(aligned).toHaveLength(2)
    const ids = aligned.flatMap((suggestion) =>
      suggestion.after
        .filter((block) => block.kind === 'inserted')
        .map((block) => block.suggestionId),
    )
    expect(ids).toEqual([0, 1])
  })

  it('uma nota sem blocos nao quebra', () => {
    expect(alignSuggestions('', [])).toEqual([])
    expect(
      alignSuggestions('', [
        { term: 'x', definition: 'y', sourceQuote: 'z' },
      ]),
    ).toEqual([])
  })
})
