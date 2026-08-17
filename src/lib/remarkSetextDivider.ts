type MarkdownNode = {
  children?: MarkdownNode[]
  depth?: number
  position?: {
    start: { line: number; column: number; offset?: number }
    end: { line: number; column: number; offset?: number }
  }
  type: string
  value?: string
}

type MarkdownFile = {
  value?: unknown
}

/** Linha de divisor: apenas travessoes (3+) com ate 3 espacos de indentacao. */
const DIVIDER_LINE = /^ {0,3}-{3,}[ \t]*$/

function walkAndTransform(node: MarkdownNode, sourceLines: string[]): MarkdownNode[] {
  const children: MarkdownNode[] = []
  for (const child of node.children ?? []) {
    children.push(child)
    // `---` logo apos um paragrafo e o sublinhado de um heading setext de
    // nivel 2 no CommonMark — a linha inteira acima vira um titulo. Quem
    // escreve `---` quer um divisor (mesma decisao ja aplicada no modo
    // Misto), entao o heading vira <p> + <hr>, SEM alterar o numero de
    // linhas: o <hr> ocupa a propria linha do sublinhado, preservando o
    // mapeamento de linha dos checklists do modo Leitura.
    if (child.type !== 'heading' || child.depth !== 2 || !child.position) continue
    if (child.position.end.line <= child.position.start.line) continue
    const underlineLine = sourceLines[child.position.end.line - 1] ?? ''
    if (!DIVIDER_LINE.test(underlineLine)) continue

    // Converte o heading em paragrafo com o mesmo conteudo inline, ocupando
    // somente a(s) linha(s) do conteudo (o sublinhado deixa de fazer parte).
    const underlineEnd = child.position.end
    const underlineStartOffset = (underlineEnd.offset ?? 0) - underlineLine.length
    const contentLine = sourceLines[underlineEnd.line - 2] ?? ''
    child.type = 'paragraph'
    delete child.depth
    child.position = {
      start: child.position.start,
      end: {
        line: underlineEnd.line - 1,
        column: contentLine.length + 1,
        offset: underlineStartOffset - 1,
      },
    }
    // ...e insere o divisor ocupando a propria linha do sublinhado: nenhuma
    // linha e inserida ou removida, preservando o mapeamento de linha dos
    // checklists do modo Leitura.
    children.push({
      type: 'thematicBreak',
      position: {
        start: {
          line: underlineEnd.line,
          column: 1,
          offset: underlineStartOffset,
        },
        end: underlineEnd,
      },
    })
  }
  node.children = children
  return node.children
}

/** Percorre a arvore transformando os filhos de cada no. */
function walkMarkdownTree(root: MarkdownNode, sourceLines: string[]) {
  walkAndTransform(root, sourceLines).forEach((child) => walkMarkdownTree(child, sourceLines))
}

export function remarkSetextDividerAsSeparator() {
  return (tree: MarkdownNode, file: MarkdownFile) => {
    walkMarkdownTree(tree, String(file.value ?? '').split('\n'))
  }
}
