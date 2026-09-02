import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoalsPage } from './GoalsPage'

const { listGoalsMock, createGoalMock, createStepNoteMock, updateStepMock } = vi.hoisted(() => ({
  listGoalsMock: vi.fn(),
  createGoalMock: vi.fn(),
  createStepNoteMock: vi.fn(),
  updateStepMock: vi.fn(),
}))

vi.mock('./goals', async (importOriginal) => ({
  ...await importOriginal<typeof import('./goals')>(),
  listGoals: listGoalsMock,
  createGoal: createGoalMock,
  createStepNote: createStepNoteMock,
  updateGoalStep: updateStepMock,
}))

vi.mock('../review/ReviewAiSettingsContext', () => ({
  useReviewAiSettings: () => ({ provider: 'ollama' }),
}))

const sampleGoal = {
  id: 'goal-1',
  title: 'Aprender fotossíntese',
  objective: 'Explicar sem consultar',
  sourceText: '',
  createdAtUnixMs: 1_700_000_000_000,
  steps: [
    {
      order: 1,
      title: 'Fundamentos',
      summary: 'Base mínima.',
      suggestedRelativePath: 'Metas/aprender-fotossintese/01-fundamentos.md',
      status: 'planned' as const,
    },
    {
      order: 2,
      title: 'Prática guiada',
      summary: 'Exercícios.',
      suggestedRelativePath: 'Metas/aprender-fotossintese/02-pratica-guiada.md',
      status: 'planned' as const,
    },
  ],
  aiGenerated: false,
}

describe('GoalsPage', () => {
  beforeEach(() => {
    listGoalsMock.mockReset()
    createGoalMock.mockReset()
    createStepNoteMock.mockReset()
    updateStepMock.mockReset()
    listGoalsMock.mockResolvedValue([sampleGoal])
  })
  afterEach(() => cleanup())

  it('lista metas e mostra o plano em ordem lógica ao expandir', async () => {
    render(<GoalsPage vaultPath="C:\\Vault" onOpenNote={() => undefined} />)
    expect(await screen.findByText('Aprender fotossíntese')).toBeInTheDocument()
    // A primeira meta já abre expandida por padrão.
    const steps = await screen.findByRole('list', { name: /Plano da meta/ })
    const items = within(steps).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Fundamentos')).toBeInTheDocument()
    expect(within(items[1]).getByText('Prática guiada')).toBeInTheDocument()
  })

  it('cria a nota pelo "+" e abre na página de notas', async () => {
    const onOpenNote = vi.fn()
    createStepNoteMock.mockResolvedValue(undefined)
    updateStepMock.mockResolvedValue({
      ...sampleGoal,
      steps: [{ ...sampleGoal.steps[0], noteRelativePath: sampleGoal.steps[0].suggestedRelativePath }, sampleGoal.steps[1]],
    })
    render(<GoalsPage vaultPath="C:\\Vault" onOpenNote={onOpenNote} />)
    await screen.findByRole('list', { name: /Plano da meta/ })
    await userEvent.click(await screen.findByRole('button', { name: 'Criar e abrir nota Fundamentos' }))
    await waitFor(() => expect(createStepNoteMock).toHaveBeenCalledTimes(1))
    expect(updateStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'goal-1', order: 1 }),
    )
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(
      'Metas/aprender-fotossintese/01-fundamentos.md',
    ))
  })

  it('mostra barra de progresso acessível e controle de status por passo', async () => {
    render(<GoalsPage vaultPath="C:\\Vault" onOpenNote={() => undefined} />)
    const progress = await screen.findByRole('progressbar', { name: /Progresso da meta Aprender fotossíntese/ })
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText('0/2 concluídos · 0%')).toBeInTheDocument()
    const statusGroup = await screen.findByRole('group', { name: 'Status do passo 1: Fundamentos' })
    const options = within(statusGroup).getAllByRole('button')
    expect(options.map((option) => option.textContent)).toEqual(['Planejado', 'Estudando', 'Concluído'])
    expect(options[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('cria a meta pelo modal "Nova meta"', async () => {
    createGoalMock.mockResolvedValue({ ...sampleGoal, id: 'goal-2', title: 'Meta nova' })
    render(<GoalsPage vaultPath="C:\\Vault" onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Nova meta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nova meta' })
    await userEvent.type(within(dialog).getByPlaceholderText(/Aprender fotossíntese/), 'Meta nova')
    await userEvent.type(within(dialog).getByPlaceholderText(/resolver 5 exercícios/), 'Ser capaz de X')
    await userEvent.click(within(dialog).getByRole('button', { name: /Criar meta e gerar plano/ }))
    await waitFor(() => expect(createGoalMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Meta nova', objective: 'Ser capaz de X' }),
    ))
    expect(await screen.findByText(/Meta “Meta nova” criada/)).toBeInTheDocument()
  })

  it('fecha o modal "Nova meta" ao clicar fora (backdrop)', async () => {
    render(<GoalsPage vaultPath="C:\\Vault" onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Nova meta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nova meta' })
    // Clique direto no <dialog> = clique no backdrop (o form é filho e não fecha).
    fireEvent.mouseDown(dialog)
    expect(dialog).not.toHaveAttribute('open')
    // Clique dentro do form não fecha.
    await userEvent.click(screen.getByRole('button', { name: 'Nova meta' }))
    const reopened = await screen.findByRole('dialog', { name: 'Nova meta' })
    fireEvent.mouseDown(within(reopened).getByPlaceholderText(/Aprender fotossíntese/))
    expect(reopened).toHaveAttribute('open')
  })
})
