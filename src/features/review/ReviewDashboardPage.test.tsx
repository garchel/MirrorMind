import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewDashboardPage } from './ReviewDashboardPage'

const { getDashboardMock } = vi.hoisted(() => ({
  getDashboardMock: vi.fn(),
}))

vi.mock('./reviewDashboard', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewDashboard')>(),
  getVaultReviewDashboard: getDashboardMock,
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
  }],
  trackedUnitCount: 40,
  averageRetrievability: 0.72,
  averageStabilityDays: 21.5,
  completedSessionCount: 15,
  loadForecast: [
    { dayOffset: 0, dueCount: 3 },
    { dayOffset: 1, dueCount: 1 },
    { dayOffset: 2, dueCount: 2 },
    ...emptyForecast.slice(3),
  ],
  awaitingFirstReviewCount: 4,
  fragileUnitCount: 2,
}

function renderPage(onOpenNote = vi.fn()) {
  return {
    onOpenNote,
    ...render(<ReviewDashboardPage vaultPath="C:\\Vault" onOpenNote={onOpenNote} />),
  }
}

describe('ReviewDashboardPage', () => {
  beforeEach(() => {
    getDashboardMock.mockReset()
    getDashboardMock.mockResolvedValue(dashboard)
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

  it('shows the error state with retry when the backend fails', async () => {
    getDashboardMock.mockRejectedValueOnce(new Error('boom'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível carregar o painel/i)
    getDashboardMock.mockResolvedValueOnce(dashboard)
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Notas em aprendizado')).toBeInTheDocument()
  })
})
