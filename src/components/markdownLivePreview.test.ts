import { describe, expect, it } from 'vitest'
import { parser, GFM } from '@lezer/markdown'
import { findMaskTokens, findTreeMaskTokens, isTokenAdjacentToCaret, type MaskToken } from './markdownLivePreview'

type InlineToken = Extract<MaskToken, { innerFrom: number }>

function treeOf(text: string) {
  return parser.configure([GFM]).parse(text)
}

const docOf = (text: string) => ({
  toString: () => text,
  lineAt: (pos: number) => {
    const upto = Math.max(0, Math.min(pos, text.length))
    let line = 1
    let start = 0
    for (let index = 0; index < upto; index += 1) {
      if (text[index] === '\n') {
        line += 1
        start = index + 1
      }
    }
    const nextBreak = text.indexOf('\n', upto)
    return { number: line, from: start, to: nextBreak === -1 ? text.length : nextBreak }
  },
})

describe('findTreeMaskTokens', () => {
  it('detecta titulo com nivel e marcador (incluindo o espaco)', () => {
    const text = '## Titulo'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const heading = mask.tokens.find((token) => token.kind === 'heading')
    expect(heading).toBeTruthy()
    expect(heading!.level).toBe(2)
    expect(text.slice(heading!.from, heading!.textFrom)).toBe('## ')
  })

  it('detecta negrito, italico, riscado, codigo e link com ranges internos', () => {
    const text = '**neg** *it* ~~ris~~ `cod` [tex](url)'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const inline = (kind: InlineToken['kind']) => mask.tokens.find((token): token is InlineToken => token.kind === kind)

    const bold = inline('bold')
    expect(text.slice(bold!.from, bold!.to)).toBe('**neg**')
    expect(text.slice(bold!.innerFrom, bold!.innerTo)).toBe('neg')

    const italic = inline('italic')
    expect(text.slice(italic!.innerFrom, italic!.innerTo)).toBe('it')

    const strike = inline('strike')
    expect(text.slice(strike!.innerFrom, strike!.innerTo)).toBe('ris')

    const code = inline('code')
    expect(text.slice(code!.innerFrom, code!.innerTo)).toBe('cod')

    const link = inline('link')
    expect(text.slice(link!.innerFrom, link!.innerTo)).toBe('tex')
  })

  it('detecta lista aninhada e citacao', () => {
    const text = '- item\n  - sub\n> citacao'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    expect(mask.tokens.filter((token) => token.kind === 'bullet')).toHaveLength(2)
    expect(mask.tokens.some((token) => token.kind === 'quote')).toBe(true)
  })

  it('detecta tarefa com checkbox (marcado e desmarcado)', () => {
    const text = '- [x] feita\n- [ ] pendente'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const tasks = mask.tokens.filter((token) => token.kind === 'task') as Array<Extract<MaskToken, { kind: 'task' }>>
    expect(tasks).toHaveLength(2)
    expect(tasks[0].checked).toBe(true)
    expect(tasks[1].checked).toBe(false)
    expect(text.slice(tasks[0].from, tasks[0].to)).toBe('[x]')
  })

  it('detecta bloco de codigo com fence e marca as linhas como fenced', () => {
    const text = '```js\nconst x = 1\n```'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const fence = mask.tokens.find((token) => token.kind === 'fence')
    expect(fence).toBeTruthy()
    expect(text.slice(fence!.openFrom, fence!.openTo)).toBe('```')
    expect(text.slice(fence!.closeFrom, fence!.closeTo)).toBe('```')
    expect(mask.fencedLines.size).toBe(3)
    expect(mask.tokens.some((token) => token.kind === 'bold')).toBe(false)
  })

  it('detecta tabela GFM: linha de delimitadores e pipes nas linhas', () => {
    const text = '| A | B |\n|---|---|\n| 1 | 2 |'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    expect(mask.tableLines.size).toBe(3)
    const rows = mask.tokens.filter((token) => token.kind === 'tableRow')
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.from < row.to)).toBe(true)
    expect(text.slice(rows[0].from, rows[0].to)).toContain('| A | B |')
    expect(text.slice(rows[1].from, rows[1].to)).toContain('| 1 | 2 |')
  })

  it('nao gera tokens inline dentro de blocos de codigo', () => {
    const text = '```\n**nao deve ser mascado**\n```'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    expect(mask.tokens.some((token) => token.kind === 'bold')).toBe(false)
  })
})

describe('findMaskTokens (fallback)', () => {
  it('detecta wikilink e marcadores de bloco', () => {
    const wikilink = findMaskTokens('[[alvo]]', 0).find((token) => token.kind === 'wikilink') as InlineToken
    expect(wikilink).toBeTruthy()
    expect(wikilink.innerFrom === wikilink.from + 2).toBe(true)
    expect(findMaskTokens('# Titulo', 0).some((token) => token.kind === 'heading')).toBe(true)
    expect(findMaskTokens('- item', 0).some((token) => token.kind === 'bullet')).toBe(true)
    expect(findMaskTokens('> citacao', 0).some((token) => token.kind === 'quote')).toBe(true)
  })
})

describe('desempenho com notas grandes', () => {
  it('processa uma nota com milhares de linhas sem estourar o tempo', () => {
    const parts: string[] = []
    for (let index = 0; index < 2_000; index += 1) {
      parts.push(`## Seção ${index}\n\nTexto **negrito** com [[wikilink-${index}]] e \`código\`.\n\n- item ${index}\n  - subitem\n\n> citação ${index}\n`)
    }
    const text = parts.join('\n')
    const started = performance.now()
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const elapsed = performance.now() - started
    expect(mask.tokens.length).toBeGreaterThan(2_000)
    expect(mask.fencedLines.size).toBe(0)
    expect(mask.tokens.some((token) => token.kind === 'heading')).toBe(true)
    expect(mask.tokens.some((token) => token.kind === 'bold')).toBe(true)
    // Limite generoso: a mascara por arvore deve ser sublinear na pratica.
    expect(elapsed).toBeLessThan(5_000)
  })
})

describe('isTokenAdjacentToCaret', () => {
  const mask = findTreeMaskTokens(treeOf('**negrito**'), docOf('**negrito**'))
  const bold = mask.tokens.find((token): token is InlineToken => token.kind === 'bold')!

  it('revela quando o cursor esta dentro do token', () => {
    expect(isTokenAdjacentToCaret(bold, 5)).toBe(true)
  })

  it('revela quando o cursor esta imediatamente antes ou depois do token', () => {
    expect(isTokenAdjacentToCaret(bold, bold.revealFrom)).toBe(true)
    expect(isTokenAdjacentToCaret(bold, bold.revealTo)).toBe(true)
  })

  it('mascara quando o cursor esta longe do token', () => {
    expect(isTokenAdjacentToCaret(bold, 50)).toBe(false)
  })
})
