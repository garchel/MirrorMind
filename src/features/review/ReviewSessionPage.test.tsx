import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'
import { ReviewSessionPage } from './ReviewSessionPage'

const { startMock, completeMock, continueMock, reclassifyMock, previewMock, synthesisMock, sourcesMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  completeMock: vi.fn(),
  continueMock: vi.fn(),
  reclassifyMock: vi.fn(),
  previewMock: vi.fn(),
  synthesisMock: vi.fn(),
  sourcesMock: vi.fn(),
}))

vi.mock('./reviewSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewSession')>(),
  startReviewSession: startMock,
  completeReviewSession: completeMock,
  continueReviewConversation: continueMock,
  previewReviewSessionPlan: previewMock,
}))

vi.mock('./ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('./ai')>(),
  assessNoteSynthesis: synthesisMock,
  getNoteSessionSources: sourcesMock,
  setNoteUnitClassification: reclassifyMock,
}))

const item = {
  noteId: 'note-1', relativePath: 'Biologia/Fotossintese.md', title: 'Fotossintese',
  nextReviewAtUnixMs: 1, priorityWeight: 3, deadlineAtUnixMs: null, preferredMode: 'exam' as const, isFirstReview: true,
}

const VAULT_PATH = 'C:\\Vault'

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
  // Prova mista: duas multipla escolha e uma resposta curta — a correcao
  // deterministica compara os termos-chave da resposta esperada registrada no
  // backend, que nunca trafega para o cliente.
  prompts: [
    { id: 'q1', text: 'Pergunta um?', assistance: 'Dica um.', kind: 'multipleChoice' as const, options: questionOptions('Opcao A') },
    { id: 'q2', text: 'Pergunta dois?', assistance: 'Dica dois.', kind: 'shortAnswer' as const, options: [] },
    { id: 'q3', text: 'Pergunta tres?', assistance: 'Dica tres.', kind: 'multipleChoice' as const, options: questionOptions('Opcao C') },
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
      id: 'unit-1', ordinal: 0, kind: 'paragraph' as const, sourceStartUtf16: 0, sourceEndUtf16: markdown.length,
      sectionPath: [], evaluated: true, score, outcome: score >= 90 ? 'complete' as const : 'good' as const,
    }],
    gaps,
    completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
  },
})

async function answerExamQuestion(user: ReturnType<typeof userEvent.setup>, option: string) {
  // A prova mista alterna multipla escolha (radio) e resposta curta
  // (textarea): o helper responde de acordo com a pergunta exibida.
  const textarea = document.querySelector('.review-question textarea') as HTMLTextAreaElement | null
  if (textarea) {
    await user.type(textarea, option)
  } else {
    await user.click(screen.getByRole('radio', { name: option }))
  }
  await user.click(screen.getByRole('button', { name: /Salvar resposta|Concluir e avaliar/ }))
}

function renderPage(onExit = vi.fn(), onCompleted = vi.fn()) {
  return { onExit, onCompleted, ...render(
    <ReviewAiSettingsProvider>
      <ReviewSessionPage vaultPath={VAULT_PATH} item={item} onExit={onExit} onCompleted={onCompleted} />
    </ReviewAiSettingsProvider>,
  ) }
}

describe('ReviewSessionPage', () => {
  beforeEach(() => {
    localStorage.clear()
    startMock.mockReset()
    completeMock.mockReset()
    continueMock.mockReset()
    reclassifyMock.mockReset()
    previewMock.mockReset()
    synthesisMock.mockReset()
    sourcesMock.mockReset()
    sourcesMock.mockResolvedValue([])
    previewMock.mockResolvedValue({
      targetUnitCount: 4, totalUnitCount: 10, coverageFraction: 0.4,
      estimatedMinutes: 6, expectedSessionsToCover: 3,
    })
    startMock.mockResolvedValue({ outcome: 'valid', draft })
    completeMock.mockResolvedValue(report(reportMarkdown, 72, [
      { classification: 'confused', sourceQuote: 'energia luminosa', sourceStartUtf16: 2, sourceEndUtf16: 18 },
    ]))
    reclassifyMock.mockResolvedValue({
      noteId: 'note-1', relativePath: item.relativePath, enrolled: true, readiness: 'ready',
      schedulingStatus: 'scheduled', firstReviewAtUnixMs: null, nextReviewAtUnixMs: 1_768_000_000_000,
      completedReviewCount: 1, due: false, policy: {},
    })
  })
  afterEach(cleanup)

  it('shows the estimated session plan on the setup screen and refreshes it per mode', async () => {
    const user = userEvent.setup()
    renderPage()
    // Plano estimado exibido com duracao, cobertura e sessoes para cobrir.
    await screen.findByText(/6 min/)
    expect(screen.getByText(/cobre 4 de 10 unidades \(40%\)/)).toBeInTheDocument()
    expect(screen.getByText(/cerca de 3 sessões para cobrir/)).toBeInTheDocument()
    // Trocar o modo recalcula o plano.
    previewMock.mockResolvedValue({
      targetUnitCount: 5, totalUnitCount: 10, coverageFraction: 0.5,
      estimatedMinutes: 7, expectedSessionsToCover: 2,
    })
    await user.click(screen.getByRole('radio', { name: /Modo conversa/ }))
    await screen.findByText(/7 min/)
    expect(screen.getByText(/cobre 5 de 10 unidades \(50%\)/)).toBeInTheDocument()
    // A falha do preview nunca bloqueia o inicio da sessao.
    previewMock.mockRejectedValue(new Error('offline'))
    await user.click(screen.getByRole('radio', { name: /Modo prova/ }))
    await screen.findByText(/Nao foi possivel estimar a sessao/)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('shows the evaluable points of each target unit on the setup screen', async () => {
    previewMock.mockResolvedValue({
      targetUnitCount: 2, totalUnitCount: 4, coverageFraction: 0.5,
      estimatedMinutes: 3, expectedSessionsToCover: 2,
      unitEvaluablePoints: [
        {
          unitId: 'unit-1', ordinal: 0, kind: 'paragraph',
          points: [
            'A fotossintese transforma energia luminosa em energia quimica.',
            'O processo libera oxigenio.',
          ],
        },
        { unitId: 'unit-2', ordinal: 1, kind: 'paragraph', points: [] },
      ],
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'O que esta sessão testará' })
    expect(screen.getByText('Parágrafo 1')).toBeInTheDocument()
    expect(screen.getByText('A fotossintese transforma energia luminosa em energia quimica.')).toBeInTheDocument()
    expect(screen.getByText('O processo libera oxigenio.')).toBeInTheDocument()
    // Unidade sem pontos nao aparece na lista.
    expect(screen.queryByText('Parágrafo 2')).not.toBeInTheDocument()
    // Sem pontos em nenhuma unidade, a secao nao e exibida.
    previewMock.mockResolvedValue({
      targetUnitCount: 1, totalUnitCount: 1, coverageFraction: 1,
      estimatedMinutes: 1, expectedSessionsToCover: 1, unitEvaluablePoints: [],
    })
    await user.click(screen.getByRole('radio', { name: /Modo conversa/ }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'O que esta sessão testará' })).not.toBeInTheDocument()
    })
  })

  it('explains that an objective exam is weaker evidence for scheduling', async () => {
    // Relatorio de prova objetiva (reconhecimento) concluido.
    completeMock.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 72, outcome: 'good',
        summary: 'Bom dominio.',
        markdown: reportMarkdown,
        units: [{
          id: 'unit-1', ordinal: 0, kind: 'paragraph' as const, sourceStartUtf16: 0, sourceEndUtf16: reportMarkdown.length,
          sectionPath: [], evaluated: true, score: 72, outcome: 'good',
        }],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
        evidence: 'recognition',
      },
    })
    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await answerExamQuestion(user, 'Opcao A beta')
    await answerExamQuestion(user, 'Opcao B gama')
    await answerExamQuestion(user, 'Opcao C alfa')

    expect(await screen.findByText(/prova objetiva: a nota reflete o acerto/i)).toBeInTheDocument()
    expect(screen.getByText(/evidência mais fraca de recuperação espontânea/i)).toBeInTheDocument()
    expect(onCompleted).toHaveBeenCalledOnce()
  })

  it('answers a short answer question with the typed text, without exposing the expected answer', async () => {
    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    // A primeira pergunta e de multipla escolha.
    await answerExamQuestion(user, 'Opcao A beta')
    // A segunda pergunta e de resposta curta: o textarea aparece e o botao
    // `Nao sei` continua disponivel.
    expect(await screen.findByRole('heading', { name: 'Pergunta dois?' })).toBeInTheDocument()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, 'A energia luminosa alimenta as plantas')
    await user.click(screen.getByRole('button', { name: 'Salvar resposta' }))
    expect(await screen.findByRole('heading', { name: 'Pergunta tres?' })).toBeInTheDocument()
    await answerExamQuestion(user, 'Opcao C alfa')

    expect(onCompleted).toHaveBeenCalledOnce()
    const submitted = completeMock.mock.calls[0][0].exchanges as Array<{ promptId: string; answer: string }>
    expect(submitted[1].promptId).toBe('q2')
    expect(submitted[1].answer).toBe('A energia luminosa alimenta as plantas')
  })

  it('lets the user answer `Nao sei` without guessing, sending the explicit option', async () => {
    completeMock.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 60, outcome: 'partial',
        summary: 'Prova concluida: 2 de 3 questoes corretas, 1 sem resposta.',
        markdown: reportMarkdown,
        units: [{
          id: 'unit-1', ordinal: 0, kind: 'paragraph' as const, sourceStartUtf16: 0, sourceEndUtf16: reportMarkdown.length,
          sectionPath: [], evaluated: true, score: 60, outcome: 'partial',
        }],
        gaps: [{ classification: 'forgotten', sourceQuote: 'fonte de energia', sourceStartUtf16: 10, sourceEndUtf16: 26 }],
        completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
        evidence: 'recognition',
      },
    })
    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await answerExamQuestion(user, 'Opcao A beta')
    await answerExamQuestion(user, 'Opcao B gama')
    // A opcao explicita `Nao sei` aparece fora das alternativas (vale para a
    // multipla escolha e para a resposta curta) e envia a resposta exata,
    // sem chute e sem indice de alternativa.
    await user.click(screen.getByRole('button', { name: 'Não sei' }))
    await user.click(screen.getByRole('button', { name: 'Concluir e avaliar' }))

    expect(await screen.findByText(/1 sem resposta/i)).toBeInTheDocument()
    expect(onCompleted).toHaveBeenCalledOnce()
    const submitted = completeMock.mock.calls[0][0].exchanges as Array<{ answer: string }>
    expect(submitted[2].answer).toBe('Não sei')
  })

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

  it('shows the adaptive coverage note and the not-evaluated badge for out-of-scope paragraphs', async () => {
    const firstParagraph = 'A energia luminosa alimenta a fotossintese.'
    const secondParagraph = 'A mitose divide a celula.'
    const coverageMarkdown = `${firstParagraph}\n\n${secondParagraph}`
    completeMock.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 72, outcome: 'good' as const,
        summary: 'Cobertura parcial.',
        markdown: coverageMarkdown,
        units: [
          {
            id: 'unit-1', ordinal: 0, kind: 'paragraph' as const, sourceStartUtf16: 0, sourceEndUtf16: firstParagraph.length,
            sectionPath: [], evaluated: true, score: 72, outcome: 'good' as const,
          },
          {
            id: 'unit-2', ordinal: 1, kind: 'paragraph' as const, sourceStartUtf16: firstParagraph.length + 2, sourceEndUtf16: coverageMarkdown.length,
            sectionPath: [], evaluated: false, score: 0, outcome: 'partial' as const,
          },
        ],
        gaps: [{
          classification: 'confused', sourceQuote: 'energia luminosa',
          sourceStartUtf16: 2, sourceEndUtf16: 18,
        }],
        completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }

    await waitFor(() => {
      const note = document.querySelector('.review-coverage-note')
      expect(note?.textContent).toContain('1 de 2 parágrafos')
    })
    const note = document.querySelector('.review-note-markdown')
    expect(note?.querySelector('.review-unit-score.is-not-evaluated')).toHaveTextContent('não avaliado')
    expect(note?.querySelector('.review-unit-score.is-good')).toHaveTextContent('72')
  })

  it('labels the coverage with seções when the note is segmented into sections', async () => {
    const firstSection = 'A energia luminosa alimenta a fotossintese.'
    const secondSection = 'A mitose divide a celula.'
    const coverageMarkdown = `${firstSection}\n\n${secondSection}`
    completeMock.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 72, outcome: 'good' as const,
        summary: 'Cobertura parcial.',
        markdown: coverageMarkdown,
        units: [
          {
            id: 'unit-1', ordinal: 0, kind: 'section' as const,
            sourceStartUtf16: 0, sourceEndUtf16: firstSection.length,
            sectionPath: ['Fotossíntese'], evaluated: true, score: 72, outcome: 'good' as const,
          },
          {
            id: 'unit-2', ordinal: 1, kind: 'section' as const,
            sourceStartUtf16: firstSection.length + 2, sourceEndUtf16: coverageMarkdown.length,
            sectionPath: ['Célula'], evaluated: false, score: 0, outcome: 'partial' as const,
          },
        ],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }

    await waitFor(() => {
      const note = document.querySelector('.review-coverage-note')
      expect(note?.textContent).toContain('1 de 2 seções')
    })
    expect(screen.getByRole('button', { name: /Revisar mais 1 seção agora/ })).toBeInTheDocument()
  })

  it('continues the calibration immediately when the report still has unobserved paragraphs', async () => {
    const firstParagraph = 'A energia luminosa alimenta a fotossintese.'
    const secondParagraph = 'A mitose divide a celula.'
    const coverageMarkdown = `${firstParagraph}\n\n${secondParagraph}`
    completeMock.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 72, outcome: 'good' as const,
        summary: 'Cobertura parcial.',
        markdown: coverageMarkdown,
        units: [
          {
            id: 'unit-1', ordinal: 0, kind: 'paragraph' as const, sourceStartUtf16: 0, sourceEndUtf16: firstParagraph.length,
            sectionPath: [], evaluated: true, score: 72, outcome: 'good' as const,
          },
          {
            id: 'unit-2', ordinal: 1, kind: 'paragraph' as const, sourceStartUtf16: firstParagraph.length + 2, sourceEndUtf16: coverageMarkdown.length,
            sectionPath: [], evaluated: false, score: 0, outcome: 'partial' as const,
          },
        ],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Revisar mais 1 parágrafo agora/ })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Revisar mais 1 parágrafo agora/ }))
    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ allowCalibrationContinuation: true }))
    })
  })

  it('reveals optional help without changing the answer flow', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await user.click(await screen.findByRole('button', { name: 'Mostrar dica' }))
    expect(screen.getByText('Dica um.')).toBeInTheDocument()
  })

  it('marks an answer given with the hint visible as assisted evidence', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await screen.findByRole('heading', { name: 'Pergunta um?' })
    // A dica fica visivel enquanto a resposta e enviada.
    await user.click(screen.getByRole('button', { name: 'Mostrar dica' }))
    await answerExamQuestion(user, 'Opcao A beta')
    // As demais respostas nao usam a dica.
    await answerExamQuestion(user, 'Opcao B gama')
    await answerExamQuestion(user, 'Opcao C alfa')

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    const submitted = completeMock.mock.calls[0][0].exchanges as Array<{ promptId: string; assistanceUsed: boolean }>
    expect(submitted).toHaveLength(3)
    expect(submitted[0]).toMatchObject({ promptId: 'q1', assistanceUsed: true })
    expect(submitted[1]).toMatchObject({ assistanceUsed: false })
    expect(submitted[2]).toMatchObject({ assistanceUsed: false })
  })

  it('explains that an assisted exam stabilizes even less than pure recognition', async () => {
    completeMock.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 72, outcome: 'good',
        summary: 'Prova concluida: 3 de 3 questoes corretas, 1 com ajuda.',
        markdown: reportMarkdown,
        units: [{
          id: 'unit-1', ordinal: 0, kind: 'paragraph' as const, sourceStartUtf16: 0, sourceEndUtf16: reportMarkdown.length,
          sectionPath: [], evaluated: true, score: 72, outcome: 'good',
        }],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
        evidence: 'assistedRecognition',
      },
    })
    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await answerExamQuestion(user, 'Opcao A beta')
    await answerExamQuestion(user, 'Opcao B gama')
    await answerExamQuestion(user, 'Opcao C alfa')

    expect(await screen.findByText(/peso é ainda menor para os trechos assistidos/i)).toBeInTheDocument()
    expect(onCompleted).toHaveBeenCalledOnce()
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

  it('finishes the conversation after the sixth answer without requesting another turn', async () => {
    // A conversa tem no maximo 6 respostas: ao responder a sexta, a sessao
    // finaliza direto, sem pedir um setimo turno a IA.
    startMock.mockResolvedValue({ outcome: 'valid', draft: conversationDraft })
    continueMock
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-2', text: 'Pergunta 2?', assistance: 'Dica.', options: [] }, shouldFinish: false })
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-3', text: 'Pergunta 3?', assistance: 'Dica.', options: [] }, shouldFinish: false })
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-4', text: 'Pergunta 4?', assistance: 'Dica.', options: [] }, shouldFinish: false })
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-5', text: 'Pergunta 5?', assistance: 'Dica.', options: [] }, shouldFinish: false })
      .mockResolvedValueOnce({ outcome: 'valid', prompt: { id: 'turn-6', text: 'Pergunta 6?', assistance: 'Dica.', options: [] }, shouldFinish: false })
    completeMock.mockResolvedValue(report(reportMarkdown, 72, []))

    const { onCompleted } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await screen.findByRole('heading', { name: 'O que a mitose produz?' })
    for (let index = 1; index <= 6; index += 1) {
      await user.type(screen.getByLabelText('Sua resposta'), `Resposta ${index}.`)
      await user.click(screen.getByRole('button', { name: 'Salvar resposta' }))
      if (index < 6) {
        await screen.findByRole('heading', { name: `Pergunta ${index + 1}?` })
      }
    }
    // Cinco continuacoes (da 2a a 6a pergunta) e depois nenhuma: a 6a resposta
    // finaliza sem pedir um setimo turno.
    expect(continueMock).toHaveBeenCalledTimes(5)
    expect((await screen.findAllByText('72')).length).toBeGreaterThan(0)
    expect(onCompleted).toHaveBeenCalledOnce()
  })

  it('labels a clarification turn in the conversation without exposing the expected content', async () => {
    startMock.mockResolvedValue({ outcome: 'valid', draft: conversationDraft })
    continueMock.mockResolvedValueOnce({
      outcome: 'valid',
      prompt: {
        id: 'turn-2',
        text: 'Voce quis dizer que as duas celulas sao identicas?',
        assistance: 'Nao ha resposta certa aqui.',
        options: [],
        isClarification: true,
      },
      shouldFinish: false,
    })
    completeMock.mockResolvedValue(report(reportMarkdown, 72, []))

    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await user.type(screen.getByLabelText('Sua resposta'), 'Duas celulas.')
    await user.click(screen.getByRole('button', { name: 'Salvar resposta' }))

    expect(await screen.findByText('Esclarecimento')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Voce quis dizer que as duas celulas sao identicas?' })).toBeInTheDocument()
  })

  it('renders an entirely inconclusive session without a score and lets the user redo it', async () => {
    completeMock.mockResolvedValue({
      outcome: 'inconclusive',
      report: {
        sessionId: 'session-1',
        overallScore: null,
        outcome: null,
        summary: 'Sessao inconclusiva: apenas 1 de 7 paragrafos-alvo tiveram evidencia valida (minimo de 50%).',
        markdown: reportMarkdown,
        units: [
          { id: 'unit-1', ordinal: 0, kind: 'paragraph' as const, sourceStartUtf16: 0, sourceEndUtf16: reportMarkdown.length, sectionPath: [], evaluated: false, inconclusive: true, score: 0, outcome: 'partial' },
        ],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: null,
        inconclusive: true,
      },
    })

    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }

    expect(await screen.findByText('Sessão inconclusiva')).toBeInTheDocument()
    expect(screen.getByText(/nenhuma avaliação foi persistida/i)).toBeInTheDocument()
    expect(screen.queryByText('/100')).not.toBeInTheDocument()
    expect(screen.queryByText('Próxima revisão:')).not.toBeInTheDocument()
    startMock.mockClear()
    await user.click(screen.getByRole('button', { name: 'Refazer revisão agora' }))
    expect(startMock).toHaveBeenCalledOnce()
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

    // Cancelar mantem a sessao ativa e fechando o dialogo.
    await user.click(screen.getByRole('button', { name: 'Notas' }))
    expect(screen.getByRole('dialog', { name: /abandonar esta revis/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Pergunta um?' })).toBeInTheDocument()

    // Confirmar descarta a sessao e sai para a fila.
    await user.click(screen.getByRole('button', { name: 'Notas' }))
    await user.click(screen.getByRole('button', { name: /confirmar abandono/i }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('guards vault switching during a session with the same confirmation dialog', async () => {
    const onExit = vi.fn()
    render(
      <ReviewAiSettingsProvider>
        <footer><button type="button" className="vault-switch-button">Meu Vault</button></footer>
        <ReviewSessionPage vaultPath="C:\\Vault" item={item} onExit={onExit} onCompleted={vi.fn()} />
      </ReviewAiSettingsProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await screen.findByRole('heading', { name: 'Pergunta um?' })

    await user.click(screen.getByRole('button', { name: 'Meu Vault' }))
    expect(screen.getByRole('dialog', { name: /abandonar esta revis/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Meu Vault' }))
    await user.click(screen.getByRole('button', { name: /confirmar abandono/i }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('abandons via the header button only after the dialog confirms', async () => {
    const { onExit } = renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await screen.findByRole('heading', { name: 'Pergunta um?' })

    await user.click(screen.getByRole('button', { name: 'Abandonar' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onExit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Abandonar' }))
    await user.click(screen.getByRole('button', { name: /confirmar abandono/i }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('prevents the window from unloading during an active session', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    await screen.findByRole('heading', { name: 'Pergunta um?' })

    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })

  it('corrects the classification of a paragraph by clicking its score badge', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }
    await screen.findByRole('heading', { name: 'Nota avaliada' })

    const badge = document.querySelector('.review-unit-score[data-unit-id]') as HTMLElement | null
    expect(badge).not.toBeNull()
    await user.click(badge!)
    const menu = screen.getByRole('menu', { name: /corrigir classificação/i })
    expect(menu).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /completa/i }))
    await waitFor(() => {
      expect(reclassifyMock).toHaveBeenCalledWith(expect.objectContaining({
        relativePath: item.relativePath,
        unitId: 'unit-1',
        score: 100,
      }))
    })
    // O badge passa a exibir a classificacao corrigida e a nota reagendada
    // pelo backend aparece no resumo.
    await waitFor(() => {
      expect(document.querySelector('.review-unit-score[data-unit-id]')).toHaveTextContent('100')
    })
    expect(document.querySelector('.review-unit-score[data-unit-id]')).toHaveAttribute('data-outcome', 'complete')
    expect(screen.getByText(/próxima revisão/i).textContent).toContain('de 2026')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the classification menu without changing anything when clicking outside', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Iniciar revisao' }))
    for (const option of ['Opcao A alfa', 'Opcao B alfa', 'Opcao C alfa']) {
      await answerExamQuestion(user, option)
    }
    await screen.findByRole('heading', { name: 'Nota avaliada' })

    const badge = document.querySelector('.review-unit-score[data-unit-id]') as HTMLElement | null
    await user.click(badge!)
    expect(screen.getByRole('menu', { name: /corrigir classificação/i })).toBeInTheDocument()
    await user.click(screen.getByRole('heading', { name: 'Nota avaliada' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(reclassifyMock).not.toHaveBeenCalled()
  })

  it('evaluates the user synthesis across the four dimensions without altering memory', async () => {
    synthesisMock.mockResolvedValue({
      outcome: 'valid',
      sourceHash: 'sha256:content',
      report: {
        overallScore: 72,
        dimensions: {
          core: { score: 80, explanation: 'Captura a ideia central.', quote: 'A fotossintese converte luz em energia.', sourceQuote: null },
          connections: { score: 60, explanation: 'Conecta clorofila e luz.', quote: 'A clorofila absorve a luz.', sourceQuote: null },
          application: { score: 75, explanation: 'Aplica em exemplo proprio.', quote: 'Isso explica plantas de sombra.', sourceQuote: null },
          gaps: { score: 50, explanation: 'Admite duvida sobre a fase escura.', quote: 'Nao lembro a fase escura.', sourceQuote: null },
        },
        observations: [{ text: 'Conecte mais os conceitos.' }],
      },
    })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Revisão de síntese/ }))
    await user.type(screen.getByLabelText('Sua síntese da nota'), 'A fotossintese converte luz em energia. A clorofila absorve a luz. Isso explica plantas de sombra. Nao lembro a fase escura.')
    await user.click(screen.getByRole('button', { name: 'Avaliar síntese' }))

    expect(await screen.findByText('Resultado da síntese')).toBeInTheDocument()
    expect(synthesisMock).toHaveBeenCalledWith({
      vaultPath: VAULT_PATH,
      relativePath: item.relativePath,
      synthesis: 'A fotossintese converte luz em energia. A clorofila absorve a luz. Isso explica plantas de sombra. Nao lembro a fase escura.',
      provider: 'ollama',
    })
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('Cerne')).toBeInTheDocument()
    expect(screen.getByText('Conexões')).toBeInTheDocument()
    expect(screen.getByText('Aplicação')).toBeInTheDocument()
    expect(screen.getByText('Lacunas')).toBeInTheDocument()
    expect(startMock).not.toHaveBeenCalled()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('lists the attachment sources considered by the synthesis session', async () => {
    sourcesMock.mockResolvedValue([
      { rawTarget: 'grafico.png', kind: 'image', relativePath: 'media/grafico.png', sizeBytes: 1024, reason: null },
      { rawTarget: 'manual.pdf', kind: 'document', relativePath: null, sizeBytes: null, reason: 'anexo não encontrado no inventário do Vault' },
      { rawTarget: 'fonte', kind: 'markdown', relativePath: 'fonte.md', sizeBytes: null, reason: null },
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Revisão de síntese/ }))

    expect(await screen.findByRole('heading', { name: 'Fontes consideradas' })).toBeInTheDocument()
    expect(sourcesMock).toHaveBeenCalledWith({ vaultPath: VAULT_PATH, relativePath: item.relativePath })
    expect(screen.getByText('grafico.png')).toBeInTheDocument()
    expect(screen.getByText('media/grafico.png')).toBeInTheDocument()
    expect(screen.getByText('manual.pdf')).toBeInTheDocument()
    expect(screen.getByText('fonte.md')).toBeInTheDocument()
  })

  it('shows the evaluation error when the synthesis cannot be validated', async () => {
    synthesisMock.mockResolvedValue({
      outcome: 'invalid',
      sourceHash: 'sha256:content',
      message: 'O relatorio de sintese nao esta fundamentado nos textos.',
      rawResponse: null,
      validationErrors: ['A citacao deve ser literal exata.'],
    })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Revisão de síntese/ }))
    await user.type(screen.getByLabelText('Sua síntese da nota'), 'A fotossintese converte luz em energia. A clorofila absorve a luz. Isso explica plantas de sombra. Nao lembro a fase escura.')
    await user.click(screen.getByRole('button', { name: 'Avaliar síntese' }))

    expect(await screen.findByText('O relatorio de sintese nao esta fundamentado nos textos.')).toBeInTheDocument()
    expect(screen.getByText('A citacao deve ser literal exata.')).toBeInTheDocument()
  })
})
