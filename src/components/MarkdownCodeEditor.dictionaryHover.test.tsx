import { cleanup, render, screen } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dictionaryEntriesEffect,
  dictionaryEntriesField,
  dictionaryEntryAt,
} from '../features/dictionary/dictionaryExtension'
import { DictionaryTooltip } from '../features/dictionary/DictionaryTooltip'
import type { DictionaryEntry } from '../features/dictionary/dictionarySchema'

function entry(term: string, concept: string): DictionaryEntry {
  return { term, concept, createdAtUnixMs: 0, updatedAtUnixMs: 0 }
}

/**
 * O hover do dicionário: o mouse sobre a palavra dispara o aviso, e o balao
 * mostra o conceito **acima** da palavra.
 *
 * ## Por que o teste nao dispara um `mousemove`
 *
 * O `posAtCoords` do CodeMirror mede o layout de verdade: em jsdom nao ha
 * geometria, entao o `mousemove` sintetico cai sempre fora de qualquer
 * palavra. Testar por evento mediria o jsdom, nao o codigo.
 *
 * O que se testa aqui e a **logica de posicao** — a parte que decide qual
 * palavra esta sob o cursor — e o balao, que e React puro.
 */
describe('hover do dicionario', () => {
  afterEach(() => {
    cleanup()
  })

  /** Um estado com o dicionario carregado.
   *
   * O efeito nao pode entrar na lista de extensoes (o CodeMirror so aceita
   * extensoes ali): o estado e criado e **depois** o efeito e despachado —
   * que e o caminho que o editor real percorre.
   */
  function stateWith(doc: string, entries: DictionaryEntry[]) {
    const state = EditorState.create({
      doc,
      extensions: [dictionaryEntriesField],
    })
    return state.update({ effects: dictionaryEntriesEffect.of(entries) }).state
  }

  it('acha o verbete da palavra sob a posicao', () => {
    const state = stateWith('O rubisco fixa o carbono.', [
      entry('rubisco', 'Enzima que fixa carbono.'),
    ])
    const found = dictionaryEntryAt(state, 3)
    expect(found?.term).toBe('rubisco')
    expect(found?.concept).toBe('Enzima que fixa carbono.')
  })

  it('nao acha verbete para uma palavra sem conceito', () => {
    const state = stateWith('O rubisco fixa o carbono.', [entry('outra', 'Sem relacao.')])
    expect(dictionaryEntryAt(state, 3)).toBeNull()
  })

  it('nao acha verbete fora de uma palavra', () => {
    const state = stateWith('O rubisco fixa o carbono.', [entry('rubisco', 'Enzima.')])
    // A posicao 1 e o espaco depois de "O".
    expect(dictionaryEntryAt(state, 1)).toBeNull()
  })

  it('acha o verbete ignorando caixa e acentos', () => {
    const state = stateWith('A Glicólise ocorre aqui.', [
      entry('glicólise', 'Quebra da glicose.'),
    ])
    expect(dictionaryEntryAt(state, 3)?.term).toBe('glicólise')
  })
})

describe('DictionaryTooltip', () => {
  afterEach(() => {
    cleanup()
  })

  it('mostra o termo e o conceito', () => {
    render(
      <DictionaryTooltip
        entry={entry('rubisco', 'Enzima que fixa carbono.')}
        rect={new DOMRect(100, 200, 60, 18)}
      />,
    )
    expect(screen.getByTestId('dictionary-tooltip')).toBeTruthy()
    expect(screen.getByText('rubisco')).toBeTruthy()
    expect(screen.getByText('Enzima que fixa carbono.')).toBeTruthy()
  })

  it('nao mostra nada sem verbete', () => {
    render(<DictionaryTooltip entry={null} rect={null} />)
    expect(screen.queryByTestId('dictionary-tooltip')).toBeNull()
  })

  it('nao mostra nada sem retangulo', () => {
    render(
      <DictionaryTooltip
        entry={entry('rubisco', 'Enzima.')}
        rect={null}
      />,
    )
    expect(screen.queryByTestId('dictionary-tooltip')).toBeNull()
  })
})
