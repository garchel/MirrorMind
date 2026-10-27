import { invoke } from '../../lib/tauri'
import { z } from 'zod'
import type { ReviewAiProvider } from '../review/ai'
import { dictionaryEntrySchema, type DictionaryEntry } from './dictionarySchema'

/**
 * O conceito sugerido para um trecho selecionado na nota.
 *
 * O backend devolve `existing` porque a comparacao de variantes e a mesma do
 * `upsert` (`estroma` cobre `estroma dos cloroplastos`). Reimplementar a regra
 * na interface faria a tela dizer "novo" para um termo que o dicionario ja
 * reconhece.
 */
const conceptSuggestionSchema = z.object({
  term: z.string(),
  concept: z.string(),
  existing: dictionaryEntrySchema.nullable(),
  invalid: z.boolean(),
}).strict()

export type DictionaryConceptSuggestion = z.infer<typeof conceptSuggestionSchema>

/**
 * Pede ao provider generativo o conceito de um trecho da nota.
 *
 * `markdown` e o rascunho atual, e nao o arquivo no disco: com o autosave
 * desligado, ler o disco daria ao modelo um contexto que o usuario ja mudou.
 * O backend recorta a janela ao redor do trecho e cobra o orcamento por ela,
 * nao pela nota inteira.
 */
export async function suggestDictionaryConcept(
  vaultPath: string,
  term: string,
  markdown: string,
  provider: ReviewAiProvider,
): Promise<DictionaryConceptSuggestion> {
  const payload = await invoke('suggest_dictionary_concept', {
    path: vaultPath,
    term,
    markdown,
    provider,
  })
  return conceptSuggestionSchema.parse(payload)
}

/** Reexportado para a tela nao depender do modulo do schema do dicionario. */
export type { DictionaryEntry }
