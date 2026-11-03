import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DictionaryPage } from './DictionaryPage'
import type { DictionaryEntry, DictionarySnapshot } from './dictionarySchema'

const { entriesMock, saveMock, removeMock } = vi.hoisted(() => ({
  entriesMock: vi.fn(),
  saveMock: vi.fn(),
  removeMock: vi.fn(),
}))

vi.mock('./dictionaryEngine', async (importOriginal) => ({
  ...await importOriginal<typeof import('./dictionaryEngine')>(),
  createDictionaryEngine: () => ({
    entries: entriesMock,
    save: saveMock,
    remove: removeMock,
    limits: vi.fn(async () => ({ maxTermChars: 120, maxConceptChars: 2000 })),
  }),
}))

const VAULT_PATH = 'C:\\Vault'

function entry(term: string, concept: string): DictionaryEntry {
  return { term, concept, createdAtUnixMs: 1, updatedAtUnixMs: 1, contexts: [] }
}

function snapshot(entries: DictionaryEntry[]): DictionarySnapshot {
  return { entries }
}

/** A lista lateral e o painel de detalhe, para os testes nao dependerem de
 * qual dos dois mostra o termo (os dois mostram). */
function termsPane() {
  return screen.getByRole('complementary', { name: 'Termos salvos' })
}

function detailPane() {
  return screen.getByRole('main')
}

describe('DictionaryPage', () => {
  beforeEach(() => {
    entriesMock.mockReset()
    saveMock.mockReset()
    removeMock.mockReset()
    entriesMock.mockResolvedValue(snapshot([]))
    saveMock.mockResolvedValue(snapshot([]))
    removeMock.mockResolvedValue(snapshot([]))
  })

  afterEach(() => {
    cleanup()
  })

  it('mostra o esqueleto enquanto o dicionario carrega', () => {
    entriesMock.mockImplementation(() => new Promise(() => {}))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Lendo o dicionário...')
  })

  it('mostra o estado vazio quando nao ha conceito nenhum', async () => {
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getByText(/Nenhum conceito registrado/)).toBeTruthy()
    })
    expect(within(termsPane()).getByText('Nenhum termo ainda')).toBeTruthy()
  })

  it('lista os conceitos do vault na lateral e mostra o primeiro no detalhe', async () => {
    entriesMock.mockResolvedValue(
      snapshot([entry('rubisco', 'Enzima que fixa carbono na fotossíntese.')]),
    )
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(within(termsPane()).getByRole('button', { name: 'rubisco' })).toBeTruthy()
    })
    expect(within(detailPane()).getByRole('heading', { name: 'rubisco' })).toBeTruthy()
    expect(within(detailPane()).getByText(/Enzima que fixa carbono/)).toBeTruthy()
  })

  it('filtra por termo ignorando caixa e acentos', async () => {
    entriesMock.mockResolvedValue(
      snapshot([
        entry('glicólise', 'Quebra da glicose.'),
        entry('rubisco', 'Enzima que fixa carbono.'),
      ]),
    )
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
    })
    await userEvent.type(screen.getByPlaceholderText('Buscar por termo'), 'GLICOL')
    await waitFor(() => {
      expect(screen.queryByText('rubisco')).toBeNull()
    })
    expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
  })

  it('filtra pela letra e limpa o filtro ao clicar de novo', async () => {
    entriesMock.mockResolvedValue(
      snapshot([
        entry('glicólise', 'Quebra da glicose.'),
        entry('rubisco', 'Enzima que fixa carbono.'),
      ]),
    )
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
    })

    const letraG = screen.getByRole('button', { name: 'Letra G' })
    await userEvent.click(letraG)
    expect(letraG).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('rubisco')).toBeNull()
    expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)

    await userEvent.click(letraG)
    expect(letraG).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByText('rubisco').length).toBeGreaterThan(0)
  })

  it('combina a busca com a letra escolhida', async () => {
    entriesMock.mockResolvedValue(
      snapshot([
        entry('glicólise', 'Quebra da glicose.'),
        entry('glicogênio', 'Reserva de glicose.'),
        entry('rubisco', 'Enzima.'),
      ]),
    )
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
    })

    await userEvent.type(screen.getByPlaceholderText('Buscar por termo'), 'glico')
    await userEvent.click(screen.getByRole('button', { name: 'Letra G' }))
    expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
    expect(screen.getAllByText('glicogênio').length).toBeGreaterThan(0)
    expect(screen.queryByText('rubisco')).toBeNull()

    // A letra R nao tem nenhum termo que contenha "glico": o filtro vazio
    // tem de dizer que nada foi encontrado, nao mostrar um termo antigo.
    await userEvent.click(screen.getByRole('button', { name: 'Letra R' }))
    expect(screen.queryByText('glicólise')).toBeNull()
    expect(screen.queryByText('glicogênio')).toBeNull()
    expect(screen.getByText('Nenhum conceito encontrado')).toBeTruthy()
  })

  it('permite filtrar por uma letra sem nenhum termo', async () => {
    // Toda letra ativa o filtro: o clique nunca deve ser um botao inerte.
    entriesMock.mockResolvedValue(snapshot([entry('glicólise', 'Quebra da glicose.')]))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
    })

    const letraZ = screen.getByRole('button', { name: 'Letra Z' })
    expect(letraZ).toBeEnabled()
    await userEvent.click(letraZ)
    expect(letraZ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('glicólise')).toBeNull()
    expect(within(termsPane()).getByText('Nenhum termo encontrado')).toBeTruthy()
    expect(within(detailPane()).getByText('Nenhum conceito encontrado')).toBeTruthy()

    await userEvent.click(letraZ)
    expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
  })

  it('troca o conceito mostrado ao escolher um termo na lista', async () => {
    entriesMock.mockResolvedValue(
      snapshot([
        entry('glicólise', 'Quebra da glicose.'),
        entry('rubisco', 'Enzima que fixa carbono.'),
      ]),
    )
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(within(detailPane()).getByRole('heading', { name: 'glicólise' })).toBeTruthy()
    })

    await userEvent.click(screen.getByRole('button', { name: 'rubisco' }))
    expect(within(detailPane()).getByRole('heading', { name: 'rubisco' })).toBeTruthy()
    expect(within(detailPane()).getByText(/Enzima que fixa carbono/)).toBeTruthy()
    expect(within(detailPane()).queryByText(/Quebra da glicose/)).toBeNull()
  })

  it('mostra os contextos do termo por nota, fechados por padrao', async () => {
    const comContexto: DictionaryEntry = {
      ...entry('estroma', 'Fluido interno do cloroplasto.'),
      contexts: [
        {
          notePath: 'bio/fotossintese.md',
          context: 'Onde ocorre a fixacao de carbono.',
          capturedAtUnixMs: 2,
        },
        {
          notePath: 'bio/respiracao.md',
          context: 'Espaco interno da mitocondria.',
          capturedAtUnixMs: 1,
        },
      ],
    }
    entriesMock.mockResolvedValue(snapshot([comContexto]))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)

    const summary = await screen.findByText('Contextos em 2 notas')
    const details = summary.closest('details')
    expect(details?.open).toBe(false)

    await userEvent.click(summary)
    expect(details?.open).toBe(true)
    expect(screen.getByText('bio/fotossintese.md')).toBeTruthy()
    expect(screen.getByText('Onde ocorre a fixacao de carbono.')).toBeTruthy()
  })

  it('nao mostra a secao de contextos quando o verbete nao tem nenhum', async () => {
    entriesMock.mockResolvedValue(snapshot([entry('rubisco', 'Enzima.')]))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(within(detailPane()).getByRole('heading', { name: 'rubisco' })).toBeTruthy()
    })
    expect(screen.queryByText(/Contexto em/)).toBeNull()
    expect(screen.queryByText(/Contextos em/)).toBeNull()
  })

  it('registra um conceito novo', async () => {
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await userEvent.click(await screen.findByRole('button', { name: /Novo conceito/ }))
    await userEvent.type(screen.getByPlaceholderText('ex.: glicólise aeróbica'), 'rubisco')
    await userEvent.type(
      screen.getByPlaceholderText(/A definição que aparece/),
      'Enzima que fixa carbono.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(VAULT_PATH, 'rubisco', 'Enzima que fixa carbono.')
    })
  })

  it('limpa o filtro quando o termo salvo ficaria escondido', async () => {
    // A lista esta filtrada por "G"; o termo novo comeca com "R". Sem limpar
    // o filtro, ele sumiria logo depois de salvo.
    entriesMock.mockResolvedValue(snapshot([entry('glicólise', 'Quebra da glicose.')]))
    saveMock.mockResolvedValue(
      snapshot([entry('glicólise', 'Quebra da glicose.'), entry('rubisco', 'Enzima.')]),
    )
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('glicólise').length).toBeGreaterThan(0)
    })

    await userEvent.click(screen.getByRole('button', { name: 'Letra G' }))
    await userEvent.click(screen.getByRole('button', { name: /Novo conceito/ }))
    await userEvent.type(screen.getByPlaceholderText('ex.: glicólise aeróbica'), 'rubisco')
    await userEvent.type(screen.getByPlaceholderText(/A definição que aparece/), 'Enzima.')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Letra G' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })
    expect(screen.getAllByText('rubisco').length).toBeGreaterThan(0)
  })

  it('mostra o erro do backend quando o registro falha', async () => {
    saveMock.mockRejectedValue(new Error('O conceito nao pode ser vazio.'))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await userEvent.click(await screen.findByRole('button', { name: /Novo conceito/ }))
    await userEvent.type(screen.getByPlaceholderText('ex.: glicólise aeróbica'), 'rubisco')
    await userEvent.type(
      screen.getByPlaceholderText(/A definição que aparece/),
      'Enzima que fixa carbono.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => {
      // O erro aparece no formulario E no estado de erro da pagina. O
      // formulario e o lugar certo: e ali que o usuario esta.
      expect(screen.getByText(/O conceito nao pode ser vazio/)).toBeTruthy()
    })
  })

  it('edita um conceito existente', async () => {
    entriesMock.mockResolvedValue(snapshot([entry('rubisco', 'Primeira definição.')]))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(within(detailPane()).getByRole('heading', { name: 'rubisco' })).toBeTruthy()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Editar rubisco' }))
    const campo = screen.getByPlaceholderText(/A definição que aparece/)
    await userEvent.clear(campo)
    await userEvent.type(campo, 'Segunda definição.')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(VAULT_PATH, 'rubisco', 'Segunda definição.')
    })
  })

  it('remove um conceito', async () => {
    entriesMock.mockResolvedValue(snapshot([entry('rubisco', 'Enzima.')]))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(within(detailPane()).getByRole('heading', { name: 'rubisco' })).toBeTruthy()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Remover rubisco' }))
    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledWith(VAULT_PATH, 'rubisco')
    })
  })

  it('cancela o formulario sem gravar', async () => {
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await userEvent.click(await screen.findByRole('button', { name: /Novo conceito/ }))
    await userEvent.type(screen.getByPlaceholderText('ex.: glicólise aeróbica'), 'rubisco')
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/ }))
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('nao carrega o dicionario de outro vault', async () => {
    const OUTRO_VAULT_PATH = 'C:\\OutroVault'
    const { rerender } = render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(entriesMock).toHaveBeenCalledWith(VAULT_PATH)
    })
    rerender(<DictionaryPage vaultPath={OUTRO_VAULT_PATH} />)
    await waitFor(() => {
      expect(entriesMock).toHaveBeenCalledWith(OUTRO_VAULT_PATH)
    })
  })
})
