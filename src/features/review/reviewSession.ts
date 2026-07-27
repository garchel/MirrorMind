import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import type { ReviewAiProvider } from './ai'

export type ReviewMode = 'exam' | 'conversation'

const boundedText = z.string().trim().min(1).max(8_192)
const safeTimestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hashSchema = z.string().startsWith('sha256:').max(256)

const reviewPromptSchema = z.object({
  id: z.string().min(1).max(256),
  text: boundedText,
  assistance: boundedText,
}).strict()

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
  const validExam = draft.mode === 'exam'
    && draft.prompts.length >= 3
    && draft.prompts.length <= 5
    && draft.minimumAnswers === 3
    && draft.maximumAnswers === 5
  const validConversation = draft.mode === 'conversation'
    && draft.prompts.length === 1
    && draft.minimumAnswers === 4
    && draft.maximumAnswers === 6
  if (!validExam && !validConversation) {
    context.addIssue({ code: 'custom', message: 'Review draft limits do not match its mode.' })
  }
})

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

const reviewCompletionReportSchema = z.object({
  sessionId: z.string().min(1).max(256),
  overallScore: z.number().int().min(0).max(100),
  outcome: z.enum(['forgotten', 'partial', 'good', 'complete']),
  summary: boundedText,
  gaps: z.array(reviewGapSchema).max(200),
  completedAtUnixMs: safeTimestamp,
  nextReviewAtUnixMs: safeTimestamp,
}).strict().superRefine((report, context) => {
  const outcomeMatches = (report.overallScore <= 39 && report.outcome === 'forgotten')
    || (report.overallScore >= 40 && report.overallScore <= 69 && report.outcome === 'partial')
    || (report.overallScore >= 70 && report.overallScore <= 89 && report.outcome === 'good')
    || (report.overallScore >= 90 && report.outcome === 'complete')
  if (!outcomeMatches) {
    context.addIssue({ code: 'custom', message: 'The score and outcome band must match.' })
  }
  if (report.nextReviewAtUnixMs <= report.completedAtUnixMs) {
    context.addIssue({ code: 'custom', message: 'The next review must be after completion.' })
  }
  if ((report.overallScore === 100) !== (report.gaps.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Only a perfect result can omit grounded gaps.' })
  }
})

const reviewCompletionAttemptSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('valid'),
    report: reviewCompletionReportSchema,
  }).strict(),
  invalidAttemptSchema,
])

const reviewExchangeSchema = z.object({
  promptId: z.string().min(1).max(256),
  prompt: boundedText,
  answer: z.string().trim().min(1).max(32_768),
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

export async function startReviewSession(input: {
  vaultPath: string
  relativePath: string
  provider: ReviewAiProvider
  mode: ReviewMode
}): Promise<ReviewGenerationAttempt> {
  return parseReviewGenerationAttempt(await invoke('start_note_review_session', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    provider: input.provider,
    mode: input.mode,
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