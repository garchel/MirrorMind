import katex from 'katex'
import { RangeSet, StateField } from '@codemirror/state'
import type { Range, Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'

// Live preview (modo Misto): a sintaxe Markdown e mascarada como formatacao
// (negrito, italico, codigo, titulos, tabelas, matematica KaTeX, divisores...),
// e apenas o token adjacente ao cursor (antes ou depois dele) e exibido em
// Markdown cru — o resto da nota permanece com a aparencia formatada, como no
// modo Leitura do Obsidian.
//
// A mascara e derivada da arvore sintatica real do parser Lezer (GFM) do
// CodeMirror, o mesmo parser que renderiza o modo Leitura. Tabelas, tarefas,
// blocos de codigo, listas aninhadas, citacoes e divisores usam as faixas
// exatas dos nos; wikilinks `[[...]]` e matematica (que o parser base nao
// cobre) usam regex com regras de exclusao (frontmatter, blocos de codigo e
// spans de codigo).

export type MaskToken =
  | { kind: 'bold' | 'italic' | 'strike' | 'code' | 'wikilink' | 'link'; from: number; to: number; innerFrom: number; innerTo: number; revealFrom: number; revealTo: number }
  | { kind: 'heading'; level: number; from: number; to: number; textFrom: number; textTo: number; revealFrom: number; revealTo: number }
  | { kind: 'quote' | 'bullet'; from: number; to: number; textFrom: number; textTo: number; revealFrom: number; revealTo: number }
  | { kind: 'task'; from: number; to: number; checked: boolean; revealFrom: number; revealTo: number }
  | { kind: 'fence'; from: number; to: number; openFrom: number; openTo: number; contentFrom: number; contentTo: number; closeFrom: number; closeTo: number; revealFrom: number; revealTo: number }
  | { kind: 'tableRow'; from: number; to: number; isDelimiter: boolean; revealFrom: number; revealTo: number }
  | { kind: 'math'; from: number; to: number; source: string; displayMode: boolean; revealFrom: number; revealTo: number }
  | { kind: 'hr'; from: number; to: number; revealFrom: number; revealTo: number }

type InlineKind = 'bold' | 'italic' | 'strike' | 'code' | 'wikilink' | 'link'

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g

// Matematica: bloco $$...$$ pode cruzar linhas; inline $...$ nunca cruza.
const DISPLAY_MATH_RE = /\$\$([\s\S]*?)\$\$/g
const INLINE_MATH_RE = /\$(?!\$)([^$\n]+?)\$(?!\$)/g

// Mesmo formato de frontmatter usado em src/lib/markdown.ts: o YAML inicial
// permanece cru (nao e mascarado, inclusive os marcadores ---).
const FRONTMATTER_RE = /^---(?:\r?\n)[\s\S]*?(?:\r?\n)---(?:\r?\n)?/

// Encontra os tokens mascaraveis de uma linha por regex. Usado como fallback
// para wikilinks e em testes unitarios.
export function findMaskTokens(lineText: string, lineStart: number): MaskToken[] {
  const tokens: MaskToken[] = []
  const lineEnd = lineStart + lineText.length

  const blockMatch = lineText.match(/^(#{1,6})(\s+)/)
  if (blockMatch) {
    const markerFrom = lineStart
    const markerTo = lineStart + blockMatch[0].length
    tokens.push({
      kind: 'heading',
      level: blockMatch[1].length,
      from: markerFrom,
      to: markerTo,
      textFrom: markerTo,
      textTo: lineEnd,
      revealFrom: markerFrom,
      revealTo: markerTo,
    })
  } else {
    const quoteMatch = lineText.match(/^(>+\s*)/)
    if (quoteMatch) {
      const markerFrom = lineStart
      const markerTo = lineStart + quoteMatch[0].length
      tokens.push({
        kind: 'quote',
        from: markerFrom,
        to: markerTo,
        textFrom: markerTo,
        textTo: lineEnd,
        revealFrom: markerFrom,
        revealTo: markerTo,
      })
    } else {
      const bulletMatch = lineText.match(/^(\s*)([-*+])(\s+)/)
      if (bulletMatch) {
        const markerFrom = lineStart
        const markerTo = lineStart + bulletMatch[0].length
        tokens.push({
          kind: 'bullet',
          from: markerFrom,
          to: markerTo,
          textFrom: markerTo,
          textTo: lineEnd,
          revealFrom: markerFrom,
          revealTo: markerTo,
        })
      }
    }
  }

  for (const match of lineText.matchAll(WIKILINK_RE)) {
    const matchIndex = match.index ?? 0
    const fullFrom = lineStart + matchIndex
    const fullTo = fullFrom + match[0].length
    const innerText = match[1]
    const innerFrom = fullFrom + match[0].indexOf(innerText)
    const innerTo = innerFrom + innerText.length
    tokens.push({
      kind: 'wikilink',
      from: fullFrom,
      to: fullTo,
      innerFrom,
      innerTo,
      revealFrom: fullFrom,
      revealTo: fullTo,
    })
  }

  return tokens
}

// --- Derivacao da arvore sintatica -------------------------------------------------

function markChildren(node: { getChildren: (name: string) => Array<{ from: number; to: number }> }, name: string) {
  return node.getChildren(name)
}

function inlineToken(kind: InlineKind, from: number, to: number, innerFrom: number, innerTo: number): MaskToken {
  return { kind, from, to, innerFrom, innerTo, revealFrom: from, revealTo: to }
}

type TreeMask = {
  tokens: MaskToken[]
  /** Linhas dentro de blocos de codigo (a partir de 1) — nada e mascarado nelas. */
  fencedLines: Set<number>
  /** Linhas dentro de tabelas (a partir de 1) — pipes e linha de delimitadores sao mascarados. */
  tableLines: Set<number>
  /** Linhas do frontmatter YAML inicial (a partir de 1) — ficam cruas. */
  frontmatterLines: Set<number>
}

function isFencedLine(lineNumber: number, fencedLines: Set<number>) {
  return fencedLines.has(lineNumber)
}

function lineNumberAt(doc: { lineAt: (pos: number) => { number: number } }, pos: number) {
  return doc.lineAt(pos).number
}

function rangesOverlap(from: number, to: number, ranges: Array<{ from: number; to: number }>) {
  return ranges.some((range) => from < range.to && range.from < to)
}

/** Extrai os tokens mascaraveis da arvore sintatica (GFM) do documento. */
export function findTreeMaskTokens(tree: Tree, doc: { toString: () => string; lineAt: (pos: number) => { number: number; to: number } }): TreeMask {
  const text = doc.toString()
  const mask: TreeMask = {
    tokens: [],
    fencedLines: new Set<number>(),
    tableLines: new Set<number>(),
    frontmatterLines: new Set<number>(),
  }

  const frontmatter = text.match(FRONTMATTER_RE)
  let frontmatterEnd = 0
  if (frontmatter) {
    frontmatterEnd = frontmatter[0].length
    const startLine = 1
    const endLine = lineNumberAt(doc, Math.max(0, frontmatterEnd - 1))
    for (let line = startLine; line <= endLine; line += 1) mask.frontmatterLines.add(line)
  }

  const addLineRange = (kind: 'fence' | 'table', from: number, to: number) => {
    const startLine = lineNumberAt(doc, from)
    const endLine = lineNumberAt(doc, Math.max(from, to - 1))
    const target = kind === 'fence' ? mask.fencedLines : mask.tableLines
    for (let line = startLine; line <= endLine; line += 1) target.add(line)
  }

  // Estende o marcador para incluir o espaco(s) que o segue, mantendo a
  // mascara da arvore com a mesma aparicao do modo Leitura.
  const extendMarker = (markTo: number) => {
    let end = markTo
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end += 1
    return end
  }

  // Spans de codigo inline: matematica dentro deles nao deve ser mascarada.
  const codeRanges: Array<{ from: number; to: number }> = []

  tree.iterate({
    enter: (node) => {
      const type = node.type.name
      const from = node.from
      const to = node.to

      // Frontmatter: nada dentro do bloco YAML inicial e mascarado. Usa o
      // deslocamento (contiguo desde o inicio) para evitar O(n) por no.
      if (type !== 'Document' && frontmatterEnd > 0 && from < frontmatterEnd) {
        return false
      }

      if (type === 'FencedCode') {
        const marks = markChildren(node.node, 'CodeMark')
        const content = node.node.getChildren('CodeText')[0]
        addLineRange('fence', from, to)
        mask.tokens.push({
          kind: 'fence',
          from,
          to,
          openFrom: marks[0]?.from ?? from,
          openTo: marks[0]?.to ?? from,
          contentFrom: content?.from ?? from,
          contentTo: content?.to ?? from,
          closeFrom: marks[1]?.from ?? to,
          closeTo: marks[1]?.to ?? to,
          revealFrom: from,
          revealTo: to,
        })
        return
      }

      if (type === 'Table') {
        addLineRange('table', from, to)
        return
      }

      if (type === 'HorizontalRule') {
        mask.tokens.push({ kind: 'hr', from, to, revealFrom: from, revealTo: to })
        return
      }

      // Sem linha em branco antes, `---` apos um paragrafo vira o sublinhado
      // de um heading setext no parser — mas quem escreve `---` quer um
      // divisor. Renderiza o sublinhado como linha grafica (mesmo visual de
      // um HorizontalRule).
      if (type === 'SetextHeading2') {
        const mark = markChildren(node.node, 'HeaderMark')[0]
        const markFrom = mark?.from ?? from
        const markTo = mark?.to ?? to
        mask.tokens.push({ kind: 'hr', from: markFrom, to: markTo, revealFrom: markFrom, revealTo: markTo })
        return
      }

      // `===` apos um paragrafo: heading de nivel 1, como no modo Leitura.
      // O sublinhado fica oculto; o cursor sobre ele revela o Markdown cru.
      if (type === 'SetextHeading1') {
        const mark = markChildren(node.node, 'HeaderMark')[0]
        const markFrom = mark?.from ?? to
        const markTo = mark?.to ?? to
        mask.tokens.push({
          kind: 'heading',
          level: 1,
          from,
          to,
          textFrom: from,
          textTo: Math.max(from, markFrom - 1),
          revealFrom: markFrom,
          revealTo: markTo,
        })
        return
      }

      if (type === 'ATXHeading1' || type === 'ATXHeading2' || type === 'ATXHeading3' ||
          type === 'ATXHeading4' || type === 'ATXHeading5' || type === 'ATXHeading6') {
        const mark = markChildren(node.node, 'HeaderMark')[0]
        const markerFrom = mark?.from ?? from
        const markerTo = mark ? extendMarker(mark.to) : to
        mask.tokens.push({
          kind: 'heading',
          level: Number(type.slice(-1)),
          from,
          to,
          textFrom: markerTo,
          textTo: to,
          revealFrom: markerFrom,
          revealTo: markerTo,
        })
        return
      }

      if (type === 'Blockquote') {
        const mark = markChildren(node.node, 'QuoteMark')[0]
        const markerFrom = mark?.from ?? from
        const markerTo = mark ? extendMarker(mark.to) : to
        mask.tokens.push({
          kind: 'quote',
          from,
          to,
          textFrom: markerTo,
          textTo: to,
          revealFrom: markerFrom,
          revealTo: markerTo,
        })
        return
      }

      if (type === 'ListItem') {
        const mark = markChildren(node.node, 'ListMark')[0]
        if (!mark) return
        const task = node.node.getChildren('Task')[0]
        let markerEnd = extendMarker(mark.to)
        if (task) {
          const taskMark = task.getChildren('TaskMarker')[0]
          markerEnd = taskMark?.to ?? markerEnd
        }
        mask.tokens.push({
          kind: 'bullet',
          from: mark.from,
          to: markerEnd,
          textFrom: markerEnd,
          textTo: to,
          revealFrom: mark.from,
          revealTo: markerEnd,
        })
        if (task) {
          const taskMark = task.getChildren('TaskMarker')[0]
          if (taskMark) {
            mask.tokens.push({
              kind: 'task',
              from: taskMark.from,
              to: taskMark.to,
              checked: text.slice(taskMark.from, taskMark.to).toLowerCase().includes('x'),
              revealFrom: taskMark.from,
              revealTo: taskMark.to,
            })
          }
        }
        return
      }

      if (type === 'Emphasis' || type === 'StrongEmphasis' || type === 'Strikethrough' || type === 'InlineCode' || type === 'Link') {
        if (type === 'InlineCode') {
          codeRanges.push({ from, to })
        }
        const marks = markChildren(node.node, type === 'Emphasis' || type === 'StrongEmphasis'
          ? 'EmphasisMark'
          : type === 'Strikethrough' ? 'StrikethroughMark' : 'CodeMark')
        const linkMarks = type === 'Link' ? markChildren(node.node, 'LinkMark') : []
        const first = linkMarks[0] ?? marks[0]
        const last = linkMarks[1] ?? marks[marks.length - 1]
        if (!first || !last || last.to <= first.from) return
        const innerFrom = first.to
        const innerTo = last.from
        let kind: InlineKind
        if (type === 'StrongEmphasis') kind = 'bold'
        else if (type === 'Emphasis') kind = 'italic'
        else if (type === 'Strikethrough') kind = 'strike'
        else if (type === 'InlineCode') kind = 'code'
        else kind = 'link'
        mask.tokens.push(inlineToken(kind, from, to, innerFrom, innerTo))
        return
      }

      if (type === 'TableHeader' || type === 'TableRow') {
        const rowFrom = from
        // Limita o token a propria linha para nunca incluir a quebra de linha.
        const rowTo = Math.min(to, doc.lineAt(rowFrom).to)
        mask.tokens.push({
          kind: 'tableRow',
          from: rowFrom,
          to: rowTo,
          isDelimiter: false,
          revealFrom: rowFrom,
          revealTo: rowTo,
        })
      }
    },
  })

  // Matematica em bloco: $$...$$ (pode cruzar linhas), fora de frontmatter,
  // blocos de codigo, tabelas e spans de codigo.
  const displayRanges: Array<{ from: number; to: number }> = []
  const inProtectedLines = (from: number, to: number) => {
    const startLine = lineNumberAt(doc, from)
    const endLine = lineNumberAt(doc, Math.max(from, to - 1))
    for (let line = startLine; line <= endLine; line += 1) {
      if (mask.fencedLines.has(line) || mask.frontmatterLines.has(line) || mask.tableLines.has(line)) return true
    }
    return false
  }

  for (const match of text.matchAll(DISPLAY_MATH_RE)) {
    const matchIndex = match.index ?? 0
    const from = matchIndex
    const to = matchIndex + match[0].length
    if (inProtectedLines(from, to) || rangesOverlap(from, to, codeRanges)) continue
    displayRanges.push({ from, to })
    mask.tokens.push({
      kind: 'math',
      from,
      to,
      source: match[1],
      displayMode: true,
      revealFrom: from,
      revealTo: to,
    })
  }

  for (const match of text.matchAll(INLINE_MATH_RE)) {
    const matchIndex = match.index ?? 0
    const from = matchIndex
    const to = matchIndex + match[0].length
    const line = lineNumberAt(doc, from)
    if (mask.fencedLines.has(line) || mask.frontmatterLines.has(line)) continue
    if (rangesOverlap(from, to, displayRanges) || rangesOverlap(from, to, codeRanges)) continue
    mask.tokens.push({
      kind: 'math',
      from,
      to,
      source: match[1],
      displayMode: false,
      revealFrom: from,
      revealTo: to,
    })
  }

  return mask
}

export function isTokenAdjacentToCaret(token: MaskToken, caret: number) {
  return caret >= token.revealFrom - 1 && caret <= token.revealTo + 1
}

/**
 * O cursor so revela o Markdown cru de um elemento quando esta NA MESMA LINHA
 * do elemento (tocando-o). Cursor em linha em branco ou vizinha nao revela
 * nada das linhas adjacentes — a tolerancia de +/-1 posicao de
 * `isTokenAdjacentToCaret` atravessa quebras de linha, entao a linha do cursor
 * e comparada com a faixa de linhas do token. Tokens multilinha (fence,
 * formula $$...$$) revelam quando o cursor esta em qualquer linha interna.
 */
function isTokenRevealed(token: MaskToken, carets: number[], doc: Text) {
  if (!carets.some((caret) => isTokenAdjacentToCaret(token, caret))) return false
  const firstLine = lineNumberAt(doc, token.from)
  const lastLine = lineNumberAt(doc, Math.max(token.from, token.to - 1))
  return carets.some((caret) => {
    const caretLine = lineNumberAt(doc, caret)
    return caretLine >= firstLine && caretLine <= lastLine
  })
}

const hidden = Decoration.replace({})

const strongMark = Decoration.mark({ class: 'cm-live-strong' })
const emMark = Decoration.mark({ class: 'cm-live-em' })
const strikeMark = Decoration.mark({ class: 'cm-live-strike' })
const codeMark = Decoration.mark({ class: 'cm-live-code' })
const linkMark = Decoration.mark({ class: 'cm-live-link' })
const quoteMark = Decoration.mark({ class: 'cm-live-quote' })
const fenceContentMark = Decoration.mark({ class: 'cm-live-fence-content' })
const headingMarks = [1, 2, 3, 4, 5, 6].map((level) => Decoration.mark({ class: `cm-live-heading cm-live-h${level}` }))

// Linhas intermediarias de uma formula multilinha: colapsadas para zero altura.
const mathCollapsedLine = Decoration.line({ class: 'cm-live-math-collapsed' })

class BulletWidget extends WidgetType {
  private readonly marker: string

  constructor(marker: string) {
    super()
    this.marker = marker
  }

  eq(other: BulletWidget) { return other.marker === this.marker }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-bullet'
    span.textContent = this.marker
    return span
  }

  ignoreEvent() { return true }
}

class CheckboxWidget extends WidgetType {
  private readonly checked: boolean

  constructor(checked: boolean) {
    super()
    this.checked = checked
  }

  eq(other: CheckboxWidget) { return other.checked === this.checked }

  toDOM() {
    const span = document.createElement('span')
    span.className = `cm-live-checkbox${this.checked ? ' is-checked' : ''}`
    span.setAttribute('role', 'checkbox')
    span.setAttribute('aria-checked', String(this.checked))
    return span
  }

  ignoreEvent() { return true }
}

// Renderiza a formula com KaTeX no lugar do codigo-fonte `$...$` / `$$...$$`.
class MathWidget extends WidgetType {
  private readonly source: string
  private readonly displayMode: boolean

  constructor(source: string, displayMode: boolean) {
    super()
    this.source = source
    this.displayMode = displayMode
  }

  eq(other: MathWidget) { return other.source === this.source && other.displayMode === this.displayMode }

  toDOM() {
    const span = document.createElement('span')
    span.className = `cm-live-math${this.displayMode ? ' cm-live-math-display' : ''}`
    span.innerHTML = katex.renderToString(this.source, {
      displayMode: this.displayMode,
      output: 'html',
      throwOnError: false,
    })
    return span
  }

  ignoreEvent() { return true }
}

// Divisor horizontal (---): vira uma linha grafica, como <hr> no modo Leitura.
class HrWidget extends WidgetType {
  eq(_other: HrWidget) { return true }

  toDOM() {
    const div = document.createElement('div')
    div.className = 'cm-live-hr'
    div.setAttribute('role', 'separator')
    return div
  }

  ignoreEvent() { return true }
}

type DecorRange = { from: number; to: number; decoration: Decoration }

/**
 * Decoracoes de uma formula: inline em uma unica linha ou, quando o bloco
 * $$...$$ cruza linhas, o widget renderizado na primeira linha com as demais
 * linhas ocultas e colapsadas. Plugins do CodeMirror nao podem substituir
 * quebras de linha, entao cada replace fica dentro de uma unica linha.
 */
function mathDecorations(token: Extract<MaskToken, { kind: 'math' }>, doc: Text): DecorRange[] {
  const firstLine = doc.lineAt(token.from)
  const lastLine = doc.lineAt(token.to - 1)
  const widget: DecorRange = {
    from: token.from,
    to: firstLine.number === lastLine.number ? token.to : firstLine.to,
    decoration: Decoration.replace({ widget: new MathWidget(token.source, token.displayMode) }),
  }
  if (firstLine.number === lastLine.number) return [widget]

  const ranges: DecorRange[] = [widget]
  for (let lineNumber = firstLine.number + 1; lineNumber <= lastLine.number; lineNumber += 1) {
    const line = doc.line(lineNumber)
    ranges.push(
      { from: line.from, to: line.to, decoration: hidden },
      { from: line.from, to: line.from, decoration: mathCollapsedLine },
    )
  }
  return ranges
}

function tokenDecorations(token: MaskToken, doc: Text): DecorRange[] {
  switch (token.kind) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code':
    case 'wikilink':
    case 'link': {
      const contentMark = token.kind === 'bold' ? strongMark
        : token.kind === 'italic' ? emMark
          : token.kind === 'strike' ? strikeMark
            : token.kind === 'code' ? codeMark
              : linkMark
      return [
        { from: token.from, to: token.innerFrom, decoration: hidden },
        { from: token.innerFrom, to: token.innerTo, decoration: contentMark },
        { from: token.innerTo, to: token.to, decoration: hidden },
      ]
    }
    case 'heading': {
      // O marcador pode estar no inicio (ATX `#`) ou no fim (setext `===`).
      // Ranges vazios de replace sao invalidos no CodeMirror (lancam erro e
      // derrubam o conjunto inteiro), entao cada faixa so entra quando nao vazia.
      const headingRanges: DecorRange[] = []
      if (token.textFrom > token.from) headingRanges.push({ from: token.from, to: token.textFrom, decoration: hidden })
      headingRanges.push({ from: token.textFrom, to: token.textTo, decoration: headingMarks[token.level - 1] ?? headingMarks[0] })
      // Sublinhado setext (===) no fim: oculto sem cruzar a quebra de linha
      // (textTo exclui o \n; ATX nao ativa este trecho).
      if (token.revealFrom > token.textTo) headingRanges.push({ from: token.revealFrom, to: token.revealTo, decoration: hidden })
      return headingRanges
    }
    case 'quote':
      return [
        { from: token.from, to: token.textFrom, decoration: hidden },
        { from: token.textFrom, to: token.textTo, decoration: quoteMark },
      ]
    case 'bullet':
      // So o marcador vira o bullet; o texto da linha permanece com a cor normal.
      return [{ from: token.from, to: token.to, decoration: Decoration.replace({ widget: new BulletWidget('•') }) }]
    case 'task':
      return [{ from: token.from, to: token.to, decoration: Decoration.replace({ widget: new CheckboxWidget(token.checked) }) }]
    case 'fence': {
      // Replaces `hidden` NUNCA cruzam quebras de linha: o CodeMirror proibe
      // substituir quebras de linha via plugins (RangeError). O conteudo fica
      // na propria marca (pode cruzar linhas); as faixas de ocultacao ficam
      // dentro de UMA linha — o resto da linha de abertura e o inicio da
      // linha de fechamento. Faixas vazias sao descartadas (tambem invalidas).
      const openLineTo = doc.lineAt(token.openTo).to
      const closeLineFrom = doc.lineAt(token.closeFrom).from
      const hideAfterOpenTo = Math.min(token.contentFrom, openLineTo)
      const hideBeforeCloseFrom = Math.max(token.contentTo, closeLineFrom)
      return [
        { from: token.openFrom, to: token.openTo, decoration: hidden },
        { from: token.openTo, to: hideAfterOpenTo, decoration: hidden },
        { from: token.contentFrom, to: token.contentTo, decoration: fenceContentMark },
        { from: hideBeforeCloseFrom, to: token.closeFrom, decoration: hidden },
        { from: token.closeFrom, to: token.closeTo, decoration: hidden },
      ].filter((range) => range.from < range.to)
    }
    case 'tableRow':
      return []
    case 'math':
      return [{ from: token.from, to: token.to, decoration: Decoration.replace({ widget: new MathWidget(token.source, token.displayMode) }) }]
    case 'hr':
      return [{ from: token.from, to: token.to, decoration: Decoration.replace({ widget: new HrWidget() }) }]
  }
}

// --- Tabelas: um <table> real, identico ao modo Leitura ----------------------
//
// A tabela e o UNICO elemento do modo Misto que nunca revela o Markdown cru
// quando o usuario interage com ela: um StateField substitui o range inteiro
// da tabela por um widget de BLOCO que renderiza um <table> real (mesmo CSS
// do modo Leitura), com cabecalho <th>, corpo <tbody>, alinhamento por coluna
// e KaTeX nas celulas. A deteccao e textual (mesmas regras do parser GFM),
// pois StateFields nao tem acesso a view para garantir a arvore sintatica.
//
// Widgets de bloco e replaces que cruzam quebras de linha so podem ser
// fornecidos por StateFields (nao por view plugins) — por isso a tabela vive
// num campo proprio e o ViewPlugin simplesmente pula as linhas cobertas.

export type TableAlignment = 'left' | 'center' | 'right' | null

export type TableCell = {
  /** Conteudo da celula (sem os pipes e sem espacos das bordas). */
  text: string
  align: TableAlignment
  /** Faixa absoluta no documento (inclui os espacos ao redor do conteudo). */
  from: number
  to: number
}

export type TableSpec = {
  /** Inicio do cabecalho (posicao absoluta no documento). */
  from: number
  /** Fim da ultima linha da tabela (posicao absoluta, sem a quebra final). */
  to: number
  header: TableCell[]
  rows: TableCell[][]
}

function splitTableCells(line: string) {
  // Pipes escapados (`\|`) nao separam celulas.
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/g).map((cell) => cell.trim())
}

/** Segmentos de uma linha de tabela entre pipes, com faixas absolutas no
 * documento. Segmentos vazios das bordas (pipes externos) sao descartados. */
function rowCellSegments(lineText: string, lineFrom: number): Array<{ from: number; to: number }> {
  const pipes: number[] = []
  // Pipes escapados (`\|`) nao separam celulas.
  for (const match of lineText.matchAll(/(?<!\\)\|/g)) pipes.push(lineFrom + (match.index ?? 0))
  if (pipes.length === 0) return []
  const segments = [
    { from: lineFrom, to: pipes[0] },
    ...pipes.slice(0, -1).map((pipe, index) => ({ from: pipe + 1, to: pipes[index + 1] })),
    { from: pipes[pipes.length - 1] + 1, to: lineFrom + lineText.length },
  ]
  return segments.filter((segment) => segment.to > segment.from)
}

/** Desescapa `\|` (pipe escapado no markdown) para exibicao/editacao. */
function unescapeCellText(text: string) {
  return text.replace(/\\\|/g, '|')
}

/** Escapa `|` para o markdown quando o usuario digita em uma celula. */
function escapeCellText(text: string) {
  return text.replace(/\|/g, '\\|')
}

/** Linha do cabecalho: contem um pipe e pelo menos uma celula nao vazia. */
function isTableHeaderRow(text: string) {
  if (!text.includes('|')) return false
  return splitTableCells(text).some((cell) => cell.length > 0)
}

function parseAlignment(cell: string): TableAlignment {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
  if (cell.endsWith(':')) return 'right'
  if (cell.startsWith(':')) return 'left'
  return null
}

/** Linha de delimitadores: precisa conter um pipe (senão e setext heading). */
function isDelimiterRow(text: string) {
  if (!text.includes('|')) return false
  const cells = splitTableCells(text)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

/** Linhas que encerram a tabela (inicio de outro elemento de bloco). */
function isTableBlockStart(text: string) {
  if (text.trim() === '') return true
  if (/^\s*(#{1,6}\s|>\s?|[-+*]\s|\d{1,9}[.)]\s|```|~~~)/.test(text)) return true
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) return true
  return false
}

/**
 * Detecta as tabelas GFM do documento por texto, com as mesmas regras do
 * parser Lezer (validado em testes contra a arvore sintatica): linha de
 * cabecalho com pipe, linha de delimitadores com o mesmo numero de celulas e
 * linhas de corpo ate o primeiro inicio de bloco. Ignora frontmatter e blocos
 * de codigo. Tabelas podem comecar logo apos um paragrafo (sem linha em
 * branco) — como no GFM.
 */
/** Fim do frontmatter YAML inicial (offset absoluto, ou 0 se nao houver).
 * Mesmas regras do FRONTMATTER_RE, percorrendo apenas as linhas do bloco —
 * nao copia o documento inteiro (funciona em notas grandes) e tolera CRLF
 * (o Text do CodeMirror mantem o \r no fim da linha). */
function frontmatterEndOffset(doc: Text): number {
  if (doc.lines < 2) return 0
  const first = doc.line(1).text
  if (first !== '---' && first !== '---\r') return 0
  for (let line = 2; line <= doc.lines; line += 1) {
    const text = doc.line(line).text
    if (text === '---' || text === '---\r') return doc.line(line).to
  }
  return 0
}

export function findTableSpecs(doc: Text): TableSpec[] {
  const specs: TableSpec[] = []
  const frontmatterEnd = frontmatterEndOffset(doc)
  const frontmatterLines = new Set<number>()
  if (frontmatterEnd > 0) {
    const endLine = lineNumberAt(doc, Math.max(0, frontmatterEnd - 1))
    for (let line = 1; line <= endLine; line += 1) frontmatterLines.add(line)
  }

  let inFence = false
  let lineNumber = 1
  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber)
    const text = line.text
    if (frontmatterLines.has(lineNumber)) {
      lineNumber += 1
      continue
    }
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      lineNumber += 1
      continue
    }
    if (inFence) {
      lineNumber += 1
      continue
    }
    if (!isTableHeaderRow(text) || lineNumber >= doc.lines) {
      lineNumber += 1
      continue
    }
    const delimiterText = doc.line(lineNumber + 1).text
    if (!isDelimiterRow(delimiterText)) {
      lineNumber += 1
      continue
    }
    const headerCells = splitTableCells(text)
    const delimiterCells = splitTableCells(delimiterText)
    if (delimiterCells.length !== headerCells.length) {
      lineNumber += 1
      continue
    }
    const aligns = delimiterCells.map(parseAlignment)
    const headerSegments = rowCellSegments(text, line.from)
    const header = headerCells.map((cell, index) => ({
      text: unescapeCellText(cell),
      align: aligns[index] ?? null,
      from: headerSegments[index]?.from ?? line.from,
      to: headerSegments[index]?.to ?? line.from,
    }))

    const rows: TableCell[][] = []
    let lastLine = lineNumber + 1
    let cursor = lineNumber + 2
    while (cursor <= doc.lines) {
      const rowText = doc.line(cursor).text
      if (isTableBlockStart(rowText)) break
      const segments = rowCellSegments(rowText, doc.line(cursor).from)
      rows.push(splitTableCells(rowText).map((cell, index) => ({
        text: unescapeCellText(cell),
        align: aligns[index] ?? null,
        from: segments[index]?.from ?? doc.line(cursor).from,
        to: segments[index]?.to ?? doc.line(cursor).from,
      })))
      lastLine = cursor
      cursor += 1
    }

    const lastDocLine = doc.line(lastLine)
    const to = lastDocLine.to < doc.length ? lastDocLine.to + 1 : lastDocLine.to
    specs.push({
      from: line.from,
      to,
      header,
      rows,
    })
    lineNumber = lastLine + 1
  }
  return specs
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Construtos inline suportados nas celulas (mesma aparencia do modo Leitura):
// matematica $...$ (KaTeX), codigo `...`, negrito **...**/__...__, italico
// *...*/_..._ e riscado ~~...~~. As regras de flanco seguem o GFM (sem espaco
// apos a abertura, conteudo sem espacos nas bordas, sublinhado fora de
// palavra). O texto fora dos marcadores e escapado como HTML.
const CELL_INLINE_RE =
  /(\$[^$\n]+\$)|`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|~~([^~\n]+?)~~|(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)|(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g

/** Conteudo de uma celula: formata negrito/italico/codigo/riscado e renderiza
 * matematica $...$ via KaTeX — como o modo Leitura. */
function renderCellHtml(text: string) {
  let html = ''
  let last = 0
  for (const match of text.matchAll(CELL_INLINE_RE)) {
    const full = match[0]
    const index = match.index ?? 0
    html += escapeHtml(text.slice(last, index))
    const [, math, code, boldStars, boldUnders, strike, italicStar, italicUnders] = match
    if (math !== undefined) {
      html += katex.renderToString(math.slice(1, -1), { displayMode: false, output: 'html', throwOnError: false })
    } else if (code !== undefined) {
      html += `<code>${escapeHtml(code)}</code>`
    } else if (boldStars !== undefined || boldUnders !== undefined) {
      html += `<strong>${escapeHtml(boldStars ?? boldUnders ?? '')}</strong>`
    } else if (strike !== undefined) {
      html += `<del>${escapeHtml(strike)}</del>`
    } else if (italicStar !== undefined || italicUnders !== undefined) {
      html += `<em>${escapeHtml(italicStar ?? italicUnders ?? '')}</em>`
    }
    last = index + full.length
  }
  return html + escapeHtml(text.slice(last))
}

/** Tabela editavel: um <table> real (mesma aparencia do modo Leitura) cujas
 * celulas sao editaveis inline. A tabela NUNCA revela o Markdown cru — nem
 * com o cursor ao redor nem dentro dela. Ao clicar numa celula, ela troca o
 * conteudo formatado pelo texto cru (para editar); ao sair, volta a formatar.
 * Cada edicao e sincronizada de volta ao documento por transacoes. */
class TableWidget extends WidgetType {
  private view: EditorView | null = null
  readonly spec: TableSpec

  constructor(spec: TableSpec) {
    super()
    this.spec = spec
  }

  eq(other: TableWidget) {
    return other.spec.from === this.spec.from
      && other.spec.to === this.spec.to
      && tableContent(other.spec) === tableContent(this.spec)
  }

  updateDOM(dom: HTMLElement, view: EditorView) {
    if (!this.sameStructure(dom)) return false
    this.view = view
    ;(dom as unknown as { __liveTableWidget: TableWidget }).__liveTableWidget = this
    this.syncCells(dom)
    return true
  }

  toDOM(view: EditorView) {
    this.view = view
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-table-wrap'
    ;(wrap as unknown as { __liveTableWidget: TableWidget }).__liveTableWidget = this
    wrap.addEventListener('mousedown', (event) => this.onMouseDown(event as MouseEvent), true)
    wrap.addEventListener('focusin', (event) => this.onFocusIn(event as FocusEvent))
    wrap.addEventListener('focusout', (event) => this.onFocusOut(event as FocusEvent))
    wrap.addEventListener('input', (event) => this.onInput(event as InputEvent))
    wrap.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent))
    this.buildTable(wrap)
    return wrap
  }

  ignoreEvent() {
    // Os eventos dentro da tabela sao tratados pelas proprias celulas
    // (contenteditable), nao pelo CodeMirror.
    return true
  }

  private buildTable(wrap: HTMLElement) {
    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    this.spec.header.forEach((cell, col) => headRow.appendChild(this.makeCell('th', cell, 0, col)))
    thead.appendChild(headRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    this.spec.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      row.forEach((cell, col) => tr.appendChild(this.makeCell('td', cell, rowIndex + 1, col)))
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    wrap.appendChild(table)
    this.buildGrips(wrap)
  }

  private makeCell(tag: 'th' | 'td', cell: TableCell, row: number, col: number) {
    const el = document.createElement(tag)
    el.className = 'cm-live-table-cell'
    el.dataset.row = String(row)
    el.dataset.col = String(col)
    el.contentEditable = 'false'
    if (cell.align) el.style.textAlign = cell.align
    el.innerHTML = renderCellHtml(cell.text)
    return el
  }

  private sameStructure(dom: HTMLElement) {
    const rows = dom.querySelectorAll('tbody tr')
    const headCells = dom.querySelectorAll('thead th').length
    return headCells === this.spec.header.length && rows.length === this.spec.rows.length
  }

  /** Atualiza as celulas nao-editadas a partir do novo spec (sem redesenhar). */
  private syncCells(wrap: HTMLElement) {
    const editing = wrap.querySelector('.cm-live-table-cell.is-editing')
    wrap.querySelectorAll<HTMLElement>('th.cm-live-table-cell, td.cm-live-table-cell').forEach((el) => {
      if (el === editing) return
      const row = Number(el.dataset.row)
      const col = Number(el.dataset.col)
      const cell = row === 0 ? this.spec.header[col] : this.spec.rows[row - 1]?.[col]
      if (!cell) return
      if (el.dataset.raw === 'true') {
        if (el.textContent !== cell.text) el.textContent = cell.text
      } else {
        const html = renderCellHtml(cell.text)
        if (el.innerHTML !== html) el.innerHTML = html
      }
      if (cell.align) el.style.textAlign = cell.align
    })
  }

  private cellForEvent(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null
    return target.closest('th.cm-live-table-cell, td.cm-live-table-cell')
  }

  /** Widget ativo da tabela (pode ter sido substituido por updateDOM). */
  private liveWidget(cell: HTMLElement) {
    const wrap = cell.closest('.cm-live-table-wrap') as HTMLElement | null
    return wrap ? (wrap as unknown as { __liveTableWidget?: TableWidget }).__liveTableWidget : undefined
  }

  /** Troca a celula para o modo de edicao (texto cru + contenteditable). */
  private enterEditMode(cell: HTMLElement) {
    if (cell.dataset.raw === 'true') return
    const widget = this.liveWidget(cell) ?? this
    const row = Number(cell.dataset.row)
    const col = Number(cell.dataset.col)
    const tableCell = widget.cellFromSpec(row, col)
    if (!tableCell) return
    cell.dataset.raw = 'true'
    cell.textContent = tableCell.text
    cell.contentEditable = 'true'
    cell.classList.add('is-editing')
  }

  private cellFromSpec(row: number, col: number) {
    return row === 0 ? this.spec.header[col] : this.spec.rows[row - 1]?.[col]
  }

  /** Sai da edicao e reformata a celula a partir do documento atualizado. */
  private exitEditMode(cell: HTMLElement) {
    if (cell.dataset.raw !== 'true') return
    const row = Number(cell.dataset.row)
    const col = Number(cell.dataset.col)
    const widget = this.liveWidget(cell)
    const tableCell = widget?.cellFromSpec(row, col)
    cell.dataset.raw = 'false'
    cell.contentEditable = 'false'
    cell.classList.remove('is-editing')
    if (tableCell) cell.innerHTML = renderCellHtml(tableCell.text)
  }

  private onMouseDown(event: MouseEvent) {
    const cell = this.cellForEvent(event.target)
    if (cell && this.view) this.enterEditMode(cell)
    // Deixa o comportamento padrao colocar o caret no ponto do clique.
  }

  private onFocusIn(event: FocusEvent) {
    const cell = this.cellForEvent(event.target)
    if (cell && this.view) this.enterEditMode(cell)
  }

  private onFocusOut(event: FocusEvent) {
    const cell = this.cellForEvent(event.target)
    if (!cell) return
    const related = event.relatedTarget
    if (related instanceof Node && cell.parentElement?.contains(related)) return
    this.exitEditMode(cell)
  }

  /** Sincroniza o texto digitado de volta ao documento. */
  private onInput(event: InputEvent) {
    const wrap = event.currentTarget as HTMLElement | null
    if (!wrap) return
    const cell = this.cellForEvent(event.target)
    const widget = wrap ? (wrap as unknown as { __liveTableWidget?: TableWidget }).__liveTableWidget : undefined
    if (!cell || !widget || !this.view) return
    const row = Number(cell.dataset.row)
    const col = Number(cell.dataset.col)
    const tableCell = row === 0 ? widget.spec.header[col] : widget.spec.rows[row - 1]?.[col]
    if (!tableCell) return
    const newText = escapeCellText(cell.textContent ?? '')
    const oldText = this.view.state.doc.sliceString(tableCell.from, tableCell.to)
    if (newText !== oldText) {
      this.view.dispatch({ changes: { from: tableCell.from, to: tableCell.to, insert: newText } })
    }
  }

  private focusCell(view: EditorView, row: number, col: number) {
    const el = view.contentDOM.querySelector<HTMLElement>(
      `.cm-live-table-cell[data-row="${row}"][data-col="${col}"]`,
    )
    if (!el) return false
    this.enterEditMode(el)
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return true
  }

  /** Navegacao entre celulas: Tab/Shift+Tab, setas e Enter (nova linha). */
  private onKeyDown(event: KeyboardEvent) {
    const cell = this.cellForEvent(event.target)
    const wrap = event.currentTarget as HTMLElement | null
    const widget = wrap ? (wrap as unknown as { __liveTableWidget?: TableWidget }).__liveTableWidget : undefined
    if (!cell || !widget || !this.view) return

    if (event.key === 'Escape') {
      event.preventDefault()
      cell.blur()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      this.moveTo(cell, widget, event.shiftKey ? -1 : 1, 0)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      this.moveTo(cell, widget, 0, 1)
      return
    }
    if (
      event.key === 'ArrowDown' || event.key === 'ArrowUp'
      || event.key === 'ArrowRight' || event.key === 'ArrowLeft'
    ) {
      // Setas so navegam entre celulas quando o caret esta na borda
      // correspondente da celula; senao o navegador move o caret no texto.
      if (!this.caretAtEdge(cell, event.key)) return
      event.preventDefault()
      const dx = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      const dy = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      this.moveTo(cell, widget, dx, dy)
    }
  }

  /** True se o caret colapsado esta na borda da celula correspondente a seta. */
  private caretAtEdge(cell: HTMLElement, key: string): boolean {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false
    const caret = selection.getRangeAt(0)
    const full = cell.ownerDocument.createRange()
    full.selectNodeContents(cell)
    // Constantes de instancia do Range do DOM (o global Range e importado
    // como tipo do @codemirror/state e nao pode ser usado como valor aqui).
    const atStart = caret.compareBoundaryPoints(caret.START_TO_START, full) === 0
    const atEnd = caret.compareBoundaryPoints(caret.END_TO_END, full) === 0
    if (key === 'ArrowLeft' || key === 'ArrowUp') return atStart
    if (key === 'ArrowRight' || key === 'ArrowDown') return atEnd
    return false
  }

  private moveTo(cell: HTMLElement, widget: TableWidget, colDelta: number, rowDelta: number) {
    if (!this.view) return
    let row = Number(cell.dataset.row)
    let col = Number(cell.dataset.col)
    const maxRow = widget.spec.rows.length
    const maxCol = widget.spec.header.length
    if (colDelta !== 0) {
      col += colDelta
      if (col < 0) {
        col = maxCol - 1
        row -= 1
      } else if (col >= maxCol) {
        col = 0
        row += 1
      }
    }
    row += rowDelta
    if (row < 0) row = 0
    if (row > maxRow) {
      if (rowDelta !== 0) this.addRow(widget, col)
      row = maxRow
    }
    this.focusCell(this.view, row, col)
  }

  /** Insere uma nova linha vazia apos a ultima linha da tabela (Enter). */
  private addRow(widget: TableWidget, col: number) {
    if (!this.view) return
    const change = insertTableRowChange(this.view.state.doc, widget.spec)
    if (!change) return
    this.view.dispatch({ changes: change })
    const focus = () => {
      if (!this.view) return
      const newRow = widget.spec.rows.length + 1
      this.focusCell(this.view, newRow, col)
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus)
    else setTimeout(focus, 0)
  }

  /** Wrap atual da tabela no DOM (pode ter sido redesenhado pelo updateDOM). */
  private currentWrap(): HTMLElement | null {
    if (!this.view) return null
    return this.view.contentDOM.querySelector('.cm-live-table-wrap')
  }

  /** Widget vivo da tabela: o DOM pode ter sido substituido por updateDOM
   * durante uma edicao/arrasto, entao resolve sempre do wrap atual. */
  private currentWidget(): TableWidget {
    const wrap = this.currentWrap()
    const live = wrap
      ? (wrap as unknown as { __liveTableWidget?: TableWidget }).__liveTableWidget
      : undefined
    return live ?? this
  }

  /** Alcas de redimensionamento: borda inferior (linhas), borda direita
   * (colunas) e canto (linhas + colunas). O cursor muda no hover via CSS. */
  private buildGrips(wrap: HTMLElement) {
    const makeGrip = (type: 'row' | 'col' | 'corner') => {
      const grip = document.createElement('div')
      grip.className = 'cm-live-table-grip'
      grip.dataset.grip = type
      grip.title = type === 'row'
        ? 'Arrastar para adicionar/remover linhas'
        : type === 'col'
          ? 'Arrastar para adicionar/remover colunas'
          : 'Arrastar para adicionar/remover linhas e colunas'
      grip.addEventListener('mousedown', (event) => this.startGripDrag(type, event as MouseEvent))
      wrap.appendChild(grip)
    }
    makeGrip('row')
    makeGrip('col')
    makeGrip('corner')
  }

  /** Inicia o arrasto de uma alca: registra a base (linhas/colunas atuais) e
   * as dimensoes de referencia, e segue o mouse ate o mouseup. Cada celula de
   * linha/coluna cruzada adiciona ou remove uma linha/coluna no documento. */
  private startGripDrag(type: 'row' | 'col' | 'corner', event: MouseEvent) {
    // contentDOM desconectado = editor destruido (sem API publica para destroyed).
    if (!this.view || !this.view.contentDOM.isConnected) return
    event.preventDefault()
    event.stopPropagation()
    const widget = this.currentWidget()
    const startX = event.clientX
    const startY = event.clientY
    const baseRows = widget.spec.rows.length
    const baseCols = widget.spec.header.length
    const rowEl = this.view.contentDOM.querySelector('.cm-live-table-wrap tbody tr:last-child')
    const cellEl = this.view.contentDOM.querySelector('.cm-live-table-wrap tbody td:last-child')
      ?? this.view.contentDOM.querySelector('.cm-live-table-wrap thead th:last-child')
    // jsdom nao mede layout: fallback de 24px (linha) e 80px (coluna).
    const rowHeight = rowEl?.getBoundingClientRect().height || 24
    const colWidth = cellEl?.getBoundingClientRect().width || 80
    // Mantem o cursor de redimensionamento e o estado visual mesmo quando o
    // wrap e redesenhado (o DOM novo perde a classe/dataset anteriores).
    const markDrag = () => {
      const wrap = this.currentWrap()
      if (!wrap) return
      wrap.classList.add('resizing')
      wrap.dataset.dragging = type
    }
    const unmarkDrag = () => {
      const wrap = this.currentWrap()
      if (!wrap) return
      wrap.classList.remove('resizing')
      delete wrap.dataset.dragging
    }
    markDrag()
    const onMove = (moveEvent: MouseEvent) => {
      if (!this.view || !this.view.contentDOM.isConnected) return
      const rowDelta = type === 'col' ? 0 : Math.round((moveEvent.clientY - startY) / rowHeight)
      const colDelta = type === 'row' ? 0 : Math.round((moveEvent.clientX - startX) / colWidth)
      this.applyResize(Math.max(1, baseRows + rowDelta), Math.max(1, baseCols + colDelta))
      markDrag()
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      unmarkDrag()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // Limpeza acessivel ao destroy() do widget (arrasto interrompido por
    // redesenho/desmontagem do editor antes do mouseup).
    const wrap = this.currentWrap()
    if (wrap) {
      ;(wrap as unknown as { __dragCleanup?: () => void }).__dragCleanup = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        unmarkDrag()
      }
    }
  }

  destroy(dom: HTMLElement) {
    ;(dom as unknown as { __dragCleanup?: () => void }).__dragCleanup?.()
  }

  /** Converge a tabela para o tamanho alvo, adicionando/removendo linhas e
   * colunas no documento (o widget se redesenha a cada transacao). */
  private applyResize(targetRows: number, targetCols: number) {
    if (!this.view) return
    for (let guard = 0; guard < 64; guard += 1) {
      const live = this.currentWidget()
      const rowDiff = targetRows - live.spec.rows.length
      const colDiff = targetCols - live.spec.header.length
      if (rowDiff === 0 && colDiff === 0) return
      if (rowDiff > 0) { if (!this.insertRow(live)) return }
      else if (rowDiff < 0) { if (!this.deleteRow(live)) return }
      else if (colDiff > 0) { if (!this.insertColumn(live)) return }
      else if (colDiff < 0) { if (!this.deleteColumn(live)) return }
    }
  }

  private insertRow(live: TableWidget) {
    if (!this.view) return false
    const change = insertTableRowChange(this.view.state.doc, live.spec)
    if (!change) return false
    this.view.dispatch({ changes: change })
    return true
  }

  private deleteRow(live: TableWidget) {
    if (!this.view) return false
    const change = removeTableRowChange(this.view.state.doc, live.spec)
    if (!change) return false
    this.view.dispatch({ changes: change })
    return true
  }

  private insertColumn(live: TableWidget) {
    if (!this.view) return false
    const changes = addTableColumnChanges(this.view.state.doc, live.spec)
    if (changes.length === 0) return false
    this.view.dispatch({ changes })
    return true
  }

  private deleteColumn(live: TableWidget) {
    if (!this.view) return false
    const changes = removeTableColumnChanges(this.view.state.doc, live.spec)
    if (changes.length === 0) return false
    this.view.dispatch({ changes })
    return true
  }
}

/** Insere uma nova linha vazia apos a ultima linha da tabela. Usado pelo Enter
 * e pelo arrasto da borda inferior. Retorna a transacao ou null. */
function insertTableRowChange(doc: Text, spec: TableSpec) {
  const lastLine = doc.lineAt(Math.max(spec.from, spec.to - 1))
  const cells = Array.from({ length: spec.header.length }, () => ' ').join(' | ')
  const atEnd = lastLine.to >= doc.length
  const at = atEnd ? lastLine.to : lastLine.to + 1
  return { from: at, to: at, insert: `${atEnd ? '\n' : ''}| ${cells} |\n` }
}

/** Remove a ultima linha de dados, mantendo no minimo uma linha. Retorna a
 * transacao ou null quando nao ha linha para remover. */
function removeTableRowChange(doc: Text, spec: TableSpec) {
  if (spec.rows.length <= 1) return null
  const lastLine = doc.lineAt(Math.max(spec.from, spec.to - 1))
  const end = lastLine.to < doc.length ? lastLine.to + 1 : lastLine.to
  return { from: lastLine.from, to: end, insert: '' }
}

/** Anexa uma celula ao fim de uma linha de tabela, preservando o espacamento
 * das colunas existentes. Linhas sem pipe externo sao reconstruidas com pipes. */
function appendTableCell(lineText: string, cellText: string): string {
  if (lineText.endsWith('|')) return lineText.slice(0, -1) + `| ${cellText} |`
  const cells = splitTableCells(lineText).concat(cellText)
  return `| ${cells.join(' | ')} |`
}

/** Adiciona uma coluna vazia a direita (celulas vazias; a linha de
 * delimitadores ganha um `---` neutro). */
function addTableColumnChanges(doc: Text, spec: TableSpec) {
  const firstLine = lineNumberAt(doc, spec.from)
  const lastLineNo = lineNumberAt(doc, Math.max(spec.from, spec.to - 1))
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let lineNo = firstLine; lineNo <= lastLineNo; lineNo += 1) {
    const line = doc.line(lineNo)
    const cellText = isDelimiterRow(line.text) ? '---' : ''
    const newText = appendTableCell(line.text, cellText)
    if (newText !== line.text) changes.push({ from: line.from, to: line.to, insert: newText })
  }
  return changes
}

/** Remove a ultima coluna, mantendo no minimo uma. Linhas com pipes externos
 * preservam o espacamento das colunas restantes; as demais sao reconstruidas
 * com pipes externos. */
function removeTableColumnChanges(doc: Text, spec: TableSpec) {
  if (spec.header.length <= 1) return []
  const firstLine = lineNumberAt(doc, spec.from)
  const lastLineNo = lineNumberAt(doc, Math.max(spec.from, spec.to - 1))
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let lineNo = firstLine; lineNo <= lastLineNo; lineNo += 1) {
    const line = doc.line(lineNo)
    const text = line.text
    const segments = rowCellSegments(text, line.from)
    if (segments.length === 0) continue
    const newText = text.startsWith('|') && text.endsWith('|')
      ? `|${segments.slice(0, -1).map((seg) => doc.sliceString(seg.from, seg.to)).join('|')}|`
      : `| ${splitTableCells(text).slice(0, -1).join(' | ')} |`
    if (newText !== text) changes.push({ from: line.from, to: line.to, insert: newText })
  }
  return changes
}

function tableContent(spec: TableSpec) {
  return [
    ...spec.header.map((cell) => cell.text),
    ...spec.rows.flat().map((cell) => cell.text),
  ].join('\u0000')
}

function buildTableField(doc: Text): { decorations: DecorationSet; tableLines: Set<number> } {
  const ranges: Range<Decoration>[] = []
  const tableLines = new Set<number>()
  for (const spec of findTableSpecs(doc)) {
    ranges.push(Decoration.replace({ widget: new TableWidget(spec), block: true }).range(spec.from, spec.to))
    for (let line = lineNumberAt(doc, spec.from); line <= lineNumberAt(doc, Math.max(spec.from, spec.to - 1)); line += 1) {
      tableLines.add(line)
    }
  }
  return { decorations: RangeSet.of(ranges, true), tableLines }
}

/** StateField que fornece os widgets de tabela (bloco real, identico ao modo
 * Leitura). A tabela nunca revela o Markdown cru — mesmo com o cursor nela. */
const livePreviewTableField = StateField.define<{ decorations: DecorationSet; tableLines: Set<number> }>({
  create(state) {
    return buildTableField(state.doc)
  },
  update(value, transaction) {
    if (!transaction.docChanged) return value
    return buildTableField(transaction.state.doc)
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

function buildDecorations(view: EditorView) {
  const doc = view.state.doc
  const selection = view.state.selection.main
  const carets = [selection.from, selection.to]
  const viewport = view.viewport

  // GFM e mais pesado que CommonMark: timeout generoso para evitar arvore parcial.
  const tree = ensureSyntaxTree(view.state, viewport.to, 200) ?? syntaxTree(view.state)
  const mask = findTreeMaskTokens(tree, doc)

  const lineTokens = new Map<number, MaskToken[]>()
  for (const token of mask.tokens) {
    const line = lineNumberAt(doc, token.from)
    const list = lineTokens.get(line) ?? []
    list.push(token)
    lineTokens.set(line, list)
  }

  // Linhas cobertas pelos widgets de tabela (StateField): a tabela inteira e
  // substituida por um <table> real, entao o plugin nao as decora.
  const tableLines = view.state.field(livePreviewTableField, false)?.tableLines ?? new Set<number>()

  // Virtualizacao: processa somente as linhas do viewport (com pequena margem),
  // pois o CodeMirror so renderiza decoracoes nessa regiao.
  const firstLine = doc.lineAt(viewport.from).number
  const lastLine = doc.lineAt(viewport.to).number

  const allRanges: DecorRange[] = []
  const push = (ranges: DecorRange[]) => {
    for (const range of ranges) allRanges.push(range)
  }

  // Matematica e divisores sao blocos: mesmo quando o inicio esta acima do
  // viewport, o widget precisa continuar visivel para as linhas intermediarias.
  for (const token of mask.tokens) {
    if (token.kind !== 'math' && token.kind !== 'hr') continue
    if (token.to < viewport.from || token.from > viewport.to) continue
    if (isTokenRevealed(token, carets, doc)) continue
    // Matematica dentro de tabelas e renderizada pelo proprio widget de tabela.
    const startLine = lineNumberAt(doc, token.from)
    const endLine = lineNumberAt(doc, Math.max(token.from, token.to - 1))
    let inTable = false
    for (let line = startLine; line <= endLine; line += 1) {
      if (tableLines.has(line)) {
        inTable = true
        break
      }
    }
    if (inTable) continue
    push(token.kind === 'math' ? mathDecorations(token, doc) : tokenDecorations(token, doc))
  }

  for (let index = firstLine; index <= lastLine; index += 1) {
    const line = doc.line(index)
    const lineText = line.text
    const tokens = lineTokens.get(index) ?? []

    // Tabelas: o StateField substitui o range inteiro por um <table> real —
    // o ViewPlugin nao decora nenhuma linha coberta por ele.
    if (tableLines.has(index)) continue

    // Frontmatter YAML: permanece cru (nada e mascarado).
    if (mask.frontmatterLines.has(index)) continue

    if (isFencedLine(index, mask.fencedLines)) {
      for (const token of tokens) {
        if (token.kind !== 'fence') continue
        if (isTokenRevealed(token, carets, doc)) continue
        push(tokenDecorations(token, doc))
      }
      continue
    }

    // Linha normal: mascara os tokens da arvore e os wikilinks por regex.
    const regexTokens = findMaskTokens(lineText, line.from).filter((token) => token.kind === 'wikilink')
    const allTokens = [...tokens, ...regexTokens]
    allTokens.sort((left, right) => left.from - right.from || left.to - right.to)
    for (const token of allTokens) {
      if (token.kind === 'fence' || token.kind === 'math' || token.kind === 'hr') continue
      if (isTokenRevealed(token, carets, doc)) continue
      push(tokenDecorations(token, doc))
    }
  }

  // RangeSet.of ordena internamente (permite misturar decoracoes de ponto,
  // como linhas de tabela, com decoracoes de intervalo).
  const ranges = allRanges.map(({ from, to, decoration }) => decoration.range(from, to))
  return RangeSet.of(ranges, true)
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: ReturnType<typeof buildDecorations>

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (value) => value.decorations },
)

export const markdownLivePreview = [livePreviewTableField, livePreviewPlugin]
