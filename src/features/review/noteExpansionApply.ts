/**
 * Aplica uma expansao de trecho apressado ao rascunho.
 *
 * ## O que ela faz
 *
 * Substitui o trecho original (`startUtf16` ate `endUtf16`) pela frase
 * completa que o provider proposeu.
 *
 * ## Por que a validacao e obrigatoria
 *
 * Os offsets vem do provider, e o rascunho pode ter mudado entre a proposta
 * e o clique: o usuario digitou, ou aplicou outra sugestao. Sem conferir que o
 * texto no intervalo ainda e o trecho original, a substituicao escreveria a
 * frase no lugar errado — apagando conteudo do aluno.
 *
 * E por isso que a funcao devolve `null` em vez de um resultado parcial: o
 * chamador precisa avisar que a edicao ficou desatualizada, e nao gravar
 * qualquer coisa.
 */
export function applyNoteExpansion(
  content: string,
  expansion: { startUtf16: number; endUtf16: number; expanded: string },
  expectedSource?: string,
): string | null {
  const { startUtf16, endUtf16, expanded } = expansion
  if (startUtf16 < 0 || endUtf16 < startUtf16) return null
  if (endUtf16 > content.length) return null

  const current = content.slice(startUtf16, endUtf16)
  // O trecho tem que ser o que o provider ancorou. Sem esta checagem, um
  // rascunho que mudou aplicaria a frase no lugar errado.
  if (expectedSource !== undefined && current !== expectedSource) {
    return null
  }
  if (current.trim().length === 0) return null

  return content.slice(0, startUtf16) + expanded + content.slice(endUtf16)
}
