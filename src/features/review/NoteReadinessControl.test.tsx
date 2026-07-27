import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteReadinessControl } from './NoteReadinessControl'
import type { NoteReviewState, ReadinessAttempt } from './ai'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'

const { assessNoteReadinessMock, getNoteReviewStateMock, setNoteReviewEnrollmentMock } = vi.hoisted(() => ({
  assessNoteReadinessMock: vi.fn(),
  getNoteReviewStateMock: vi.fn(),
  setNoteReviewEnrollmentMock: vi.fn(),
}))

vi.mock('./ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai')>()
  return {
    ...original,
    assessNoteReadiness: assessNoteReadinessMock,
    getNoteReviewState: getNoteReviewStateMock,
    setNoteReviewEnrollment: setNoteReviewEnrollmentMock,
  }
})

const validAttempt: ReadinessAttempt = {
  outcome: 'valid',
  sourceHash: `sha256:${'b'.repeat(64)}`,
  report: {
    status: 'ready',
    explanation: 'A nota tem material suficiente.',
    centralIdea: {
      sourceQuote: 'Ideia central.',
      sourceStartUtf16: 0,
      sourceEndUtf16: 13,
    },
    evaluablePoints: [
      { sourceQuote: 'Ponto um.', sourceStartUtf16: 14, sourceEndUtf16: 23 },
      { sourceQuote: 'Ponto dois.', sourceStartUtf16: 24, sourceEndUtf16: 34 },
      { sourceQuote: 'Ponto trÃƒÂªs.', sourceStartUtf16: 35, sourceEndUtf16: 46 },
    ],
    issues: [],
  },
}

function control(props?: Partial<React.ComponentProps<typeof NoteReadinessControl>>) {
  return (
    <ReviewAiSettingsProvider>
      <NoteReadinessControl
        vaultPath={'C:\\Vault'}
        relativePath="biologia.md"
        sourceRevision="# Biologia"
        isDirty={false}
        {...props}
      />
    </ReviewAiSettingsProvider>
  )
}

describe('NoteReadinessControl', () => {
  beforeEach(() => {
    window.localStorage.clear()
    assessNoteReadinessMock.mockReset()
    getNoteReviewStateMock.mockReset().mockResolvedValue(null)
    setNoteReviewEnrollmentMock.mockReset()
  })

  afterEach(cleanup)

  it('exposes a rejected provider response safely and regenerates against the same source and provider', async () => {
    const user = userEvent.setup()
    const invalidAttempt: ReadinessAttempt = {
      outcome: 'invalid',
      sourceHash: `sha256:${'a'.repeat(64)}`,
      message: 'A resposta nÃƒÂ£o corresponde ao contrato.',
      rawResponse: '<img src=x onerror="window.hacked=true">',
      validationErrors: ['Campo status ausente.', 'Trecho citado nÃƒÂ£o existe na nota.'],
    }
    assessNoteReadinessMock.mockResolvedValueOnce(invalidAttempt).mockResolvedValueOnce(invalidAttempt)

    render(control())
    await user.click(screen.getByRole('button', { name: /Avaliar/ }))

    await screen.findByLabelText(/resposta da IA/i)
    expect(screen.getByTestId('review-ai-raw-response')).toHaveTextContent(invalidAttempt.rawResponse ?? '')
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('Campo status ausente.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Gerar novo/ }))
    await waitFor(() => expect(assessNoteReadinessMock).toHaveBeenCalledTimes(2))
    expect(assessNoteReadinessMock).toHaveBeenNthCalledWith(2, {
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
      provider: 'ollama',
      expectedSourceHash: invalidAttempt.sourceHash,
    })
  })

  it('discards a delayed result when the active note changes', async () => {
    const user = userEvent.setup()
    let resolveAttempt!: (attempt: ReadinessAttempt) => void
    assessNoteReadinessMock.mockReturnValue(new Promise<ReadinessAttempt>((resolve) => {
      resolveAttempt = resolve
    }))
    const view = render(control())

    await user.click(screen.getByRole('button', { name: /Avaliar/ }))
    view.rerender(control({ relativePath: 'quimica.md', sourceRevision: '# QuÃƒÂ­mica' }))
    resolveAttempt(validAttempt)

    await waitFor(() => expect(screen.getByRole('button', { name: /Avaliar/ })).toBeEnabled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not offer regeneration for a valid report and closes with Escape', async () => {
    const user = userEvent.setup()
    assessNoteReadinessMock.mockResolvedValue(validAttempt)
    render(control())
    const trigger = screen.getByRole('button', { name: /Avaliar/ })
    await user.click(trigger)

    expect(await screen.findByRole('heading', { name: /Pronta/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Ponto/)[2]).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar novo/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('renders Markdown and KaTeX in evaluable points', async () => {
    const user = userEvent.setup()
    const formula = '$$6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2$$'
    assessNoteReadinessMock.mockResolvedValue({
      ...validAttempt,
      report: {
        ...validAttempt.report,
        evaluablePoints: [{ sourceQuote: formula, sourceStartUtf16: 0, sourceEndUtf16: formula.length }],
      },
    })
    render(control())

    await user.click(screen.getByRole('button', { name: /Avaliar/ }))

    const source = await screen.findByText('6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2', { selector: 'annotation' })
    expect(source.closest('.katex')).not.toBeNull()
  })
  it('requires the saved Markdown to match the visible note', () => {
    render(control({ isDirty: true }))
    const button = screen.getByRole('button', { name: /Avaliar/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('Salve a nota'))
  })

  it('requires explicit consent before Gemini can receive a note', () => {
    window.localStorage.setItem('mirrormind.review.provider.v1', 'gemini')
    render(control())
    const button = screen.getByRole('button', { name: /Avaliar/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('Autorize o envio ao Gemini'))
  })

  it('loads a persisted ready state and lets the user explicitly enable reviews', async () => {
    const user = userEvent.setup()
    const readyState: NoteReviewState = {
      noteId: 'note-atp',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)
    setNoteReviewEnrollmentMock.mockResolvedValue({
      ...readyState,
      enrolled: true,
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
    })

    render(control())

    expect(await screen.findByText('Pronta')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Ativar/ }))
    expect(setNoteReviewEnrollmentMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
      enabled: true,
    })
    expect(await screen.findByRole('button', { name: /Pausar/ })).toBeInTheDocument()
  })
  it('discards a delayed enrollment result when the active note changes', async () => {
    const user = userEvent.setup()
    const readyState: NoteReviewState = {
      noteId: 'note-a',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'c'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
    }
    let resolveEnrollment!: (state: NoteReviewState) => void
    getNoteReviewStateMock.mockResolvedValueOnce(readyState).mockResolvedValueOnce(null)
    setNoteReviewEnrollmentMock.mockReturnValue(new Promise<NoteReviewState>((resolve) => {
      resolveEnrollment = resolve
    }))
    const view = render(control())

    await user.click(await screen.findByRole('button', { name: /Ativar/ }))
    view.rerender(control({ relativePath: 'quimica.md', sourceRevision: '# QuÃƒÆ’Ã‚Â­mica' }))
    resolveEnrollment({ ...readyState, enrolled: true, schedulingStatus: 'scheduled' })

    await waitFor(() => expect(getNoteReviewStateMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: /Pausar/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Pronta')).not.toBeInTheDocument()
  })

  it('lets an enrolled modified note be disabled', async () => {
    const user = userEvent.setup()
    const modifiedState: NoteReviewState = {
      noteId: 'note-modified',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'d'.repeat(64)}`,
      readiness: 'modified',
      assessedAtUnixMs: 1_720_000_000_000,
      report: validAttempt.outcome === 'valid' ? validAttempt.report : null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'paused',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: null,
    }
    getNoteReviewStateMock.mockResolvedValue(modifiedState)
    setNoteReviewEnrollmentMock.mockResolvedValue({ ...modifiedState, enrolled: false })
    render(control())

    await user.click(await screen.findByRole('button', { name: /Pausar/ }))

    expect(setNoteReviewEnrollmentMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
      enabled: false,
    })
    await user.click(screen.getByRole('button', { name: /Abrir/ }))
    expect(screen.getByText('Este relatorio pertence a versao anterior da nota.')).toBeInTheDocument()
  })
  it('reopens the complete persisted readiness report', async () => {
    const persistedState: NoteReviewState = {
      noteId: 'note-report',
      relativePath: 'biologia.md',
      contentHash: validAttempt.sourceHash,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: validAttempt.outcome === 'valid' ? validAttempt.report : null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
    }
    getNoteReviewStateMock.mockResolvedValue(persistedState)
    render(control())

    await userEvent.setup().click(await screen.findByRole('button', { name: /Abrir/ }))

    expect(await screen.findByText('A nota tem material suficiente.')).toBeInTheDocument()
    expect(screen.getByText('Ponto dois.')).toBeInTheDocument()
  })
})
