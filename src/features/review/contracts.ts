import { z } from 'zod'

export const LEARNING_SCHEMA_VERSION = 1 as const
export const MAX_LEARNING_DOCUMENT_BYTES = 2 * 1024 * 1024

const LIMITS = {
  identifier: 256,
  text: 8_192,
  path: 1_024,
  units: 2_000,
  sessions: 5_000,
  gaps: 200,
  tags: 100,
  issues: 100,
  uint32: 4_294_967_295,
} as const

const unixMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const uint32Schema = z.number().int().nonnegative().max(LIMITS.uint32)
const boundedTextSchema = (maximum: number) => z.string()
  .min(1)
  .max(maximum)
  .refine((value) => value === value.trim(), 'Leading or trailing whitespace is not allowed.')
const identifierSchema = boundedTextSchema(LIMITS.identifier)
const contentHashSchema = boundedTextSchema(LIMITS.identifier)
const shortTextSchema = boundedTextSchema(LIMITS.text)

const readinessIssueSchema = z.object({
  unitId: identifierSchema.nullable(),
  code: z.enum(['ambiguous', 'insufficient', 'contradictory', 'missingContext']),
  message: shortTextSchema,
}).strict()

const groundedReadinessSourceSchema = z.object({
  sourceQuote: shortTextSchema,
  sourceStartUtf16: uint32Schema,
  sourceEndUtf16: uint32Schema,
}).strict().refine(
  ({ sourceStartUtf16, sourceEndUtf16 }) => sourceEndUtf16 > sourceStartUtf16,
  { message: 'A readiness source range must be non-empty.' },
)

const groundedReadinessIssueSchema = z.object({
  code: z.enum(['ambiguous', 'insufficient', 'contradictory', 'missingContext']),
  message: shortTextSchema,
  suggestion: shortTextSchema,
  sourceQuote: shortTextSchema.nullable(),
  sourceStartUtf16: uint32Schema.nullable(),
  sourceEndUtf16: uint32Schema.nullable(),
}).strict().superRefine((issue, context) => {
  const completeSource = issue.sourceQuote !== null
    && issue.sourceStartUtf16 !== null
    && issue.sourceEndUtf16 !== null
  const emptySource = issue.sourceQuote === null
    && issue.sourceStartUtf16 === null
    && issue.sourceEndUtf16 === null
  if (!completeSource && !emptySource) {
    context.addIssue({ code: 'custom', message: 'Readiness issue source fields must be complete.' })
  } else if (completeSource && issue.sourceEndUtf16! <= issue.sourceStartUtf16!) {
    context.addIssue({ code: 'custom', message: 'A readiness issue range must be non-empty.' })
  }
})

const readinessReportSchema = z.object({
  status: z.enum(['ready', 'ambiguous', 'insufficient']),
  explanation: shortTextSchema,
  centralIdea: groundedReadinessSourceSchema.nullable(),
  evaluablePoints: z.array(groundedReadinessSourceSchema).max(LIMITS.issues),
  issues: z.array(groundedReadinessIssueSchema).max(LIMITS.issues),
}).strict()
const assessedReadinessBase = {
  assessedAtUnixMs: unixMillisecondsSchema,
  assessedContentHash: contentHashSchema,
  issues: z.array(readinessIssueSchema).max(LIMITS.issues),
  report: readinessReportSchema.nullable().optional(),
}

const readinessAssessmentSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('unassessed'),
    assessedAtUnixMs: z.null(),
    assessedContentHash: z.null(),
    issues: z.array(readinessIssueSchema).max(0),
    report: z.null().optional(),
  }).strict(),
  z.object({ status: z.literal('ready'), ...assessedReadinessBase }).strict(),
  z.object({ status: z.literal('ambiguous'), ...assessedReadinessBase }).strict(),
  z.object({ status: z.literal('insufficient'), ...assessedReadinessBase }).strict(),
  z.object({ status: z.literal('modified'), ...assessedReadinessBase }).strict(),
]).superRefine((assessment, context) => {
  if (assessment.status !== 'unassessed'
    && assessment.status !== 'modified'
    && assessment.report
    && assessment.report.status !== assessment.status) {
    context.addIssue({ code: 'custom', path: ['report', 'status'], message: 'Report status must match readiness status.' })
  }
})

const enrollmentSchema = z.object({
  manual: z.boolean(),
  manualPaused: z.boolean().default(false),
  inheritedFromTagIds: z.array(identifierSchema).max(LIMITS.tags),
  preferredMode: z.enum(['exam', 'conversation']),
}).strict()

const learningNoteSchema = z.object({
  id: identifierSchema,
  relativePath: boundedTextSchema(LIMITS.path),
  contentHash: contentHashSchema,
  readiness: readinessAssessmentSchema,
  enrollment: enrollmentSchema,
}).strict()

const evaluationGapSchema = z.object({
  classification: z.enum(['forgotten', 'confused']),
  sourceQuote: shortTextSchema,
  sourceStartUtf16: uint32Schema,
  sourceEndUtf16: uint32Schema,
}).strict().refine(
  ({ sourceStartUtf16, sourceEndUtf16 }) => sourceEndUtf16 > sourceStartUtf16,
  { message: 'sourceEndUtf16 must be greater than sourceStartUtf16' },
)

const evaluatedUnitResultSchema = z.object({
  kind: z.literal('evaluated'),
  score: z.number().int().min(0).max(100),
  outcome: z.enum(['forgotten', 'partial', 'good', 'complete']),
  evidence: z.enum(['recognition', 'freeRecall', 'conversation']),
  evaluatedAtUnixMs: unixMillisecondsSchema,
  gaps: z.array(evaluationGapSchema).max(LIMITS.gaps),
}).strict().superRefine(({ score, outcome, gaps }, context) => {
  const expectedOutcome = score < 40
    ? 'forgotten'
    : score < 70
      ? 'partial'
      : score < 90
        ? 'good'
        : 'complete'
  if (outcome !== expectedOutcome) {
    context.addIssue({ code: 'custom', message: 'Score ' + score + ' requires outcome ' + expectedOutcome + '.' })
  }
  if (outcome === 'complete' && gaps.length > 0) {
    context.addIssue({ code: 'custom', message: 'A complete result cannot contain gaps.' })
  }
})

const inconclusiveUnitResultSchema = z.object({
  kind: z.literal('inconclusive'),
  evaluatedAtUnixMs: unixMillisecondsSchema,
  reason: shortTextSchema,
}).strict()

const unitEvaluationSchema = z.discriminatedUnion('kind', [
  evaluatedUnitResultSchema,
  inconclusiveUnitResultSchema,
])

const fsrsStateSchema = z.object({
  difficulty: z.number().finite().min(1).max(10),
  stabilityDays: z.number().finite().positive(),
  retrievability: z.number().finite().min(0).max(1),
  lastReviewedAtUnixMs: unixMillisecondsSchema,
}).strict()

const unitIdentitySchema = z.object({
  signatureVersion: z.literal(1),
  normalizedContentHash: contentHashSchema,
  previousContextHash: contentHashSchema.nullable(),
  nextContextHash: contentHashSchema.nullable(),
  approximateStartUtf16: uint32Schema,
}).strict()

const unitSnapshotFields = {
  id: identifierSchema,
  ordinal: uint32Schema,
  kind: z.enum(['wholeNote', 'section', 'paragraph']),
  contentHash: contentHashSchema,
  sectionPath: z.array(shortTextSchema).max(32),
  identity: unitIdentitySchema,
  sourceStartUtf16: uint32Schema,
  sourceEndUtf16: uint32Schema,
}

const unitSnapshotSchema = z.object(unitSnapshotFields).strict().refine(
  ({ sourceStartUtf16, sourceEndUtf16 }) => sourceEndUtf16 > sourceStartUtf16,
  { message: 'A unit source range must be non-empty.' },
)

const learningUnitSchema = z.object({
  ...unitSnapshotFields,
  fsrs: fsrsStateSchema.nullable(),
  latestEvaluation: unitEvaluationSchema.nullable(),
}).strict().refine(
  ({ sourceStartUtf16, sourceEndUtf16 }) => sourceEndUtf16 > sourceStartUtf16,
  { message: 'A unit source range must be non-empty.' },
)

const policySourceSchema = z.object({
  kind: z.enum(['vaultDefault', 'expiredDeadlineTag', 'tag', 'activeDeadlineTag', 'note']),
  sourceId: identifierSchema.nullable(),
}).strict().superRefine(({ kind, sourceId }, context) => {
  if (kind === 'vaultDefault' && sourceId !== null) {
    context.addIssue({ code: 'custom', message: 'vaultDefault cannot have a sourceId.', path: ['sourceId'] })
  }
  if (kind !== 'vaultDefault' && sourceId === null) {
    context.addIssue({ code: 'custom', message: kind + ' requires a sourceId.', path: ['sourceId'] })
  }
})

const policySourcesSchema = z.object({
  firstReviewIntervalDays: policySourceSchema,
  targetRetention: policySourceSchema,
  priorityWeight: policySourceSchema,
  minIntervalDays: policySourceSchema,
  maxIntervalDays: policySourceSchema,
  deadlineAtUnixMs: policySourceSchema.nullable(),
  activeDeadline: policySourceSchema.nullable(),
}).strict()

const reviewPolicySchema = z.object({
  firstReviewIntervalDays: z.number().int().positive().max(3_650),
  targetRetention: z.number().finite().min(0.5).max(0.99),
  priorityWeight: z.number().finite().positive().max(100),
  minIntervalDays: z.number().int().positive().max(3_650),
  maxIntervalDays: z.number().int().positive().max(36_500),
  deadlineAtUnixMs: unixMillisecondsSchema.nullable(),
  sources: policySourcesSchema,
}).strict().superRefine(({ minIntervalDays, maxIntervalDays, deadlineAtUnixMs, sources }, context) => {
  if (maxIntervalDays < minIntervalDays) {
    context.addIssue({ code: 'custom', message: 'maxIntervalDays must be >= minIntervalDays.' })
  }
  if ((deadlineAtUnixMs === null) !== (sources.deadlineAtUnixMs === null)) {
    context.addIssue({ code: 'custom', message: 'Deadline value and provenance must both be present or absent.' })
  }
  if (sources.activeDeadline !== null && sources.activeDeadline.kind !== 'activeDeadlineTag') {
    context.addIssue({ code: 'custom', message: 'activeDeadline must reference an active deadline tag.' })
  }
})

const schedulingStateSchema = z.object({
  status: z.enum(['notScheduled', 'scheduled', 'due', 'paused']),
  firstReviewAtUnixMs: unixMillisecondsSchema.nullable(),
  lastReviewAtUnixMs: unixMillisecondsSchema.nullable(),
  nextReviewAtUnixMs: unixMillisecondsSchema.nullable(),
  fsrsVersion: boundedTextSchema(LIMITS.identifier),
}).strict().superRefine((state, context) => {
  const dates = [state.firstReviewAtUnixMs, state.lastReviewAtUnixMs, state.nextReviewAtUnixMs]
  if (state.status === 'notScheduled' && dates.some((value) => value !== null)) {
    context.addIssue({ code: 'custom', message: 'notScheduled cannot contain review dates.' })
  }
  if ((state.status === 'scheduled' || state.status === 'due')
    && (state.firstReviewAtUnixMs === null || state.nextReviewAtUnixMs === null)) {
    context.addIssue({ code: 'custom', message: state.status + ' requires first and next review dates.' })
  }
  if (state.status === 'paused' && state.nextReviewAtUnixMs !== null) {
    context.addIssue({ code: 'custom', message: 'paused cannot have a next review date.' })
  }
  if (state.firstReviewAtUnixMs !== null && state.lastReviewAtUnixMs !== null
    && state.lastReviewAtUnixMs < state.firstReviewAtUnixMs) {
    context.addIssue({ code: 'custom', message: 'lastReviewAtUnixMs cannot precede firstReviewAtUnixMs.' })
  }
})

const sessionUnitResultSchema = z.object({
  unitSnapshot: unitSnapshotSchema,
  evaluation: unitEvaluationSchema,
  fsrsBefore: fsrsStateSchema.nullable(),
  fsrsAfter: fsrsStateSchema.nullable(),
}).strict().superRefine(({ evaluation, fsrsBefore, fsrsAfter }, context) => {
  if (evaluation.kind === 'inconclusive' && JSON.stringify(fsrsBefore) !== JSON.stringify(fsrsAfter)) {
    context.addIssue({ code: 'custom', message: 'Inconclusive results cannot change FSRS state.' })
  }
  if (evaluation.kind === 'evaluated' && fsrsAfter === null) {
    context.addIssue({ code: 'custom', message: 'Evaluated results must produce an FSRS state.' })
  }
})

const reviewSessionSchema = z.object({
  id: identifierSchema,
  noteContentHash: contentHashSchema,
  mode: z.enum(['exam', 'conversation']),
  provider: z.enum(['gemini', 'ollama']),
  completedAtUnixMs: unixMillisecondsSchema,
  overallScore: z.number().int().min(0).max(100).nullable(),
  unitResults: z.array(sessionUnitResultSchema).min(1).max(LIMITS.units),
  effectivePolicy: reviewPolicySchema,
  nextReviewAtUnixMs: unixMillisecondsSchema.nullable(),
}).strict().superRefine(({ completedAtUnixMs, overallScore, unitResults, nextReviewAtUnixMs }, context) => {
  const evaluatedResults = unitResults.filter(
    (result): result is typeof result & { evaluation: z.infer<typeof evaluatedUnitResultSchema> } =>
      result.evaluation.kind === 'evaluated',
  )
  if ((evaluatedResults.length > 0) !== (overallScore !== null)) {
    context.addIssue({ code: 'custom', message: 'overallScore is present exactly when at least one unit was evaluated.' })
  } else if (overallScore !== null) {
    const expected = Math.round(
      evaluatedResults.reduce((total, result) => total + result.evaluation.score, 0)
      / evaluatedResults.length,
    )
    if (overallScore !== expected) {
      context.addIssue({ code: 'custom', message: 'overallScore must equal the rounded mean of evaluated units.' })
    }
  }
  if (nextReviewAtUnixMs !== null && nextReviewAtUnixMs <= completedAtUnixMs) {
    context.addIssue({ code: 'custom', message: 'The next review must be after session completion.' })
  }
  unitResults.forEach((result, resultIndex) => {
    if (result.evaluation.kind !== 'evaluated') return
    result.evaluation.gaps.forEach((gap, gapIndex) => {
      if (gap.sourceStartUtf16 < result.unitSnapshot.sourceStartUtf16
        || gap.sourceEndUtf16 > result.unitSnapshot.sourceEndUtf16) {
        context.addIssue({
          code: 'custom',
          message: 'Evaluation gaps must stay inside their unit snapshot.',
          path: ['unitResults', resultIndex, 'evaluation', 'gaps', gapIndex],
        })
      }
    })
  })
})

export const learningDocumentSchema = z.object({
  schemaVersion: z.literal(LEARNING_SCHEMA_VERSION),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  note: learningNoteSchema,
  units: z.array(learningUnitSchema).min(1).max(LIMITS.units),
  effectivePolicy: reviewPolicySchema,
  scheduling: schedulingStateSchema,
  sessions: z.array(reviewSessionSchema).max(LIMITS.sessions),
}).strict().superRefine(({ note, units, effectivePolicy, scheduling, sessions }, context) => {
  const assessmentHash = note.readiness.assessedContentHash
  if (note.readiness.status === 'modified') {
    if (assessmentHash === note.contentHash || scheduling.status !== 'paused') {
      context.addIssue({
        code: 'custom',
        message: 'Modified notes must preserve a stale assessment hash and pause scheduling.',
        path: ['note', 'readiness'],
      })
    }
  } else if (note.readiness.status === 'unassessed') {
    if (scheduling.status !== 'notScheduled') {
      context.addIssue({ code: 'custom', message: 'Unassessed notes cannot be scheduled.', path: ['scheduling', 'status'] })
    }
  } else if (assessmentHash !== note.contentHash) {
    context.addIssue({
      code: 'custom',
      message: 'Assessed readiness must match the current note content hash.',
      path: ['note', 'readiness', 'assessedContentHash'],
    })
  }

  if ((note.readiness.status === 'ambiguous' || note.readiness.status === 'insufficient')
    && scheduling.status !== 'paused') {
    context.addIssue({ code: 'custom', message: 'Notes that are not ready must pause scheduling.', path: ['scheduling', 'status'] })
  }

  const unitIds = new Set<string>()
  const ordinals = new Set<number>()
  units.forEach((unit, unitIndex) => {
    if (unitIds.has(unit.id)) context.addIssue({ code: 'custom', message: 'Unit ids must be unique.', path: ['units', unitIndex, 'id'] })
    if (ordinals.has(unit.ordinal)) context.addIssue({ code: 'custom', message: 'Unit ordinals must be unique.', path: ['units', unitIndex, 'ordinal'] })
    unitIds.add(unit.id)
    ordinals.add(unit.ordinal)
  })

  note.readiness.issues.forEach((issue, issueIndex) => {
    if (issue.unitId !== null && !unitIds.has(issue.unitId)) {
      context.addIssue({
        code: 'custom',
        message: 'Readiness references an unknown current unit.',
        path: ['note', 'readiness', 'issues', issueIndex, 'unitId'],
      })
    }
  })

  const sessionIds = new Set<string>()
  let previousCompletedAt = 0
  sessions.forEach((session, sessionIndex) => {
    if (sessionIds.has(session.id)) context.addIssue({ code: 'custom', message: 'Session ids must be unique.', path: ['sessions', sessionIndex, 'id'] })
    sessionIds.add(session.id)
    if (session.completedAtUnixMs < previousCompletedAt) context.addIssue({ code: 'custom', message: 'Sessions must be chronological.', path: ['sessions', sessionIndex, 'completedAtUnixMs'] })
    previousCompletedAt = session.completedAtUnixMs
    const resultIds = new Set<string>()
    session.unitResults.forEach((result, resultIndex) => {
      const historicalUnitId = result.unitSnapshot.id
      if (resultIds.has(historicalUnitId)) context.addIssue({ code: 'custom', message: 'A session can contain only one result per unit.', path: ['sessions', sessionIndex, 'unitResults', resultIndex, 'unitSnapshot', 'id'] })
      resultIds.add(historicalUnitId)
    })
  })

  const latestSession = sessions.at(-1)
  if (latestSession) {
    if (scheduling.lastReviewAtUnixMs !== latestSession.completedAtUnixMs) {
      context.addIssue({ code: 'custom', message: 'Scheduling must reference the latest completed session.', path: ['scheduling', 'lastReviewAtUnixMs'] })
    }
    const expectedNextReview = scheduling.status === 'paused' ? null : latestSession.nextReviewAtUnixMs
const policyChangedAfterSession = JSON.stringify(effectivePolicy) !== JSON.stringify(latestSession.effectivePolicy)
    if (scheduling.nextReviewAtUnixMs !== expectedNextReview && !policyChangedAfterSession) {
      context.addIssue({ code: 'custom', message: 'Scheduling and the latest session must agree on the next review.', path: ['scheduling', 'nextReviewAtUnixMs'] })
    }
  } else if (scheduling.lastReviewAtUnixMs !== null) {
    context.addIssue({ code: 'custom', message: 'Scheduling cannot have a last review without a session.', path: ['scheduling', 'lastReviewAtUnixMs'] })
  }

  units.forEach((unit, unitIndex) => {
    const latestResult = sessions
      .slice()
      .reverse()
      .flatMap((session) => session.unitResults)
      .find((result) => result.unitSnapshot.id === unit.id
        && result.unitSnapshot.contentHash === unit.contentHash
        && result.evaluation.kind === 'evaluated')
    if (!latestResult) {
      if (unit.latestEvaluation !== null || unit.fsrs !== null) {
        context.addIssue({ code: 'custom', message: 'A unit without matching history cannot have a projected state.', path: ['units', unitIndex] })
      }
      return
    }
    if (JSON.stringify(unit.latestEvaluation) !== JSON.stringify(latestResult.evaluation)
      || JSON.stringify(unit.fsrs) !== JSON.stringify(latestResult.fsrsAfter)) {
      context.addIssue({ code: 'custom', message: 'The current unit projection must match its latest historical result.', path: ['units', unitIndex] })
    }
  })
})

export interface SessionMarkdownValidationInput {
  document: LearningDocument
  sessionId: string
  markdown: string
  trustedNoteContentHash: string
  trustedUnitContentHashes: Readonly<Record<string, string>>
}

export function validateSessionAgainstMarkdown({
  document,
  sessionId,
  markdown,
  trustedNoteContentHash,
  trustedUnitContentHashes,
}: SessionMarkdownValidationInput): void {
  const session = document.sessions.find(({ id }) => id === sessionId)
  if (!session) throw new Error('Review session does not exist in the learning document.')
  if (document.note.contentHash !== trustedNoteContentHash
    || session.noteContentHash !== trustedNoteContentHash) {
    throw new Error('Review session was produced for a stale note version.')
  }

  const unitsById = new Map(document.units.map((unit) => [unit.id, unit]))
  session.unitResults.forEach((result) => {
    const snapshot = result.unitSnapshot
    const unit = unitsById.get(snapshot.id)
    if (!unit || snapshot.contentHash !== unit.contentHash
      || snapshot.sourceStartUtf16 !== unit.sourceStartUtf16
      || snapshot.sourceEndUtf16 !== unit.sourceEndUtf16
      || trustedUnitContentHashes[snapshot.id] !== unit.contentHash) {
      throw new Error('Review result was produced for a stale or unknown unit.')
    }
    if (result.evaluation.kind === 'evaluated') {
      result.evaluation.gaps.forEach((gap) => {
        if (gap.sourceStartUtf16 < snapshot.sourceStartUtf16
          || gap.sourceEndUtf16 > snapshot.sourceEndUtf16
          || markdown.slice(gap.sourceStartUtf16, gap.sourceEndUtf16) !== gap.sourceQuote) {
          throw new Error('Review evidence does not match its current Markdown unit.')
        }
      })
    }
  })
}

const legacyV0Schema = z.object({
  schemaVersion: z.literal(0),
  note: z.object({
    readiness: z.object({
      status: z.enum(['ready', 'ambiguous', 'insufficient']),
      assessedAtUnixMs: unixMillisecondsSchema,
      contentHash: contentHashSchema,
      issues: z.array(readinessIssueSchema).max(LIMITS.issues),
    }).passthrough(),
  }).passthrough(),
  units: z.array(z.object({
    contentHash: contentHashSchema,
    latestEvaluation: z.object({
      outcome: z.enum(['forgotten', 'partial', 'good', 'complete', 'inconclusive']),
      evaluatedAtUnixMs: unixMillisecondsSchema,
    }).passthrough().nullable(),
  }).passthrough()).min(1).max(LIMITS.units),
  effectivePolicy: z.object({
    deadlineAtUnixMs: unixMillisecondsSchema.nullable(),
    source: policySourceSchema,
  }).passthrough(),
  sessions: z.array(z.unknown()).max(0),
}).passthrough()

export type LearningDocument = z.infer<typeof learningDocumentSchema>

export function parseLearningDocument(value: unknown): LearningDocument {
  return learningDocumentSchema.parse(value)
}

export function parseLearningDocumentJson(input: string): LearningDocument {
  if (new TextEncoder().encode(input).byteLength > MAX_LEARNING_DOCUMENT_BYTES) {
    throw new Error('Learning document exceeds the maximum supported size.')
  }
  return parseLearningDocument(JSON.parse(input))
}

export function migrateLearningDocument(value: unknown): LearningDocument {
  if (typeof value === 'object' && value !== null
    && 'schemaVersion' in value && value.schemaVersion === LEARNING_SCHEMA_VERSION) {
    return parseLearningDocument(value)
  }

  const legacy = legacyV0Schema.parse(value)
  const migrated = JSON.parse(JSON.stringify(legacy)) as Record<string, any>
  migrated.schemaVersion = LEARNING_SCHEMA_VERSION
  migrated.revision = 1

  const readiness = migrated.note.readiness
  readiness.assessedContentHash = readiness.contentHash
  delete readiness.contentHash

  migrated.units = migrated.units.map((unit: Record<string, any>) => {
    const latestEvaluation = unit.latestEvaluation === null
      ? null
      : unit.latestEvaluation.outcome === 'inconclusive'
        ? {
            kind: 'inconclusive',
            evaluatedAtUnixMs: unit.latestEvaluation.evaluatedAtUnixMs,
            reason: 'Migrated from V0 without conclusive evidence.',
          }
        : { kind: 'evaluated', ...unit.latestEvaluation }

    return {
      ...unit,
      identity: {
        signatureVersion: 1,
        normalizedContentHash: unit.contentHash,
        previousContextHash: null,
        nextContextHash: null,
        approximateStartUtf16: 0,
      },
      sourceStartUtf16: 0,
      sourceEndUtf16: 1,
      latestEvaluation,
    }
  })

  const source = migrated.effectivePolicy.source
  const deadlineSource = migrated.effectivePolicy.deadlineAtUnixMs === null ? null : source
  migrated.effectivePolicy.sources = {
    firstReviewIntervalDays: source,
    targetRetention: source,
    priorityWeight: source,
    minIntervalDays: source,
    maxIntervalDays: source,
    deadlineAtUnixMs: deadlineSource,
    activeDeadline: source.kind === 'activeDeadlineTag' ? source : null,
  }
  delete migrated.effectivePolicy.source

  return parseLearningDocument(migrated)
}
