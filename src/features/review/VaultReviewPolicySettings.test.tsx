import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultReviewPolicySettings } from './VaultReviewPolicySettings'

const { getConfigMock, previewMock, setDefaultsMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  previewMock: vi.fn(),
  setDefaultsMock: vi.fn(),
}))

vi.mock('./vaultReviewPolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('./vaultReviewPolicy')>()
  return {
    ...original,
    getVaultReviewPolicyConfig: getConfigMock,
    previewVaultReviewDefaults: previewMock,
    setVaultReviewDefaults: setDefaultsMock,
  }
})

const config = {
  revision: 3,
  defaults: {
    firstReviewIntervalDays: 2,
    targetRetention: 0.8,
    priorityWeight: 1,
    minIntervalDays: 1,
    maxIntervalDays: 365,
    preferredMode: 'exam',
  },
  tagRules: [{
    tag: 'revisao/prova',
    autoEnroll: true,
    firstReviewIntervalDays: 1,
    targetRetention: 0.9,
    priorityWeight: 3,
    minIntervalDays: 1,
    maxIntervalDays: 90,
    deadlineAtUnixMs: null,
  }],  updatedAtUnixMs: null,
  affectedNoteCount: 0,
}

describe('VaultReviewPolicySettings', () => {
  beforeEach(() => {
    getConfigMock.mockReset().mockResolvedValue(config)
    previewMock.mockReset().mockResolvedValue({ affectedNoteCount: 3 })
    setDefaultsMock.mockReset().mockResolvedValue({
      ...config,
      revision: 4,
      affectedNoteCount: 3,
    })
  })

  afterEach(cleanup)

  it('aplica o ritmo assim que a opcao muda, sem botao de salvar', async () => {
    const user = userEvent.setup()
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    expect(screen.queryByRole('button', { name: 'Salvar padrão' })).toBeNull()
    await user.click(await screen.findByRole('radio', { name: 'Intensiva' }))

    await waitFor(() => expect(setDefaultsMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      expectedRevision: 3,
      defaults: {
        firstReviewIntervalDays: 1,
        targetRetention: 0.9,
        priorityWeight: 3,
        minIntervalDays: 1,
        maxIntervalDays: 90,
        preferredMode: 'exam',
      },
    }), { timeout: 2000 })
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('aplica o padrao escolhido em Personalizado (prioridade)', async () => {
    const user = userEvent.setup()
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('radio', { name: 'Intensiva' }))
    await user.click(screen.getByRole('radio', { name: 'Personalizado' }))
    const prioridadeVault = screen.getByRole('radiogroup', { name: 'Prioridade na fila' })
    await user.click(within(prioridadeVault).getByRole('radio', { name: 'Urgente' }))

    await waitFor(() => expect(setDefaultsMock).toHaveBeenCalledWith(expect.objectContaining({
      defaults: expect.objectContaining({ priorityWeight: 3 }),
    })), { timeout: 2000 })
  })

  it('nao aplica o ritmo do vault anterior ao trocar de vault', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('radio', { name: 'Leve' }))
    rerender(<VaultReviewPolicySettings vaultPath={'D:\\Outro'} />)

    await waitFor(() => expect(getConfigMock).toHaveBeenCalledWith('D:\\Outro'))
    // A espera do debounce morre junto com o componente do vault antigo.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(setDefaultsMock).not.toHaveBeenCalledWith(expect.objectContaining({
      vaultPath: 'C:\\Vault',
    }))
  })

  it('mostra o resultado quando nenhuma nota precisa ser reagendada', async () => {
    const user = userEvent.setup()
    setDefaultsMock.mockResolvedValueOnce({
      ...config,
      revision: 4,
      affectedNoteCount: 0,
    })
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('radio', { name: 'Leve' }))

    expect(await screen.findByText(/Nenhuma nota precisou ser reagendada/i)).toBeInTheDocument()
  })

  it('salva o metodo padrao das sessoes sem trocar o ritmo', async () => {
    const user = userEvent.setup()
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('radio', { name: /Conversa/ }))

    await waitFor(() => expect(setDefaultsMock).toHaveBeenCalledWith(expect.objectContaining({
      defaults: expect.objectContaining({
        preferredMode: 'conversation',
        // Ritmo da fixture intacto: metodo e esforco sao ortogonais.
        firstReviewIntervalDays: 2,
        targetRetention: 0.8,
      }),
    })), { timeout: 2000 })
  })

  it('trocar de ritmo preserva o metodo padrao escolhido', async () => {
    const user = userEvent.setup()
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('radio', { name: /Conversa/ }))
    await user.click(screen.getByRole('radio', { name: 'Leve' }))

    await waitFor(() => expect(setDefaultsMock).toHaveBeenCalledWith(expect.objectContaining({
      defaults: expect.objectContaining({
        preferredMode: 'conversation',
        firstReviewIntervalDays: 7,
      }),
    })), { timeout: 2000 })
  })
})
