import { describe, expect, it } from 'vitest'
import { parseRetentionReport } from './retentionReport'

const basePayload = {
  generatedAtUnixMs: 1_730_000_000_000,
  overall: {
    enrolledNoteCount: 3,
    trackedUnitCount: 12,
    averageRetrievability: 0.72,
    averageStabilityDays: 9.5,
    fragileUnitCount: 2,
    completedSessionCount: 15,
  },
  perTag: [
    {
      tag: 'revisao/prova',
      noteCount: 2,
      unitCount: 6,
      averageRetrievability: 0.55,
      fragileUnitCount: 2,
    },
    {
      tag: 'revisao/manter',
      noteCount: 1,
      unitCount: 6,
      averageRetrievability: 0.88,
      fragileUnitCount: 0,
    },
  ],
  evolution: [
    { dayStartUnixMs: 1_729_657_600_000, sessionCount: 2, averageScore: 62 },
    { dayStartUnixMs: 1_729_744_000_000, sessionCount: 1, averageScore: null },
  ],
}

describe('parseRetentionReport', () => {
  it('accepts a complete retention payload', () => {
    const report = parseRetentionReport(basePayload)
    expect(report.overall.trackedUnitCount).toBe(12)
    expect(report.perTag).toHaveLength(2)
    expect(report.perTag[0].tag).toBe('revisao/prova')
    expect(report.evolution).toHaveLength(2)
    expect(report.evolution[1].averageScore).toBeNull()
  })

  it('accepts an empty vault (no tags, no sessions, no retention)', () => {
    const report = parseRetentionReport({
      generatedAtUnixMs: 1_730_000_000_000,
      overall: {
        enrolledNoteCount: 0,
        trackedUnitCount: 0,
        averageRetrievability: null,
        averageStabilityDays: null,
        fragileUnitCount: 0,
        completedSessionCount: 0,
      },
      perTag: [],
      evolution: Array.from({ length: 30 }, (_, index) => ({
        dayStartUnixMs: 1_730_000_000_000 - index * 86_400_000,
        sessionCount: 0,
        averageScore: null,
      })),
    })
    expect(report.overall.averageRetrievability).toBeNull()
    expect(report.perTag).toEqual([])
  })

  it('rejects unknown fields', () => {
    expect(() => parseRetentionReport({ ...basePayload, extra: true })).toThrow()
  })

  it('rejects invalid retention values', () => {
    expect(() =>
      parseRetentionReport({
        ...basePayload,
        overall: { ...basePayload.overall, averageRetrievability: 1.5 },
      }),
    ).toThrow()
  })

  it('rejects an evolution point with a score outside 0-100', () => {
    expect(() =>
      parseRetentionReport({
        ...basePayload,
        evolution: [{ dayStartUnixMs: 1, sessionCount: 1, averageScore: 120 }],
      }),
    ).toThrow()
  })
})
