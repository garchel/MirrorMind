import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedVaultDialog } from './SharedVaultDialog'

// O app não liga o cleanup automático: sem isto o DOM de um teste vaza para o
// seguinte e os botões aparecem duplicados.
afterEach(cleanup)

function abrir(overrides: Partial<Parameters<typeof SharedVaultDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <SharedVaultDialog
      pasta="C:/Users/paulo/Documentos/Estudo"
      outros={['Ana', 'Joao']}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onConfirm, onCancel }
}

describe('aviso de pasta compartilhada', () => {
  it('diz quem já usou e separa o que é comum do que é individual', () => {
    abrir()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/já foi aberta por/)).toBeInTheDocument()
    expect(screen.getByText(/Ana e Joao/)).toBeInTheDocument()
    // as duas metades do contrato, sem eufemismo
    expect(screen.getByText(/Todas as notas e anexos/)).toBeInTheDocument()
    expect(screen.getByText(/Histórico de revisão, metas, dicionário/)).toBeInTheDocument()
    // e a expectativa errada sobre o PIN, desfeita na tela
    expect(screen.getByText(/O PIN do perfil protege a escolha de perfil/)).toBeInTheDocument()
  })

  it('abrir sem marcar a caixa não dispensa o aviso', async () => {
    const user = userEvent.setup()
    const { onConfirm } = abrir()

    await user.click(screen.getByRole('button', { name: 'Abrir compartilhado' }))

    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('marcar "não avisar de novo" leva a dispensa junto', async () => {
    const user = userEvent.setup()
    const { onConfirm } = abrir()

    await user.click(screen.getByRole('checkbox', { name: /Não avisar de novo/ }))
    await user.click(screen.getByRole('button', { name: 'Abrir compartilhado' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('escolher outra pasta não abre nada', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = abrir()

    await user.click(screen.getByRole('button', { name: 'Escolher outra pasta' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
