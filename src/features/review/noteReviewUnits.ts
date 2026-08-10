import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

const noteReviewUnitSchema = z.object({
  sourceStartUtf16: z.number().int().nonnegative().max(4_294_967_295),
  sourceEndUtf16: z.number().int().positive().max(4_294_967_295),
  // A unidade foi efetivamente avaliada na sessão (alvo da cobertura
  // adaptativa). Unidades fora do alvo não pontuam nem evoluem estado.
  evaluated: z.boolean(),
  // Unidade do alvo com evidência insuficiente: nunca pontua zero, não
  // altera DSR/FSRS e não entra na média.
  inconclusive: z.boolean().default(false),
  score: z.number().int().min(0).max(100),
  outcome: z.enum(['forgotten', 'partial', 'good', 'complete']),
}).strict()

const noteReviewUnitsSchema = z.array(noteReviewUnitSchema).max(2_000)

export type NoteReviewUnit = z.infer<typeof noteReviewUnitSchema>

export function parseNoteReviewUnits(payload: unknown): NoteReviewUnit[] {
  return noteReviewUnitsSchema.parse(payload)
}

export async function getNoteReviewUnits(input: {
  vaultPath: string
  relativePath: string
}): Promise<NoteReviewUnit[]> {
  return parseNoteReviewUnits(await invoke<unknown>('get_note_review_units', {
    path: input.vaultPath,
    relativePath: input.relativePath,
  }))
}
