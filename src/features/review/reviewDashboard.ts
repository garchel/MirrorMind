import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

const unixMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const upcomingDeadlineItemSchema = z.object({
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  title: z.string().min(1).max(1_024),
  deadlineAtUnixMs: unixMillisecondsSchema,
  priorityWeight: z.number().finite().positive().max(100),
  retentionAtRisk: z.boolean(),
  sourceTag: z.string().min(1).max(100).nullable(),
  due: z.boolean(),
}).strict()

export const expiredDeadlineItemSchema = z.object({
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  title: z.string().min(1).max(1_024),
  deadlineAtUnixMs: unixMillisecondsSchema,
  sourceTag: z.string().min(1).max(100).nullable(),
}).strict()

export const dailyLoadItemSchema = z.object({
  dayOffset: z.number().int().min(0).max(6),
  dueCount: z.number().int().nonnegative().max(100_000),
}).strict()

export const calibrationNoteItemSchema = z.object({
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  title: z.string().min(1).max(1_024),
  observedUnitCount: z.number().int().nonnegative().max(2_000),
  totalUnitCount: z.number().int().positive().max(2_000),
  // Tipo dominante das unidades da nota: ``section``, ``paragraph`` ou
  // ``mixed`` (ex.: preambulo + secoes). Alimenta o substantivo do progresso.
  unitKind: z.enum(['section', 'paragraph', 'mixed']),
}).strict().superRefine((item, context) => {
  if (item.observedUnitCount >= item.totalUnitCount) {
    context.addIssue({ code: 'custom', message: 'A calibration note must still have unobserved units.' })
  }
})

export const readinessAttentionItemSchema = z.object({
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  title: z.string().min(1).max(1_024),
  status: z.enum(['unassessed', 'ready', 'ambiguous', 'insufficient', 'modified']),
  assessedAtUnixMs: unixMillisecondsSchema.nullable(),
  explanation: z.string().max(8_192),
  issueCount: z.number().int().nonnegative().max(100),
}).strict()

export const vaultReviewDashboardSchema = z.object({
  enrolledNoteCount: z.number().int().nonnegative().max(100_000),
  dueNoteCount: z.number().int().nonnegative().max(100_000),
  dueWithinWeekCount: z.number().int().nonnegative().max(100_000),
  activeDeadlineNoteCount: z.number().int().nonnegative().max(100_000),
  upcomingDeadlines: z.array(upcomingDeadlineItemSchema).max(20),
  expiredDeadlineNoteCount: z.number().int().nonnegative().max(100_000),
  expiredDeadlines: z.array(expiredDeadlineItemSchema).max(20),
  trackedUnitCount: z.number().int().nonnegative().max(2_000_000),
  averageRetrievability: z.number().finite().min(0).max(1).nullable(),
  averageStabilityDays: z.number().finite().positive().max(1_000_000).nullable(),
  completedSessionCount: z.number().int().nonnegative().max(5_000_000),
  completedTodayCount: z.number().int().nonnegative().max(5_000_000),
  loadForecast: z.array(dailyLoadItemSchema).length(7),
  awaitingFirstReviewCount: z.number().int().nonnegative().max(100_000),
  fragileUnitCount: z.number().int().nonnegative().max(2_000_000),
  calibrationNoteCount: z.number().int().nonnegative().max(100_000),
  calibrationNotes: z.array(calibrationNoteItemSchema).max(20),
  readinessUnassessedNoteCount: z.number().int().nonnegative().max(100_000),
  readinessReadyNoteCount: z.number().int().nonnegative().max(100_000),
  readinessAmbiguousNoteCount: z.number().int().nonnegative().max(100_000),
  readinessInsufficientNoteCount: z.number().int().nonnegative().max(100_000),
  readinessModifiedNoteCount: z.number().int().nonnegative().max(100_000),
  readinessAttentionNoteCount: z.number().int().nonnegative().max(100_000),
  readinessAttentionNotes: z.array(readinessAttentionItemSchema).max(20),
}).strict().superRefine((dashboard, context) => {
  if (dashboard.calibrationNotes.length > dashboard.calibrationNoteCount) {
    context.addIssue({ code: 'custom', message: 'The calibration list cannot exceed its count.' })
  }
  if (dashboard.expiredDeadlines.length > dashboard.expiredDeadlineNoteCount) {
    context.addIssue({ code: 'custom', message: 'The expired deadline list cannot exceed its count.' })
  }
  if (dashboard.readinessAttentionNotes.length > dashboard.readinessAttentionNoteCount) {
    context.addIssue({ code: 'custom', message: 'The readiness attention list cannot exceed its count.' })
  }
  const offsets = dashboard.loadForecast.map((day) => day.dayOffset)
  const inOrder = offsets.every((offset, index) => offset === index)
  if (!inOrder) {
    context.addIssue({ code: 'custom', message: 'The load forecast must cover days 0 through 6 in order.' })
  }
})

export type UpcomingDeadlineItem = z.infer<typeof upcomingDeadlineItemSchema>
export type ExpiredDeadlineItem = z.infer<typeof expiredDeadlineItemSchema>
export type DailyLoadItem = z.infer<typeof dailyLoadItemSchema>
export type CalibrationNoteItem = z.infer<typeof calibrationNoteItemSchema>
export type ReadinessAttentionItem = z.infer<typeof readinessAttentionItemSchema>
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
