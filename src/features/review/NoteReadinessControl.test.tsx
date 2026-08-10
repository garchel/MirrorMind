import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteReadinessControl } from './NoteReadinessControl'
import type { NoteReviewState, ReadinessAttempt } from './ai'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'

const { assessNoteReadinessMock, getNoteReviewStateMock, resetNoteLearningMock, setNoteReviewEnrollmentMock } = vi.hoisted(() => ({
  assessNoteReadinessMock: vi.fn(),
  getNoteReviewStateMock: vi.fn(),
  resetNoteLearningMock: vi.fn(),
  setNoteReviewEnrollmentMock: vi.fn(),
}))

vi.mock('./ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai')>()
  return {
    ...original,
    assessNoteReadiness: assessNoteReadinessMock,
    getNoteReviewState: getNoteReviewStateMock,
    resetNoteLearning: resetNoteLearningMock,
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
    resetNoteLearningMock.mockReset()
    setNoteReviewEnrollmentMock.mockReset()
  })

  afterEach(cleanup)

  it('notifica o estado de prontidão mais recente via onStatusChange', async () => {
    const onStatusChange = vi.fn()
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-1',
      relativePath: 'biologia.md',
      contentHash: 'sha256:note',
      readiness: 'ready',
      assessedAtUnixMs: 1,
      report: null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
    })

    render(control({ onStatusChange }))

    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('ready'))
  })

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

  it('abre uma revisão imediata quando a nota está pronta e inscrita', async () => {
    const user = userEvent.setup()
    const onStartReview = vi.fn()
    const readyState: NoteReviewState = {
      noteId: 'note-ready',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)

    render(control({ onStartReview }))

    await user.click(await screen.findByRole('button', { name: 'Iniciar revisão agora' }))

    expect(setNoteReviewEnrollmentMock).not.toHaveBeenCalled()
    expect(onStartReview).toHaveBeenCalledWith({
      noteId: 'note-ready',
      preferredMode: 'exam',
      nextReviewAtUnixMs: 1_720_172_800_000,
      firstReviewAtUnixMs: 1_720_172_800_000,
    })
  })

  it('inscreve automaticamente e inicia a revisão quando a nota está pronta mas não inscrita', async () => {
    const user = userEvent.setup()
    const onStartReview = vi.fn()
    const readyState: NoteReviewState = {
      noteId: 'note-atp',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: false,
      preferredMode: 'conversation',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)
    setNoteReviewEnrollmentMock.mockResolvedValue({
      ...readyState,
      enrolled: true,
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: false,
    })

    render(control({ onStartReview }))

    await user.click(await screen.findByRole('button', { name: 'Iniciar revisão agora' }))

    expect(setNoteReviewEnrollmentMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
      enabled: true,
    })
    await waitFor(() => expect(onStartReview).toHaveBeenCalledWith({
      noteId: 'note-atp',
      preferredMode: 'conversation',
      nextReviewAtUnixMs: 1_720_172_800_000,
      firstReviewAtUnixMs: 1_720_172_800_000,
    }))
  })

  it('desabilita a revisão imediata para notas não avaliadas ou sujas', async () => {
    render(control())
    const button = screen.getByRole('button', { name: 'Iniciar revisão agora' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('Avalie a nota'))
    cleanup()

    render(control({ isDirty: true }))
    const dirtyButton = screen.getByRole('button', { name: 'Iniciar revisão agora' })
    expect(dirtyButton).toBeDisabled()
    expect(dirtyButton).toHaveAttribute('title', expect.stringContaining('Salve a nota'))
  })

  it('reopens the persisted report of an enrolled modified note', async () => {
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
      deadlineRetentionAtRisk: false,
    }
    getNoteReviewStateMock.mockResolvedValue(modifiedState)
    render(control())

    await user.click(await screen.findByRole('button', { name: /Abrir/ }))
    expect(screen.getByText('Este relatorio pertence a versao anterior da nota.')).toBeInTheDocument()
  })
  it('reinicia o aprendizado somente após confirmação', async () => {
    const user = userEvent.setup()
    const readyState: NoteReviewState = {
      noteId: 'note-reset',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_000_000_000,
      nextReviewAtUnixMs: 1_720_000_000_000,
      deadlineRetentionAtRisk: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)
    resetNoteLearningMock.mockResolvedValue({
      ...readyState,
      firstReviewAtUnixMs: 1_730_000_000_000,
      nextReviewAtUnixMs: 1_730_000_000_000,
      deadlineRetentionAtRisk: false,
    })

    render(control())

    await user.click(await screen.findByRole('button', { name: /Reiniciar aprendizado desta nota/ }))
    expect(screen.getByRole('dialog', { name: /Reiniciar aprendizado/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reiniciar aprendizado' }))

    expect(resetNoteLearningMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
    })
    // O estado retornado substitui o anterior: a proxima data passa a ser a nova.
    const expectedDate = new Date(1_730_000_000_000).toLocaleDateString('pt-BR')
    expect(await screen.findByText(`Próxima revisão: ${expectedDate}`)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Reiniciar aprendizado/ })).not.toBeInTheDocument()
  })

  it('flags a deadline with retention at risk', async () => {
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-risk',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'c'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: true,
    })

    render(control())

    expect(await screen.findByText('Meta de retenção em risco')).toBeInTheDocument()
  })

  it('cancela o reinício sem chamar o backend', async () => {
    const user = userEvent.setup()
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-reset',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_000_000_000,
      nextReviewAtUnixMs: 1_720_000_000_000,
      deadlineRetentionAtRisk: false,
    })

    render(control())

    await user.click(await screen.findByRole('button', { name: /Reiniciar aprendizado desta nota/ }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(resetNoteLearningMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /Reiniciar aprendizado/ })).not.toBeInTheDocument()
  })

  it('não oferece reinício quando a nota nunca foi avaliada', async () => {
    render(control())
    expect(await screen.findByText(/Status: Não avaliada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reiniciar aprendizado/ })).not.toBeInTheDocument()
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
      deadlineRetentionAtRisk: false,
    }
    getNoteReviewStateMock.mockResolvedValue(persistedState)
    render(control())

    await userEvent.setup().click(await screen.findByRole('button', { name: /Abrir/ }))

    expect(await screen.findByText('A nota tem material suficiente.')).toBeInTheDocument()
    expect(screen.getByText('Ponto dois.')).toBeInTheDocument()
  })
})
