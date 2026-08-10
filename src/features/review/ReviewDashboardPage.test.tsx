import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewDashboardPage } from './ReviewDashboardPage'

const { getDashboardMock, getConfigMock, previewDeadlineMock, applyDeadlineMock, setPriorityMock } = vi.hoisted(() => ({
  getDashboardMock: vi.fn(),
  getConfigMock: vi.fn(),
  previewDeadlineMock: vi.fn(),
  applyDeadlineMock: vi.fn(),
  setPriorityMock: vi.fn(),
}))

vi.mock('./reviewDashboard', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewDashboard')>(),
  getVaultReviewDashboard: getDashboardMock,
}))

vi.mock('./vaultReviewPolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('./vaultReviewPolicy')>(),
  getVaultReviewPolicyConfig: getConfigMock,
  previewDeadlineChange: previewDeadlineMock,
  applyDeadlineChange: applyDeadlineMock,
}))

vi.mock('./reviewPolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewPolicy')>(),
  setNoteReviewPriority: setPriorityMock,
}))

const emptyForecast = Array.from({ length: 7 }, (_, dayOffset) => ({ dayOffset, dueCount: 0 }))

const dashboard = {
  enrolledNoteCount: 12,
  dueNoteCount: 3,
  dueWithinWeekCount: 6,
  activeDeadlineNoteCount: 2,
  upcomingDeadlines: [{
    noteId: 'note-1',
    relativePath: 'Provas/Calculo.md',
    title: 'Calculo',
    deadlineAtUnixMs: 1_750_000_000_000,
    priorityWeight: 4,
    retentionAtRisk: true,
    sourceTag: 'prova-bio',
    due: true,
  }],
  expiredDeadlineNoteCount: 1,
  expiredDeadlines: [{
    noteId: 'note-2',
    relativePath: 'Provas/Passada.md',
    title: 'Passada',
    deadlineAtUnixMs: Date.now() - 4 * 86_400_000,
    sourceTag: 'prova-bio',
  }],
  trackedUnitCount: 40,
  averageRetrievability: 0.72,
  averageStabilityDays: 21.5,
  completedSessionCount: 15,
  completedTodayCount: 4,
  loadForecast: [
    { dayOffset: 0, dueCount: 3 },
    { dayOffset: 1, dueCount: 1 },
    { dayOffset: 2, dueCount: 2 },
    ...emptyForecast.slice(3),
  ],
  awaitingFirstReviewCount: 4,
  fragileUnitCount: 2,
  calibrationNoteCount: 1,
  calibrationNotes: [{
    noteId: 'note-9',
    relativePath: 'Longa.md',
    title: 'Longa',
    observedUnitCount: 3,
    totalUnitCount: 8,
  }],
}

function renderPage(onOpenNote = vi.fn(), onStartReview = vi.fn()) {
  return {
    onOpenNote,
    onStartReview,
    ...render(<ReviewDashboardPage vaultPath="C:\\Vault" onOpenNote={onOpenNote} onStartReview={onStartReview} />),
  }
}

describe('ReviewDashboardPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    getDashboardMock.mockReset()
    getDashboardMock.mockResolvedValue(dashboard)
    getConfigMock.mockReset()
    getConfigMock.mockResolvedValue({ revision: 7 })
    previewDeadlineMock.mockReset()
    previewDeadlineMock.mockResolvedValue({ affectedNoteCount: 3 })
    applyDeadlineMock.mockReset()
    applyDeadlineMock.mockResolvedValue({ revision: 8 })
    setPriorityMock.mockReset()
    setPriorityMock.mockResolvedValue({})
  })
  afterEach(cleanup)

  it('renders the summary cards and the retention hint', async () => {
    renderPage()
    expect(await screen.findByText('Notas em aprendizado')).toBeInTheDocument()
    expect(screen.getByText('Vencidas agora')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    expect(screen.getByText(/72%/)).toBeInTheDocument()
    expect(screen.getByText(/2 parágrafos frágeis/)).toBeInTheDocument()
  })

  it('shows the awaiting-first-review card', async () => {
    renderPage()
    expect(await screen.findByText('Aguardando 1ª revisão')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders the calibration section with partial retention progress and an open action', async () => {
    const onOpenNote = vi.fn()
    renderPage(onOpenNote)
    expect(await screen.findByRole('heading', { name: 'Em calibração' })).toBeInTheDocument()
    expect(screen.getByText(/1 nota longa/)).toBeInTheDocument()
    const progress = screen.getByRole('progressbar', { name: 'Progresso da calibração de Longa' })
    expect(progress).toHaveAttribute('aria-valuenow', '3')
    expect(progress).toHaveAttribute('aria-valuemax', '8')
    expect(screen.getByText('3 de 8 parágrafos · 5 restantes')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir nota Longa' }))
    expect(onOpenNote).toHaveBeenCalledWith('Longa.md')
  })

  it('warns when the calibration list is truncated beyond the first items', async () => {
    getDashboardMock.mockResolvedValue({
      ...dashboard,
      calibrationNoteCount: 25,
      calibrationNotes: dashboard.calibrationNotes,
    })
    renderPage()
    expect(await screen.findByText(/25 notas longas/)).toBeInTheDocument()
    expect(screen.getByText(/lista está limitada aos primeiros itens/)).toBeInTheDocument()
  })

  it('renders the seven-day load forecast with today and tomorrow labels', async () => {
    renderPage()
    const list = await screen.findByRole('list', { name: 'Revisões previstas por dia' })
    expect(list).toBeInTheDocument()
    expect(screen.getByText('Carga prevista')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('Amanha')).toBeInTheDocument()
    // Total exibido no cabecalho da secao.
    expect(screen.getByText(/6 revisões nos próximos 7 dias/)).toBeInTheDocument()
    const bars = list.querySelectorAll('.review-dashboard-forecast-bar')
    expect(bars).toHaveLength(7)
  })

  it('opens the note from an upcoming deadline', async () => {
    const { onOpenNote } = renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir nota Calculo' }))
    expect(onOpenNote).toHaveBeenCalledWith('Provas/Calculo.md')
  })

  it('signals expired deadlines with the tag source and guidance', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Prazos encerrados' })).toBeInTheDocument()
    expect(screen.getByText(/1 nota — a data-limite da tag já passou/)).toBeInTheDocument()
    expect(screen.getByText('Passada')).toBeInTheDocument()
    expect(screen.getByText('Provas/Passada.md')).toBeInTheDocument()
    expect(screen.getByText('#prova-bio')).toBeInTheDocument()
    expect(screen.getByText(/remover a tag da nota, trocar o perfil da tag nas Configurações ou manter a política atual/)).toBeInTheDocument()
    expect(screen.getByText('Há 4 dias')).toBeInTheDocument()
  })

  it('opens the note from an expired deadline', async () => {
    const { onOpenNote } = renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir nota Passada' }))
    expect(onOpenNote).toHaveBeenCalledWith('Provas/Passada.md')
  })

  it('opens the deadline dialog from an expired deadline note', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Alterar prazo de Passada' }))
    expect(screen.getByRole('heading', { name: /Alterar prazo · #prova-bio/ })).toBeInTheDocument()
  })

  it('starts a review directly from an expired deadline', async () => {
    const { onStartReview } = renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Revisar Passada' }))
    expect(onStartReview).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'note-2', sourceTag: 'prova-bio' }))
  })

  it('flags an upcoming deadline with retention at risk', async () => {
    renderPage()

    expect(await screen.findByText('Meta de retenção em risco')).toBeInTheDocument()
  })

  it('starts a review directly from a due deadline', async () => {
    const { onStartReview } = renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Revisar Calculo' }))
    expect(onStartReview).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'note-1', due: true }))
  })

  it('adjusts the priority of a deadline note with the stepper and reloads', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Aumentar prioridade de Calculo' }))
    expect(setPriorityMock).toHaveBeenCalledWith({
      vaultPath: expect.stringContaining('Vault'),
      relativePath: 'Provas/Calculo.md',
      priorityWeight: 5,
    })
    // A alteracao dispara um reload do painel (nova chamada ao dashboard).
    expect(getDashboardMock).toHaveBeenCalledTimes(2)
  })

  it('hides the review button when the deadline note is not due', async () => {
    getDashboardMock.mockResolvedValue({
      ...dashboard,
      upcomingDeadlines: [{ ...dashboard.upcomingDeadlines[0], due: false }],
    })
    renderPage()

    await screen.findByText('Próximos prazos')
    expect(screen.queryByRole('button', { name: 'Revisar Calculo' })).not.toBeInTheDocument()
  })

  it('renders the daily goal with progress against the completed-today count', async () => {
    window.localStorage.setItem('mirrormind.review-daily-goal', '10')
    renderPage()

    expect(await screen.findByText('Meta diária')).toBeInTheDocument()
    expect(screen.getByText('4 de 10 hoje')).toBeInTheDocument()
    const progress = screen.getByRole('progressbar', { name: /meta diária/i })
    expect(progress).toHaveAttribute('aria-valuenow', '4')
    expect(progress).toHaveAttribute('aria-valuemax', '10')
    expect(progress.firstElementChild).toHaveStyle({ width: '40%' })
  })

  it('celebrates when the completed count reaches the daily goal', async () => {
    window.localStorage.setItem('mirrormind.review-daily-goal', '3')
    renderPage()

    expect(await screen.findByText('Meta atingida')).toBeInTheDocument()
    expect(screen.getByText(/fila segue exibindo todas as revisões/i)).toBeInTheDocument()
  })

  it('suggests a goal from the forecast and persists the chosen value', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Sem meta definida')).toBeInTheDocument()
    // Forecast: 3 + 1 + 2 = 6 revisoes em 7 dias -> media 0.86 -> sugestao 1.
    await user.click(screen.getByRole('button', { name: /Sugerir: 1 revisão\/dia/ }))

    expect(window.localStorage.getItem('mirrormind.review-daily-goal')).toBe('1')
    expect(screen.getByText('Meta atingida')).toBeInTheDocument()
  })

  it('adjusts the goal with the stepper and persists it locally', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Aumentar meta diária' }))
    await user.click(screen.getByRole('button', { name: 'Aumentar meta diária' }))

    expect(window.localStorage.getItem('mirrormind.review-daily-goal')).toBe('2')
    expect(screen.getByText('Meta atingida')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /meta diária/i })).toHaveAttribute('aria-valuemax', '2')
  })

  it('shows the error state with retry when the backend fails', async () => {
    getDashboardMock.mockRejectedValueOnce(new Error('boom'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível carregar o painel/i)
    getDashboardMock.mockResolvedValueOnce(dashboard)
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Notas em aprendizado')).toBeInTheDocument()
  })

  it('changes a deadline after previewing exactly how many notes will be affected', async () => {
    const user = userEvent.setup()
    const { onOpenNote } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Alterar prazo de Calculo' }))
    expect(screen.getByRole('heading', { name: /Alterar prazo/ })).toBeInTheDocument()

    // Altera a data e preview do impacto.
    fireEvent.change(screen.getByLabelText('Nova data da prova'), { target: { value: '2030-05-05' } })
    previewDeadlineMock.mockResolvedValueOnce({ affectedNoteCount: 3 })
    await user.click(screen.getByRole('button', { name: 'Ver impacto' }))
    expect(await screen.findByText('notas terão a próxima data recalculada')).toBeInTheDocument()
    expect(previewDeadlineMock).toHaveBeenCalledWith(
      expect.stringContaining('Vault'),
      'prova-bio',
      expect.any(Number),
    )

    // Confirma a alteracao e recarrega o painel.
    await user.click(screen.getByRole('button', { name: 'Confirmar alteração' }))
    expect(applyDeadlineMock).toHaveBeenCalledWith(expect.objectContaining({
      vaultPath: expect.stringContaining('Vault'),
      expectedRevision: 7,
      tag: 'prova-bio',
      expectedAffectedNoteCount: 3,
      newDeadline: expect.any(Number),
    }))
    expect(onOpenNote).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: /Painel do vault/ })).toBeInTheDocument()
  })

  it('hides the confirm button until the impact has been previewed', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Alterar prazo de Calculo' }))
    expect(screen.getByRole('button', { name: 'Confirmar alteração' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Nova data da prova'), { target: { value: '2030-05-05' } })
    await user.click(screen.getByRole('button', { name: 'Ver impacto' }))
    expect(await screen.findByRole('button', { name: 'Confirmar alteração' })).toBeEnabled()
  })

  it('surfaces a preview failure inside the dialog', async () => {
    const user = userEvent.setup()
    renderPage()

    previewDeadlineMock.mockRejectedValueOnce(new Error('A tag de prazo nao esta configurada.'))
    await user.click(await screen.findByRole('button', { name: 'Alterar prazo de Calculo' }))
    fireEvent.change(screen.getByLabelText('Nova data da prova'), { target: { value: '2030-05-05' } })
    await user.click(screen.getByRole('button', { name: 'Ver impacto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/A tag de prazo nao esta configurada/)
  })
})
