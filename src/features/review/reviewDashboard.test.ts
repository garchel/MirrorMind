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
  }],
  trackedUnitCount: 40,
  averageRetrievability: 0.72,
  averageStabilityDays: 21.5,
  completedSessionCount: 15,
  loadForecast: [
    { dayOffset: 0, dueCount: 3 },
    { dayOffset: 1, dueCount: 1 },
    ...emptyForecast.slice(2),
  ],
  awaitingFirstReviewCount: 4,
  fragileUnitCount: 2,
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
      trackedUnitCount: 0,
      averageRetrievability: null,
      averageStabilityDays: null,
      completedSessionCount: 0,
      loadForecast: emptyForecast,
      awaitingFirstReviewCount: 0,
      fragileUnitCount: 0,
    }
    expect(parseVaultReviewDashboard(empty).averageRetrievability).toBeNull()
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

  it('caps the number of upcoming deadlines at 20', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      noteId: `note-${index}`,
      relativePath: `Nota-${index}.md`,
      title: `Nota ${index}`,
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
