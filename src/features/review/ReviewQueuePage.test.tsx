import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewQueuePage } from './ReviewQueuePage'
import { formatOverdueDate } from './reviewQueueDate'

const { getDueReviewQueueMock } = vi.hoisted(() => ({
  getDueReviewQueueMock: vi.fn(),
}))

vi.mock('./reviewQueue', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewQueue')>(),
  getDueReviewQueue: getDueReviewQueueMock,
}))

describe('ReviewQueuePage', () => {
  beforeEach(() => getDueReviewQueueMock.mockReset())
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('shows overdue notes in backend order and opens the selected note', async () => {
    const onOpenNote = vi.fn()
    const onStartReview = vi.fn()
    getDueReviewQueueMock.mockResolvedValue([
      {
        noteId: 'note-high',
        relativePath: 'Prova/ATP.md',
        title: 'ATP',
        nextReviewAtUnixMs: Date.now() - 3 * 24 * 60 * 60 * 1_000,
        priorityWeight: 3,
        deadlineAtUnixMs: null,
        preferredMode: 'exam',
        isFirstReview: true,
      },
      {
        noteId: 'note-low',
        relativePath: 'Leitura.md',
        title: 'Leitura',
        nextReviewAtUnixMs: Date.now() - 24 * 60 * 60 * 1_000,
        priorityWeight: 1,
        deadlineAtUnixMs: null,
        preferredMode: 'conversation',
        isFirstReview: false,
      },
    ])

    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={onOpenNote} onStartReview={onStartReview} />)

    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]).getByRole('heading', { name: 'ATP' })).toBeInTheDocument()
    expect(within(rows[0]).getByText('Primeira revisão')).toBeInTheDocument()
    expect(within(rows[1]).getByRole('heading', { name: 'Leitura' })).toBeInTheDocument()
    await userEvent.setup().click(within(rows[0]).getByRole('button', { name: 'Abrir nota ATP' }))
    expect(onOpenNote).toHaveBeenCalledWith('Prova/ATP.md')
    await userEvent.setup().click(within(rows[0]).getByRole('button', { name: 'Revisar ATP' }))
    expect(onStartReview).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'note-high' }))
  })

  it('counts overdue labels by local calendar day', () => {
    const now = new Date(2026, 6, 22, 0, 15).getTime()
    const yesterday = new Date(2026, 6, 21, 23, 30).getTime()

    expect(formatOverdueDate(yesterday, now)).toBe('Vencida há 1 dia')
  })

  it('explains when there are no overdue notes', async () => {
    getDueReviewQueueMock.mockResolvedValue([])
    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByText('Nenhuma revisão vencida.')).toBeInTheDocument()
  })
  it('allows retrying after a queue loading failure', async () => {
    getDueReviewQueueMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])

    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a fila de revisão.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByText('Nenhuma revisão vencida.')).toBeInTheDocument()
    expect(getDueReviewQueueMock).toHaveBeenCalledTimes(2)
  })
})