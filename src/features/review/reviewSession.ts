import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import type { ReviewAiProvider } from './ai'

export type ReviewMode = 'exam' | 'conversation'

const boundedText = z.string().trim().min(1).max(8_192)
const safeTimestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hashSchema = z.string().startsWith('sha256:').max(256)
const optionText = z.string().trim().min(1).max(1_024)

const reviewPromptSchema = z.object({
  id: z.string().min(1).max(256),
  text: boundedText,
  assistance: boundedText,
  // Tipo da pergunta da prova mista: multipla escolha (o usuario escolhe a
  // alternativa) ou resposta curta (o usuario escreve). A resposta correta
  // (indice da alternativa ou resposta esperada) nunca trafega para o
  // cliente: o backend guarda e corrige.
  kind: z.enum(['multipleChoice', 'shortAnswer']).default('multipleChoice'),
  // Alternativas de multipla escolha; vazio para resposta curta e conversa.
  options: z.array(optionText).max(5).default([]),
  // Pergunta neutra de esclarecimento (modo conversa): desambigua a resposta
  // anterior sem revelar o conteúdo esperado.
  isClarification: z.boolean().default(false),
}).strict().superRefine((prompt, context) => {
  if (prompt.kind === 'shortAnswer' && prompt.options.length > 0) {
    context.addIssue({ code: 'custom', message: 'A short answer question cannot carry options.' })
  }
  if (prompt.options.length > 0 && prompt.options.length < 3) {
    context.addIssue({ code: 'custom', message: 'A multiple-choice question needs at least 3 options.' })
  }
  if (new Set(prompt.options).size !== prompt.options.length) {
    context.addIssue({ code: 'custom', message: 'Multiple-choice options must be distinct.' })
  }
})

const reviewSessionDraftSchema = z.object({
  sessionId: z.string().min(1).max(256),
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  noteContentHash: hashSchema,
  mode: z.enum(['exam', 'conversation']),
  provider: z.enum(['gemini', 'ollama']),
  prompts: z.array(reviewPromptSchema).min(1).max(5),
  minimumAnswers: z.number().int().min(3).max(6),
  maximumAnswers: z.number().int().min(3).max(6),
}).strict().superRefine((draft, context) => {
  // A prova e mista: cada pergunta e de multipla escolha (3-5 alternativas) ou
  // de resposta curta (sem alternativas), e a prova precisa trazer os dois
  // tipos — reconhecimento e recordacao espontanea.
  const validExam = draft.mode === 'exam'
    && draft.prompts.length >= 3
    && draft.prompts.length <= 5
    && draft.minimumAnswers === 3
    && draft.maximumAnswers === 5
    && draft.prompts.some((prompt) => prompt.kind === 'multipleChoice')
    && draft.prompts.some((prompt) => prompt.kind === 'shortAnswer')
    && draft.prompts.every((prompt) => prompt.kind === 'multipleChoice'
      ? prompt.options.length >= 3 && prompt.options.length <= 5
      : prompt.options.length === 0)
  const validConversation = draft.mode === 'conversation'
    && draft.prompts.length === 1
    && draft.minimumAnswers === 4
    && draft.maximumAnswers === 6
    && draft.prompts.every((prompt) => prompt.options.length === 0)
  if (!validExam && !validConversation) {
    context.addIssue({ code: 'custom', message: 'Review draft limits do not match its mode.' })
  }
})

// Plano estimado da sessao antes de iniciar: quantas unidades serao cobertas,
// a fracao da nota, a duracao estimada e quantas sessoes seriam necessarias
// para cobrir tudo. Derivado deterministicamente da selecao de cobertura no
// backend (sem consultar a IA) — o que o usuario ve na preparacao e o que a
// sessao executara.
const reviewSessionPlanSchema = z.object({
  targetUnitCount: z.number().int().positive().max(2_000),
  totalUnitCount: z.number().int().positive().max(2_000),
  coverageFraction: z.number().min(0).max(1),
  estimatedMinutes: z.number().int().positive().max(24 * 60),
  expectedSessionsToCover: z.number().int().positive().max(2_000),
}).strict().superRefine((plan, context) => {
  if (plan.targetUnitCount > plan.totalUnitCount) {
    context.addIssue({ code: 'custom', message: 'The session plan cannot cover more units than exist.' })
  }
  if (plan.coverageFraction > 1) {
    context.addIssue({ code: 'custom', message: 'The coverage fraction must be at most 1.' })
  }
})

export type ReviewSessionPlan = z.infer<typeof reviewSessionPlanSchema>

const invalidAttemptSchema = z.object({
  outcome: z.literal('invalid'),
  message: boundedText,
  rawResponse: z.string().max(2 * 1024 * 1024).nullable(),
  validationErrors: z.array(boundedText).max(200),
}).strict()

const reviewGenerationAttemptSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('valid'),
    draft: reviewSessionDraftSchema,
  }).strict(),
  invalidAttemptSchema,
])

const conversationTurnAttemptSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('valid'),
    prompt: reviewPromptSchema.nullable(),
    shouldFinish: z.boolean(),
  }).strict().superRefine((turn, context) => {
    if (turn.shouldFinish === (turn.prompt !== null)) {
      context.addIssue({ code: 'custom', message: 'A finished turn cannot include another prompt.' })
    }
  }),
  invalidAttemptSchema,
])

const reviewGapSchema = z.object({
  classification: z.enum(['forgotten', 'confused']),
  sourceQuote: boundedText,
  sourceStartUtf16: z.number().int().nonnegative().max(4_294_967_295),
  sourceEndUtf16: z.number().int().positive().max(4_294_967_295),
}).strict().superRefine((gap, context) => {
  if (gap.sourceEndUtf16 <= gap.sourceStartUtf16) {
    context.addIssue({ code: 'custom', message: 'Grounded review ranges must be non-empty.' })
  }
})

const reviewUnitReportSchema = z.object({
  id: z.string().min(1).max(256),
  ordinal: z.number().int().nonnegative().max(2_000),
  // Tipo da unidade na segmentacao: usado nos rotulos de contagem da cobertura
  // (``secoes``, ``paragrafos`` ou ``unidades``).
  kind: z.enum(['wholeNote', 'section', 'paragraph']),
  sourceStartUtf16: z.number().int().nonnegative().max(4_294_967_295),
  sourceEndUtf16: z.number().int().positive().max(4_294_967_295),
  sectionPath: z.array(z.string().min(1).max(512)).max(64),
  // A unidade foi efetivamente avaliada nesta sessão (fazia parte do alvo da
  // cobertura adaptativa). Unidades fora do alvo não pontuam nem evoluem
  // estado; score/outcome são ignorados para elas.
  evaluated: z.boolean(),
  // Unidade do alvo com evidência insuficiente (inconclusiva): nunca pontua
  // zero, não altera DSR/FSRS e não entra na média.
  inconclusive: z.boolean().default(false),
  score: z.number().int().min(0).max(100),
  outcome: z.enum(['forgotten', 'partial', 'good', 'complete']),
}).strict().superRefine((unit, context) => {
  if (unit.sourceEndUtf16 <= unit.sourceStartUtf16) {
    context.addIssue({ code: 'custom', message: 'Unit source ranges must be non-empty.' })
  }
  if (!unit.evaluated) return
  const bandMatches = (unit.score <= 39 && unit.outcome === 'forgotten')
    || (unit.score >= 40 && unit.score <= 69 && unit.outcome === 'partial')
    || (unit.score >= 70 && unit.score <= 89 && unit.outcome === 'good')
    || (unit.score >= 90 && unit.outcome === 'complete')
  if (!bandMatches) {
    context.addIssue({ code: 'custom', message: 'The unit score and outcome band must match.' })
  }
})

const reviewCompletionReportSchema = z.object({
  sessionId: z.string().min(1).max(256),
  // Nulo quando a sessão inteira é inconclusiva (cobertura válida abaixo do
  // mínimo): nada foi persistido e a nota permanece vencida.
  overallScore: z.number().int().min(0).max(100).nullable(),
  outcome: z.enum(['forgotten', 'partial', 'good', 'complete']).nullable(),
  summary: boundedText,
  markdown: z.string().max(2_000_000),
  units: z.array(reviewUnitReportSchema).min(1).max(2_000),
  gaps: z.array(reviewGapSchema).max(200),
  completedAtUnixMs: safeTimestamp,
  // Força da evidência que fundamentou o agendamento: a prova objetiva é
  // reconhecimento (evidência mais fraca de recuperação espontânea) e a
  // conversa é resposta aberta. A nota exibida é a mesma; a evidência difere
  // na atualização DSR/FSRS. As variantes assistidas (`assistedRecognition`,
  // `assistedConversation`) indicam que a resposta veio com a dica/contexto
  // exibido e estabilizam ainda menos.
  evidence: z.enum(['recognition', 'freeRecall', 'conversation', 'assistedRecognition', 'assistedConversation']).default('freeRecall'),
  nextReviewAtUnixMs: safeTimestamp.nullable(),
  inconclusive: z.boolean().default(false),
}).strict().superRefine((report, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message })
  if (report.inconclusive) {
    if (report.overallScore !== null || report.outcome !== null || report.nextReviewAtUnixMs !== null) {
      issue('An inconclusive session must not carry a score, outcome or next review.')
    }
    if (report.units.some((unit) => unit.evaluated)) {
      issue('An inconclusive session must not mark any unit as evaluated.')
    }
    return
  }
  if (report.overallScore === null || report.outcome === null || report.nextReviewAtUnixMs === null) {
    issue('A conclusive session always carries a score, outcome and next review.')
    return
  }
  const outcomeMatches = (report.overallScore <= 39 && report.outcome === 'forgotten')
    || (report.overallScore >= 40 && report.overallScore <= 69 && report.outcome === 'partial')
    || (report.overallScore >= 70 && report.overallScore <= 89 && report.outcome === 'good')
    || (report.overallScore >= 90 && report.outcome === 'complete')
  if (!outcomeMatches) {
    issue('The score and outcome band must match.')
  }
  if (report.nextReviewAtUnixMs <= report.completedAtUnixMs) {
    issue('The next review must be after completion.')
  }
  if ((report.overallScore === 100) !== (report.gaps.length === 0)) {
    issue('Only a perfect result can omit grounded gaps.')
  }
  const evaluatedUnits = report.units.filter((unit) => unit.evaluated)
  if (evaluatedUnits.length === 0) {
    issue('A session must evaluate at least one unit.')
  }
  // A pontuação geral usa somente as unidades efetivamente avaliadas; as
  // unidades fora do alvo da cobertura adaptativa não entram na média.
  const roundedMean = Math.round(evaluatedUnits.reduce((sum, unit) => sum + unit.score, 0) / evaluatedUnits.length)
  if (roundedMean !== report.overallScore) {
    issue('The overall score must equal the rounded mean of the evaluated unit scores.')
  }
  for (const gap of report.gaps) {
    const contained = report.units.some((unit) => (
      unit.sourceStartUtf16 <= gap.sourceStartUtf16 && gap.sourceEndUtf16 <= unit.sourceEndUtf16
    ))
    if (!contained) {
      issue('Every gap must be contained within an evaluated unit.')
    }
  }
  for (const unit of report.units) {
    if (!unit.evaluated) continue
    const insideGaps = report.gaps.filter((gap) => (
      unit.sourceStartUtf16 <= gap.sourceStartUtf16 && gap.sourceEndUtf16 <= unit.sourceEndUtf16
    )).length
    if ((unit.score === 100) !== (insideGaps === 0)) {
      issue('A unit scores 100 if and only if no gap is attributed to it.')
    }
  }
})

const reviewCompletionAttemptSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('valid'),
    report: reviewCompletionReportSchema,
  }).strict().superRefine((attempt, context) => {
    if (attempt.report.inconclusive) {
      context.addIssue({ code: 'custom', message: 'A valid attempt cannot report an inconclusive session.' })
    }
  }),
  z.object({
    outcome: z.literal('inconclusive'),
    report: reviewCompletionReportSchema,
  }).strict().superRefine((attempt, context) => {
    if (!attempt.report.inconclusive) {
      context.addIssue({ code: 'custom', message: 'An inconclusive attempt must report an inconclusive session.' })
    }
  }),
  invalidAttemptSchema,
])

const reviewExchangeSchema = z.object({
  promptId: z.string().min(1).max(256),
  prompt: boundedText,
  answer: z.string().trim().min(1).max(32_768),
  // A resposta foi dada com a dica (prova) ou contexto (conversa) exibido:
  // a recuperação foi assistida, evidência mais fraca para o agendamento.
  assistanceUsed: z.boolean().default(false),
  // O turno respondido era uma pergunta neutra de esclarecimento (conversa).
  // O backend valida contra o prompt emitido e usa a contagem para limitar a
  // no máximo dois esclarecimentos por conversa de forma determinística.
  isClarification: z.boolean().default(false),
}).strict()

export type ReviewPrompt = z.infer<typeof reviewPromptSchema>
export type ReviewSessionDraft = z.infer<typeof reviewSessionDraftSchema>
export type ReviewExchange = z.infer<typeof reviewExchangeSchema>
export type ReviewGenerationAttempt = z.infer<typeof reviewGenerationAttemptSchema>
export type ConversationTurnAttempt = z.infer<typeof conversationTurnAttemptSchema>
export type ReviewCompletionAttempt = z.infer<typeof reviewCompletionAttemptSchema>
export type ReviewCompletionReport = z.infer<typeof reviewCompletionReportSchema>

export function parseReviewGenerationAttempt(payload: unknown): ReviewGenerationAttempt {
  return reviewGenerationAttemptSchema.parse(payload)
}

export function parseConversationTurnAttempt(payload: unknown): ConversationTurnAttempt {
  return conversationTurnAttemptSchema.parse(payload)
}

export function parseReviewCompletionAttempt(payload: unknown): ReviewCompletionAttempt {
  return reviewCompletionAttemptSchema.parse(payload)
}

export async function previewReviewSessionPlan(input: {
  vaultPath: string
  relativePath: string
  mode: ReviewMode
}): Promise<ReviewSessionPlan> {
  return reviewSessionPlanSchema.parse(await invoke('preview_review_session_plan', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    mode: input.mode,
  }))
}

export async function startReviewSession(input: {
  vaultPath: string
  relativePath: string
  provider: ReviewAiProvider
  mode: ReviewMode
  /** Permite iniciar uma etapa de calibracao de nota longa mesmo sem a nota
   * estar vencida, enquanto houver unidades ainda nao observadas. */
  allowCalibrationContinuation?: boolean
}): Promise<ReviewGenerationAttempt> {
  return parseReviewGenerationAttempt(await invoke('start_note_review_session', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    provider: input.provider,
    mode: input.mode,
    allowCalibrationContinuation: input.allowCalibrationContinuation ?? false,
  }))
}

export async function continueReviewConversation(input: {
  vaultPath: string
  draft: ReviewSessionDraft
  provider: ReviewAiProvider
  exchanges: ReviewExchange[]
}): Promise<ConversationTurnAttempt> {
  const exchanges = z.array(reviewExchangeSchema).min(1).max(5).parse(input.exchanges)
  return parseConversationTurnAttempt(await invoke('continue_note_review_conversation', {
    path: input.vaultPath,
    relativePath: input.draft.relativePath,
    provider: input.provider,
    sessionId: input.draft.sessionId,
    noteId: input.draft.noteId,
    noteContentHash: input.draft.noteContentHash,
    exchanges,
  }))
}

export async function completeReviewSession(input: {
  vaultPath: string
  draft: ReviewSessionDraft
  provider: ReviewAiProvider
  exchanges: ReviewExchange[]
}): Promise<ReviewCompletionAttempt> {
  const bounds = input.draft.mode === 'exam' ? z.array(reviewExchangeSchema).min(3).max(5)
    : z.array(reviewExchangeSchema).min(4).max(6)
  const exchanges = bounds.parse(input.exchanges)
  return parseReviewCompletionAttempt(await invoke('complete_note_review_session', {
    path: input.vaultPath,
    relativePath: input.draft.relativePath,
    provider: input.provider,
    sessionId: input.draft.sessionId,
    noteId: input.draft.noteId,
    noteContentHash: input.draft.noteContentHash,
    mode: input.draft.mode,
    exchanges,
  }))
}