import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

export const reviewNotificationSettingsSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  muted: z.boolean(),
}).strict()

export type ReviewNotificationSettings = z.infer<typeof reviewNotificationSettingsSchema>

export const reviewNotificationCheckSchema = z.object({
  sent: z.boolean(),
  dueCount: z.number().int().nonnegative(),
  skippedReason: z.string().nullable(),
}).strict()

export type ReviewNotificationCheck = z.infer<typeof reviewNotificationCheckSchema>

export function parseReviewNotificationSettings(payload: unknown): ReviewNotificationSettings {
  return reviewNotificationSettingsSchema.parse(payload)
}

export function parseReviewNotificationCheck(payload: unknown): ReviewNotificationCheck {
  return reviewNotificationCheckSchema.parse(payload)
}

export function getReviewNotificationSettings(): Promise<ReviewNotificationSettings> {
  return invoke<unknown>('get_review_notification_settings').then(parseReviewNotificationSettings)
}

export function setReviewNotificationSettings(
  settings: ReviewNotificationSettings,
): Promise<ReviewNotificationSettings> {
  return invoke<unknown>('set_review_notification_settings', { settings }).then(parseReviewNotificationSettings)
}

/** Checa o resumo diario para o vault ativo e envia a notificacao se devido. */
export function checkReviewNotifications(params: {
  vaultPath: string
  nowUnixMs: number
  localDayStartUnixMs: number
}): Promise<ReviewNotificationCheck> {
  return invoke<unknown>('check_review_notifications', params).then(parseReviewNotificationCheck)
}

/** Envia uma notificacao de teste imediatamente. */
export function sendReviewTestNotification(): Promise<void> {
  return invoke<void>('send_review_test_notification')
}
