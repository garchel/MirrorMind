import { invoke } from '../../lib/tauri'
import { z } from 'zod'

export const workloadEstimateSchema = z.object({
  reviewsFirst30Days: z.number().int().nonnegative(),
  reviewsFirstYear: z.number().int().nonnegative(),
  steadyIntervalDays: z.number().int().positive(),
}).strict()

export type WorkloadEstimate = z.infer<typeof workloadEstimateSchema>

export type WorkloadEstimateInput = {
  firstReviewIntervalDays: number
  targetRetention: number
  minIntervalDays: number
  maxIntervalDays: number
}

/** Estimativa de carga de uma política: simulação determinística no backend. */
export async function estimateReviewWorkload(
  input: WorkloadEstimateInput,
): Promise<WorkloadEstimate> {
  return workloadEstimateSchema.parse(await invoke('estimate_review_workload', { input }))
}
