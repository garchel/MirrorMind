import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

afterEach(cleanup)

function renderDialog(overrides: Partial<React.ComponentProps<typeof UnsavedChangesDialog>> = {}) {
  const handlers = {
    onSaveAndQuit: vi.fn(),
    onDiscardAndQuit: vi.fn(),
    onCancel: vi.fn(),
  }
  render(
    <UnsavedChangesDialog
      open
      paths={['notas/a.md']}
      newNote={false}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('UnsavedChangesDialog', () => {
  it('resume quantas notas seriam perdidas e lista os caminhos', () => {
    renderDialog({ paths: ['notas/fotossintese.md', 'notas/celula.md'] })
    expect(screen.getByText('2 notas têm alterações não salvas')).toBeInTheDocument()
    expect(screen.getByText('notas/fotossintese')).toBeInTheDocument()
    expect(screen.getByText('notas/celula')).toBeInTheDocument()
  })

  it('usa o singular para uma nota', () => {
    renderDialog()
    expect(screen.getByText('Uma nota tem alterações não salvas')).toBeInTheDocument()
  })

  it('resume a lista longa em vez de despejar todas as abas', () => {
    renderDialog({ paths: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'] })
    expect(screen.getByText('e mais 1')).toBeInTheDocument()
    expect(screen.queryByText('e.md')).toBeNull()
  })

  it('conta a nota nova sem arquivo como uma perda', () => {
    renderDialog({ paths: [], newNote: true })
    expect(screen.getByText('Uma nota tem alterações não salvas')).toBeInTheDocument()
    expect(screen.getByText(/ainda não tem arquivo/)).toBeInTheDocument()
  })

  it('leva as tres saidas para quem decide', async () => {
    const user = userEvent.setup()
    const handlers = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Salvar e sair' }))
    expect(handlers.onSaveAndQuit).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Descartar e sair' }))
    expect(handlers.onDiscardAndQuit).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(handlers.onCancel).toHaveBeenCalledTimes(1)
  })

  it('mostra a falha ao salvar e mantem o fechamento bloqueado', () => {
    renderDialog({ error: 'Não foi possível salvar a nota aberta.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível salvar a nota aberta.')
  })

  it('bloqueia as acoes enquanto grava', () => {
    renderDialog({ saving: true })
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descartar e sair' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })
})
