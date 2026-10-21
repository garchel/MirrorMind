import { z } from 'zod'

/**
 * O dicionário de conceitos de um Vault.
 *
 * O schema é `.strict()` como o resto do app: uma chave a mais na resposta
 * do backend é um sinal de que os dois lados divergiram, e o `.strict()`
 * transforma isso num erro legível em vez de um `undefined` silencioso.
 */
export const dictionaryEntrySchema = z.object({
  term: z.string(),
  concept: z.string(),
  createdAtUnixMs: z.number(),
  updatedAtUnixMs: z.number(),
}).strict()

export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>

/** Os verbetes de um Vault, ordenados por termo. */
export const dictionarySnapshotSchema = z.object({
  entries: z.array(dictionaryEntrySchema),
}).strict()

export type DictionarySnapshot = z.infer<typeof dictionarySnapshotSchema>

/** Os limites que o backend aplica. */
export const dictionaryLimitsSchema = z.object({
  maxTermChars: z.number(),
  maxConceptChars: z.number(),
}).strict()

export type DictionaryLimits = z.infer<typeof dictionaryLimitsSchema>

/**
 * Normaliza um termo para comparação, do mesmo jeito que o backend.
 *
 * **Tem que ser a mesma regra do `normalize_term` em `dictionary/mod.rs`.**
 * Se as duas divergirem, o hover casa uma palavra e a página outra — e o
 * usuário vê um termo registrado que não aparece em lugar nenhum.
 *
 * Minúsculas, sem acentos, sem pontuação nas pontas. O espaço interno é
 * preservado: "pH ótimo" é um termo de duas palavras.
 */
export function normalizeTerm(text: string): string {
  return text
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .toLowerCase()
    .normalize('NFD')
    // Os marcas combinantes (U+0300–U+036F) saem depois do NFD: e ele que
    // separa o "a" do acento. Escritos com escape, porque os caracteres
    // literais sao invisiveis no editor e corrompem o arquivo silenciosamente.
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * O dicionário indexado por termo normalizado.
 *
 * A busca por hover acontece a cada movimento do mouse: um `Map` faz o
 * caminho de `O(1)` em vez de varrer a lista a cada pixel.
 */
export function indexDictionary(
  entries: readonly DictionaryEntry[],
): Map<string, DictionaryEntry> {
  const index = new Map<string, DictionaryEntry>()
  for (const entry of entries) {
    const key = normalizeTerm(entry.term)
    if (!key) continue
    index.set(key, entry)
  }
  return index
}

/**
 * As palavras de um termo, já normalizadas.
 *
 * Usado para casar **palavra inteira** no texto: o termo "arte" não pode
 * casar com "partido", e casar por substring transformaria o dicionário
 * num gerador de falsos positivos.
 */
export function normalizedWords(term: string): string[] {
  return normalizeTerm(term)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
}

/**
 * Extrai a palavra sob uma posicao do texto.
 *
 * Devolve `null` quando o texto na posicao nao e parte de uma palavra — a
 * posicao esta num espaco, numa pontuacao ou no fim do texto.
 *
 * ## A posicao precisa estar DENTRO da palavra
 *
 * Sem esta checagem, o cursor sobre o espaco entre duas palavras devolveria
 * a palavra da esquerda, e o balao apareceria quando o mouse nao esta sobre
 * nada. O hover precisa casar a palavra sob o **ponteiro**, nao a vizinha.
 */
export function wordAt(text: string, offset: number): { word: string; start: number; end: number } | null {
  if (offset < 0 || offset > text.length) return null
  const isWordCharacter = (character: string) => /[\p{L}\p{N}]/u.test(character)

  // A posicao tem de estar sobre um caractere de palavra.
  const at = text.slice(offset, offset + 1)
  if (!at || !isWordCharacter(at)) return null

  let start = offset
  while (start > 0) {
    const previous = text.slice(start - 1, start)
    if (!isWordCharacter(previous)) break
    start -= 1
  }
  let end = offset
  while (end < text.length) {
    const next = text.slice(end, end + 1)
    if (!isWordCharacter(next)) break
    end += 1
  }
  if (start === end) return null
  return { word: text.slice(start, end), start, end }
}
