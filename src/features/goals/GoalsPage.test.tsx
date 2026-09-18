import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoalsPage } from './GoalsPage'

const { listGoalsMock, createGoalMock, createGoalStepNoteMock, updateStepMock, deleteGoalMock, setModeMock } = vi.hoisted(() => ({
  listGoalsMock: vi.fn(),
  createGoalMock: vi.fn(),
  createGoalStepNoteMock: vi.fn(),
  updateStepMock: vi.fn(),
  deleteGoalMock: vi.fn(),
  setModeMock: vi.fn(),
}))

vi.mock('./goals', async (importOriginal) => ({
  ...await importOriginal<typeof import('./goals')>(),
  listGoals: listGoalsMock,
  createGoal: createGoalMock,
  createGoalStepNote: createGoalStepNoteMock,
  updateGoalStep: updateStepMock,
  deleteGoal: deleteGoalMock,
  setGoalNoteContentMode: setModeMock,
}))

vi.mock('../review/ReviewAiSettingsContext', () => ({
  useReviewAiSettings: () => ({ provider: 'ollama' }),
}))

// Caminho via const (não literal em JSX): escapes em atributos JSX não são
// avaliados da mesma forma pelo transform e dobrariam as barras no runtime.
const VAULT_PATH = 'C:\\Vault'

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
  noteContentMode: 'blank' as const,
}

describe('GoalsPage', () => {
  beforeEach(() => {
    listGoalsMock.mockReset()
    createGoalMock.mockReset()
    createGoalStepNoteMock.mockReset()
    updateStepMock.mockReset()
    deleteGoalMock.mockReset()
    setModeMock.mockReset()
    listGoalsMock.mockResolvedValue([sampleGoal])
    deleteGoalMock.mockResolvedValue(undefined)
  })
  afterEach(() => cleanup())

  it('lista as metas em cards e abre o plano em ordem lógica no modal', async () => {
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    expect(await screen.findByText('Aprender fotossíntese')).toBeInTheDocument()
    // Plano fechado por padrão: só abre no modal do card.
    expect(screen.queryByRole('list', { name: /Plano da meta/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    const steps = within(dialog).getByRole('list', { name: /Plano da meta/ })
    const items = within(steps).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Fundamentos')).toBeInTheDocument()
    expect(within(items[1]).getByText('Prática guiada')).toBeInTheDocument()
  })

  it('mostra as métricas gerais no cabeçalho e os passos concluídos no modal', async () => {
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    expect(screen.getByText('1 meta')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    expect(within(dialog).getByText('Passos concluídos')).toBeInTheDocument()
    expect(within(dialog).getByText('0/2 · 0%')).toBeInTheDocument()
  })

  it('cria a nota pelo "+" no modal (com indexadora) e abre na página de notas', async () => {
    const onOpenNote = vi.fn()
    const updated = {
      ...sampleGoal,
      steps: [{ ...sampleGoal.steps[0], noteRelativePath: sampleGoal.steps[0].suggestedRelativePath }, sampleGoal.steps[1]],
    }
    createGoalStepNoteMock.mockResolvedValue({
      goal: updated,
      notePath: 'Metas/aprender-fotossintese/01-fundamentos.md',
      indexPath: 'Metas/aprender-fotossintese/00-aprender-fotossintese.md',
    })
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={onOpenNote} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar e abrir nota Fundamentos' }))
    await waitFor(() => expect(createGoalStepNoteMock).toHaveBeenCalledTimes(1))
    const received = createGoalStepNoteMock.mock.calls[0][0] as { vaultPath: string; order: number }
    expect(received.order).toBe(1)
    expect(received.vaultPath).toBe(VAULT_PATH)
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(
      'Metas/aprender-fotossintese/01-fundamentos.md',
    ))
  })

  it('orienta o começo com guia e CTA quando não há metas', async () => {
    listGoalsMock.mockResolvedValue([])
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    expect(await screen.findByText('Nenhuma meta ainda.')).toBeInTheDocument()
    expect(screen.getByText(/quebra seu objetivo em notas ordenadas/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Criar primeira meta' }))
    expect(await screen.findByRole('dialog', { name: 'Nova meta' })).toBeInTheDocument()
  })

  it('fecha o modal de detalhe ao clicar fora (backdrop)', async () => {
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    fireEvent.mouseDown(dialog)
    expect(dialog).not.toHaveAttribute('open')
  })

  it('exclui a meta com confirmação em duas etapas dentro do modal', async () => {
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir meta Aprender fotossíntese' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar exclusão da meta Aprender fotossíntese' }))
    await waitFor(() => expect(deleteGoalMock).toHaveBeenCalledTimes(1))
    expect(deleteGoalMock.mock.calls[0][1]).toBe('goal-1')
    expect(screen.queryByText('Aprender fotossíntese')).not.toBeInTheDocument()
  })

  it('deriva o progresso das notas criadas (sem controle manual)', async () => {
    listGoalsMock.mockResolvedValue([{
      ...sampleGoal,
      steps: [{ ...sampleGoal.steps[0], noteRelativePath: sampleGoal.steps[0].suggestedRelativePath }, sampleGoal.steps[1]],
    }])
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    // Card e cabeçalho refletem 1 de 2 (50%) só pela nota vinculada.
    expect(screen.getByText('1/2 · 50%')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    const progress = within(dialog).getByRole('progressbar', { name: /Progresso da meta Aprender fotossíntese/ })
    expect(progress).toHaveAttribute('aria-valuenow', '50')
    expect(within(dialog).getByText('1/2 · 50%')).toBeInTheDocument()
    // Passo com nota mostra abrir (check) e sem controle manual de status.
    expect(within(dialog).getByRole('button', { name: 'Abrir nota Fundamentos' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: /Status do passo/ })).not.toBeInTheDocument()
  })

  it('mostra barra de progresso acessível no bloco único do modal', async () => {
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    const progress = within(dialog).getByRole('progressbar', { name: /Progresso da meta Aprender fotossíntese/ })
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    // Números aparecem uma única vez no modal (sem duplicação).
    expect(within(dialog).getAllByText('0/2 · 0%')).toHaveLength(1)
  })

  it('cria a meta pelo modal "Nova meta"', async () => {
    createGoalMock.mockResolvedValue({ ...sampleGoal, id: 'goal-2', title: 'Meta nova' })
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
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

  it('envia o modo de conteúdo escolhido no modal "Nova meta"', async () => {
    createGoalMock.mockResolvedValue({ ...sampleGoal, id: 'goal-2', title: 'Meta nova' })
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Nova meta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nova meta' })
    // Ícone de ajuda explica as opções sem poluir o formulário.
    expect(within(dialog).getByRole('button', { name: 'Como funcionam as opções' })).toBeInTheDocument()
    expect(within(dialog).getByText(/sem inventar fatos/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Conteúdo das notas novas' }))
    await userEvent.click(within(dialog).getByRole('option', { name: 'Esqueleto com IA' }))
    await userEvent.type(within(dialog).getByPlaceholderText(/Aprender fotossíntese/), 'Meta nova')
    await userEvent.type(within(dialog).getByPlaceholderText(/resolver 5 exercícios/), 'Ser capaz de X')
    await userEvent.click(within(dialog).getByRole('button', { name: /Criar meta e gerar plano/ }))
    await waitFor(() => expect(createGoalMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Meta nova', noteContentMode: 'ai' }),
    ))
  })

  it('altera o modo de conteúdo no modal da meta e persiste', async () => {
    setModeMock.mockResolvedValue({ ...sampleGoal, noteContentMode: 'ai' as const })
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Conteúdo das notas novas' }))
    await userEvent.click(within(dialog).getByRole('option', { name: 'Esqueleto com IA' }))
    await waitFor(() => expect(setModeMock).toHaveBeenCalledWith(
      { vaultPath: VAULT_PATH, id: 'goal-1', noteContentMode: 'ai' },
    ))
  })

  it('navega no dropdown por teclado e fecha com Escape sem fechar o modal', async () => {
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    const trigger = within(dialog).getByRole('button', { name: 'Conteúdo das notas novas' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    // Abre com foco na opção atual; seta desce para a próxima.
    await userEvent.keyboard('{ArrowDown}')
    expect(within(dialog).getByRole('option', { name: 'Esqueleto com IA' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Aprender fotossíntese' })).toBeInTheDocument()
  })

  it('avisa quando a IA falha e a nota nasce em branco', async () => {
    createGoalStepNoteMock.mockResolvedValue({
      goal: sampleGoal,
      notePath: 'Metas/aprender-fotossintese/01-fundamentos.md',
      indexPath: 'Metas/aprender-fotossintese/00-aprender-fotossintese.md',
      usedAiDraft: false,
      draftError: 'Orçamento mensal de IA atingido',
    })
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
    await screen.findByText('Aprender fotossíntese')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir detalhes da meta Aprender fotossíntese' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aprender fotossíntese' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar e abrir nota Fundamentos' }))
    expect(await within(dialog).findByText(/criada em branco/)).toBeInTheDocument()
  })

  it('fecha o modal "Nova meta" ao clicar fora (backdrop)', async () => {
    render(<GoalsPage vaultPath={VAULT_PATH} onOpenNote={() => undefined} />)
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
