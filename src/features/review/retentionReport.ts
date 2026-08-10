import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { localDayStartUnixMs } from './reviewDashboard'

const unixMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const retentionOverallSchema = z.object({
  enrolledNoteCount: z.number().int().nonnegative().max(1_000_000),
  trackedUnitCount: z.number().int().nonnegative().max(10_000_000),
  averageRetrievability: z.number().min(0).max(1).nullable(),
  averageStabilityDays: z.number().nonnegative().max(100_000).nullable(),
  fragileUnitCount: z.number().int().nonnegative().max(10_000_000),
  completedSessionCount: z.number().int().nonnegative().max(10_000_000),
}).strict()

export const tagRetentionItemSchema = z.object({
  tag: z.string().min(1).max(512),
  noteCount: z.number().int().nonnegative().max(1_000_000),
  unitCount: z.number().int().nonnegative().max(10_000_000),
  averageRetrievability: z.number().min(0).max(1).nullable(),
  fragileUnitCount: z.number().int().nonnegative().max(10_000_000),
}).strict()

export const performancePointSchema = z.object({
  dayStartUnixMs: unixMillisecondsSchema,
  sessionCount: z.number().int().nonnegative().max(10_000_000),
  averageScore: z.number().min(0).max(100).nullable(),
}).strict()

export const retentionReportSchema = z.object({
  generatedAtUnixMs: unixMillisecondsSchema,
  overall: retentionOverallSchema,
  perTag: z.array(tagRetentionItemSchema).max(10_000),
  evolution: z.array(performancePointSchema).max(400),
}).strict()

export type RetentionReport = z.infer<typeof retentionReportSchema>
export type RetentionOverall = z.infer<typeof retentionOverallSchema>
export type TagRetentionItem = z.infer<typeof tagRetentionItemSchema>
export type PerformancePoint = z.infer<typeof performancePointSchema>

export function parseRetentionReport(payload: unknown): RetentionReport {
  return retentionReportSchema.parse(payload)
}

export async function getRetentionReport(vaultPath: string): Promise<RetentionReport> {
  return parseRetentionReport(await invoke<unknown>('get_retention_report', {
    path: vaultPath,
    localDayStartUnixMs: localDayStartUnixMs(),
  }))
}
