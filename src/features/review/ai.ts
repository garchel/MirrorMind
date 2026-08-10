import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

export type ReviewAiProvider = 'gemini' | 'ollama'

const aiConfigurationSchema = z.object({
  geminiConfigured: z.boolean(),
  geminiModel: z.string().min(1),
  ollamaEndpoint: z.literal('http://127.0.0.1:11434/v1'),
  ollamaModel: z.literal('qwen2.5:7b'),
}).strict()

const groundedSourceSchema = z.object({
  sourceQuote: z.string().min(1),
  sourceStartUtf16: z.number().int().nonnegative(),
  sourceEndUtf16: z.number().int().positive(),
}).strict().superRefine((source, context) => {
  if (source.sourceEndUtf16 <= source.sourceStartUtf16) {
    context.addIssue({ code: 'custom', message: 'Grounded source ranges must be non-empty.' })
  }
})

const groundedIssueSchema = z.object({
  code: z.enum(['ambiguous', 'insufficient', 'contradictory', 'missingContext']),
  message: z.string().min(1),
  suggestion: z.string().min(1),
  sourceQuote: z.string().nullable(),
  sourceStartUtf16: z.number().int().nonnegative().nullable(),
  sourceEndUtf16: z.number().int().positive().nullable(),
}).strict().superRefine((issue, context) => {
  const hasQuote = issue.sourceQuote !== null
  if (hasQuote !== (issue.sourceStartUtf16 !== null && issue.sourceEndUtf16 !== null)) {
    context.addIssue({ code: 'custom', message: 'Grounded issue ranges must accompany a source quote.' })
  }
  if (issue.sourceStartUtf16 !== null && issue.sourceEndUtf16 !== null
    && issue.sourceEndUtf16 <= issue.sourceStartUtf16) {
    context.addIssue({ code: 'custom', message: 'Grounded issue ranges must be non-empty.' })
  }
})

const readinessReportSchema = z.object({
  status: z.enum(['ready', 'ambiguous', 'insufficient']),
  explanation: z.string().min(1),
  centralIdea: groundedSourceSchema.nullable(),
  evaluablePoints: z.array(groundedSourceSchema).max(100),
  issues: z.array(groundedIssueSchema).max(100),
}).strict()
const readinessAttemptSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('valid'),
    sourceHash: z.string().startsWith('sha256:'),
    report: readinessReportSchema,

  }).strict(),
  z.object({
    outcome: z.literal('invalid'),
    sourceHash: z.string().startsWith('sha256:'),
    message: z.string().min(1),
    rawResponse: z.string().nullable(),
    validationErrors: z.array(z.string().min(1)),
  }).strict(),
])

const noteReviewStateSchema = z.object({
  noteId: z.string().min(1),
  relativePath: z.string().min(1),
  contentHash: z.string().startsWith('sha256:'),
  readiness: z.enum(['unassessed', 'ready', 'ambiguous', 'insufficient', 'modified']),
  assessedAtUnixMs: z.number().int().nonnegative().nullable(),
  report: readinessReportSchema.nullable().optional(),
  enrolled: z.boolean(),
  preferredMode: z.enum(['exam', 'conversation']),
  schedulingStatus: z.enum(['notScheduled', 'scheduled', 'due', 'paused']),
  firstReviewAtUnixMs: z.number().int().nonnegative().nullable(),
  nextReviewAtUnixMs: z.number().int().nonnegative().nullable(),
  deadlineRetentionAtRisk: z.boolean(),
}).strict()
const ollamaStatusSchema = z.object({
  reachable: z.boolean(),
  modelInstalled: z.boolean(),
}).strict()

export type ReviewAiConfiguration = z.infer<typeof aiConfigurationSchema>
export type ReadinessAttempt = z.infer<typeof readinessAttemptSchema>
export type NoteReviewState = z.infer<typeof noteReviewStateSchema>
export type OllamaStatus = z.infer<typeof ollamaStatusSchema>

export async function getReviewAiConfiguration(): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(await invoke('get_review_ai_configuration'))
}

export async function configureGeminiApiKey(apiKey: string): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(await invoke('configure_gemini_api_key', { apiKey }))
}

export async function setGeminiDataConsent(consent: boolean): Promise<void> {
  await invoke('set_gemini_data_consent', { consent })
}
export async function removeGeminiApiKey(): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(await invoke('remove_gemini_api_key'))
}

export async function checkOllamaReviewStatus(): Promise<OllamaStatus> {
  return ollamaStatusSchema.parse(await invoke('check_ollama_review_status'))
}

export async function assessNoteReadiness(input: {
  vaultPath: string
  relativePath: string
  provider: ReviewAiProvider
  expectedSourceHash?: string
}): Promise<ReadinessAttempt> {
  const payload = await invoke('assess_note_readiness', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    provider: input.provider,
    expectedSourceHash: input.expectedSourceHash ?? null,
  })
  return readinessAttemptSchema.parse(payload)
}

export async function getNoteReviewState(input: {
  vaultPath: string
  relativePath: string
}): Promise<NoteReviewState | null> {
  const payload = await invoke('get_note_review_state', {
    path: input.vaultPath,
    relativePath: input.relativePath,
  })
  return payload === null ? null : noteReviewStateSchema.parse(payload)
}

export async function setNoteReviewEnrollment(input: {
  vaultPath: string
  relativePath: string
  enabled: boolean
}): Promise<NoteReviewState> {
  return noteReviewStateSchema.parse(await invoke('set_note_review_enrollment', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    enabled: input.enabled,
  }))
}
export async function resetNoteLearning(input: {
  vaultPath: string
  relativePath: string
}): Promise<NoteReviewState> {
  return noteReviewStateSchema.parse(await invoke('reset_note_learning', {
    path: input.vaultPath,
    relativePath: input.relativePath,
  }))
}
export function reviewAiErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Nao foi possivel concluir a operacao de IA.'
}
