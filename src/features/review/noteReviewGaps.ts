import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

const noteReviewGapSchema = z.object({
  classification: z.enum(['forgotten', 'confused']),
  sourceQuote: z.string().min(1).max(8_192)
    .refine((value) => value.trim().length > 0, 'A citação da lacuna não pode ser vazia.'),
  sourceStartUtf16: z.number().int().nonnegative().max(4_294_967_295),
  sourceEndUtf16: z.number().int().nonnegative().max(4_294_967_295),
}).strict().refine(
  ({ sourceStartUtf16, sourceEndUtf16 }) => sourceEndUtf16 > sourceStartUtf16,
  'O intervalo UTF-16 da lacuna deve ser nao vazio.',
)

const noteReviewGapsSchema = z.array(noteReviewGapSchema).max(200)

export type NoteReviewGap = z.infer<typeof noteReviewGapSchema>

export function parseNoteReviewGaps(payload: unknown): NoteReviewGap[] {
  return noteReviewGapsSchema.parse(payload)
}

export async function getNoteReviewGaps(input: {
  vaultPath: string
  relativePath: string
}): Promise<NoteReviewGap[]> {
  return parseNoteReviewGaps(await invoke<unknown>('get_note_review_gaps', {
    path: input.vaultPath,
    relativePath: input.relativePath,
  }))
}
