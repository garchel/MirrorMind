import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrashPage } from './TrashPage'
import type { TrashItem } from '../../lib/useTrashItems'

afterEach(cleanup)

const DIA = 86_400_000
const hoje = Math.floor(Date.now() / DIA)

function item(overrides: Partial<TrashItem> = {}): TrashItem {
  return {
    id: 't1',
    originalRelativePath: 'Prova/ATP.md',
    trashedName: 'ATP.md.abc',
    itemType: 'note',
    deletedAtDay: hoje - 2,
    ...overrides,
  }
}

function renderPage(trashItems: TrashItem[], handlers: {
  restore?: (id: string) => void
  excluir?: (item: TrashItem | null) => void
} = {}) {
  return render(
    <TrashPage
      trashItems={trashItems}
      loading={false}
      restoreTrashItem={handlers.restore ?? vi.fn()}
      setPermanentDeleteTarget={handlers.excluir ?? vi.fn()}
    />,
  )
}

describe('TrashPage', () => {
  it('usa o cabecalho padrao e mostra quanto falta para expirar', () => {
    renderPage([item()])

    expect(screen.getByRole('heading', { name: 'Arquivos excluídos' })).toBeInTheDocument()
    // Excluido ha 2 dias, com prazo de 30: faltam 28.
    expect(screen.getByText('28 dias')).toBeInTheDocument()
  })

  it('destaca o item que esta perto de ser apagado', () => {
    renderPage([item({ deletedAtDay: hoje - 26 })])

    const expira = screen.getByText('4 dias')
    expect(expira).toHaveClass('is-critical')
    // O numero fica em <strong>, entao o texto e quebrado em nos: olhamos o bloco.
    expect(document.querySelector('.trash-count')).toHaveTextContent('1 expira em até 7 dias')
  })

  it('filtra por nome ou caminho', async () => {
    const user = userEvent.setup()
    renderPage([
      item({ id: 'a', originalRelativePath: 'Prova/ATP.md' }),
      item({ id: 'b', originalRelativePath: 'Leituras/Cap-4.md' }),
    ])

    await user.type(screen.getByRole('searchbox', { name: 'Buscar na lixeira' }), 'cap')

    expect(screen.getByText('Leituras/Cap-4')).toBeInTheDocument()
    expect(screen.queryByText('Prova/ATP')).not.toBeInTheDocument()
  })

  it('avisa quando o filtro nao acha nada, sem dizer que a lixeira esta vazia', async () => {
    const user = userEvent.setup()
    renderPage([item()])

    await user.type(screen.getByRole('searchbox', { name: 'Buscar na lixeira' }), 'inexistente')

    expect(screen.getByText(/Nenhum item corresponde a/)).toBeInTheDocument()
    expect(screen.queryByText(/A lixeira está vazia/)).not.toBeInTheDocument()
  })

  it('restaura os itens selecionados de uma vez', async () => {
    const user = userEvent.setup()
    const restore = vi.fn()
    renderPage([
      item({ id: 'a', originalRelativePath: 'Prova/ATP.md' }),
      item({ id: 'b', originalRelativePath: 'Leituras/Cap-4.md' }),
    ], { restore })

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar todos os itens' }))
    await user.click(screen.getByRole('button', { name: /Restaurar selecionados/ }))

    expect(restore).toHaveBeenCalledWith('a')
    expect(restore).toHaveBeenCalledWith('b')
  })

  it('permite restaurar um item so, pelo nome dele', async () => {
    const user = userEvent.setup()
    const restore = vi.fn()
    renderPage([item()], { restore })

    await user.click(screen.getByRole('button', { name: 'Restaurar Prova/ATP.md' }))
    expect(restore).toHaveBeenCalledWith('t1')
  })

  it('mostra o estado vazio orientado', () => {
    renderPage([])

    const tabela = screen.getByRole('table')
    expect(within(tabela).getByText(/A lixeira está vazia/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Selecionar todos os itens' })).toBeDisabled()
  })
})
