import type { StructuralAuditEdit } from './ai'

/**
 * Aplica uma edicao da auditoria estrutural ao rascunho da nota.
 *
 * Os offsets sao em unidades UTF-16 (o mesmo espaco que o JS usa em
 * `String.slice`), entao a edicao e uma simples concatenacao de fatias.
 * Devolve `null` quando o edit e invalido (offsets fora do tamanho ou
 * intervalo invertido) — o frontend mostra erro em vez de corromper o texto.
 */
export function applyStructuralAuditEdit(
  content: string,
  edit: StructuralAuditEdit,
): string | null {
  const length = content.length
  if (edit.startUtf16 < 0 || edit.startUtf16 > length) return null
  if (edit.endUtf16 !== null && (edit.endUtf16 < edit.startUtf16 || edit.endUtf16 > length)) {
    return null
  }

  if (edit.kind === 'insertHeadingBefore') {
    if (!edit.insert) return null
    return content.slice(0, edit.startUtf16) + edit.insert + content.slice(edit.startUtf16)
  }

  if (edit.kind === 'removeLines') {
    if (edit.endUtf16 === null) return null
    return content.slice(0, edit.startUtf16) + content.slice(edit.endUtf16)
  }

  if (edit.kind === 'splitSection') {
    if (!edit.ops || edit.ops.length === 0) return null
    // Aplica do maior offset para o menor: os offsets sao relativos ao conteudo
    // original, e inserir primeiro em posicoes posteriores mantem os anteriores
    // validos.
    const ops = [...edit.ops].sort((a, b) => b.startUtf16 - a.startUtf16)
    let next = content
    for (const op of ops) {
      if (op.startUtf16 < 0 || op.startUtf16 > next.length) return null
      next = next.slice(0, op.startUtf16) + op.insert + next.slice(op.startUtf16)
    }
    return next
  }

  return null
}
