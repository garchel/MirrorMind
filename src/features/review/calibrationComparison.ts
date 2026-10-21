import { invoke } from '../../lib/tauri'
import { z } from 'zod'
import type { ReviewAiProvider } from './ai'

/**
 * A comparação entre os dois motores, como o app a mostra.
 *
 * O sidecar só existe no modo `Dual`: sem ele, `collecting` é `false` e a
 * lista está vazia. Isso é importante para a tela — uma lista vazia com
 * `collecting: false` significa "não há coleta ligado", e não "os motores
 * concordam sempre".
 */

const divergenceSchema = z.object({
  atUnixMs: z.number().int().nonnegative(),
  relativePath: z.string().min(1),
  dimension: z.string().min(1),
  primaryEngine: z.string().min(1),
  primaryLabel: z.string().nullable(),
  secondaryEngine: z.string().min(1),
  secondaryLabel: z.string().nullable(),
  primaryConfidence: z.number().min(0).max(1).nullable(),
  primaryDistribution: z.record(z.string(), z.number().min(0).max(1)).nullable(),
}).strict()

const comparisonSchema = z.object({
  total: z.number().int().nonnegative(),
  divergences: z.number().int().nonnegative(),
  divergenceRate: z.number().min(0).max(1).nullable(),
  recent: z.array(divergenceSchema).max(50),
  collecting: z.boolean(),
}).strict()

export type CalibrationDivergence = z.infer<typeof divergenceSchema>
export type CalibrationComparison = z.infer<typeof comparisonSchema>

export async function getCalibrationComparison(
  vaultPath: string,
): Promise<CalibrationComparison> {
  const payload = await invoke('get_calibration_comparison', { vaultRoot: vaultPath })
  return comparisonSchema.parse(payload)
}

/**
 * A divergencia do motor nesta nota especifica.
 *
 * `null` quando nao ha registro — a nota nunca foi avaliada no modo `Dual`,
 * ou os dois motores concordaram e so a comparacao guarda o acordo.
 */
const noteDivergenceSchema = z.object({
  atUnixMs: z.number().int().nonnegative(),
  dimension: z.string().min(1),
  primaryEngine: z.string().min(1),
  primaryLabel: z.string().nullable(),
  secondaryEngine: z.string().min(1),
  secondaryLabel: z.string().nullable(),
  primaryConfidence: z.number().min(0).max(1).nullable(),
}).strict()

export type NoteCalibrationDivergence = z.infer<typeof noteDivergenceSchema>

export async function getNoteCalibrationDivergence(
  vaultPath: string,
  relativePath: string,
): Promise<NoteCalibrationDivergence | null> {
  const payload = await invoke('get_note_calibration_divergence', {
    vaultRoot: vaultPath,
    relativePath,
  })
  if (payload === null || payload === undefined) return null
  return noteDivergenceSchema.parse(payload)
}

// --- melhorias da nota ------------------------------------------------------

/**
 * A expansao de um trecho que o aluno escreveu apressado.
 *
 * `sourceQuote` e o trecho original (a ancora) e `expanded` e a frase
 * completa que o aluno quis dizer. `startUtf16` e `endUtf16` delimitam o
 * trecho original, para a substituicao ser exata.
 */
const improvementExpansionSchema = z.object({
  sourceQuote: z.string().min(1),
  expanded: z.string().min(1),
  startUtf16: z.number().int().nonnegative(),
  endUtf16: z.number().int().nonnegative(),
}).strict()

const improvementSuggestionSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  sourceQuote: z.string().min(1),
  startUtf16: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
}).strict()

const improvementReportSchema = z.object({
  expansions: z.array(improvementExpansionSchema).max(20),
  suggestions: z.array(improvementSuggestionSchema).max(20),
  rejected: z.number().int().nonnegative(),
  invalid: z.boolean(),
}).strict()

export type NoteImprovementExpansion = z.infer<typeof improvementExpansionSchema>
export type NoteImprovementSuggestion = z.infer<typeof improvementSuggestionSchema>
export type NoteImprovementReport = z.infer<typeof improvementReportSchema>

/**
 * Pede sugestoes de melhoria para a nota.
 *
 * O provider generativo propoe (expansoes e definicoes) e o motor
 * calibrado confirma as definicoes. A estrategia do Vault decide se o motor
 * calibrado participa.
 */
export async function proposeNoteImprovements(
  vaultPath: string,
  relativePath: string,
  provider: ReviewAiProvider,
): Promise<NoteImprovementReport> {
  const payload = await invoke('propose_note_improvements', {
    path: vaultPath,
    relativePath,
    provider,
  })
  return improvementReportSchema.parse(payload)
}

