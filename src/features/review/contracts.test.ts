import { describe, expect, it } from 'vitest'
import conformanceSource from '../../../tests/fixtures/review-learning-conformance.json?raw'
import legacyFixtureSource from '../../../tests/fixtures/review-learning-v0.json?raw'
import scenariosSource from '../../../tests/fixtures/review-learning-scenarios.json?raw'
import fixtureSource from '../../../tests/fixtures/review-learning-v1.json?raw'
import {
  LEARNING_SCHEMA_VERSION,
  MAX_LEARNING_DOCUMENT_BYTES,
  migrateLearningDocument,
  parseLearningDocument,
  parseLearningDocumentJson,
  validateSessionAgainstMarkdown,
} from './contracts'

const fixture = () => JSON.parse(fixtureSource) as Record<string, any>

interface ConformanceOperation {
  path: Array<string | number>
  value?: unknown
  delete?: boolean
}

interface ConformanceCase {
  name: string
  valid: boolean
  operations: ConformanceOperation[]
}

const conformanceCases = JSON.parse(conformanceSource) as ConformanceCase[]
const scenarios = JSON.parse(scenariosSource) as Record<string, any>

function applyOperation(root: Record<string, any>, operation: ConformanceOperation): void {
  let target: any = root
  operation.path.slice(0, -1).forEach((segment) => {
    target = target[segment]
  })
  const key = operation.path.at(-1) as string | number
  if (operation.delete) {
    delete target[key]
  } else {
    target[key] = operation.value
  }
}

describe('learning document contract', () => {
  it('accepts a complete version 1 learning document', () => {
    const value = fixture()
    const parsed = parseLearningDocument(value)

    expect(LEARNING_SCHEMA_VERSION).toBe(1)
    expect(parsed).toEqual(value)
    expect(parsed.units).toHaveLength(2)
    expect(parsed.sessions[0].unitResults).toHaveLength(2)
  })

  it('preserves and validates a complete persisted readiness report', () => {
    const value = fixture()
    value.note.readiness.report = {
      status: 'ready',
      explanation: 'A nota possui material avaliavel.',
      centralIdea: {
        sourceQuote: 'Fotossintese',
        sourceStartUtf16: 0,
        sourceEndUtf16: 12,
      },
      evaluablePoints: [],
      issues: [{
        code: 'missingContext',
        message: 'Falta contexto.',
        suggestion: 'Explique o processo.',
        sourceQuote: null,
        sourceStartUtf16: null,
        sourceEndUtf16: null,
      }],
    }

    const parsed = parseLearningDocument(value)

    expect(parsed.note.readiness.report).toEqual(value.note.readiness.report)
    value.note.readiness.report.status = 'ambiguous'
    expect(() => parseLearningDocument(value)).toThrow()
  })
  it('represents an unassessed note without scheduling it', () => {
    const value = fixture()
    value.note.readiness = {
      status: 'unassessed',
      assessedAtUnixMs: null,
      assessedContentHash: null,
      issues: [],
    }
    value.units = value.units.map((unit: Record<string, unknown>) => ({
      ...unit,
      fsrs: null,
      latestEvaluation: null,
    }))
    value.scheduling = {
      ...value.scheduling,
      status: 'notScheduled',
      firstReviewAtUnixMs: null,
      lastReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
    }
    value.sessions = []

    expect(parseLearningDocument(value).note.readiness.status).toBe('unassessed')
  })

  it('preserves the assessed hash and pauses a modified note', () => {
    const value = fixture()
    value.note.contentHash = 'sha256:edited-content'
    value.note.readiness.status = 'modified'
    value.scheduling.status = 'paused'
    value.scheduling.nextReviewAtUnixMs = null

    const parsed = parseLearningDocument(value)
    expect(parsed.note.readiness.status).toBe('modified')
    expect(parsed.note.readiness.assessedContentHash).toBe('sha256:note-content')
  })

  it('rejects a modified note that discards the stale assessment hash', () => {
    const value = fixture()
    value.note.readiness.status = 'modified'
    value.scheduling.status = 'paused'
    value.scheduling.nextReviewAtUnixMs = null

    expect(() => parseLearningDocument(value)).toThrow(/preserve a stale assessment hash/i)
  })

  it('rejects a score that contradicts its outcome band', () => {
    const value = fixture()
    value.units[0].latestEvaluation.score = 20

    expect(() => parseLearningDocument(value)).toThrow(/requires outcome forgotten/i)
  })

  it('allows an inconclusive result only without score or FSRS change', () => {
    const value = fixture()
    const stableFsrs = value.sessions[0].unitResults[0].fsrsAfter
    value.sessions[0].unitResults = [{
      unitSnapshot: value.sessions[0].unitResults[0].unitSnapshot,
      evaluation: {
        kind: 'inconclusive',
        evaluatedAtUnixMs: 1720500000000,
        reason: 'A resposta não trouxe evidência suficiente.',
      },
      fsrsBefore: stableFsrs,
      fsrsAfter: stableFsrs,
    }]
    value.sessions[0].overallScore = null
    value.units = value.units.map((unit: Record<string, any>) => ({
      ...unit,
      fsrs: null,
      latestEvaluation: null,
    }))

    expect(parseLearningDocument(value).sessions[0].overallScore).toBeNull()

    value.sessions[0].unitResults[0].fsrsAfter = null
    expect(() => parseLearningDocument(value)).toThrow(/cannot change FSRS/i)
  })

  it('rejects invalid policy-source provenance', () => {
    const value = fixture()
    value.effectivePolicy.sources.priorityWeight.sourceId = null

    expect(() => parseLearningDocument(value)).toThrow(/requires a sourceId/i)
  })

  it('rejects duplicate unit and session identities', () => {
    const duplicateUnit = fixture()
    duplicateUnit.units[1].id = duplicateUnit.units[0].id
    expect(() => parseLearningDocument(duplicateUnit)).toThrow(/unit ids must be unique/i)

    const duplicateSession = fixture()
    duplicateSession.sessions.push(duplicateSession.sessions[0])
    expect(() => parseLearningDocument(duplicateSession)).toThrow(/session ids must be unique/i)
  })

  it('preserves historical session snapshots after a unit is removed', () => {
    const value = fixture()
    value.sessions[0].unitResults[0].unitSnapshot.id = 'removed-unit'
    value.units[0].fsrs = null
    value.units[0].latestEvaluation = null

    expect(parseLearningDocument(value).sessions[0].unitResults[0].unitSnapshot.id)
      .toBe('removed-unit')
  })

  it.each(conformanceCases)('matches the shared conformance result for $name', (testCase) => {
    const value = fixture()
    testCase.operations.forEach((operation) => applyOperation(value, operation))

    let succeeded = true
    try {
      parseLearningDocument(value)
    } catch {
      succeeded = false
    }
    expect(succeeded).toBe(testCase.valid)
  })

  it('accepts evidence only when hashes and UTF-16 quotes match current Markdown', () => {
    const document = parseLearningDocument(fixture())
    const markdown = ' '.repeat(24)
      + 'energia luminosa'
      + ' '.repeat(145 - 40)
      + 'glicose e oxigênio'
    const hashes = {
      'unit-1': 'sha256:paragraph-1',
      'unit-2': 'sha256:paragraph-2',
    }

    expect(() => validateSessionAgainstMarkdown({
      document,
      sessionId: 'session-1',
      markdown,
      trustedNoteContentHash: 'sha256:note-content',
      trustedUnitContentHashes: hashes,
    })).not.toThrow()

    expect(() => validateSessionAgainstMarkdown({
      document,
      sessionId: 'session-1',
      markdown: markdown.replace('energia luminosa', 'energia química '),
      trustedNoteContentHash: 'sha256:note-content',
      trustedUnitContentHashes: hashes,
    })).toThrow(/does not match its current Markdown unit/i)
  })

  it('keeps the deterministic fixture matrix internally consistent', () => {
    expect(scenarios.shortNote.expectedUnitKind).toBe('wholeNote')
    expect(scenarios.shortNote.expectedUnitCount).toBe(1)
    expect(scenarios.segmentation.expectedUnits[0].normalizedContentHash)
      .toBe(scenarios.segmentation.expectedUnits[1].normalizedContentHash)
    expect(scenarios.segmentation.expectedUnits[0].nextContextHash)
      .toBe(scenarios.segmentation.expectedUnits[1].normalizedContentHash)

    scenarios.evaluationCases.forEach((testCase: Record<string, any>) => {
      if (testCase.expectedOutcome === 'inconclusive') {
        expect(testCase.expectedScore).toBeNull()
        return
      }
      const expectedOutcome = testCase.expectedScore < 40
        ? 'forgotten'
        : testCase.expectedScore < 70
          ? 'partial'
          : testCase.expectedScore < 90
            ? 'good'
            : 'complete'
      expect(testCase.expectedOutcome).toBe(expectedOutcome)
    })

    scenarios.policyCases.forEach((testCase: Record<string, any>) => {
      const activeTags = testCase.tags
        .filter((tag: Record<string, any>) => tag.deadlineAtUnixMs > testCase.nowUnixMs)
        .sort((left: Record<string, any>, right: Record<string, any>) =>
          left.deadlineAtUnixMs - right.deadlineAtUnixMs)
      expect(activeTags[0]?.id ?? null).toBe(testCase.expectedActiveDeadlineTagId)
    })

    scenarios.dateCases.forEach((testCase: Record<string, any>) => {
      expect(testCase.nowUnixMs >= testCase.nextReviewAtUnixMs).toBe(testCase.expectedDue)
    })
  })


  it('allows current scheduling to change when the effective policy changed after the latest session', () => {
    const document = JSON.parse(fixtureSource)
    document.effectivePolicy.priorityWeight = 3
    document.effectivePolicy.sources.priorityWeight = { kind: 'note', sourceId: document.note.id }
    document.scheduling.nextReviewAtUnixMs += 86_400_000

    expect(parseLearningDocument(document).scheduling.nextReviewAtUnixMs)
      .toBe(document.scheduling.nextReviewAtUnixMs)
  })

  it('migrates V0 once and is idempotent for V1', () => {
    const migrated = migrateLearningDocument(JSON.parse(legacyFixtureSource))
    const migratedAgain = migrateLearningDocument(migrated)

    expect(migrated.schemaVersion).toBe(1)
    expect(migrated.units[0].identity.signatureVersion).toBe(1)
    expect(migratedAgain).toEqual(migrated)
  })

  it('rejects JSON larger than the explicit parser budget', () => {
    expect(() => parseLearningDocumentJson(' '.repeat(MAX_LEARNING_DOCUMENT_BYTES + 1)))
      .toThrow(/maximum supported size/i)
  })
})
