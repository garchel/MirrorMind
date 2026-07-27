import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'
import { ReviewSessionPage } from './ReviewSessionPage'

const { startMock, completeMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  completeMock: vi.fn(),
}))

vi.mock('./reviewSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewSession')>(),
  startReviewSession: startMock,
  completeReviewSession: completeMock,
}))

const item = {
  noteId: 'note-1', relativePath: 'Biologia/Fotossintese.md', title: 'Fotossintese',
  nextReviewAtUnixMs: 1, priorityWeight: 3, preferredMode: 'exam' as const, isFirstReview: true,
}

const draft = {
  sessionId: 'session-1', noteId: 'note-1', relativePath: item.relativePath,
  noteContentHash: 'sha256:content', mode: 'exam' as const, provider: 'ollama' as const,
  prompts: [
    { id: 'q1', text: 'Pergunta um?', assistance: 'Dica um.' },
    { id: 'q2', text: 'Pergunta dois?', assistance: 'Dica dois.' },
    { id: 'q3', text: 'Pergunta tres?', assistance: 'Dica tres.' },
  ], minimumAnswers: 3, maximumAnswers: 5,
}

function renderPage(onExit = vi.fn(), onCompleted = vi.fn()) {
  return { onExit, onCompleted, ...render(
    <ReviewAiSettingsProvider>
      <ReviewSessionPage vaultPath="C:\\Vault" item={item} onExit={onExit} onCompleted={onCompleted} />
    </ReviewAiSettingsProvider>,
  ) }
}

describe('ReviewSessionPage', () => {
  beforeEach(() => {
    localStorage.clear()
    startMock.mockReset()
    completeMock.mockReset()
    startMock.mockResolvedValue({ outcome: 'valid', draft })
    completeMock.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 72, outcome: 'good',
        summary: 'Bom dominio, com uma imprecisao.',
        gaps: [{ classification: 'confused', sourceQuote: 'energia luminosa', sourceStartUtf16: 10, sourceEndUtf16: 26 }],
        completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
  })
  afterEach(cleanup)

  it('runs an exam without exposing the note and only scores after all answers', async () => {
    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    expect(await screen.findByRole('heading', { name: 'Pergunta um?' })).toBeInTheDocument()
    expect(screen.queryByText(/energia luminosa/i)).not.toBeInTheDocument()

    for (const answer of ['Resposta um', 'Resposta dois', 'Resposta tres']) {
      await user.type(screen.getByLabelText('Sua resposta'), answer)
      await user.click(screen.getByRole('button', { name: /Salvar resposta|Concluir e avaliar/ }))
    }

    expect(await screen.findByText('72')).toBeInTheDocument()
    expect(screen.getByText('energia luminosa')).toBeInTheDocument()
    expect(onCompleted).toHaveBeenCalledOnce()
  })

  it('reveals optional help without changing the answer flow', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await user.click(await screen.findByRole('button', { name: 'Mostrar dica' }))
    expect(screen.getByText('Dica um.')).toBeInTheDocument()
  })

  it('shows the raw invalid response and can request a new report', async () => {
    completeMock
      .mockResolvedValueOnce({ outcome: 'invalid', message: 'Resposta invalida.', rawResponse: '{bad}', validationErrors: ['score ausente'] })
      .mockResolvedValueOnce({
        outcome: 'valid', report: {
          sessionId: 'session-1', overallScore: 100, outcome: 'complete', summary: 'Dominio completo.', gaps: [],
          completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
        },
      })
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const answer of ['Um', 'Dois', 'Tres']) {
      await user.type(screen.getByLabelText('Sua resposta'), answer)
      await user.click(screen.getByRole('button', { name: /Salvar resposta|Concluir e avaliar/ }))
    }
    expect(await screen.findByDisplayValue('{bad}')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Gerar novo relatorio' }))
    expect(await screen.findByText('100')).toBeInTheDocument()
    expect(completeMock).toHaveBeenCalledTimes(2)
  })
  it('guards rail navigation and discards the active session only after confirmation', async () => {
    const onExit = vi.fn()
    render(
      <ReviewAiSettingsProvider>
        <aside className="workspace-rail"><button type="button">Notas</button></aside>
        <ReviewSessionPage vaultPath="C:\\Vault" item={item} onExit={onExit} onCompleted={vi.fn()} />
      </ReviewAiSettingsProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await screen.findByRole('heading', { name: 'Pergunta um?' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    await user.click(screen.getByRole('button', { name: 'Notas' }))
    expect(onExit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Notas' }))
    expect(onExit).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledTimes(2)
  })
})
