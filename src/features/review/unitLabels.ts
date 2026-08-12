/**
 * Rotulos de contagem de unidades: a segmentacao produz tres tipos
 * (nota inteira, secao e paragrafo), e a interface deve usar o substantivo
 * correspondente em vez de sempre dizer "paragrafos". Quando os tipos se
 * misturam (ex.: preambulo em paragrafo + secoes), o neutro "unidades" e o
 * honesto.
 */

/** Tipo dominante de uma colecao de unidades, para escolher o substantivo. */
export type UnitKindLabel = 'section' | 'paragraph' | 'mixed'

export function dominantUnitKind(kinds: ReadonlyArray<string | undefined>): UnitKindLabel {
  const present = new Set(kinds.filter((kind): kind is string => kind === 'section' || kind === 'paragraph'))
  if (present.size === 0 || present.size > 1) return 'mixed'
  return present.has('section') ? 'section' : 'paragraph'
}

/** Substantivo no singular para o tipo dado. */
export function unitNoun(kind: UnitKindLabel): string {
  switch (kind) {
    case 'section': return 'seção'
    case 'paragraph': return 'parágrafo'
    case 'mixed': return 'unidade'
  }
}

/** Substantivo no plural (plural irregular de "seção"). */
export function unitPluralNoun(kind: UnitKindLabel): string {
  switch (kind) {
    case 'section': return 'seções'
    case 'paragraph': return 'parágrafos'
    case 'mixed': return 'unidades'
  }
}

/** "X seção(ões)": pluraliza o substantivo conforme a contagem. */
export function unitCountLabel(count: number, kinds: ReadonlyArray<string | undefined>): string {
  const kind = dominantUnitKind(kinds)
  return `${count} ${count === 1 ? unitNoun(kind) : unitPluralNoun(kind)}`
}
