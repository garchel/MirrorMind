import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

  it('shows the affected-note count before applying a preset', async () => {
    const user = userEvent.setup()
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /^Intensiva/ }))
    await user.click(screen.getByRole('button', { name: 'Salvar padrão' }))

    expect(await screen.findByText(/3 notas terão suas datas recalculadas/i)).toBeInTheDocument()
    expect(setDefaultsMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirmar alteração' }))

    await waitFor(() => expect(setDefaultsMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      expectedRevision: 3,
      defaults: {
        firstReviewIntervalDays: 1,
        targetRetention: 0.9,
        priorityWeight: 3,
        minIntervalDays: 1,
        maxIntervalDays: 90,
      },
    }))
  })

  it('applies exactly the defaults whose impact was previewed', async () => {
    const user = userEvent.setup()
    let resolvePreview: ((value: { affectedNoteCount: number }) => void) | undefined
    previewMock.mockReturnValueOnce(new Promise((resolve) => {
      resolvePreview = resolve
    }))
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /^Intensiva/ }))
    await user.click(screen.getByText('Opções avançadas'))
    await user.click(screen.getByRole('button', { name: 'Salvar padrão' }))
    const vaultPriorityInput = screen.getAllByLabelText('Peso de prioridade')[0]
    await user.clear(vaultPriorityInput)
    await user.type(vaultPriorityInput, '9')
    resolvePreview?.({ affectedNoteCount: 3 })

    await user.click(await screen.findByRole('button', { name: 'Confirmar alteração' }))

    await waitFor(() => expect(setDefaultsMock).toHaveBeenCalledWith(expect.objectContaining({
      defaults: expect.objectContaining({ priorityWeight: 3 }),
    })))
  })
  it('does not keep a new Vault busy when an earlier preview finishes late', async () => {
    const user = userEvent.setup()
    let resolvePreview: ((value: { affectedNoteCount: number }) => void) | undefined
    previewMock.mockReturnValueOnce(new Promise((resolve) => {
      resolvePreview = resolve
    }))
    const { rerender } = render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: 'Salvar padrão' }))
    rerender(<VaultReviewPolicySettings vaultPath={'D:\\Outro'} />)

    await waitFor(() => expect(getConfigMock).toHaveBeenCalledWith('D:\\Outro'))
    expect(await screen.findByRole('button', { name: 'Salvar padrão' })).toBeEnabled()
    resolvePreview?.({ affectedNoteCount: 1 })
  })
  it('applies immediately when no existing note is affected', async () => {
    const user = userEvent.setup()
    previewMock.mockResolvedValueOnce({ affectedNoteCount: 0 })
    render(<VaultReviewPolicySettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /^Leve/ }))
    await user.click(screen.getByRole('button', { name: 'Salvar padrão' }))

    await waitFor(() => expect(setDefaultsMock).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status')).toHaveTextContent(/Padrão do Vault salvo/i)
  })
})