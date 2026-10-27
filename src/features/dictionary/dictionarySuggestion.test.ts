import { afterEach, describe, expect, it, vi } from 'vitest'
import { suggestDictionaryConcept } from './dictionarySuggestion'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/tauri', () => ({ invoke: invokeMock }))

afterEach(() => {
  invokeMock.mockReset()
})

const SUGESTAO = {
  term: 'estroma',
  concept: 'O fluido interno do cloroplasto.',
  existing: null,
  invalid: false,
}

describe('suggestDictionaryConcept', () => {
  it('envia o rascunho e o trecho para o backend', async () => {
    invokeMock.mockResolvedValue(SUGESTAO)

    const resultado = await suggestDictionaryConcept(
      'C:/Vault',
      'estroma dos cloroplastos',
      '# Ciclo de Calvin\n\nA fixacao ocorre no estroma.',
      'ollama',
    )

    expect(invokeMock).toHaveBeenCalledWith('suggest_dictionary_concept', {
      path: 'C:/Vault',
      term: 'estroma dos cloroplastos',
      markdown: '# Ciclo de Calvin\n\nA fixacao ocorre no estroma.',
      provider: 'ollama',
    })
    expect(resultado).toEqual(SUGESTAO)
  })

  it('traz o verbete existente quando o backend reconhece uma variante', async () => {
    invokeMock.mockResolvedValue({
      ...SUGESTAO,
      existing: {
        term: 'estroma dos cloroplastos',
        concept: 'O fluido onde ocorre a fixação.',
        createdAtUnixMs: 1,
        updatedAtUnixMs: 2,
      },
    })

    const resultado = await suggestDictionaryConcept('C:/Vault', 'estroma', '# Nota', 'ollama')

    expect(resultado.existing?.term).toBe('estroma dos cloroplastos')
  })

  it('recusa uma resposta fora do contrato', async () => {
    invokeMock.mockResolvedValue({ ...SUGESTAO, extra: true })

    await expect(
      suggestDictionaryConcept('C:/Vault', 'estroma', '# Nota', 'ollama'),
    ).rejects.toThrow()
  })

  it('preserva a falha do backend', async () => {
    invokeMock.mockRejectedValue(new Error('O Ollama local nao esta acessivel.'))

    await expect(
      suggestDictionaryConcept('C:/Vault', 'estroma', '# Nota', 'ollama'),
    ).rejects.toThrow('O Ollama local nao esta acessivel.')
  })
})
