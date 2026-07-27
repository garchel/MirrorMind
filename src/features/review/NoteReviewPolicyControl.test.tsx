import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteReviewPolicyControl } from './NoteReviewPolicyControl'
import type { NoteReviewPolicy } from './reviewPolicy'

const { getPolicyMock, setPolicyMock } = vi.hoisted(() => ({
  getPolicyMock: vi.fn(),
  setPolicyMock: vi.fn(),
}))

vi.mock('./reviewPolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reviewPolicy')>()
  return {
    ...original,
    getNoteReviewPolicy: getPolicyMock,
    setNoteReviewPolicy: setPolicyMock,
  }
})

const policy: NoteReviewPolicy = {
  firstReviewIntervalDays: 2,
  targetRetention: 0.8,
  priorityWeight: 1,
  minIntervalDays: 1,
  maxIntervalDays: 365,
  preferredMode: 'exam',
  sources: {
    firstReviewIntervalDays: { kind: 'vaultDefault', sourceId: null },
    targetRetention: { kind: 'vaultDefault', sourceId: null },
    priorityWeight: { kind: 'vaultDefault', sourceId: null },
    minIntervalDays: { kind: 'vaultDefault', sourceId: null },
    maxIntervalDays: { kind: 'vaultDefault', sourceId: null },
  },
  firstReviewAtUnixMs: 1_920_172_800_000,
  nextReviewAtUnixMs: 1_920_172_800_000,
  completedReviewCount: 0,
  enrolled: true,
  due: false,
}

describe('NoteReviewPolicyControl', () => {
  beforeEach(() => {
    getPolicyMock.mockReset().mockResolvedValue(policy)
    setPolicyMock.mockReset().mockImplementation(async ({ policy: saved }) => ({
      ...policy,
      ...saved,
      sources: Object.fromEntries(Object.keys(policy.sources).map((key) => [key, { kind: 'note', sourceId: 'note-1' }])),
    }))
  })

  afterEach(cleanup)

  it('applies a simple policy profile and persists the preferred review mode', async () => {
    const user = userEvent.setup()
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByRole('button', { name: /^Intensiva/ }))
    await user.click(screen.getByRole('radio', { name: /Conversa/i }))
    await user.click(screen.getByRole('button', { name: 'Salvar política' }))

    await waitFor(() => expect(setPolicyMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
      policy: {
        firstReviewIntervalDays: 1,
        targetRetention: 0.9,
        priorityWeight: 3,
        minIntervalDays: 1,
        maxIntervalDays: 90,
        preferredMode: 'conversation',
        overrideFields: [
          'firstReviewIntervalDays',
          'targetRetention',
          'priorityWeight',
          'minIntervalDays',
          'maxIntervalDays',
        ],
        inheritFields: [],
      },
    }))
    expect(screen.getByRole('status')).toHaveTextContent(/Configuração da nota/i)
  })

  it('shows advanced values and validates interval order before saving', async () => {
    const user = userEvent.setup()
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByText('Opções avançadas'))
    await user.clear(screen.getByLabelText('Intervalo mínimo (dias)'))
    await user.type(screen.getByLabelText('Intervalo mínimo (dias)'), '30')
    await user.clear(screen.getByLabelText('Intervalo máximo (dias)'))
    await user.type(screen.getByLabelText('Intervalo máximo (dias)'), '10')

    expect(screen.getByRole('button', { name: 'Salvar política' })).toBeDisabled()
    expect(screen.getByText(/máximo deve ser igual ou maior/i)).toBeInTheDocument()
  })
  it('offers a retry when the policy cannot be loaded', async () => {
    const user = userEvent.setup()
    getPolicyMock.mockRejectedValueOnce(new Error('O arquivo mudou')).mockResolvedValueOnce(policy)
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: /Falha ao carregar.*Tentar novamente/i }))

    expect(await screen.findByRole('button', { name: 'Configurar revisão da nota' })).toBeEnabled()
    expect(getPolicyMock).toHaveBeenCalledTimes(2)
  })

  it('closes the policy dialog with Escape', async () => {
    const user = userEvent.setup()
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('changes only the preferred mode without freezing inherited policy values', async () => {
    const user = userEvent.setup()
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByRole('radio', { name: /Conversa/i }))
    await user.click(screen.getByRole('button', { name: 'Salvar política' }))

    await waitFor(() => expect(setPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      policy: expect.objectContaining({
        preferredMode: 'conversation',
        overrideFields: [],
        inheritFields: [],
      }),
    })))
  })

  it('discards unsaved values when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByText('Opções avançadas'))
    const priority = screen.getByLabelText('Peso de prioridade')
    await user.clear(priority)
    await user.type(priority, '9')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByText('Opções avançadas'))

    expect(screen.getByLabelText('Peso de prioridade')).toHaveValue(1)
  })
  it('removes note overrides and returns every numeric field to the Vault policy', async () => {
    const user = userEvent.setup()
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByRole('button', { name: 'Usar padrão do Vault' }))

    await waitFor(() => expect(setPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      policy: expect.objectContaining({
        overrideFields: [],
        inheritFields: [
          'firstReviewIntervalDays',
          'targetRetention',
          'priorityWeight',
          'minIntervalDays',
          'maxIntervalDays',
        ],
      }),
    })))
  })
  it('does not keep the next note busy when an earlier save finishes late', async () => {
    const user = userEvent.setup()
    let resolveSave: ((value: NoteReviewPolicy) => void) | undefined
    setPolicyMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve
    }))
    const { rerender } = render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="primeira.md"
      sourceRevision="# Primeira"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByRole('button', { name: 'Salvar política' }))
    rerender(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="segunda.md"
      sourceRevision="# Segunda"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    expect(screen.getByRole('button', { name: 'Salvar política' })).toBeEnabled()
    resolveSave?.(policy)
  })
  it('can return to the Vault policy even when draft intervals are invalid', async () => {
    const user = userEvent.setup()
    render(<NoteReviewPolicyControl
      vaultPath={'C:\\Vault'}
      relativePath="biologia.md"
      sourceRevision="# Biologia"
      isDirty={false}
    />)

    await user.click(await screen.findByRole('button', { name: 'Configurar revisão da nota' }))
    await user.click(screen.getByText('Opções avançadas'))
    await user.clear(screen.getByLabelText('Intervalo mínimo (dias)'))
    await user.type(screen.getByLabelText('Intervalo mínimo (dias)'), '30')
    await user.clear(screen.getByLabelText('Intervalo máximo (dias)'))
    await user.type(screen.getByLabelText('Intervalo máximo (dias)'), '10')
    await user.click(screen.getByRole('button', { name: 'Usar padrão do Vault' }))

    await waitFor(() => expect(setPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      policy: expect.objectContaining({
        overrideFields: [],
        inheritFields: [
          'firstReviewIntervalDays',
          'targetRetention',
          'priorityWeight',
          'minIntervalDays',
          'maxIntervalDays',
        ],
      }),
    })))
  })
})
