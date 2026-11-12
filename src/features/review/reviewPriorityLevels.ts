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
