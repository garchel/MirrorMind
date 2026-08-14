import { invoke } from '../../lib/tauri'
import { z } from 'zod'
import {
  parseVaultReviewPolicyConfig,
  tagReviewPolicyRuleSchema,
  type TagReviewPolicyRule,
  type VaultReviewPolicyConfig,
} from '../review/vaultReviewPolicy'

export const tagSummarySchema = z.object({
  tag: z.string().min(1),
  notePaths: z.array(z.string()),
}).strict()

export const tagManagementChangeSchema = z.object({
  currentTag: z.string().min(1).nullable(),
  nextTag: z.string().min(1).nullable(),
  removeFromNotes: z.boolean(),
}).strict()

export const tagManagementPreviewSchema = z.object({
  affectedNotePaths: z.array(z.string()),
  markdownNotePaths: z.array(z.string()),
}).strict()

const tagManagementResultSchema = z.object({
  config: z.unknown(),
  affectedNotePaths: z.array(z.string()),
  markdownNotePaths: z.array(z.string()),
}).strict()

export type TagSummary = z.infer<typeof tagSummarySchema>
export type TagManagementChange = z.infer<typeof tagManagementChangeSchema>
export type TagManagementPreview = z.infer<typeof tagManagementPreviewSchema>

export type TagManagementResult = {
  config: VaultReviewPolicyConfig
  affectedNotePaths: string[]
  markdownNotePaths: string[]
}

export async function getTagIndex(vaultPath: string): Promise<TagSummary[]> {
  return z.array(tagSummarySchema).parse(await invoke<unknown>('get_tag_index', {
    path: vaultPath,
  }))
}

export async function previewTagManagementChange(
  vaultPath: string,
  change: TagManagementChange,
): Promise<TagManagementPreview> {
  const validated = tagManagementChangeSchema.parse(change)
  return tagManagementPreviewSchema.parse(await invoke<unknown>(
    'preview_tag_management_change',
    { path: vaultPath, change: validated },
  ))
}

export async function applyTagManagementChange(input: {
  vaultPath: string
  expectedRevision: number
  tagRules: TagReviewPolicyRule[]
  change: TagManagementChange
  expectedAffectedNotePaths: string[]
}): Promise<TagManagementResult> {
  const tagRules = z.array(tagReviewPolicyRuleSchema).max(100).parse(input.tagRules)
  const change = tagManagementChangeSchema.parse(input.change)
  const payload = tagManagementResultSchema.parse(await invoke<unknown>(
    'apply_tag_management_change',
    {
      path: input.vaultPath,
      expectedRevision: input.expectedRevision,
      tagRules,
      change,
      expectedAffectedNotePaths: z.array(z.string()).parse(input.expectedAffectedNotePaths),
    },
  ))
  return {
    config: parseVaultReviewPolicyConfig(payload.config),
    affectedNotePaths: payload.affectedNotePaths,
    markdownNotePaths: payload.markdownNotePaths,
  }
}
