import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'
import { ReviewSessionPage } from './ReviewSessionPage'

const { startMock, completeMock, continueMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  completeMock: vi.fn(),
  continueMock: vi.fn(),
}))

vi.mock('./reviewSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewSession')>(),
  startReviewSession: startMock,
  completeReviewSession: completeMock,
  continueReviewConversation: continueMock,
}))

const item = {
  noteId: 'note-1', relativePath: 'Biologia/Fotossintese.md', title: 'Fotossintese',
  nextReviewAtUnixMs: 1, priorityWeight: 3, deadlineAtUnixMs: null, preferredMode: 'exam' as const, isFirstReview: true,
}

const reportMarkdown = 'A energia luminosa alimenta a fotossintese.'
const perfectMarkdown = 'ATP armazena energia para uso celular.'

const questionOptions = (base: string) => [
  `${base} alfa`,
  `${base} beta`,
  `${base} gama`,
  `${base} delta`,
]

const draft = {
  sessionId: 'session-1', noteId: 'note-1', relativePath: item.relativePath,
  noteContentHash: 'sha256:content', mode: 'exam' as const, provider: 'ollama' as const,
  prompts: [
    { id: 'q1', text: 'Pergunta um?', assistance: 'Dica um.', options: questionOptions('Opcao A') },
    { id: 'q2', text: 'Pergunta dois?', assistance: 'Dica dois.', options: questionOptions('Opcao B') },
    { id: 'q3', text: 'Pergunta tres?', assistance: 'Dica tres.', options: questionOptions('Opcao C') },
  ], minimumAnswers: 3, maximumAnswers: 5,
}

const conversationDraft = {
  sessionId: 'session-2', noteId: 'note-1', relativePath: item.relativePath,
  noteContentHash: 'sha256:content', mode: 'conversation' as const, provider: 'ollama' as const,
  prompts: [{ id: 'turn-1', text: 'O que a mitose produz?', assistance: 'Pense nas celulas.', options: [] }],
  minimumAnswers: 4, maximumAnswers: 6,
}

const report = (markdown: string, score = 72, gaps: Array<{ classification: 'forgotten' | 'confused'; sourceQuote: string; sourceStartUtf16: number; sourceEndUtf16: number }> = []) => ({
  outcome: 'valid' as const,
  report: {
    sessionId: 'session-1', overallScore: score, outcome: score >= 90 ? 'complete' as const : 'good' as const,
    summary: 'Bom dominio, com uma imprecisao.',
    markdown,
    units: [{
      id: 'unit-1', ordinal: 0, sourceStartUtf16: 0, sourceEndUtf16: markdown.length,
      sectionPath: [], score, outcome: score >= 90 ? 'complete' as const : 'good' as const,
    }],
    gaps,
    completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
  },
})

async function answerExamQuestion(user: ReturnType<typeof userEvent.setup>, option: string) {
  await user.click(screen.getByRole('radio', { name: option }))
  await user.click(screen.getByRole('button', { name: /Salvar resposta|Concluir e avaliar/ }))
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
    continueMock.mockReset()
    startMock.mockResolvedValue({ outcome: 'valid', draft })
    completeMock.mockResolvedValue(report(reportMarkdown, 72, [
      { classification: 'confused', sourceQuote: 'energia luminosa', sourceStartUtf16: 2, sourceEndUtf16: 18 },
    ]))
  })
  afterEach(cleanup)

  it('runs a multiple-choice exam without exposing the note or the correct answer', async () => {
    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    expect(await screen.findByRole('heading', { name: 'Pergunta um?' })).toBeInTheDocument()
    expect(screen.queryByText(/energia luminosa/i)).not.toBeInTheDocument()

    await answerExamQuestion(user, 'Opcao A beta')
    expect(await screen.findByRole('heading', { name: 'Pergunta dois?' })).toBeInTheDocument()
    await answerExamQuestion(user, 'Opcao B gama')
    await answerExamQuestion(user, 'Opcao C alfa')

    expect((await screen.findAllByText('72')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('energia luminosa').length).toBeGreaterThan(0)
    expect(onCompleted).toHaveBeenCalledOnce()
    const submitted = completeMock.mock.calls[0][0].exchanges as Array<{ promptId: string; answer: string }>
    expect(submitted).toHaveLength(3)
    expect(submitted[0].answer).toMatch(/^B\) Opcao A beta$/)
  })

  it('renders the evaluated note with the gap marked and the paragraph score badge', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }

    expect(await screen.findByRole('heading', { name: 'Nota avaliada' })).toBeInTheDocument()
    const note = document.querySelector('.review-note-markdown')
    expect(note).not.toBeNull()
    expect(note?.querySelector('mark[data-gap="confused"]')).toHaveTextContent('energia luminosa')
    const badge = note?.querySelector('.review-unit-score')
    expect(badge).toHaveTextContent('72')
    expect(badge).toHaveAttribute('data-outcome', 'good')
    expect(screen.getByRole('list', { name: 'Faixas de pontuação por parágrafo' })).toBeInTheDocument()
  })

  it('reveals optional help without changing the answer flow', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await user.click(await screen.findByRole('button', { name: 'Mostrar dica' }))
    expect(screen.getByText('Dica um.')).toBeInTheDocument()
  })

  it('renders LaTeX math inside exam options and dica', async () => {
    startMock.mockResolvedValue({
      outcome: 'valid',
      draft: {
        ...draft,
        prompts: [
          {
            id: 'q1',
            text: 'Qual e o principal produto da fase clara?',
            assistance: 'Pense na molecula gerada pela fotolise: $\\text{O}_2$.',
            options: ['$\\text{CO}_2$', '$\\text{O}_2$', '$\\text{ATP}$', '$\\text{NADPH}$'],
          },
          ...draft.prompts.slice(1),
        ],
      },
    })
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await screen.findByRole('heading', { name: 'Qual e o principal produto da fase clara?' })

    expect(document.querySelectorAll('.review-option-text .katex').length).toBeGreaterThanOrEqual(4)

    await user.click(screen.getByRole('button', { name: 'Mostrar dica' }))
    expect(document.querySelector('.review-assistance .katex')).not.toBeNull()
  })

  it('renders the gap quote with markdown and math in Pontos para revisar', async () => {
    const mathGapQuote = String.raw`* **Local:** Tilacoides.

$$6\text{CO}_2 + 6\text{H}_2\text{O} \rightarrow \text{C}_6\text{H}_{12}\text{O}_6 + 6\text{O}_2$$`
    completeMock.mockResolvedValue(report(reportMarkdown, 72, [
      { classification: 'forgotten', sourceQuote: mathGapQuote, sourceStartUtf16: 2, sourceEndUtf16: 18 },
    ]))
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }
    await screen.findByRole('heading', { name: 'Nota avaliada' })

    const gapQuote = document.querySelector('.review-gap-quote')
    expect(gapQuote).not.toBeNull()
    expect(gapQuote?.querySelector('strong')).toHaveTextContent('Local')
    expect(gapQuote?.querySelector('.katex')).not.toBeNull()
    expect(document.querySelector('.review-gaps li.is-forgotten .review-gap-quote')).not.toBeNull()
  })

  it('lays the report out in two columns with the note and the summary side by side', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }
    await screen.findByRole('heading', { name: 'Nota avaliada' })

    const layout = document.querySelector('.review-report-layout')
    expect(layout).not.toBeNull()
    expect(layout?.classList.contains('has-note')).toBe(true)
    expect(layout?.querySelector('.review-report-note .review-note-markdown')).not.toBeNull()
    expect(layout?.querySelector('.review-report-side')).not.toBeNull()
    expect(screen.getByRole('complementary', { name: 'Resumo da revisão' })).toBeInTheDocument()
  })

  it('shows the raw invalid response and can request a new report', async () => {
    completeMock
      .mockResolvedValueOnce({ outcome: 'invalid', message: 'Resposta invalida.', rawResponse: '{bad}', validationErrors: ['score ausente'] })
      .mockResolvedValueOnce(report(perfectMarkdown, 100))
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }
    expect(await screen.findByDisplayValue('{bad}')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Gerar novo relatorio' }))
    expect((await screen.findAllByText('100')).length).toBeGreaterThan(0)
    expect(completeMock).toHaveBeenCalledTimes(2)
  })

  it('answers a conversation with a textarea until the AI finishes the exchange', async () => {
    startMock.mockResolvedValue({ outcome: 'valid', draft: conversationDraft })
    continueMock
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-2', text: 'Por que as celulas sao semelhantes?', assistance: 'Distribuicao do material.', options: [] }, shouldFinish: false })
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-3', text: 'Qual estrutura e dividida?', assistance: 'Pense no nucleo.', options: [] }, shouldFinish: false })
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-4', text: 'Quais celulas herdam?', assistance: 'Considere as duas filhas.', options: [] }, shouldFinish: false })
      .mockResolvedValueOnce({ outcome: 'valid', prompt: null, shouldFinish: true })
    completeMock.mockResolvedValue(report(reportMarkdown, 72, []))

    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    expect(await screen.findByRole('heading', { name: 'O que a mitose produz?' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()

    const turns = [
      { reply: 'Duas celulas-filhas.', next: 'Por que as celulas sao semelhantes?' },
      { reply: 'Pelo nucleo.', next: 'Qual estrutura e dividida?' },
      { reply: 'As duas filhas.', next: 'Quais celulas herdam?' },
      { reply: 'Ambas.', next: null },
    ]
    for (const turn of turns) {
      await user.type(screen.getByLabelText('Sua resposta'), turn.reply)
      await user.click(screen.getByRole('button', { name: 'Salvar resposta' }))
      if (turn.next) {
        await screen.findByRole('heading', { name: turn.next })
      }
    }
    expect(continueMock).toHaveBeenCalledTimes(4)
    expect((await screen.findAllByText('72')).length).toBeGreaterThan(0)
    expect(onCompleted).toHaveBeenCalledOnce()
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
