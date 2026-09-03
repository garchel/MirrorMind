import { invoke } from '../../lib/tauri'
import { z } from 'zod'

export type ReviewAiProvider = 'gemini' | 'ollama' | 'openAiCompatible' | 'managed'

const aiConfigurationSchema = z.object({
  geminiConfigured: z.boolean(),
  geminiModel: z.string().min(1),
  ollamaEndpoint: z.literal('http://127.0.0.1:11434/v1'),
  ollamaModel: z.literal('qwen2.5:7b'),
  openAiCompatibleConfigured: z.boolean(),
  openAiCompatibleBaseUrl: z.string().nullable(),
  openAiCompatibleModel: z.string().nullable(),
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
  recoveredFromBackup: z.boolean(),
}).strict()

const unrecoverableLearningDocumentSchema = z.object({
  storageKey: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024).nullable(),
}).strict()
const ollamaStatusSchema = z.object({
  reachable: z.boolean(),
  modelInstalled: z.boolean(),
}).strict()

const usageStatusSchema = z.object({
  day: z.number().int().nonnegative(),
  providerCalls: z.array(z.object({
    provider: z.string().min(1),
    calls: z.number().int().nonnegative(),
  }).strict()),
  totalCalls: z.number().int().nonnegative(),
  maxCallsPerDay: z.number().int().positive(),
  callsInMinute: z.number().int().nonnegative(),
  maxCallsPerMinute: z.number().int().positive(),
  exceeded: z.boolean(),
  estimatedCostUsd: z.number().nonnegative(),
  estimatedCostUsdMonth: z.number().nonnegative(),
  maxCostPerMonthUsd: z.number().nonnegative(),
  monthlyExceeded: z.boolean(),
  visionCalls: z.number().int().nonnegative(),
}).strict()

export type ReviewAiConfiguration = z.infer<typeof aiConfigurationSchema>
export type ReadinessAttempt = z.infer<typeof readinessAttemptSchema>
export type NoteReviewState = z.infer<typeof noteReviewStateSchema>
export type OllamaStatus = z.infer<typeof ollamaStatusSchema>
export type UsageStatus = z.infer<typeof usageStatusSchema>
export type UnrecoverableLearningDocument = z.infer<typeof unrecoverableLearningDocumentSchema>

export async function getReviewAiConfiguration(): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(await invoke('get_review_ai_configuration'))
}

export async function configureGeminiApiKey(apiKey: string): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(await invoke('configure_gemini_api_key', { apiKey }))
}

export async function setGeminiDataConsent(consent: boolean): Promise<void> {
  await invoke('set_gemini_data_consent', { consent })
}

/** Pede a confirmacao nativa do SO (fora do renderer) para autorizar o envio
 * ao Gemini. Retorna true somente quando o usuario confirma no dialogo do
 * sistema operacional — uma interface comprometida nao consegue falsifica-lo. */
export async function confirmGeminiDataConsent(): Promise<boolean> {
  return await invoke<boolean>('confirm_gemini_data_consent')
}

export async function setOpenAiCompatibleDataConsent(consent: boolean): Promise<void> {
  await invoke('set_openai_compatible_data_consent', { consent })
}

export async function confirmOpenAiCompatibleDataConsent(): Promise<boolean> {
  return await invoke<boolean>('confirm_openai_compatible_data_consent')
}
export async function removeGeminiApiKey(): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(await invoke('remove_gemini_api_key'))
}

/** Configura o servidor OpenAI-compatible (endereco, modelo e chave). A chave
 * fica no cofre nativo do sistema e nunca no Vault. */
export async function configureOpenAiCompatibleProvider(input: {
  baseUrl: string
  model: string
  apiKey: string
}): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(
    await invoke('configure_openai_compatible_provider', {
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
    }),
  )
}

export async function removeOpenAiCompatibleProvider(): Promise<ReviewAiConfiguration> {
  return aiConfigurationSchema.parse(await invoke('remove_openai_compatible_provider'))
}

export async function checkOllamaReviewStatus(): Promise<OllamaStatus> {
  return ollamaStatusSchema.parse(await invoke('check_ollama_review_status'))
}

/** Estado de consumo de IA do Vault: chamadas por provedor no dia, custo
 * estimado (dia e mes) e limites vigentes. */
export async function getReviewUsageStatus(vaultPath: string): Promise<UsageStatus> {
  return usageStatusSchema.parse(await invoke('review_usage_status', { path: vaultPath }))
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

const synthesisDimensionSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string().min(1),
  quote: z.string().min(1),
  sourceQuote: z.string().nullable(),
}).strict()

const synthesisAttemptSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('valid'),
    sourceHash: z.string().startsWith('sha256:'),
    report: z.object({
      overallScore: z.number().int().min(0).max(100),
      dimensions: z.object({
        core: synthesisDimensionSchema,
        connections: synthesisDimensionSchema,
        application: synthesisDimensionSchema,
        gaps: synthesisDimensionSchema,
      }).strict(),
      observations: z.array(z.object({ text: z.string().min(1) }).strict()).max(5),
    }).strict(),
  }).strict(),
  z.object({
    outcome: z.literal('invalid'),
    sourceHash: z.string().startsWith('sha256:'),
    message: z.string().min(1),
    rawResponse: z.string().nullable(),
    validationErrors: z.array(z.string().min(1)),
  }).strict(),
])

export type SynthesisAttempt = z.infer<typeof synthesisAttemptSchema>
export type SynthesisDimension = z.infer<typeof synthesisDimensionSchema>

const factFindingSchema = z.object({
  claim: z.string().min(1),
  status: z.enum(['confirmed', 'divergent', 'uncertain']),
  reason: z.string().min(1),
  source: z.string().nullable(),
  quote: z.string().min(1),
}).strict()

const factCheckAttemptSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('valid'),
    sourceHash: z.string().startsWith('sha256:'),
    report: z.object({
      overallSummary: z.string().min(1),
      findings: z.array(factFindingSchema).min(1).max(50),
    }).strict(),
  }).strict(),
  z.object({
    outcome: z.literal('invalid'),
    sourceHash: z.string().startsWith('sha256:'),
    message: z.string().min(1),
    rawResponse: z.string().nullable(),
    validationErrors: z.array(z.string().min(1)),
  }).strict(),
])

export type FactCheckAttempt = z.infer<typeof factCheckAttemptSchema>

/** Verifica os fatos de uma nota contra o conhecimento do modelo, em operacao
 * separada da avaliacao de memoria: nao altera a nota nem as pontuacoes. */
export async function verifyNoteFacts(input: {
  vaultPath: string
  relativePath: string
  provider: ReviewAiProvider
}): Promise<FactCheckAttempt> {
  const payload = await invoke('verify_note_facts', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    provider: input.provider,
  })
  return factCheckAttemptSchema.parse(payload)
}

export const sessionSourceSchema = z.object({
  rawTarget: z.string().min(1),
  kind: z.enum(['image', 'document', 'markdown', 'unknown']),
  relativePath: z.string().nullable(),
  sizeBytes: z.number().nonnegative().nullable(),
  reason: z.string().nullable(),
  extractedText: z.string().nullable().optional(),
}).strict()

export type SessionSource = z.infer<typeof sessionSourceSchema>

/** Lista as fontes consideradas de uma sessao: anexos `![[...]]` referenciados
 * pela nota e resolvidos com seguranca contra o inventario do Vault. */
export async function getNoteSessionSources(input: {
  vaultPath: string
  relativePath: string
}): Promise<SessionSource[]> {
  const payload = await invoke('note_session_sources', {
    path: input.vaultPath,
    relativePath: input.relativePath,
  })
  return z.array(sessionSourceSchema).parse(payload)
}

/** Avalia o modelo mental integrado (sintese) que o usuario escreveu sobre a
 * nota, em quatro dimensoes: cerne, conexoes, aplicacao e lacunas. Avaliacao
 * formativa — nao altera DSR/FSRS nem proximas datas. */
export async function assessNoteSynthesis(input: {
  vaultPath: string
  relativePath: string
  synthesis: string
  provider: ReviewAiProvider
}): Promise<SynthesisAttempt> {
  const payload = await invoke('assess_note_synthesis', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    synthesis: input.synthesis,
    provider: input.provider,
  })
  return synthesisAttemptSchema.parse(payload)
}

const structuralAuditEditOpSchema = z.object({
  startUtf16: z.number().int().nonnegative(),
  insert: z.string().min(1),
}).strict()

const structuralAuditEditSchema = z.object({
  kind: z.enum(['insertHeadingBefore', 'removeLines', 'splitSection']),
  startUtf16: z.number().int().nonnegative(),
  endUtf16: z.number().int().positive().nullable(),
  insert: z.string().min(1).nullable(),
  // splitSection: titulos a inserir antes de cada bloco (aplicados do maior
  // offset para o menor, entao todos os offsets permanecem validos).
  ops: z.array(structuralAuditEditOpSchema).max(50).nullable(),
}).strict().superRefine((edit, context) => {
  if (edit.kind === 'splitSection') {
    if (!edit.ops || edit.ops.length === 0) {
      context.addIssue({ code: 'custom', message: 'Split edits require ops.' })
    }
    return
  }
  if (edit.endUtf16 !== null && edit.endUtf16 <= edit.startUtf16) {
    context.addIssue({ code: 'custom', message: 'Edit ranges must be non-empty.' })
  }
})

export type StructuralAuditEdit = z.infer<typeof structuralAuditEditSchema>

export const structuralAuditSchema = z.object({
  noteWords: z.number().int().nonnegative(),
  unitCount: z.number().int().positive().max(2_000),
  findings: z.array(z.object({
    code: z.enum(['noHeadings', 'longSection', 'orphanPreamble', 'emptyHeading']),
    severity: z.enum(['warning', 'info']),
    message: z.string().min(1),
    suggestion: z.string().min(1),
    sourceQuote: z.string().nullable(),
    sourceStartUtf16: z.number().int().nonnegative().nullable(),
    sourceEndUtf16: z.number().int().positive().nullable(),
    edit: structuralAuditEditSchema.nullable(),
  }).strict()).max(200),
}).strict()

export type StructuralAudit = z.infer<typeof structuralAuditSchema>

/** Auditoria estrutural deterministica (sem IA) de uma nota. Leitura pura. */
export async function auditNoteStructure(input: {
  vaultPath: string
  relativePath: string
}): Promise<StructuralAudit> {
  return structuralAuditSchema.parse(await invoke('audit_note_structure', {
    path: input.vaultPath,
    relativePath: input.relativePath,
  }))
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

/** Corrige manualmente a classificacao de uma unidade da nota (score 0-100). */
export async function setNoteUnitClassification(input: {
  vaultPath: string
  relativePath: string
  unitId: string
  score: number
}): Promise<NoteReviewState> {
  return noteReviewStateSchema.parse(await invoke('set_note_unit_classification', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    unitId: input.unitId,
    score: input.score,
  }))
}

/** Documentos de aprendizado que nao podem ser carregados (principal corrompido/ausente e nenhum backup valido). */
export async function getUnrecoverableLearningDocuments(vaultPath: string): Promise<UnrecoverableLearningDocument[]> {
  return z.array(unrecoverableLearningDocumentSchema).parse(await invoke('get_unrecoverable_learning_documents', {
    path: vaultPath,
  }))
}

/** Copia o arquivo irrecuperavel (principal + backups) para o destino escolhido; devolve quantos arquivos foram copiados. */
export async function exportUnrecoverableLearningDocument(input: {
  vaultPath: string
  storageKey: string
  destinationPath: string
}): Promise<number> {
  return z.number().int().nonnegative().parse(await invoke('export_unrecoverable_learning_document', {
    path: input.vaultPath,
    storageKey: input.storageKey,
    destinationPath: input.destinationPath,
  }))
}

/** Isola em quarentena o documento irrecuperavel (principal + backups) para a nota recomecar; devolve quantos arquivos foram isolados. */
export async function discardUnrecoverableLearningDocument(input: {
  vaultPath: string
  storageKey: string
}): Promise<number> {
  return z.number().int().nonnegative().parse(await invoke('discard_unrecoverable_learning_document', {
    path: input.vaultPath,
    storageKey: input.storageKey,
  }))
}
/** Adiciona ao final da nota um conhecimento extra sugerido pela IA apos a
 * confirmacao explicita do usuario na interface. O backend grava com a mesma
 * seguranca de `save_note` (caminho autorizado, historico e indice atualizados). */
export async function appendKnowledgeSuggestionToNote(input: {
  vaultPath: string
  relativePath: string
  text: string
}): Promise<void> {
  await invoke('append_knowledge_suggestion_to_note', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    text: input.text,
  })
}

export function reviewAiErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Nao foi possivel concluir a operacao de IA.'
}

/** Resultado de UM provedor na comparabilidade real (mesma nota/perguntas/respostas). */
export const comparabilityOutcomeSchema = z.object({
  provider: z.string().min(1),
  failure: z.string().nullable(),
  gapBasedScore: z.number().int().min(0).max(100).nullable(),
  assertionScores: z.array(z.number().int().min(0).max(100)),
  overallScore: z.number().int().min(0).max(100).nullable(),
  summaryPresent: z.boolean(),
  gapCount: z.number().int().nonnegative(),
  gapQuotes: z.array(z.string().min(1)),
  inconclusiveCount: z.number().int().nonnegative(),
}).strict()

export const divergenceReportSchema = z.object({
  noteWords: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  providers: z.tuple([z.string().min(1), z.string().min(1)]),
  ollama: comparabilityOutcomeSchema,
  gemini: comparabilityOutcomeSchema,
  scoreDelta: z.number().int().nullable(),
  sharedGapQuotes: z.array(z.string().min(1)),
  ollamaOnlyGapQuotes: z.array(z.string().min(1)),
  geminiOnlyGapQuotes: z.array(z.string().min(1)),
}).strict()

export type DivergenceReport = z.infer<typeof divergenceReportSchema>

/** Comparabilidade REAL entre provedores: avalia a MESMA nota fixa com as
 * MESMAS perguntas e respostas em cada provedor disponivel (Ollama local +
 * Gemini ou OpenAI-compatible) e devolve o relatorio de divergencia. Nenhum
 * lado falho derruba a operacao. */
export async function runProviderComparability(): Promise<DivergenceReport> {
  const payload = await invoke('run_provider_comparability')
  return divergenceReportSchema.parse(payload)
}
