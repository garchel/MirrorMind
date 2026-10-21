/**
 * Alinha o "antes" e o "depois" de uma nota com sugestoes de melhoria.
 *
 * ## Por que 1:1
 *
 * Todas as edicoes desta feature sao **aditivas**: inserem um paragrafo
 * inteiro, sem remover nem reescrever nada. Isso e proposital — e o que
 * permite que a edicao seja revisada pelo usuario antes de ser salva, e o que
 * faz o alinhamento ser trivial: cada bloco do "depois" ou existia no
 * "antes" ou e uma sugestao nova.
 *
 * Um diff geral (LCS, Myers) seria trabalho sem ganho aqui, e o risco de
 * alinhar errado — mostrando um bloco destacado que nao corresponde ao que
 * seria inserido — e pior do que o ganho.
 */

/** Um bloco de texto, com o que ele e. */
export type AlignedBlock = {
  /** O texto do bloco, como aparece no painel correspondente. */
  text: string
  /**
   * `undefined` = bloco comum, igual nos dois lados.
   * `null` = bloco so no "depois" (uma sugestao).
   * `string` = bloco so no "antes" (sendo removido — nao acontece nesta
   * feature, mas o tipo comporta).
   */
  kind?: 'inserted' | 'removed'
  /**
   * O indice da sugestao, para ligar o hover entre os dois lados.
   */
  suggestionId?: number
}

/** Uma sugestão, com o antes e o depois alinhados. */
export type AlignedSuggestion = {
  id: number
  /** O texto que o modelo redigiu. */
  definition: string
  /** O termo que a definicao explica. */
  term: string
  /** A citacao da nota onde o termo e usado. */
  sourceQuote: string
  /** Os blocos do "antes" em volta da ancoragem. */
  before: AlignedBlock[]
  /** Os blocos do "depois" em volta da ancoragem. */
  after: AlignedBlock[]
}

/**
 * Divide o texto em blocos (paragrafos).
 *
 * A divisao e por linha em branco, que e como o app segmenta as notas. Um
 * bloco que contem o offset e o bloco **inteiro** — a sugestao entra antes
 * dele, e nao no meio.
 */
function splitBlocks(content: string): { text: string; start: number }[] {
  const blocks: { text: string; start: number }[] = []
  const pattern = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const text = match[0]
    if (text.trim().length === 0) continue
    blocks.push({ text, start: match.index })
  }
  return blocks
}

/**
 * Alinha as sugestoes entre o antes e o depois.
 *
 * As sugestoes vem com o offset UTF-16 de **insercao** (o inicio do bloco
 * onde a definicao entra). Cada uma produz um bloco novo no "depois", com o
 * mesmo indice de sugestao nos dois lados — e o que permite o highlight
 * ligado por hover.
 */
export function alignSuggestions(
  before: string,
  suggestions: { sourceQuote: string; definition: string; term: string }[],
): AlignedSuggestion[] {
  const blocks = splitBlocks(before)
  const result: AlignedSuggestion[] = []

  suggestions.forEach((suggestion, id) => {
    // O bloco ancorado e o primeiro que contem a citacao. A citacao e o
    // trecho exato da nota onde o termo aparece sem definicao.
    const anchorIndex = blocks.findIndex((block) =>
      block.text.includes(suggestion.sourceQuote),
    )
    // Sem ancora, a sugestao nao tem onde ser lida: ela nao entra na
    // comparacao. A tela mostra a lista de sugestoes sem o lado a lado para
    // essa.
    if (anchorIndex < 0) return

    const beforeBlocks: AlignedBlock[] = []
    const afterBlocks: AlignedBlock[] = []

    blocks.forEach((block, index) => {
      const isAnchor = index === anchorIndex
      if (isAnchor) {
        // A definicao entra **antes** do bloco que usa o termo — e para isso
        // que ela existe. A ordem no "depois" e: o inserido, e depois o
        // bloco original.
        beforeBlocks.push({ text: block.text })
        afterBlocks.push({
          text: suggestion.definition,
          kind: 'inserted',
          suggestionId: id,
        })
        afterBlocks.push({ text: block.text })
        return
      }
      beforeBlocks.push({ text: block.text })
      afterBlocks.push({ text: block.text })
    })

    result.push({
      id,
      definition: suggestion.definition,
      term: suggestion.term,
      sourceQuote: suggestion.sourceQuote,
      before: beforeBlocks,
      after: afterBlocks,
    })
  })

  return result
}
