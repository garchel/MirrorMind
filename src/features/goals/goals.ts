import { invoke } from '../../lib/tauri'
import { z } from 'zod'
import type { ReviewAiProvider } from '../review/ai'

const goalStepStatusSchema = z.enum(['planned', 'in_progress', 'done'])

const goalStepSchema = z.object({
  order: z.number().int().positive().max(30),
  title: z.string().min(1).max(200),
  summary: z.string().max(1000),
  suggestedRelativePath: z.string().min(1).max(512),
  status: goalStepStatusSchema.default('planned'),
  noteRelativePath: z.string().min(1).max(512).nullable().optional(),
}).strict()

const goalSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(4000),
  sourceText: z.string().max(100000).default(''),
  createdAtUnixMs: z.number().int().nonnegative(),
  steps: z.array(goalStepSchema).min(1).max(30),
  aiGenerated: z.boolean().default(false),
}).strict()

export type GoalStepStatus = z.infer<typeof goalStepStatusSchema>
export type GoalStep = z.infer<typeof goalStepSchema>
export type Goal = z.infer<typeof goalSchema>

export type GoalProvider = Extract<ReviewAiProvider, 'gemini' | 'ollama' | 'openAiCompatible'>

export async function listGoals(vaultPath: string): Promise<Goal[]> {
  const payload = await invoke('list_goals_command', { path: vaultPath })
  return z.array(goalSchema).parse(payload)
}

export async function createGoal(input: {
  vaultPath: string
  title: string
  objective: string
  sourceText: string
  provider?: GoalProvider | null
}): Promise<Goal> {
  const payload = await invoke('create_goal_command', {
    path: input.vaultPath,
    title: input.title,
    objective: input.objective,
    sourceText: input.sourceText,
    provider: input.provider ?? null,
  })
  return goalSchema.parse(payload)
}

export async function getGoal(vaultPath: string, id: string): Promise<Goal | null> {
  const payload = await invoke('get_goal_command', { path: vaultPath, id })
  return payload === null ? null : goalSchema.parse(payload)
}

export async function deleteGoal(vaultPath: string, id: string): Promise<void> {
  await invoke('delete_goal_command', { path: vaultPath, id })
}

export async function updateGoalStep(input: {
  vaultPath: string
  id: string
  order: number
  status?: GoalStepStatus
  /** undefined = não altera; null = desvincula; string = vincula */
  noteRelativePath?: string | null
}): Promise<Goal> {
  // Tauri serializa Option<Option<String>> como string | null | undefined.
  const payload = await invoke('update_goal_step_command', {
    path: input.vaultPath,
    id: input.id,
    order: input.order,
    status: input.status ?? null,
    noteRelativePath: input.noteRelativePath === undefined ? null : input.noteRelativePath,
  })
  return goalSchema.parse(payload)
}

/** Cria a nota .md do passo: `create_note` (ignora "já existe") + `save_note` com o template. */
export async function createStepNote(input: {
  vaultPath: string
  relativePath: string
  title: string
  summary: string
  goalTitle: string
  order: number
}): Promise<void> {
  const content = `# ${input.title}\n\n> Meta: ${input.goalTitle} — passo ${input.order}\n\n## O que estudar\n\n${input.summary || 'Descreva aqui os pontos principais deste passo.'}\n\n## Anotações\n\n- \n`
  try {
    await invoke('create_note', {
      path: input.vaultPath,
      relativePath: input.relativePath,
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (!/ja existe/i.test(message)) throw cause
  }
  await invoke('save_note', {
    path: input.vaultPath,
    relativePath: input.relativePath,
    content,
  })
}

export function goalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Não foi possível concluir a operação da meta.'
}
