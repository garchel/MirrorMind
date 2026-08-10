import { describe, expect, it } from 'vitest'
import {
  parseReviewNotificationCheck,
  parseReviewNotificationSettings,
  reviewNotificationCheckSchema,
  reviewNotificationSettingsSchema,
} from './reviewNotifications'

describe('review notification schemas', () => {
  it('accepts a complete settings payload', () => {
    const parsed = parseReviewNotificationSettings({
      enabled: true,
      hour: 9,
      minute: 30,
      muted: false,
    })
    expect(parsed).toEqual({ enabled: true, hour: 9, minute: 30, muted: false })
  })

  it('rejects an invalid hour and a missing muted field', () => {
    expect(reviewNotificationSettingsSchema.safeParse({ enabled: true, hour: 24, minute: 0, muted: false }).success).toBe(false)
    expect(reviewNotificationSettingsSchema.safeParse({ enabled: true, hour: 9, minute: 0 }).success).toBe(false)
    expect(reviewNotificationSettingsSchema.safeParse({ enabled: true, hour: -1, minute: 0, muted: false }).success).toBe(false)
    expect(reviewNotificationSettingsSchema.safeParse({ enabled: true, hour: 9, minute: 61, muted: false }).success).toBe(false)
  })

  it('accepts a complete check payload', () => {
    const parsed = parseReviewNotificationCheck({
      sent: false,
      dueCount: 3,
      skippedReason: 'Ainda nao e a hora configurada.',
    })
    expect(parsed).toEqual({ sent: false, dueCount: 3, skippedReason: 'Ainda nao e a hora configurada.' })
  })

  it('accepts a check payload with no skipped reason', () => {
    expect(reviewNotificationCheckSchema.safeParse({ sent: true, dueCount: 1, skippedReason: null }).success).toBe(true)
  })

  it('rejects a check payload with a negative count', () => {
    expect(reviewNotificationCheckSchema.safeParse({ sent: false, dueCount: -1, skippedReason: null }).success).toBe(false)
  })
})
