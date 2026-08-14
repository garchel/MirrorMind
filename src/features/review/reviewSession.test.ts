import { describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  completeReviewSession,
  parseConversationTurnAttempt,
  parseReviewCompletionAttempt,
  parseReviewGenerationAttempt,
  previewReviewSessionPlan,
  type ReviewExchange,
} from './reviewSession'

describe('review session IPC contracts', () => {
  it('accepts a valid estimated session plan', async () => {
    invoke.mockResolvedValue({
      targetUnitCount: 5,
      totalUnitCount: 10,
      coverageFraction: 0.5,
      estimatedMinutes: 7,
      expectedSessionsToCover: 2,
    })
    const plan = await previewReviewSessionPlan({
      vaultPath: 'C:\\Vault',
      relativePath: 'Biologia/Fotossintese.md',
      mode: 'exam',
    })
    expect(plan).toMatchObject({ targetUnitCount: 5, totalUnitCount: 10 })
    // Respostas antigas do preview (sem pontos) continuam validas: default vazio.
    expect(plan.unitEvaluablePoints).toEqual([])
    expect(invoke).toHaveBeenCalledWith('preview_review_session_plan', {
      path: 'C:\\Vault',
      relativePath: 'Biologia/Fotossintese.md',
      mode: 'exam',
    })
  })

  it('accepts the evaluable points of each target unit in the plan', async () => {
    invoke.mockResolvedValue({
      targetUnitCount: 2,
      totalUnitCount: 4,
      coverageFraction: 0.5,
      estimatedMinutes: 3,
      expectedSessionsToCover: 2,
      unitEvaluablePoints: [
        { unitId: 'unit-1', ordinal: 0, kind: 'paragraph', points: ['A fotossintese transforma energia luminosa em energia quimica.', 'O processo libera oxigenio.'] },
        { unitId: 'unit-2', ordinal: 1, kind: 'paragraph', points: [] },
      ],
    })
    const plan = await previewReviewSessionPlan({
      vaultPath: 'C:\\Vault',
      relativePath: 'Biologia/Fotossintese.md',
      mode: 'exam',
    })
    expect(plan.unitEvaluablePoints).toHaveLength(2)
    expect(plan.unitEvaluablePoints[0].points[1]).toBe('O processo libera oxigenio.')
    expect(plan.unitEvaluablePoints[1].kind).toBe('paragraph')
    // Ponto fora dos limites de contrato e rejeitado.
    invoke.mockResolvedValue({
      targetUnitCount: 1,
      totalUnitCount: 1,
      coverageFraction: 1,
      estimatedMinutes: 1,
      expectedSessionsToCover: 1,
      unitEvaluablePoints: [{ unitId: 'unit-1', ordinal: 0, kind: 'invented', points: ['x'] }],
    })
    await expect(previewReviewSessionPlan({
      vaultPath: 'C:\\Vault',
      relativePath: 'Nota.md',
      mode: 'exam',
    })).rejects.toThrow()
  })

  it('rejects a plan that covers more units than exist or exceeds one session of coverage', async () => {
    invoke.mockResolvedValue({
      targetUnitCount: 11,
      totalUnitCount: 10,
      coverageFraction: 1.5,
      estimatedMinutes: 7,
      expectedSessionsToCover: 1,
    })
    await expect(previewReviewSessionPlan({
      vaultPath: 'C:\\Vault',
      relativePath: 'Nota.md',
      mode: 'conversation',
    })).rejects.toThrow()
  })

  it('accepts a generated exam draft without exposing note content', () => {
    const payload = {
      outcome: 'valid',
      draft: {
        sessionId: 'session-1',
        noteId: 'note-1',
        relativePath: 'Biologia/Fotossintese.md',
        noteContentHash: 'sha256:content',
        mode: 'exam',
        provider: 'ollama',
        prompts: [
          {
            id: 'question-1', text: 'Como a energia muda?', assistance: 'Pense nas formas de energia.',
            kind: 'multipleChoice', options: ['Quimica', 'Luminosa', 'Termica', 'Nuclear'], isClarification: false,
          },
          {
            id: 'question-2', text: 'Quais substancias participam?', assistance: 'Considere os reagentes.',
            kind: 'multipleChoice', options: ['Agua e gas carbonico', 'Oxigenio e hidrogenio', 'Glucose e ATP', 'Sais e proteinas'], isClarification: false,
          },
          {
            id: 'question-3', text: 'O que e liberado?', assistance: 'A nota cita um gas.',
            kind: 'shortAnswer', options: [], isClarification: false,
          },
        ],
        minimumAnswers: 3,
        maximumAnswers: 5,
      },
    }

    expect(parseReviewGenerationAttempt(payload)).toEqual(payload)
    expect(JSON.stringify(payload)).not.toContain('sourceMarkdown')
    // A alternativa correta nunca e exposta ao cliente no contrato do rascunho.
    expect(JSON.stringify(payload)).not.toContain('correctOptionIndex')
  })

  it('accepts a progressive conversation turn and a grounded final report', () => {
    expect(parseConversationTurnAttempt({
      outcome: 'valid',
      prompt: {
        id: 'turn-2',
        text: 'Por que isso acontece?',
        assistance: 'Considere o mecanismo descrito.',
      },
      shouldFinish: false,
    })).toMatchObject({ outcome: 'valid', shouldFinish: false })

    expect(parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 72,
        outcome: 'good',
        summary: 'Bom dominio, com uma imprecisao.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [{
          id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 46,
          sectionPath: [], evaluated: true, score: 72, outcome: 'good',
        }],
        gaps: [{
          classification: 'confused',
          sourceQuote: 'energia luminosa',
          sourceStartUtf16: 2,
          sourceEndUtf16: 18,
        }],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toMatchObject({
      outcome: 'valid',
      report: { overallScore: 72, outcome: 'good', units: [{ score: 72 }] },
    })
  })

  it('accepts unit assertions and defaults them to empty for legacy reports', () => {
    const withAssertions = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 50,
        outcome: 'partial',
        summary: 'Lembrou a maior parte do paragrafo.',
        markdown: 'ATP armazena energia para uso celular e libera ADP.',
        units: [{
          id: 'unit-1', ordinal: 0, kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 48,
          sectionPath: [], evaluated: true, score: 50, outcome: 'partial',
          assertions: [
            { text: 'ATP armazena energia.', status: 'remembered', sourceQuote: 'armazena energia', sourceStartUtf16: 4, sourceEndUtf16: 20 },
            { text: 'A hidrolise libera ADP.', status: 'partial', sourceQuote: 'libera ADP', sourceStartUtf16: 34, sourceEndUtf16: 45 },
            { text: 'A energia vem da clorofila.', status: 'contradicted', sourceQuote: 'energia para uso celular', sourceStartUtf16: 4, sourceEndUtf16: 27 },
          ],
        }],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
    expect(withAssertions.outcome).toBe('valid')
    if (withAssertions.outcome === 'valid') {
      const unit = withAssertions.report.units[0]
      expect(unit.assertions).toHaveLength(3)
      expect(unit.assertions[1]).toMatchObject({ text: 'A hidrolise libera ADP.', status: 'partial' })
      expect(unit.assertions[2].status).toBe('contradicted')
      // Identificacao do cerne: ausente na resposta -> secundaria (default).
      expect(unit.assertions.every((assertion) => assertion.centrality === 'secondary')).toBe(true)
    }

    // Classificacao central/secundaria e preservada quando o provedor envia.
    const withCentrality = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-3',
        overallScore: 33,
        outcome: 'forgotten',
        summary: 'Esqueceu a ideia central.',
        markdown: 'A fotossintese converte energia luminosa em quimica.',
        units: [{
          id: 'unit-1', ordinal: 0, kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 52,
          sectionPath: [], evaluated: true, score: 33, outcome: 'forgotten',
          assertions: [
            { text: 'A fotossintese converte energia', status: 'missing', centrality: 'central', sourceQuote: 'converte energia luminosa', sourceStartUtf16: 15, sourceEndUtf16: 43 },
            { text: 'libera oxigenio', status: 'remembered', centrality: 'secondary', sourceQuote: 'em quimica', sourceStartUtf16: 44, sourceEndUtf16: 52 },
          ],
        }],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
    expect(withCentrality.outcome).toBe('valid')
    if (withCentrality.outcome === 'valid') {
      expect(withCentrality.report.units[0].assertions[0].centrality).toBe('central')
      expect(withCentrality.report.units[0].assertions[1].centrality).toBe('secondary')
    }

    // Dados antigos (avaliacao por lacunas) nao carregam o campo: o default
    // vazio mantem a compatibilidade e o relatorio continua valido.
    const legacy = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-2',
        overallScore: 72,
        outcome: 'good',
        summary: 'Bom dominio.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [{
          id: 'unit-1', ordinal: 0, kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 46,
          sectionPath: [], evaluated: true, score: 72, outcome: 'good',
        }],
        gaps: [{ classification: 'confused', sourceQuote: 'energia luminosa', sourceStartUtf16: 2, sourceEndUtf16: 18 }],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
    expect(legacy.outcome).toBe('valid')
    if (legacy.outcome === 'valid') {
      expect(legacy.report.units[0].assertions).toEqual([])
    }

    // Status fora do contrato e rejeitado.
    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-3',
        overallScore: 72,
        outcome: 'good',
        summary: 'Bom dominio.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [{
          id: 'unit-1', ordinal: 0, kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 46,
          sectionPath: [], evaluated: true, score: 72, outcome: 'good',
          assertions: [{ text: 'x', status: 'inventado', sourceQuote: 'x', sourceStartUtf16: 0, sourceEndUtf16: 1 }],
        }],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toThrow()
  })

  it('rejects a report whose overall score is not the rounded mean of the units', () => {
    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 90,
        outcome: 'complete',
        summary: 'Inconsistente.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [
          { id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 23, sectionPath: [], evaluated: true, score: 100, outcome: 'complete' },
          { id: 'unit-2', ordinal: 1,  kind: 'paragraph', sourceStartUtf16: 25, sourceEndUtf16: 46, sectionPath: [], evaluated: true, score: 100, outcome: 'complete' },
        ],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toThrow()
  })

  it('rejects a unit scored 100 while a gap lies inside its range', () => {
    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 95,
        outcome: 'complete',
        summary: 'Inconsistente.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [{
          id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 46,
          sectionPath: [], evaluated: true, score: 100, outcome: 'complete',
        }],
        gaps: [{ classification: 'forgotten', sourceQuote: 'energia', sourceStartUtf16: 2, sourceEndUtf16: 9 }],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toThrow()
  })

  it('rejects unbounded or structurally inconsistent payloads', () => {
    expect(() => parseReviewGenerationAttempt({
      outcome: 'valid',
      draft: {
        sessionId: 'session-1',
        noteId: 'note-1',
        relativePath: 'Nota.md',
        noteContentHash: 'sha256:content',
        mode: 'exam',
        provider: 'ollama',
        prompts: [],
        minimumAnswers: 3,
        maximumAnswers: 5,
      },
    })).toThrow()

    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 120,
        outcome: 'complete',
        summary: 'Invalido.',
        markdown: 'Conteudo.',
        units: [{ id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 9, sectionPath: [], score: 120, outcome: 'complete' }],
        gaps: [],
        completedAtUnixMs: 1,
        nextReviewAtUnixMs: 2,
      },
    })).toThrow()
  })

  it('accepts an entirely inconclusive session without score or next review', () => {
    const attempt = parseReviewCompletionAttempt({
      outcome: 'inconclusive',
      report: {
        sessionId: 'session-1',
        overallScore: null,
        outcome: null,
        summary: 'Sessao inconclusiva: apenas 1 de 7 paragrafos-alvo tiveram evidencia valida.',
        markdown: 'Paragrafo um.\n\nParagrafo dois.',
        units: [
          { id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 12, sectionPath: [], evaluated: false, inconclusive: false, score: 0, outcome: 'partial' },
          { id: 'unit-2', ordinal: 1,  kind: 'paragraph', sourceStartUtf16: 14, sourceEndUtf16: 27, sectionPath: [], evaluated: false, inconclusive: true, score: 0, outcome: 'partial' },
        ],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: null,
        inconclusive: true,
      },
    })
    expect(attempt.outcome).toBe('inconclusive')
    if (attempt.outcome !== 'inconclusive') throw new Error('expected inconclusive')
    expect(attempt.report.overallScore).toBeNull()
    expect(attempt.report.nextReviewAtUnixMs).toBeNull()
    expect(attempt.report.units[1].inconclusive).toBe(true)
  })

  it('rejects an inconclusive attempt that claims to be valid and vice versa', () => {
    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: null,
        outcome: null,
        summary: 'Invalido.',
        markdown: 'Conteudo.',
        units: [{ id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 9, sectionPath: [], evaluated: false, score: 0, outcome: 'partial' }],
        gaps: [],
        completedAtUnixMs: 1,
        nextReviewAtUnixMs: null,
        inconclusive: true,
      },
    })).toThrow()
    expect(() => parseReviewCompletionAttempt({
      outcome: 'inconclusive',
      report: {
        sessionId: 'session-1',
        overallScore: null,
        outcome: null,
        summary: 'Invalido.',
        markdown: 'Conteudo.',
        units: [{ id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 9, sectionPath: [], evaluated: false, score: 0, outcome: 'partial' }],
        gaps: [],
        completedAtUnixMs: 1,
        nextReviewAtUnixMs: null,
      },
    })).toThrow()
  })

  it('parses the evidence strength of the report (recognition vs open answer)', () => {
    const baseReport = {
      sessionId: 'session-1',
      overallScore: 100,
      outcome: 'complete',
      summary: 'Prova concluida.',
      markdown: 'Conteudo.',
      units: [{ id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 9, sectionPath: [], evaluated: true, score: 100, outcome: 'complete' }],
      gaps: [],
      completedAtUnixMs: 1_730_000_000_000,
      nextReviewAtUnixMs: 1_730_604_800_000,
    }
    // Prova objetiva: reconhecimento.
    const exam = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: { ...baseReport, evidence: 'recognition' },
    })
    expect(exam).toMatchObject({ outcome: 'valid' })
    if (exam.outcome !== 'valid') throw new Error('expected valid')
    expect(exam.report.evidence).toBe('recognition')
    // Conversa: resposta aberta.
    const conversation = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: { ...baseReport, evidence: 'conversation' },
    })
    if (conversation.outcome !== 'valid') throw new Error('expected valid')
    expect(conversation.report.evidence).toBe('conversation')
    // Payload sem o campo (sessoes antigas): cai no default freeRecall.
    const legacy = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: baseReport,
    })
    if (legacy.outcome !== 'valid') throw new Error('expected valid')
    expect(legacy.report.evidence).toBe('freeRecall')
  })

  it('accepts assisted evidence for answers given with the hint or context revealed', () => {
    const baseReport = {
      sessionId: 'session-1',
      overallScore: 100,
      outcome: 'complete',
      summary: 'Prova concluida: 3 de 3 questoes corretas, 1 com ajuda.',
      markdown: 'Conteudo.',
      units: [{ id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 9, sectionPath: [], evaluated: true, score: 100, outcome: 'complete' }],
      gaps: [],
      completedAtUnixMs: 1_730_000_000_000,
      nextReviewAtUnixMs: 1_730_604_800_000,
    }
    // Prova com dica exibida: reconhecimento assistido.
    const exam = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: { ...baseReport, evidence: 'assistedRecognition' },
    })
    if (exam.outcome !== 'valid') throw new Error('expected valid')
    expect(exam.report.evidence).toBe('assistedRecognition')
    // Conversa que recorreu ao contexto: conversa assistida.
    const conversation = parseReviewCompletionAttempt({
      outcome: 'valid',
      report: { ...baseReport, evidence: 'assistedConversation' },
    })
    if (conversation.outcome !== 'valid') throw new Error('expected valid')
    expect(conversation.report.evidence).toBe('assistedConversation')
  })

  it('accepts a clarification conversation turn without exposing internals', () => {
    const parsed = parseConversationTurnAttempt({
      outcome: 'valid',
      prompt: {
        id: 'turn-2', text: 'Voce quis dizer que as celulas sao identicas?', assistance: 'Nao ha resposta certa.',
        options: [], isClarification: true,
      },
      shouldFinish: false,
    })
    expect(parsed).toMatchObject({ outcome: 'valid' })
    if (parsed.outcome !== 'valid' || parsed.prompt === null) throw new Error('expected a prompt')
    expect(parsed.prompt.isClarification).toBe(true)
  })

  it('rejects a conversation completion with 3 or 7 answers and accepts the flag', async () => {
    const draft = {
      sessionId: 'session-1',
      noteId: 'note-1',
      relativePath: 'Biologia/Fotossintese.md',
      noteContentHash: 'sha256:content',
      mode: 'conversation' as const,
      provider: 'ollama' as const,
      prompts: [{ id: 'turn-1', text: 'O que a mitose produz?', assistance: 'Pense nas celulas.', kind: 'shortAnswer' as const, options: [], isClarification: false }],
      minimumAnswers: 4,
      maximumAnswers: 6,
    }
    invoke.mockResolvedValue({
      outcome: 'valid',
      report: {
        sessionId: 'session-1', overallScore: 100, outcome: 'complete', summary: 'Ok.', markdown: '# Nota\n\nTexto.',
        units: [{ id: 'unit-1', ordinal: 0,  kind: 'paragraph', sourceStartUtf16: 0, sourceEndUtf16: 8, sectionPath: [], evaluated: true, score: 100, outcome: 'complete' }],
        gaps: [], completedAtUnixMs: 1_730_000_000_000, nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })
    const exchange = (i: number): ReviewExchange => ({ promptId: `turn-${i + 1}`, prompt: `Pergunta ${i + 1}?`, answer: `Resposta ${i + 1}.`, assistanceUsed: false, isClarification: false })
    // Tres respostas: abaixo do minimo de 4 para a conversa.
    await expect(completeReviewSession({ vaultPath: 'C:\\Vault', draft, provider: 'ollama', exchanges: [1, 2, 3].map(exchange) })).rejects.toThrow()
    // Sete respostas: acima do maximo de 6.
    await expect(completeReviewSession({ vaultPath: 'C:\\Vault', draft, provider: 'ollama', exchanges: [1, 2, 3, 4, 5, 6, 7].map(exchange) })).rejects.toThrow()
    // O flag de esclarecimento acompanha o exchange enviado ao backend.
    const exchanges = [
      { ...exchange(0), isClarification: false },
      { ...exchange(1), isClarification: true },
      { ...exchange(2), isClarification: false },
      exchange(3),
    ]
    await completeReviewSession({ vaultPath: 'C:\\Vault', draft, provider: 'ollama', exchanges })
    expect(invoke).toHaveBeenCalledWith('complete_note_review_session', expect.objectContaining({
      exchanges: expect.arrayContaining([expect.objectContaining({ isClarification: true })]),
    }))
  })
})