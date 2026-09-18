import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewQueuePage } from './ReviewQueuePage'
import { formatOverdueDate } from './reviewQueueDate'

const { getDueReviewQueueMock, listUpcomingMock, setPriorityMock } = vi.hoisted(() => ({
  getDueReviewQueueMock: vi.fn(),
  listUpcomingMock: vi.fn(),
  setPriorityMock: vi.fn(),
}))

vi.mock('./reviewQueue', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewQueue')>(),
  getDueReviewQueue: getDueReviewQueueMock,
  listUpcomingReviewQueue: listUpcomingMock,
}))

vi.mock('./reviewPolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewPolicy')>(),
  setNoteReviewPriority: setPriorityMock,
}))

// Caminho via const (não literal em JSX): escapes em atributos JSX não são
// avaliados da mesma forma pelo transform e dobrariam as barras no runtime.
const VAULT_PATH = 'C:\\Vault'

describe('ReviewQueuePage', () => {
  beforeEach(() => {
    getDueReviewQueueMock.mockReset()
    getDueReviewQueueMock.mockResolvedValue([])
    listUpcomingMock.mockReset()
    listUpcomingMock.mockResolvedValue({ items: [], total: 0 })
    setPriorityMock.mockReset()
    setPriorityMock.mockResolvedValue({})
  })
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

  it('adjusts the priority of an overdue note with the stepper and reloads', async () => {
    const item = {
      noteId: 'note-high',
      relativePath: 'Prova/ATP.md',
      title: 'ATP',
      nextReviewAtUnixMs: Date.now() - 3 * 24 * 60 * 60 * 1_000,
      priorityWeight: 3,
      deadlineAtUnixMs: null,
      preferredMode: 'exam',
      isFirstReview: true,
    }
    getDueReviewQueueMock.mockResolvedValue([item])

    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Aumentar prioridade de ATP' }))
    expect(setPriorityMock).toHaveBeenCalledWith({
      vaultPath: expect.stringContaining('Vault'),
      relativePath: 'Prova/ATP.md',
      priorityWeight: 4,
    })
    expect(getDueReviewQueueMock).toHaveBeenCalledTimes(2)
  })

  it('explains when there are no overdue notes', async () => {
    getDueReviewQueueMock.mockResolvedValue([])
    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByText('Nenhuma revisão vencida.')).toBeInTheDocument()
    expect(screen.getByText(/A fila está em dia/)).toBeInTheDocument()
    expect(screen.getByText('Inscreva as prontas')).toBeInTheDocument()
  })

  it('offers to browse notes from the empty queue', async () => {
    const onBrowseNotes = vi.fn()
    getDueReviewQueueMock.mockResolvedValue([])
    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={vi.fn()} onStartReview={vi.fn()} onBrowseNotes={onBrowseNotes} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Avaliar notas' }))
    expect(onBrowseNotes).toHaveBeenCalledTimes(1)
  })
  it('allows retrying after a queue loading failure', async () => {
    getDueReviewQueueMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])

    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByText('Nenhuma revisão vencida.')).toBeInTheDocument()
    expect(getDueReviewQueueMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces the backend error instead of a generic message', async () => {
    getDueReviewQueueMock.mockRejectedValueOnce(
      new Error('O documento principal esta corrompido e nenhum backup valido foi encontrado.'),
    )
    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/documento principal esta corrompido/)
  })

  it('always shows the upcoming section, even with nothing scheduled', async () => {
    render(<ReviewQueuePage vaultPath={VAULT_PATH} onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Próximos vencimentos' })).toBeInTheDocument()
    expect(screen.getByText('Nada agendado')).toBeInTheDocument()
    expect(screen.getByText(/Nada agendado por enquanto/)).toBeInTheDocument()
  })

  it('surfaces upcoming loading failures with retry', async () => {
    listUpcomingMock.mockRejectedValueOnce(new Error('offline'))
    render(<ReviewQueuePage vaultPath={VAULT_PATH} onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    listUpcomingMock.mockResolvedValueOnce({ items: [], total: 0 })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText(/Nada agendado por enquanto/)).toBeInTheDocument()
  })

  it('shows the first upcoming page with the visible count', async () => {
    const upcoming = (index: number) => ({
      noteId: `note-next-${index}`,
      relativePath: `Futura${index}.md`,
      title: `Futura ${index}`,
      nextReviewAtUnixMs: Date.now() + (index + 1) * 24 * 60 * 60 * 1_000,
      priorityWeight: 1,
      deadlineAtUnixMs: null,
      preferredMode: 'exam' as const,
      isFirstReview: true,
    })
    listUpcomingMock.mockResolvedValue({ items: [0, 1, 2, 3, 4].map(upcoming), total: 8 })

    render(<ReviewQueuePage vaultPath={VAULT_PATH} onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Próximos vencimentos' })).toBeInTheDocument()
    expect(screen.getByText('Mostrando 5 de 8')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Futura 0' })).toBeInTheDocument()
    expect(listUpcomingMock).toHaveBeenCalledWith(VAULT_PATH, 5, 0)
  })

  it('appends the next page on "Carregar mais" without refetching the first', async () => {
    const upcoming = (index: number) => ({
      noteId: `note-next-${index}`,
      relativePath: `Futura${index}.md`,
      title: `Futura ${index}`,
      nextReviewAtUnixMs: Date.now() + (index + 1) * 24 * 60 * 60 * 1_000,
      priorityWeight: 1,
      deadlineAtUnixMs: null,
      preferredMode: 'exam' as const,
      isFirstReview: false,
    })
    listUpcomingMock
      .mockResolvedValueOnce({ items: [0, 1, 2, 3, 4].map(upcoming), total: 8 })
      .mockResolvedValueOnce({ items: [5, 6, 7].map(upcoming), total: 8 })

    render(<ReviewQueuePage vaultPath={VAULT_PATH} onOpenNote={vi.fn()} onStartReview={vi.fn()} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Carregar mais' }))
    expect(listUpcomingMock).toHaveBeenNthCalledWith(2, VAULT_PATH, 5, 5)
    expect(await screen.findByRole('heading', { name: 'Futura 7' })).toBeInTheDocument()
    // Primeira página preservada + contador atualizado + botão some no fim.
    expect(screen.getByRole('heading', { name: 'Futura 0' })).toBeInTheDocument()
    expect(screen.getByText('Mostrando 8 de 8')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
  })

  it('loads more automatically when the sentinel scrolls into view', async () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    const observerCallbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observerCallbacks.push(callback)
      }
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    })
    try {
      const upcoming = (index: number) => ({
        noteId: `note-next-${index}`,
        relativePath: `Futura${index}.md`,
        title: `Futura ${index}`,
        nextReviewAtUnixMs: Date.now() + (index + 1) * 24 * 60 * 60 * 1_000,
        priorityWeight: 1,
        deadlineAtUnixMs: null,
        preferredMode: 'exam' as const,
        isFirstReview: false,
      })
      listUpcomingMock
        .mockResolvedValueOnce({ items: [0, 1, 2, 3, 4].map(upcoming), total: 6 })
        .mockResolvedValueOnce({ items: [5].map(upcoming), total: 6 })

      render(<ReviewQueuePage vaultPath={VAULT_PATH} onOpenNote={vi.fn()} onStartReview={vi.fn()} />)
      await screen.findByRole('heading', { name: 'Futura 4' })
      expect(observe).toHaveBeenCalled()

      observerCallbacks[0]?.([{ isIntersecting: true }])
      expect(await screen.findByRole('heading', { name: 'Futura 5' })).toBeInTheDocument()
      expect(listUpcomingMock).toHaveBeenNthCalledWith(2, VAULT_PATH, 5, 5)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens an upcoming note without starting a review', async () => {
    const onOpenNote = vi.fn()
    listUpcomingMock.mockResolvedValue({
      items: [{
        noteId: 'note-next',
        relativePath: 'Futura.md',
        title: 'Futura',
        nextReviewAtUnixMs: Date.now() + 2 * 24 * 60 * 60 * 1_000,
        priorityWeight: 1,
        deadlineAtUnixMs: null,
        preferredMode: 'conversation' as const,
        isFirstReview: true,
      }],
      total: 1,
    })

    render(<ReviewQueuePage vaultPath="C:\\Vault" onOpenNote={onOpenNote} onStartReview={vi.fn()} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Abrir nota Futura' }))
    expect(onOpenNote).toHaveBeenCalledWith('Futura.md')
    expect(screen.queryByRole('button', { name: 'Revisar Futura' })).not.toBeInTheDocument()
  })
})