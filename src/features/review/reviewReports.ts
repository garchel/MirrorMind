import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

const unixMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const reviewReportItemSchema = z.object({
  sessionId: z.string().min(1).max(256),
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  title: z.string().min(1).max(1_024),
  mode: z.enum(['exam', 'conversation']),
  provider: z.enum(['gemini', 'ollama']),
  completedAtUnixMs: unixMillisecondsSchema,
  overallScore: z.number().int().min(0).max(100).nullable(),
  outcome: z.enum(['forgotten', 'partial', 'good', 'complete']).nullable(),
  gapCount: z.number().int().nonnegative().max(100_000),
  unitCount: z.number().int().positive().max(10_000),
  nextReviewAtUnixMs: unixMillisecondsSchema.nullable(),
}).strict().superRefine((report, context) => {
  const bandMatches = (report.overallScore === null && report.outcome === null)
    || (report.overallScore !== null && report.outcome !== null
      && ((report.overallScore <= 39 && report.outcome === 'forgotten')
        || (report.overallScore >= 40 && report.overallScore <= 69 && report.outcome === 'partial')
        || (report.overallScore >= 70 && report.overallScore <= 89 && report.outcome === 'good')
        || (report.overallScore >= 90 && report.outcome === 'complete')))
  if (!bandMatches) {
    context.addIssue({ code: 'custom', message: 'The score and outcome band must match.' })
  }
})

export const MAX_REVIEW_REPORT_ITEMS = 5_000

const reviewReportsSchema = z.array(reviewReportItemSchema).max(MAX_REVIEW_REPORT_ITEMS)

export type ReviewReportItem = z.infer<typeof reviewReportItemSchema>

export function parseReviewReports(payload: unknown): ReviewReportItem[] {
  return reviewReportsSchema.parse(payload)
}

export async function getReviewReports(vaultPath: string): Promise<ReviewReportItem[]> {
  return parseReviewReports(await invoke<unknown>('list_review_reports', { path: vaultPath }))
}
