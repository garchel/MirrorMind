import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  return { term, concept, createdAtUnixMs: 1, updatedAtUnixMs: 1 }
}

function snapshot(entries: DictionaryEntry[]): DictionarySnapshot {
  return { entries }
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

  it('mostra o estado vazio quando nao ha conceito nenhum', async () => {
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getByText(/Nenhum conceito registrado/)).toBeTruthy()
    })
  })

  it('lista os conceitos do vault', async () => {
    entriesMock.mockResolvedValue(
      snapshot([entry('rubisco', 'Enzima que fixa carbono na fotossíntese.')]),
    )
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('rubisco')).toBeTruthy()
    })
    expect(screen.getByText(/Enzima que fixa carbono/)).toBeTruthy()
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
      expect(screen.getByText('glicólise')).toBeTruthy()
    })
    await userEvent.type(screen.getByPlaceholderText('Buscar por termo'), 'GLICOL')
    await waitFor(() => {
      expect(screen.queryByText('rubisco')).toBeNull()
    })
    expect(screen.getByText('glicólise')).toBeTruthy()
  })

  it('registra um conceito novo', async () => {
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await userEvent.click(screen.getByRole('button', { name: /Novo conceito/ }))
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

  it('mostra o erro do backend quando o registro falha', async () => {
    saveMock.mockRejectedValue(new Error('O conceito nao pode ser vazio.'))
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await userEvent.click(screen.getByRole('button', { name: /Novo conceito/ }))
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
      expect(screen.getByText('rubisco')).toBeTruthy()
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
      expect(screen.getByText('rubisco')).toBeTruthy()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Remover rubisco' }))
    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledWith(VAULT_PATH, 'rubisco')
    })
  })

  it('cancela o formulario sem gravar', async () => {
    render(<DictionaryPage vaultPath={VAULT_PATH} />)
    await userEvent.click(screen.getByRole('button', { name: /Novo conceito/ }))
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
