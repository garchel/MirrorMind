import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteTagPicker } from './NoteTagPicker'

const { getNoteReviewStateMock, getVaultReviewPolicyConfigMock } = vi.hoisted(() => ({
  getNoteReviewStateMock: vi.fn(),
  getVaultReviewPolicyConfigMock: vi.fn(),
}))

vi.mock('../features/review/ai', () => ({
  getNoteReviewState: getNoteReviewStateMock,
  reviewAiErrorMessage: () => 'Falha de revis?o.',
}))

vi.mock('../features/review/vaultReviewPolicy', () => ({
  getVaultReviewPolicyConfig: getVaultReviewPolicyConfigMock,
}))

const config = {
  revision: 0,
  defaults: {
    firstReviewIntervalDays: 2,
    targetRetention: 0.8,
    priorityWeight: 1,
    minIntervalDays: 1,
    maxIntervalDays: 365,
  },
  tagRules: [{
    tag: 'estudo',
    autoEnroll: true,
    firstReviewIntervalDays: 2,
    targetRetention: 0.8,
    priorityWeight: 1,
    minIntervalDays: 1,
    maxIntervalDays: 365,
    deadlineAtUnixMs: null,
  }],
  updatedAtUnixMs: null,
  affectedNoteCount: 0,
}

describe('NoteTagPicker', () => {
  beforeEach(() => {
    getVaultReviewPolicyConfigMock.mockReset().mockResolvedValue(config)
    getNoteReviewStateMock.mockReset().mockResolvedValue({
      noteId: 'note-1',
      relativePath: 'nota.md',
      contentHash: 'sha256:note',
      readiness: 'unassessed',
      assessedAtUnixMs: null,
      report: null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
    })
  })

  afterEach(cleanup)

  it('confirma o impacto e avisa quando a tag ativa revis?o autom?tica', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<NoteTagPicker availableTags={[]} onApply={onApply} relativePath="nota.md" tags={[]} vaultPath="C:\\Vault" />)

    await user.click(screen.getByRole('button', { name: 'Tags associadas a nota' }))
    await user.click(await screen.findByRole('menuitem', { name: '#estudo' }))

    expect(await screen.findByRole('dialog', { name: 'Aplicar #estudo' })).toHaveTextContent('Fa?a a avalia??o da nota antes de aplicar esta tag')
    await user.click(screen.getByRole('button', { name: 'Aplicar tag' }))

    expect(onApply).toHaveBeenCalledWith('estudo')
  })

  it('bloqueia a selecao enquanto os detalhes da revisao nao podem ser carregados', async () => {
    const user = userEvent.setup()
    getVaultReviewPolicyConfigMock.mockRejectedValueOnce(new Error('falha'))

    render(<NoteTagPicker availableTags={['existente']} onApply={vi.fn()} relativePath="nota.md" tags={[]} vaultPath="C:\\Vault" />)

    await user.click(screen.getByRole('button', { name: 'Tags associadas a nota' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '#existente' })).not.toBeInTheDocument()
  })
})
