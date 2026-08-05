import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagManagementPage } from './TagManagementPage'

const {
  getConfigMock,
  getTagIndexMock,
  previewMock,
  applyMock,
} = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getTagIndexMock: vi.fn(),
  previewMock: vi.fn(),
  applyMock: vi.fn(),
}))

vi.mock('../review/vaultReviewPolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../review/vaultReviewPolicy')>()
  return {
    ...original,
    getVaultReviewPolicyConfig: getConfigMock,
  }
})

vi.mock('./tagManagement', async (importOriginal) => {
  const original = await importOriginal<typeof import('./tagManagement')>()
  return {
    ...original,
    getTagIndex: getTagIndexMock,
    previewTagManagementChange: previewMock,
    applyTagManagementChange: applyMock,
  }
})

const rule = {
  tag: 'prova',
  autoEnroll: true,
  firstReviewIntervalDays: 1,
  targetRetention: 0.9,
  priorityWeight: 3,
  minIntervalDays: 1,
  maxIntervalDays: 90,
  deadlineAtUnixMs: null,
}

const config = {
  revision: 3,
  defaults: {
    firstReviewIntervalDays: 2,
    targetRetention: 0.8,
    priorityWeight: 1,
    minIntervalDays: 1,
    maxIntervalDays: 365,
  },
  tagRules: [rule],
  updatedAtUnixMs: null,
  affectedNoteCount: 0,
}

describe('TagManagementPage', () => {
  beforeEach(() => {
    getConfigMock.mockReset().mockResolvedValue(config)
    getTagIndexMock.mockReset().mockResolvedValue([{
      tag: 'prova',
      notePaths: ['materias/biologia.md', 'materias/quimica.md'],
    }])
    previewMock.mockReset().mockResolvedValue({
      affectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      markdownNotePaths: [],
    })
    applyMock.mockReset().mockResolvedValue({
      config: { ...config, revision: 4, affectedNoteCount: 2 },
      affectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      markdownNotePaths: [],
    })
  })

  afterEach(cleanup)

  it('selects a tag and previews every impacted note before editing', async () => {
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    expect(await screen.findByRole('heading', { name: /prova/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Editar/i }))
    const priority = screen.getByLabelText('Prioridade na fila')
    await user.clear(priority)
    await user.type(priority, '4')
    await user.click(screen.getByRole('button', { name: 'Revisar alterações' }))

    expect(await screen.findByRole('dialog', { name: /Salvar alterações em #prova/i })).toBeInTheDocument()
    expect(screen.getByText('materias/biologia.md')).toBeInTheDocument()
    expect(screen.getByText('materias/quimica.md')).toBeInTheDocument()
    expect(applyMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirmar alteração' }))
    await waitFor(() => expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3,
      expectedAffectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      tagRules: [expect.objectContaining({ tag: 'prova', priorityWeight: 4 })],
    })))
  })

  it('asks separately whether deletion should remove the tag from Markdown', async () => {
    const user = userEvent.setup()
    applyMock.mockResolvedValueOnce({
      config: { ...config, revision: 4, tagRules: [], affectedNoteCount: 2 },
      affectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      markdownNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
    })
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /Excluir/i }))
    const removeFromNotes = screen.getByLabelText(/Remover também das notas/i)
    expect(removeFromNotes).not.toBeChecked()
    await user.click(removeFromNotes)
    expect(screen.getByText(/O Markdown das notas abaixo será alterado/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir tag' }))

    await waitFor(() => expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({
      change: {
        currentTag: 'prova',
        nextTag: null,
        removeFromNotes: true,
      },
      tagRules: [],
    })))
  })

  it('creates a configured tag only after a zero-impact confirmation', async () => {
    const user = userEvent.setup()
    previewMock.mockResolvedValueOnce({ affectedNotePaths: [], markdownNotePaths: [] })
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: 'Criar tag' }))
    await user.type(screen.getByLabelText('Nome da tag'), 'Biologia Celular')
    await user.click(screen.getByRole('button', { name: 'Revisar criação' }))

    const dialog = await screen.findByRole('dialog', { name: /Criar #biologia-celular/i })
    expect(dialog).toHaveTextContent('Nenhuma nota existente será alterada')
  })
})
