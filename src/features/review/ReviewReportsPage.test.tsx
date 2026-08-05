import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewReportsPage } from './ReviewReportsPage'

const { getReviewReportsMock } = vi.hoisted(() => ({
  getReviewReportsMock: vi.fn(),
}))

vi.mock('./reviewReports', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewReports')>(),
  getReviewReports: getReviewReportsMock,
}))

const baseReport = {
  sessionId: 'session-1',
  noteId: 'note-1',
  relativePath: 'Biologia/Fotossintese.md',
  title: 'Fotossintese',
  mode: 'exam' as const,
  provider: 'ollama' as const,
  completedAtUnixMs: 1_730_000_000_000,
  overallScore: 58,
  outcome: 'partial' as const,
  gapCount: 2,
  unitCount: 2,
  nextReviewAtUnixMs: 1_730_604_800_000,
}

function renderPage(onOpenNote = vi.fn()) {
  return { onOpenNote, ...render(<ReviewReportsPage vaultPath="C:\\Vault" onOpenNote={onOpenNote} />) }
}

describe('ReviewReportsPage', () => {
  beforeEach(() => {
    getReviewReportsMock.mockReset()
    getReviewReportsMock.mockResolvedValue([baseReport])
  })
  afterEach(cleanup)

  it('lists every report as a table row with the analysis columns', async () => {
    getReviewReportsMock.mockResolvedValue([
      baseReport,
      {
        ...baseReport,
        sessionId: 'session-2',
        title: 'Reacoes',
        relativePath: 'Quimica/Reacoes.md',
        mode: 'conversation',
        overallScore: 100,
        outcome: 'complete',
        gapCount: 0,
        unitCount: 3,
        nextReviewAtUnixMs: null,
      },
    ])
    renderPage()

    expect(await screen.findByRole('table', { name: /relatórios de revisão/i })).toBeInTheDocument()

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3) // cabecalho + duas linhas
    expect(screen.getByText('Fotossintese')).toBeInTheDocument()
    expect(screen.getByText('Biologia/Fotossintese.md')).toBeInTheDocument()
    expect(screen.getByText('Prova')).toBeInTheDocument()
    expect(screen.getByText('Conversa')).toBeInTheDocument()
    expect(screen.getByText('58/100')).toBeInTheDocument()
    expect(screen.getByText('Difícil')).toBeInTheDocument()
    expect(screen.getByText('100/100')).toBeInTheDocument()
    expect(screen.getByText('Completa')).toBeInTheDocument()
    // Sem proxima revisao, a celula exibe em dash.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows an empty state when no report exists', async () => {
    getReviewReportsMock.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('Nenhum relatório ainda.')).toBeInTheDocument()
  })

  it('shows the failure and can retry', async () => {
    getReviewReportsMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([baseReport])
    renderPage()
    const user = userEvent.setup()

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os relatórios')
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByText('Fotossintese')).toBeInTheDocument()
    expect(getReviewReportsMock).toHaveBeenCalledTimes(2)
  })

  it('opens the note from a report row', async () => {
    const { onOpenNote } = renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Abrir nota Fotossintese' }))
    expect(onOpenNote).toHaveBeenCalledWith('Biologia/Fotossintese.md')
  })
})
