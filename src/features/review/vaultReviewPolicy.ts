import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

function validateIntervalOrder(
  defaults: { minIntervalDays: number; maxIntervalDays: number },
  context: z.RefinementCtx,
) {
  if (defaults.maxIntervalDays < defaults.minIntervalDays) {
    context.addIssue({
      code: 'custom',
      path: ['maxIntervalDays'],
      message: 'O intervalo máximo deve ser igual ou maior que o mínimo.',
    })
  }
}

const reviewPolicyValuesSchema = z.object({
  firstReviewIntervalDays: z.number().int().min(1).max(3_650),
  targetRetention: z.number().min(0.5).max(0.99),
  priorityWeight: z.number().positive().max(100),
  minIntervalDays: z.number().int().min(1).max(3_650),
  maxIntervalDays: z.number().int().min(1).max(36_500),
}).strict()

export const vaultReviewDefaultsSchema = reviewPolicyValuesSchema.superRefine(validateIntervalOrder)

export const tagReviewPolicyRuleSchema = reviewPolicyValuesSchema.extend({
  tag: z.string().min(1).max(100).refine((value) => (
    value === value.normalize('NFC').toLowerCase()
    && /^[\p{L}\p{N}\p{M}_-]+(?:\/[\p{L}\p{N}\p{M}_-]+)*$/u.test(value)
  ), 'Use uma tag normalizada, sem #, espaços ou barras duplicadas.'),
  autoEnroll: z.boolean(),
}).strict().superRefine(validateIntervalOrder)

export const vaultReviewPolicyConfigSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  defaults: vaultReviewDefaultsSchema,
  tagRules: z.array(tagReviewPolicyRuleSchema).max(100),
  updatedAtUnixMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  affectedNoteCount: z.number().int().nonnegative().max(2_000),
}).strict()

const vaultReviewDefaultsPreviewSchema = z.object({
  affectedNoteCount: z.number().int().nonnegative().max(2_000),
}).strict()

export type VaultReviewDefaults = z.infer<typeof vaultReviewDefaultsSchema>
export type TagReviewPolicyRule = z.infer<typeof tagReviewPolicyRuleSchema>
export type VaultReviewPolicyConfig = z.infer<typeof vaultReviewPolicyConfigSchema>
export type VaultReviewDefaultsPreview = z.infer<typeof vaultReviewDefaultsPreviewSchema>

export function parseVaultReviewPolicyConfig(payload: unknown): VaultReviewPolicyConfig {
  return vaultReviewPolicyConfigSchema.parse(payload)
}

export async function getVaultReviewPolicyConfig(vaultPath: string): Promise<VaultReviewPolicyConfig> {
  return parseVaultReviewPolicyConfig(await invoke<unknown>('get_vault_review_policy_config', {
    path: vaultPath,
  }))
}

export async function previewVaultReviewDefaults(
  vaultPath: string,
  defaults: VaultReviewDefaults,
): Promise<VaultReviewDefaultsPreview> {
  const validated = vaultReviewDefaultsSchema.parse(defaults)
  return vaultReviewDefaultsPreviewSchema.parse(await invoke<unknown>(
    'preview_vault_review_policy_defaults',
    { path: vaultPath, defaults: validated },
  ))
}

export async function setVaultReviewDefaults(input: {
  vaultPath: string
  expectedRevision: number
  defaults: VaultReviewDefaults
}): Promise<VaultReviewPolicyConfig> {
  const defaults = vaultReviewDefaultsSchema.parse(input.defaults)
  return parseVaultReviewPolicyConfig(await invoke<unknown>('set_vault_review_policy_defaults', {
    path: input.vaultPath,
    expectedRevision: input.expectedRevision,
    defaults,
  }))
}
export async function previewVaultReviewTagRules(
  vaultPath: string,
  tagRules: TagReviewPolicyRule[],
): Promise<VaultReviewDefaultsPreview> {
  const validated = z.array(tagReviewPolicyRuleSchema).max(100).parse(tagRules)
  return vaultReviewDefaultsPreviewSchema.parse(await invoke<unknown>(
    'preview_vault_review_policy_tag_rules',
    { path: vaultPath, tagRules: validated },
  ))
}
export async function setVaultReviewTagRules(input: {
  vaultPath: string
  expectedRevision: number
  tagRules: TagReviewPolicyRule[]
}): Promise<VaultReviewPolicyConfig> {
  const tagRules = z.array(tagReviewPolicyRuleSchema).max(100).parse(input.tagRules)
  return parseVaultReviewPolicyConfig(await invoke<unknown>('set_vault_review_policy_tag_rules', {
    path: input.vaultPath,
    expectedRevision: input.expectedRevision,
    tagRules,
  }))
}