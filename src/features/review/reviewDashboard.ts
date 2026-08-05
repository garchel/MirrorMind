import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

const unixMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const upcomingDeadlineItemSchema = z.object({
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  title: z.string().min(1).max(1_024),
  deadlineAtUnixMs: unixMillisecondsSchema,
  priorityWeight: z.number().finite().positive().max(100),
}).strict()

export const dailyLoadItemSchema = z.object({
  dayOffset: z.number().int().min(0).max(6),
  dueCount: z.number().int().nonnegative().max(100_000),
}).strict()

export const vaultReviewDashboardSchema = z.object({
  enrolledNoteCount: z.number().int().nonnegative().max(100_000),
  dueNoteCount: z.number().int().nonnegative().max(100_000),
  dueWithinWeekCount: z.number().int().nonnegative().max(100_000),
  activeDeadlineNoteCount: z.number().int().nonnegative().max(100_000),
  upcomingDeadlines: z.array(upcomingDeadlineItemSchema).max(20),
  trackedUnitCount: z.number().int().nonnegative().max(2_000_000),
  averageRetrievability: z.number().finite().min(0).max(1).nullable(),
  averageStabilityDays: z.number().finite().positive().max(1_000_000).nullable(),
  completedSessionCount: z.number().int().nonnegative().max(5_000_000),
  loadForecast: z.array(dailyLoadItemSchema).length(7),
  awaitingFirstReviewCount: z.number().int().nonnegative().max(100_000),
  fragileUnitCount: z.number().int().nonnegative().max(2_000_000),
}).strict().superRefine((dashboard, context) => {
  const offsets = dashboard.loadForecast.map((day) => day.dayOffset)
  const inOrder = offsets.every((offset, index) => offset === index)
  if (!inOrder) {
    context.addIssue({ code: 'custom', message: 'The load forecast must cover days 0 through 6 in order.' })
  }
})

export type UpcomingDeadlineItem = z.infer<typeof upcomingDeadlineItemSchema>
export type DailyLoadItem = z.infer<typeof dailyLoadItemSchema>
export type VaultReviewDashboard = z.infer<typeof vaultReviewDashboardSchema>

export function parseVaultReviewDashboard(payload: unknown): VaultReviewDashboard {
  return vaultReviewDashboardSchema.parse(payload)
}

/** Inicio do dia local em milissegundos, no fuso do usuario. */
export function localDayStartUnixMs(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

export function forecastDayLabel(dayOffset: number) {
  if (dayOffset === 0) return 'Hoje'
  if (dayOffset === 1) return 'Amanha'
  const date = new Date(localDayStartUnixMs())
  date.setDate(date.getDate() + dayOffset)
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(date)
    .replace('.', '')
}

export async function getVaultReviewDashboard(vaultPath: string): Promise<VaultReviewDashboard> {
  return parseVaultReviewDashboard(await invoke<unknown>('get_vault_review_dashboard', {
    path: vaultPath,
    localDayStartUnixMs: localDayStartUnixMs(),
  }))
}
