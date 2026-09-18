import { invoke } from '../../lib/tauri'
import { z } from 'zod'

const dueReviewItemSchema = z.object({
  noteId: z.string().min(1).max(256),
  relativePath: z.string().min(1).max(1_024),
  title: z.string().min(1).max(1_024),
  nextReviewAtUnixMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  priorityWeight: z.number().finite().positive().max(100),
  deadlineAtUnixMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  preferredMode: z.enum(['exam', 'conversation']),
  isFirstReview: z.boolean(),
}).strict()

export const MAX_DUE_REVIEW_ITEMS = 1_000

const dueReviewQueueSchema = z.array(dueReviewItemSchema).max(MAX_DUE_REVIEW_ITEMS)

export type DueReviewItem = z.infer<typeof dueReviewItemSchema>

export function parseDueReviewQueue(payload: unknown): DueReviewItem[] {
  return dueReviewQueueSchema.parse(payload)
}

export async function getDueReviewQueue(vaultPath: string): Promise<DueReviewItem[]> {
  return parseDueReviewQueue(await invoke('list_due_review_queue', { path: vaultPath }))
}

/** Tamanho da página da fila de vencimento (rolagem infinita). */
export const UPCOMING_PAGE_SIZE = 5

const upcomingReviewQueueSchema = z.object({
  items: z.array(dueReviewItemSchema).max(50),
  total: z.number().int().nonnegative(),
}).strict()

export type UpcomingReviewQueue = z.infer<typeof upcomingReviewQueueSchema>

export async function listUpcomingReviewQueue(
  vaultPath: string,
  limit: number,
  offset: number,
): Promise<UpcomingReviewQueue> {
  return upcomingReviewQueueSchema.parse(
    await invoke('list_upcoming_review_queue', { path: vaultPath, limit, offset }),
  )
}