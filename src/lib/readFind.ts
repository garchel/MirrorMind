/**
 * Busca textual no DOM do modo Leitura.
 *
 * O modo Leitura renderiza a nota como HTML (sem o editor CodeMirror), entao a
 * busca por Ctrl+F nao pode usar o destaque do editor. Estas funcoes caminham
 * os nos de texto do artigo renderizado e localizam as correspondencias da
 * query, devolvendo o no e os deslocamentos de cada uma para que a pagina
 * possa seleciona-las (Range do DOM) e rolar ate elas — sem mutar o DOM que o
 * React gerencia (mutacoes ali quebrariam a reconciliacao ao redigitar).
 */

export type ReadFindMatch = {
  /** No de texto que contem o inicio da correspondencia. */
  node: Text
  /** Deslocamento do inicio dentro de `node`. */
  start: number
  /** Deslocamento do fim dentro de `endNode` (pode ser um no diferente). */
  end: number
  /** No de texto que contem o fim da correspondencia. */
  endNode: Text
}

// Elementos de bloco: entre dois nos de texto de blocos diferentes entra um
// espaco na string pesquisavel, para que a busca atravesse paragrafos,
// listas, citacoes e celulas de tabela ("foo" num paragrafo e "bar" no
// proximo casam "foo bar"). Elementos inline (strong, em, code, a, span)
// ficam fora da lista e nao geram separador.
const BLOCK_SELECTOR = [
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
  'td', 'th', 'tr', 'table', 'ol', 'ul', 'dl', 'dt', 'dd', 'figure',
  'figcaption', 'hr', 'div', 'section', 'article', 'aside', 'header', 'footer',
].join(',')

type IndexedNode = { node: Text; start: number; end: number }

/** Constroi a string pesquisavel do artigo, com a faixa [start, end) de cada
 * no de texto nessa string (os separadores de bloco nao pertencem a nenhum
 * no). */
export function buildReadFindIndex(root: Node): { text: string; nodes: IndexedNode[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: IndexedNode[] = []
  let text = ''
  let previousBlock: Element | null = null

  let current = walker.nextNode() as Text | null
  while (current) {
    const block = current.parentElement?.closest(BLOCK_SELECTOR) ?? current.parentElement
    const value = current.data
    const hasText = value.trim().length > 0
    if (hasText && block !== previousBlock && previousBlock !== null && !/\s$/.test(text)) {
      text += ' '
    }
    const start = text.length
    text += value
    nodes.push({ node: current, start, end: text.length })
    if (hasText) previousBlock = block ?? null
    current = walker.nextNode() as Text | null
  }

  return { text, nodes }
}

/** Localiza todas as correspondencias (insensivel a caixa) da query no artigo
 * renderizado do modo Leitura. */
export function findReadMatches(root: Node, query: string): ReadFindMatch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const { text, nodes } = buildReadFindIndex(root)
  if (nodes.length === 0) return []

  const matches: ReadFindMatch[] = []
  let from = 0
  for (;;) {
    const index = text.toLowerCase().indexOf(needle, from)
    if (index === -1) break
    const end = index + needle.length
    const first = nodes.find((node) => node.end > index)
    const last = nodes.find((node) => node.end >= end)
    if (first && last) {
      matches.push({
        node: first.node,
        start: index - first.start,
        end: last === first ? end - first.start : end - last.start,
        endNode: last.node,
      })
    }
    from = end
  }
  return matches
}
