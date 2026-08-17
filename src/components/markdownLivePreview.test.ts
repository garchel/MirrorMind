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

  it('o bullet de tarefa nao sobrepoe o marcador [x] (para o checkbox renderizar)', () => {
    const text = '- [x] feita'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const task = mask.tokens.find((token) => token.kind === 'task')!
    const bullet = mask.tokens.find((token) => token.kind === 'bullet')!
    // O bullet cobre apenas o marcador da lista; o `[x]` fica com o checkbox
    // (antes o bullet se estendia ate o fim do colchetes e o escondia).
    expect(bullet.to).toBeLessThanOrEqual(task.from)
    expect(text.slice(bullet.from, bullet.to)).toBe('- ')
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

  it('detecta matematica inline e em bloco (KaTeX)', () => {
    const text = 'Formula $E = mc^2$ no texto e $$\\int x\\, dx$$ em bloco.'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const math = mask.tokens.filter((token) => token.kind === 'math') as Array<Extract<MaskToken, { kind: 'math' }>>
    expect(math).toHaveLength(2)
    const inline = math.find((token) => !token.displayMode)
    const display = math.find((token) => token.displayMode)
    expect(text.slice(inline!.from, inline!.to)).toBe('$E = mc^2$')
    expect(inline!.source).toBe('E = mc^2')
    expect(text.slice(display!.from, display!.to)).toBe('$$\\int x\\, dx$$')
  })

  it('detecta matematica em bloco multilinha com um unico token', () => {
    const text = '$$\n6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\rightarrow \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2\n$$'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const math = mask.tokens.find((token): token is Extract<MaskToken, { kind: 'math' }> => token.kind === 'math')
    expect(math).toBeTruthy()
    expect(math!.displayMode).toBe(true)
    expect(text.slice(math!.from, math!.to)).toBe(text)
    expect(math!.source).toContain('\\text{CO}_2')
  })

  it('nao detecta matematica dentro de codigo inline, cercado ou frontmatter', () => {
    const text = '---\ntags: [$a$]\n---\n\n`$x$`\n\n```\n$y$\n```\n\n$z$'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const math = mask.tokens.filter((token) => token.kind === 'math') as Array<Extract<MaskToken, { kind: 'math' }>>
    expect(math).toHaveLength(1)
    expect(math[0].source).toBe('z')
  })

  it('detecta divisor horizontal (---) como linha grafica', () => {
    const text = 'Texto\n\n---\n\nOutro'
    const mask = findTreeMaskTokens(treeOf(text), docOf(text))
    const hr = mask.tokens.find((token) => token.kind === 'hr')
    expect(hr).toBeTruthy()
    expect(text.slice(hr!.from, hr!.to)).toBe('---')
  })

  it('trata o sublinhado setext --- (sem linha em branco) como divisor horizontal', () => {
    // `---` logo apos um paragrafo vira sublinhado de heading setext no parser;
    // quem escreve `---` quer um divisor, entao o trecho vira linha grafica.
    const setext = 'Titulo\n---'
    const mask = findTreeMaskTokens(treeOf(setext), docOf(setext))
    const hr = mask.tokens.find((token) => token.kind === 'hr')
    expect(hr).toBeTruthy()
    expect(setext.slice(hr!.from, hr!.to)).toBe('---')
  })

  it('trata o sublinhado setext === como heading de nivel 1 com o marcador oculto', () => {
    const setext = 'Titulo\n==='
    const mask = findTreeMaskTokens(treeOf(setext), docOf(setext))
    const heading = mask.tokens.find((token) => token.kind === 'heading')
    expect(heading).toBeTruthy()
    expect(heading!.level).toBe(1)
    expect(setext.slice(heading!.from, heading!.textTo)).toBe('Titulo')
    // O marcador (===) fica na faixa de revelacao, oculto quando nao tocado.
    expect(setext.slice(heading!.revealFrom, heading!.revealTo)).toBe('===')
  })

  it('nao trata frontmatter como divisor horizontal', () => {
    const fm = '---\ntags: [a, b]\n---\n\n# Titulo'
    const maskFm = findTreeMaskTokens(treeOf(fm), docOf(fm))
    expect(maskFm.tokens.some((token) => token.kind === 'hr')).toBe(false)
    expect(maskFm.frontmatterLines.size).toBe(3)
    expect(maskFm.tokens.filter((token) => token.kind === 'heading')).toHaveLength(1)
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
