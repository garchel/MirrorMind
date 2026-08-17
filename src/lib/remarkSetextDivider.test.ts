import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { remarkSetextDividerAsSeparator } from './remarkSetextDivider'

type Node = {
  type: string
  depth?: number
  children?: Node[]
  position?: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
}

function treeFor(markdown: string) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkSetextDividerAsSeparator)
  const tree = processor.parse(markdown) as unknown as Node
  processor.runSync(tree, markdown)
  return tree
}

function types(root: Node): string[] {
  return [root.type, ...(root.children ?? []).flatMap((child) => types(child))]
}

function topLevel(root: Node) {
  return (root.children ?? []).map((child) => ({ type: child.type, depth: child.depth, start: child.position?.start.line, end: child.position?.end.line }))
}

describe('remarkSetextDividerAsSeparator', () => {
  it('transforma `texto + ---` (setext h2) em paragrafo + divisor', () => {
    const root = treeFor('Processo autotrófico.\n---\n\nDepois.')
    expect(topLevel(root)).toEqual([
      { type: 'paragraph', depth: undefined, start: 1, end: 1 },
      { type: 'thematicBreak', depth: undefined, start: 2, end: 2 },
      { type: 'paragraph', depth: undefined, start: 4, end: 4 },
    ])
  })

  it('preserva o negrito inline e nao grifa a linha inteira', () => {
    const root = treeFor('O processo é **autotrófico**.\n---')
    const [paragraph] = topLevel(root)
    expect(paragraph.type).toBe('paragraph')
    // Nenhum heading restante e o divisor esta na linha 2.
    expect(root.children?.[1]).toMatchObject({ type: 'thematicBreak' })
    expect(types(root)).not.toContain('heading')
    // O strong permanece dentro do paragrafo (apenas a palavra em negrito).
    const strong = (root.children?.[0] as Node | undefined)?.children?.find((node) => node.type === 'strong')
    expect(strong).toBeDefined()
    expect(strong?.children?.[0]).toMatchObject({ type: 'text', value: 'autotrófico' })
  })

  it('nao altera headings ATX (##) nem setext ===', () => {
    const atx = treeFor('## Titulo\n---')
    expect(types(atx)).toContain('heading')
    // `---` apos heading ATX ja e divisor.
    expect(atx.children?.map((child) => child.type)).toEqual(['heading', 'thematicBreak'])
    const eq = treeFor('Titulo\n===')
    // `===` continua heading de nivel 1.
    expect(eq.children?.map((child) => child.type)).toEqual(['heading'])
    expect(atx.children?.[0]).toMatchObject({ type: 'heading', depth: 2 })
    expect(eq.children?.[0]).toMatchObject({ type: 'heading', depth: 1 })
  })

  it('nao altera linhas de delimitacao de tabelas (com pipes)', () => {
    const root = treeFor('A | B\n--- | ---\n1 | 2')
    expect(types(root)).toContain('table')
    expect(types(root)).not.toContain('thematicBreak')
  })

  it('preserva o numero de linhas: o divisor ocupa a propria linha do ---', () => {
    const root = treeFor('Texto\n---\n\n- [ ] tarefa')
    const top = topLevel(root)
    // O paragrafo fica na linha 1, o divisor na linha 2 e a lista continua na
    // linha 4 — nenhuma linha foi inserida ou removida (mapeamento dos
    // checklists preservado).
    expect(top).toEqual([
      { type: 'paragraph', depth: undefined, start: 1, end: 1 },
      { type: 'thematicBreak', depth: undefined, start: 2, end: 2 },
      { type: 'list', depth: undefined, start: 4, end: 4 },
    ])
    // O checkbox dentro da lista mantem a linha 4 (nao deslocada).
    const listItem = root.children?.[2]?.children?.[0] as Node | undefined
    expect(listItem?.position?.start.line).toBe(4)
  })
})
