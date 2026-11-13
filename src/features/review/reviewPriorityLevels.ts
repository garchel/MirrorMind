/**
 * Os tres degraus de prioridade — o vocabulario do motor, nao um numero.
 *
 * As tags padrao de revisao ja definem exatamente estes pesos
 * (`revisao/leve` = 1, `revisao/manter` = 2, `revisao/prova` = 3) e o padrao
 * do vault e 1. Ficam fora do componente por causa da regra de Fast Refresh:
 * um arquivo `.tsx` que exporta constante e componente invalida o HMR.
 */
export const REVIEW_PRIORITY_LEVELS = [
  { label: 'Normal', weight: 1, description: 'Entra na fila pelo atraso, como as demais.' },
  { label: 'Alta', weight: 2, description: 'Passa na frente das normais.' },
  { label: 'Urgente', weight: 3, description: 'Vai para o topo da fila.' },
] as const

export type ReviewPriorityLevel = (typeof REVIEW_PRIORITY_LEVELS)[number]

/** Nivel correspondente ao peso salvo.
 *
 *  O peso pode vir fracionario de uma politica (tag, prazo ou nota antiga que
 *  ficou com 0,1). A tela mostra o degrau mais proximo — `0,1` e `0,4` sao
 *  "Normal", `2,7` e "Urgente" — e o valor exato aparece no `title` do
 *  controle, para nao esconder o dado de quem procura. Nada e reescrito ate o
 *  usuario escolher um nivel. */
export function priorityLevelFor(weight: number): ReviewPriorityLevel {
  const index = Math.min(
    REVIEW_PRIORITY_LEVELS.length - 1,
    Math.max(0, Math.round(weight) - 1),
  )
  return REVIEW_PRIORITY_LEVELS[index]
}

/** Origem do peso, na lingua do usuario.
 *
 *  A fila mostra "Alta" e nada mais. Sem a origem, nao da para saber se a nota
 *  foi marcada assim ou se herdou de uma tag — e a diferenca importa: mudar a
 *  prioridade na fila vale so para aquela nota, enquanto a tag continua
 *  valendo para as outras.
 */
export type PrioritySourceLike = {
  kind: 'vaultDefault' | 'expiredDeadlineTag' | 'tag' | 'activeDeadlineTag' | 'note'
  sourceId: string | null
}

export function describePrioritySource(source?: PrioritySourceLike | null): string | null {
  if (!source) return null
  const tag = source.sourceId ? `#${source.sourceId}` : 'de prazo'
  switch (source.kind) {
    case 'tag':
      return `Herdada da tag ${tag}`
    case 'activeDeadlineTag':
    case 'expiredDeadlineTag':
      return `Herdada da tag ${tag}`
    case 'note':
      return 'Definida nesta nota'
    case 'vaultDefault':
      return 'Padrão do vault'
    default:
      return null
  }
}
