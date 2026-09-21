import { invoke } from '../../lib/tauri'
import { displayWikilinkTargetName } from '../../lib/markdown'
import { z } from 'zod'
import type { ReviewAiProvider } from '../review/ai'

const goalStepSchema = z.object({
  order: z.number().int().positive().max(30),
  title: z.string().min(1).max(200),
  summary: z.string().max(1000),
  suggestedRelativePath: z.string().min(1).max(512),
  noteRelativePath: z.string().min(1).max(512).nullable().optional(),
})
// Sem `.strict()` de propósito: metas gravadas antes da remoção do controle
// manual ainda trazem `status` no JSON e continuam lendo (campo ignorado).

/** Conteúdo das notas novas do plano: em branco ou esqueleto gerado por IA. */
const noteContentModeSchema = z.enum(['blank', 'ai'])

const goalSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(4000),
  sourceText: z.string().max(100000).default(''),
  createdAtUnixMs: z.number().int().nonnegative(),
  steps: z.array(goalStepSchema).min(1).max(30),
  aiGenerated: z.boolean().default(false),
  noteContentMode: noteContentModeSchema.default('blank'),
}).strict()

const goalStepDraftSchema = z.object({
  tags: z.array(z.string().min(1).max(64)).max(8).default([]),
  sections: z.array(z.object({
    heading: z.string().min(1).max(80),
    body: z.string().min(1).max(2000),
  }).strict()).min(1).max(6),
}).strict()

export type NoteContentMode = z.infer<typeof noteContentModeSchema>
export type GoalStepDraft = z.infer<typeof goalStepDraftSchema>

export type GoalStep = z.infer<typeof goalStepSchema>
export type Goal = z.infer<typeof goalSchema>

/** Passo concluído = nota criada e vinculada (sem controle manual). */
export function isStepDone(step: Pick<GoalStep, 'noteRelativePath'>): boolean {
  return typeof step.noteRelativePath === 'string' && step.noteRelativePath.trim().length > 0
}

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
  noteContentMode?: NoteContentMode | null
}): Promise<Goal> {
  const payload = await invoke('create_goal_command', {
    path: input.vaultPath,
    title: input.title,
    objective: input.objective,
    sourceText: input.sourceText,
    provider: input.provider ?? null,
    noteContentMode: input.noteContentMode ?? null,
  })
  return goalSchema.parse(payload)
}

/** Altera o conteúdo padrão das notas novas (vale para os próximos +). */
export async function setGoalNoteContentMode(input: {
  vaultPath: string
  id: string
  noteContentMode: NoteContentMode
}): Promise<Goal> {
  const payload = await invoke('set_goal_note_content_mode_command', {
    path: input.vaultPath,
    id: input.id,
    noteContentMode: input.noteContentMode,
  })
  return goalSchema.parse(payload)
}

/** Pede à IA o rascunho do conteúdo de um passo (esqueleto + perguntas-guia).
 * Falhas (consentimento, orçamento, rede, schema) rejeitam para o chamador
 * cair na nota em branco — nunca bloqueiam a criação. */
export async function generateGoalStepDraft(input: {
  vaultPath: string
  id: string
  order: number
  provider: GoalProvider
}): Promise<GoalStepDraft> {
  const payload = await invoke('generate_goal_step_draft_command', {
    path: input.vaultPath,
    id: input.id,
    order: input.order,
    provider: input.provider,
  })
  return goalStepDraftSchema.parse(payload)
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
  /** undefined = não altera; null = desvincula; string = vincula */
  noteRelativePath?: string | null
}): Promise<Goal> {
  // Tauri serializa Option<Option<String>> como string | null | undefined.
  const payload = await invoke('update_goal_step_command', {
    path: input.vaultPath,
    id: input.id,
    order: input.order,
    noteRelativePath: input.noteRelativePath === undefined ? null : input.noteRelativePath,
  })
  return goalSchema.parse(payload)
}

const reconcileGoalNotesSchema = z.object({
  goal: goalSchema,
  changed: z.boolean(),
})

export type ReconcileGoalNotesResult = z.infer<typeof reconcileGoalNotesSchema>

/** Ao abrir o modal de detalhes: confere no disco as notas vinculadas —
 * apagadas são desvinculadas (o passo volta ao +), movidas têm o caminho
 * atualizado. `changed` indica se a indexadora precisa ser regravada. */
export async function reconcileGoalNotes(input: {
  vaultPath: string
  id: string
}): Promise<ReconcileGoalNotesResult> {
  const payload = await invoke('reconcile_goal_notes_command', {
    path: input.vaultPath,
    id: input.id,
  })
  return reconcileGoalNotesSchema.parse(payload)
}

const ACCENT_MAP: Record<string, string> = {
  á: 'a', à: 'a', ã: 'a', â: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', õ: 'o', ô: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
}

/** Slug idêntico ao do backend (`slugify` em `src-tauri/src/goals.rs`):
 * minúsculas, acentos mapeados, resto vira `-` (colapsado), máx 48 chars. */
export function goalSlug(title: string): string {
  const lowered = title.toLowerCase()
  let out = ''
  let lastDash = false
  for (const ch of lowered) {
    const mapped = ACCENT_MAP[ch] ?? (/[a-z0-9]/.test(ch) ? ch : null)
    if (mapped !== null) {
      out += mapped
      lastDash = false
    } else if (!lastDash && out.length > 0) {
      out += '-'
      lastDash = true
    }
    if (out.length >= 48) break
  }
  const slug = out.replace(/^-+|-+$/g, '')
  return slug === '' ? 'meta' : slug
}

/** Pasta do plano derivada do caminho sugerido pelo backend (fonte única da
 * verdade — nunca recalculada por slug), ex.: `Metas/aprender-x`. */
export function goalFolder(input: { title: string; steps: Array<{ suggestedRelativePath: string }> }): string {
  const first = input.steps[0]?.suggestedRelativePath ?? ''
  const slash = first.lastIndexOf('/')
  if (slash > 0) return first.slice(0, slash)
  return `Metas/${goalSlug(input.title)}`
}

/** Nota indexadora da meta: primeira do plano (`00-`), com o nome da meta. */
export function goalIndexRelativePath(input: { title: string; steps: Array<{ suggestedRelativePath: string }> }): string {
  return `${goalFolder(input)}/00-${goalSlug(input.title)}.md`
}

export type IndexableStep = Pick<GoalStep, 'title' | 'suggestedRelativePath' | 'noteRelativePath'>

/** Conteúdo da indexadora: checklist em ordem lógica com wikilinks para cada
 * nota proposta (`[x]` nas já criadas). Os links usam só o nome da nota (sem
 * a rota `Metas/...`); a resolução por nome-base (mesma pasta, depois o
 * vault) encontra o destino — igual ao Obsidian. Regenerado a cada nota criada. */
export function buildIndexNoteContent(input: {
  goalTitle: string
  objective: string
  steps: IndexableStep[]
}): string {
  const lines = input.steps.map((step) => {
    const done = isStepDone(step)
    const target = displayWikilinkTargetName(step.noteRelativePath ?? step.suggestedRelativePath)
    return `- [${done ? 'x' : ' '}] [[${target}|${step.title}]]`
  })
  return `# ${input.goalTitle}\n\n> Meta de estudo: ${input.objective}\n> Esta nota indexadora é atualizada pelo MirrorMind a cada nota do plano criada pelo botão +.\n\n## Notas do plano, em ordem de estudo\n\n${lines.join('\n')}\n`
}

/** Valor YAML entre aspas (títulos com `:` ou `#` não quebram o frontmatter). */
function yamlQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Template da nota do passo, com link de volta para a indexadora.
 * Com `draft` (IA), monta frontmatter (tags da meta + sugeridas), o resumo do
 * plano e as seções do esqueleto; sem `draft`, nota em branco equivalente. */
export function buildStepNoteContent(input: {
  goalTitle: string
  goalSlug: string
  indexPath: string
  order: number
  title: string
  summary: string
  draft?: GoalStepDraft | null
}): string {
  const metaTag = `meta/${input.goalSlug}`
  const tags = [metaTag, ...((input.draft?.tags ?? []).filter((tag) => tag !== metaTag))].slice(0, 9)
  const frontmatter = `---\ntags: [${tags.join(', ')}]\nmeta: ${yamlQuoted(input.goalTitle)}\nstatus: rascunho\n---\n\n`
  const header = `# ${input.title}\n\n> Parte da meta [[${input.indexPath}|${input.goalTitle}]] — passo ${input.order}\n`
  const study = input.draft
    ? `\n## O que estudar\n\n${input.summary || 'Veja o resumo do plano abaixo.'}\n${input.draft.sections.map((section) => `\n## ${section.heading}\n\n${section.body}`).join('\n')}\n`
    : `\n## O que estudar\n\n${input.summary || 'Descreva aqui os pontos principais deste passo.'}\n`
  return `${frontmatter}${header}${study}\n## Anotações\n\n- \n\n## Dúvidas\n\n- \n`
}

/** Cria a nota .md do passo: `create_note` (ignora "já existe") + `save_note` com o template. */
export async function createStepNote(input: {
  vaultPath: string
  relativePath: string
  title: string
  summary: string
  goalTitle: string
  goalSlug: string
  order: number
  indexPath: string
  draft?: GoalStepDraft | null
}): Promise<void> {
  const content = buildStepNoteContent({
    goalTitle: input.goalTitle,
    goalSlug: input.goalSlug,
    indexPath: input.indexPath,
    order: input.order,
    title: input.title,
    summary: input.summary,
    draft: input.draft ?? null,
  })
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

/** Garante a indexadora: cria se ausente e regrava o checklist a cada nota. */
export async function ensureGoalIndexNote(vaultPath: string, goal: Goal): Promise<string> {
  const indexPath = goalIndexRelativePath(goal)
  const content = buildIndexNoteContent({
    goalTitle: goal.title,
    objective: goal.objective,
    steps: goal.steps,
  })
  try {
    await invoke('create_note', { path: vaultPath, relativePath: indexPath })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (!/ja existe/i.test(message)) throw cause
  }
  await invoke('save_note', { path: vaultPath, relativePath: indexPath, content })
  return indexPath
}

export type CreatedGoalStepNote = {
  goal: Goal
  notePath: string
  indexPath: string
}

/** Fluxo do botão +: cria a nota do passo (em branco ou esqueleto com IA, com
 * link à indexadora), vincula o passo, garante/regrava a indexadora e devolve
 * tudo para abrir a nota. Com IA, qualquer falha cai para em branco. */
export async function createGoalStepNote(input: {
  vaultPath: string
  goal: Goal
  order: number
  contentMode?: NoteContentMode | null
  provider?: GoalProvider | null
}): Promise<CreatedGoalStepNote & { usedAiDraft: boolean; draftError: string | null }> {
  const step = input.goal.steps.find((item) => item.order === input.order)
  if (!step) throw new Error('O passo não existe na meta.')
  const indexPath = goalIndexRelativePath(input.goal)
  const notePath = step.noteRelativePath ?? step.suggestedRelativePath
  let usedAiDraft = false
  let draftError: string | null = null
  if (!step.noteRelativePath) {
    let draft: GoalStepDraft | null = null
    const mode = input.contentMode ?? input.goal.noteContentMode ?? 'blank'
    if (mode === 'ai' && input.provider) {
      try {
        draft = await generateGoalStepDraft({
          vaultPath: input.vaultPath,
          id: input.goal.id,
          order: step.order,
          provider: input.provider,
        })
        usedAiDraft = true
      } catch (cause) {
        draft = null
        draftError = cause instanceof Error ? cause.message : String(cause)
      }
    } else if (mode === 'ai' && !input.provider) {
      draftError = 'Nenhum provedor de IA configurado: a nota foi criada em branco.'
    }
    await createStepNote({
      vaultPath: input.vaultPath,
      relativePath: notePath,
      title: step.title,
      summary: step.summary,
      goalTitle: input.goal.title,
      goalSlug: goalSlug(input.goal.title),
      order: step.order,
      indexPath,
      draft,
    })
  }
  const updated = await updateGoalStep({
    vaultPath: input.vaultPath,
    id: input.goal.id,
    order: step.order,
    noteRelativePath: notePath,
  })
  await ensureGoalIndexNote(input.vaultPath, updated)
  return { goal: updated, notePath, indexPath, usedAiDraft, draftError }
}

export function goalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Não foi possível concluir a operação da meta.'
}
