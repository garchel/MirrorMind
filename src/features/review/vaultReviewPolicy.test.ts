import { describe, expect, it } from 'vitest'
import { parseVaultReviewPolicyConfig } from './vaultReviewPolicy'

describe('Vault review policy contract', () => {
  it('accepts versioned defaults and the affected-note count', () => {
    const payload = {
      revision: 3,
      defaults: {
        firstReviewIntervalDays: 5,
        targetRetention: 0.9,
        priorityWeight: 2.5,
        minIntervalDays: 2,
        maxIntervalDays: 180,
      },
      tagRules: [{
        tag: 'revisao/prova',
        autoEnroll: true,
        firstReviewIntervalDays: 1,
        targetRetention: 0.9,
        priorityWeight: 3,
        minIntervalDays: 1,
        maxIntervalDays: 90,
      }],      updatedAtUnixMs: 1_720_000_000_000,
      affectedNoteCount: 4,
    }

    expect(parseVaultReviewPolicyConfig(payload)).toEqual(payload)
  })

  it('rejects contradictory interval bounds', () => {
    expect(() => parseVaultReviewPolicyConfig({
      revision: 0,
      defaults: {
        firstReviewIntervalDays: 2,
        targetRetention: 0.8,
        priorityWeight: 1,
        minIntervalDays: 30,
        maxIntervalDays: 10,
      },
      tagRules: [],
      updatedAtUnixMs: null,
      affectedNoteCount: 0,
    })).toThrow()
  })
})