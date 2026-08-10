import { describe, expect, it } from 'vitest'
import { parseNoteReviewPolicy } from './reviewPolicy'

describe('note review policy contract', () => {
  it('accepts the effective policy with provenance and scheduling context', () => {
    const payload = {
      firstReviewIntervalDays: 2,
      targetRetention: 0.8,
      priorityWeight: 1,
      minIntervalDays: 1,
      maxIntervalDays: 365,
      deadlineAtUnixMs: null,
      preferredMode: 'exam',
      modeManual: false,
      sources: {
        firstReviewIntervalDays: { kind: 'vaultDefault', sourceId: null },
        targetRetention: { kind: 'vaultDefault', sourceId: null },
        priorityWeight: { kind: 'vaultDefault', sourceId: null },
        minIntervalDays: { kind: 'vaultDefault', sourceId: null },
        maxIntervalDays: { kind: 'vaultDefault', sourceId: null },
        deadlineAtUnixMs: null,
        activeDeadline: null,
      },
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
      completedReviewCount: 0,
      enrolled: true,
      due: false,
    }

    expect(parseNoteReviewPolicy(payload)).toEqual(payload)
  })

  it('rejects unsafe policy bounds', () => {
    expect(() => parseNoteReviewPolicy({
      firstReviewIntervalDays: 0,
      targetRetention: 1.2,
      priorityWeight: 0,
      minIntervalDays: 5,
      maxIntervalDays: 2,
      preferredMode: 'exam',
      sources: {},
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      completedReviewCount: 0,
      enrolled: false,
      due: false,
    })).toThrow()
  })
})
