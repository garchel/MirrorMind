import { describe, expect, it } from 'vitest'
import { parseVaultReviewDashboard, vaultReviewDashboardSchema } from './reviewDashboard'

const emptyForecast = Array.from({ length: 7 }, (_, dayOffset) => ({ dayOffset, dueCount: 0 }))

const validDashboard = {
  enrolledNoteCount: 12,
  dueNoteCount: 3,
  dueWithinWeekCount: 6,
  activeDeadlineNoteCount: 2,
  upcomingDeadlines: [{
    noteId: 'note-1',
    relativePath: 'Provas/Calculo.md',
    title: 'Calculo',
    deadlineAtUnixMs: 1_750_000_000_000,
    priorityWeight: 4,
    retentionAtRisk: false,
    sourceTag: 'prova-bio',
    due: false,
  }],
  expiredDeadlineNoteCount: 1,
  expiredDeadlines: [{
    noteId: 'note-2',
    relativePath: 'Provas/Passada.md',
    title: 'Passada',
    deadlineAtUnixMs: 1_700_000_000_000,
    sourceTag: 'prova-bio',
  }],
  trackedUnitCount: 40,
  averageRetrievability: 0.72,
  averageStabilityDays: 21.5,
  completedSessionCount: 15,
  completedTodayCount: 4,
  loadForecast: [
    { dayOffset: 0, dueCount: 3 },
    { dayOffset: 1, dueCount: 1 },
    ...emptyForecast.slice(2),
  ],
  awaitingFirstReviewCount: 4,
  fragileUnitCount: 2,
  calibrationNoteCount: 1,
  calibrationNotes: [{
    noteId: 'note-9',
    relativePath: 'Longa.md',
    title: 'Longa',
    observedUnitCount: 3,
    totalUnitCount: 8,
    unitKind: 'paragraph',
  }],
  readinessUnassessedNoteCount: 2,
  readinessReadyNoteCount: 8,
  readinessAmbiguousNoteCount: 1,
  readinessInsufficientNoteCount: 1,
  readinessModifiedNoteCount: 1,
  readinessAttentionNoteCount: 2,
  readinessAttentionNotes: [{
    noteId: 'note-3',
    relativePath: 'Esboco.md',
    title: 'Esboco',
    status: 'insufficient',
    assessedAtUnixMs: 1_730_000_000_000,
    explanation: 'Apenas titulo e esboco.',
    issueCount: 1,
  }, {
    noteId: 'note-4',
    relativePath: 'Editada.md',
    title: 'Editada',
    status: 'modified',
    assessedAtUnixMs: 1_720_000_000_000,
    explanation: '',
    issueCount: 0,
  }],
}

describe('vault review dashboard schema', () => {
  it('accepts a complete dashboard payload', () => {
    expect(parseVaultReviewDashboard(validDashboard)).toEqual(validDashboard)
  })

  it('allows an empty vault with nullable memory averages', () => {
    const empty = {
      enrolledNoteCount: 0,
      dueNoteCount: 0,
      dueWithinWeekCount: 0,
      activeDeadlineNoteCount: 0,
      upcomingDeadlines: [],
      expiredDeadlineNoteCount: 0,
      expiredDeadlines: [],
      trackedUnitCount: 0,
      averageRetrievability: null,
      averageStabilityDays: null,
      completedSessionCount: 0,
      completedTodayCount: 0,
      loadForecast: emptyForecast,
      awaitingFirstReviewCount: 0,
      fragileUnitCount: 0,
      calibrationNoteCount: 0,
      calibrationNotes: [],
      readinessUnassessedNoteCount: 0,
      readinessReadyNoteCount: 0,
      readinessAmbiguousNoteCount: 0,
      readinessInsufficientNoteCount: 0,
      readinessModifiedNoteCount: 0,
      readinessAttentionNoteCount: 0,
      readinessAttentionNotes: [],
    }
    expect(parseVaultReviewDashboard(empty).averageRetrievability).toBeNull()
  })

  it('rejects a completed-today count above the vault scale', () => {
    expect(() => parseVaultReviewDashboard({ ...validDashboard, completedTodayCount: 6_000_000 })).toThrow()
  })

  it('rejects an out-of-range retrievability average', () => {
    const invalid = { ...validDashboard, averageRetrievability: 1.5 }
    expect(() => parseVaultReviewDashboard(invalid)).toThrow()
  })

  it('rejects an empty source quote inside an upcoming deadline', () => {
    const invalid = {
      ...validDashboard,
      upcomingDeadlines: [{
        ...validDashboard.upcomingDeadlines[0],
        relativePath: '',
      }],
    }
    expect(() => parseVaultReviewDashboard(invalid)).toThrow()
  })

  it('caps the number of expired deadlines at 20', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      noteId: `note-e-${index}`,
      relativePath: `Antiga-${index}.md`,
      title: `Antiga ${index}`,
      deadlineAtUnixMs: 1_700_000_000_000 + index,
      sourceTag: `tag-${index}`,
    }))
    const result = vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      expiredDeadlineNoteCount: 25,
      expiredDeadlines: many,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an expired deadline list that exceeds its count', () => {
    const result = vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      expiredDeadlineNoteCount: 0,
      expiredDeadlines: validDashboard.expiredDeadlines,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a readiness attention list that exceeds its count', () => {
    const result = vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      readinessAttentionNoteCount: 0,
      readinessAttentionNotes: validDashboard.readinessAttentionNotes,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown readiness attention status', () => {
    const result = vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      readinessAttentionNotes: [{
        ...validDashboard.readinessAttentionNotes[0],
        status: 'unknown',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('caps the number of upcoming deadlines at 20', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      noteId: `note-${index}`,
      relativePath: `Nota-${index}.md`,
      title: `Nota ${index}`,
      retentionAtRisk: false,
      sourceTag: `tag-${index}`,
      deadlineAtUnixMs: 1_750_000_000_000 + index,
      priorityWeight: 1,
    }))
    const result = vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      upcomingDeadlines: many,
    })
    expect(result.success).toBe(false)
  })

  it('requires exactly seven forecast days in order', () => {
    expect(vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      loadForecast: emptyForecast.slice(0, 6),
    }).success).toBe(false)
    expect(vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      loadForecast: [{ dayOffset: 0, dueCount: 1 }, ...emptyForecast.slice(1, 6), { dayOffset: 9, dueCount: 1 }],
    }).success).toBe(false)
    expect(vaultReviewDashboardSchema.safeParse({
      ...validDashboard,
      loadForecast: emptyForecast.map((day, index) => ({ ...day, dueCount: index + 1 })),
    }).success).toBe(true)
  })
})
