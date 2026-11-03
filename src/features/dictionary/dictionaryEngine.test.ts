import { describe, expect, it, vi } from 'vitest'
import { createDictionaryEngine, type DictionaryTransport } from './dictionaryEngine'

/** O transporte falso: o motor e testado pelo que ele manda ao backend. */
function fakeTransport() {
  return vi.fn(async () => ({ entries: [] })) as unknown as DictionaryTransport
}

describe('dictionaryEngine.save', () => {
  it('manda o contexto da nota quando o verbete nasceu de uma selecao', async () => {
    const transport = fakeTransport()
    const engine = createDictionaryEngine(transport)

    await engine.save('C:/Vault', 'estroma', 'Fluido interno.', {
      notePath: 'bio/fotossintese.md',
      context: 'Onde ocorre a fixacao de carbono.',
    })

    expect(transport).toHaveBeenCalledWith('save_dictionary_entry', {
      vaultRoot: 'C:/Vault',
      term: 'estroma',
      concept: 'Fluido interno.',
      notePath: 'bio/fotossintese.md',
      noteContext: 'Onde ocorre a fixacao de carbono.',
    })
  })

  it('sem nota de origem, nao inventa contexto', async () => {
    // A pagina do dicionario salva a mao: nao ha nota para ligar o verbete.
    const transport = fakeTransport()
    const engine = createDictionaryEngine(transport)

    await engine.save('C:/Vault', 'estroma', 'Fluido interno.')

    expect(transport).toHaveBeenCalledWith('save_dictionary_entry', {
      vaultRoot: 'C:/Vault',
      term: 'estroma',
      concept: 'Fluido interno.',
      notePath: undefined,
      noteContext: undefined,
    })
  })
})
