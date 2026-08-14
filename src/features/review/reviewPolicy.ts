import { invoke } from '../../lib/tauri'
import { z } from 'zod'

const unixMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const policySourceSchema = z.object({
  kind: z.enum(['vaultDefault', 'expiredDeadlineTag', 'tag', 'activeDeadlineTag', 'note']),
  sourceId: z.string().min(1).max(256).nullable(),
}).strict()

const noteReviewPolicyValuesShape = {
  firstReviewIntervalDays: z.number().int().min(1).max(3_650),
  targetRetention: z.number().min(0.5).max(0.99),
  priorityWeight: z.number().positive().max(100),
  minIntervalDays: z.number().int().min(1).max(3_650),
  maxIntervalDays: z.number().int().min(1).max(36_500),
  preferredMode: z.enum(['exam', 'conversation']),
} as const

function validateIntervalOrder(
  policy: { minIntervalDays: number; maxIntervalDays: number },
  context: z.RefinementCtx,
) {
  if (policy.maxIntervalDays < policy.minIntervalDays) {
    context.addIssue({
      code: 'custom',
      message: 'Maximum interval must not be shorter than minimum interval.',
      path: ['maxIntervalDays'],
    })
  }
}

export const noteReviewPolicySchema = z.object({
  ...noteReviewPolicyValuesShape,
  // O modo foi definido explicitamente na nota (senao e herdado das tags ou
  // usa o padrao Prova).
  modeManual: z.boolean().default(false),
  deadlineAtUnixMs: unixMillisecondsSchema.nullable(),
  sources: z.object({
    firstReviewIntervalDays: policySourceSchema,
    targetRetention: policySourceSchema,
    priorityWeight: policySourceSchema,
    minIntervalDays: policySourceSchema,
    maxIntervalDays: policySourceSchema,
    deadlineAtUnixMs: policySourceSchema.nullable(),
    activeDeadline: policySourceSchema.nullable(),
  }).strict(),
  firstReviewAtUnixMs: unixMillisecondsSchema.nullable(),
  nextReviewAtUnixMs: unixMillisecondsSchema.nullable(),
  completedReviewCount: z.number().int().nonnegative().max(100_000),
  enrolled: z.boolean(),
  due: z.boolean(),
}).strict().superRefine(validateIntervalOrder)

export const noteReviewPolicyFieldSchema = z.enum([
  'firstReviewIntervalDays',
  'targetRetention',
  'priorityWeight',
  'minIntervalDays',
  'maxIntervalDays',
])

export const noteReviewPolicyInputSchema = z.object({
  ...noteReviewPolicyValuesShape,
  overrideFields: z.array(noteReviewPolicyFieldSchema).max(5)
    .refine((fields) => new Set(fields).size === fields.length, 'Override fields must be unique.'),
  inheritFields: z.array(noteReviewPolicyFieldSchema).max(5)
    .refine((fields) => new Set(fields).size === fields.length, 'Inherited fields must be unique.'),
})
  .strict()
  .superRefine((policy, context) => {
    validateIntervalOrder(policy, context)
    const inherited = new Set(policy.inheritFields)
    if (policy.overrideFields.some((field) => inherited.has(field))) {
      context.addIssue({
        code: 'custom',
        message: 'A field cannot be overridden and inherited at the same time.',
        path: ['inheritFields'],
      })
    }
  })

export type NoteReviewPolicy = z.infer<typeof noteReviewPolicySchema>
export type NoteReviewPolicyInput = z.infer<typeof noteReviewPolicyInputSchema>

export function parseNoteReviewPolicy(payload: unknown): NoteReviewPolicy {
  return noteReviewPolicySchema.parse(payload)
}

export async function getNoteReviewPolicy(input: {
  vaultPath: string
  relativePath: string
}): Promise<NoteReviewPolicy | null> {
  const payload = await invoke<unknown>('get_note_review_policy', {
    path: input.vaultPath,
    relativePath: input.relativePath,
  })
  return payload === null ? null : parseNoteReviewPolicy(payload)
}

export async function setNoteReviewPolicy(input: {
  vaultPath: string
  relativePath: string
  policy: NoteReviewPolicyInput
}): Promise<NoteReviewPolicy> {
  const policy = noteReviewPolicyInputSchema.parse(input.policy)
  return parseNoteReviewPolicy(await invoke<unknown>('set_note_review_policy', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    policy,
  }))
}

/** Acao rapida: altera somente o peso de prioridade da nota (sobrescrita de
 *  nota), preservando os demais campos, historico e estado de memoria. */
export async function setNoteReviewPriority(input: {
  vaultPath: string
  relativePath: string
  priorityWeight: number
}): Promise<NoteReviewPolicy> {
  return parseNoteReviewPolicy(await invoke<unknown>('set_note_review_priority', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    priorityWeight: input.priorityWeight,
  }))
}
