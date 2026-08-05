import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'

// Live preview (modo Misto): a sintaxe Markdown e mascarada como formatacao
// (negrito, italico, codigo, titulos, tabelas...), e apenas o token adjacente ao
// cursor (antes ou depois dele) e exibido em Markdown cru — o resto da nota
// permanece com a aparencia formatada.
//
// A mascara e derivada da arvore sintatica real do parser Lezer (GFM) do
// CodeMirror, o mesmo parser que renderiza o modo Leitura. Tabelas, tarefas,
// blocos de codigo, listas aninhadas e citacoes usam as faixas exatas dos nos;
// wikilinks `[[...]]` (sem no dedicado no parser) usam um regex de fallback.

export type MaskToken =
  | { kind: 'bold' | 'italic' | 'strike' | 'code' | 'wikilink' | 'link'; from: number; to: number; innerFrom: number; innerTo: number; revealFrom: number; revealTo: number }
  | { kind: 'heading'; level: number; from: number; to: number; textFrom: number; textTo: number; revealFrom: number; revealTo: number }
  | { kind: 'quote' | 'bullet'; from: number; to: number; textFrom: number; textTo: number; revealFrom: number; revealTo: number }
  | { kind: 'task'; from: number; to: number; checked: boolean; revealFrom: number; revealTo: number }
  | { kind: 'fence'; from: number; to: number; openFrom: number; openTo: number; contentFrom: number; contentTo: number; closeFrom: number; closeTo: number; revealFrom: number; revealTo: number }
  | { kind: 'tableRow'; from: number; to: number; isDelimiter: boolean; revealFrom: number; revealTo: number }

type InlineKind = 'bold' | 'italic' | 'strike' | 'code' | 'wikilink' | 'link'

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g

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
}

function isFencedLine(lineNumber: number, fencedLines: Set<number>) {
  return fencedLines.has(lineNumber)
}

function lineNumberAt(doc: { lineAt: (pos: number) => { number: number } }, pos: number) {
  return doc.lineAt(pos).number
}


/** Extrai os tokens mascaraveis da arvore sintatica (GFM) do documento. */
export function findTreeMaskTokens(tree: Tree, doc: { toString: () => string; lineAt: (pos: number) => { number: number; to: number } }): TreeMask {
  const text = doc.toString()
  const mask: TreeMask = {
    tokens: [],
    fencedLines: new Set<number>(),
    tableLines: new Set<number>(),
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

  tree.iterate({
    enter: (node) => {
      const type = node.type.name
      const from = node.from
      const to = node.to

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

  return mask
}

export function isTokenAdjacentToCaret(token: MaskToken, caret: number) {
  return caret >= token.revealFrom - 1 && caret <= token.revealTo + 1
}

const hidden = Decoration.replace({})

const strongMark = Decoration.mark({ class: 'cm-live-strong' })
const emMark = Decoration.mark({ class: 'cm-live-em' })
const strikeMark = Decoration.mark({ class: 'cm-live-strike' })
const codeMark = Decoration.mark({ class: 'cm-live-code' })
const linkMark = Decoration.mark({ class: 'cm-live-link' })
const quoteMark = Decoration.mark({ class: 'cm-live-quote' })
const bulletMark = Decoration.mark({ class: 'cm-live-bullet' })
const tableCellMark = Decoration.mark({ class: 'cm-live-table' })
const fenceContentMark = Decoration.mark({ class: 'cm-live-fence-content' })
const headingMarks = [1, 2, 3, 4, 5, 6].map((level) => Decoration.mark({ class: `cm-live-heading cm-live-h${level}` }))

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

type DecorRange = { from: number; to: number; decoration: Decoration }

function tokenDecorations(token: MaskToken): DecorRange[] {
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
    case 'heading':
      return [
        { from: token.from, to: token.textFrom, decoration: hidden },
        { from: token.textFrom, to: token.textTo, decoration: headingMarks[token.level - 1] ?? headingMarks[0] },
      ]
    case 'quote':
      return [
        { from: token.from, to: token.textFrom, decoration: hidden },
        { from: token.textFrom, to: token.textTo, decoration: quoteMark },
      ]
    case 'bullet':
      return [
        { from: token.from, to: token.to, decoration: Decoration.replace({ widget: new BulletWidget('•') }) },
        { from: token.textFrom, to: token.textTo, decoration: bulletMark },
      ]
    case 'task':
      return [{ from: token.from, to: token.to, decoration: Decoration.replace({ widget: new CheckboxWidget(token.checked) }) }]
    case 'fence':
      return [
        { from: token.openFrom, to: token.openTo, decoration: hidden },
        { from: token.openTo, to: token.contentFrom, decoration: hidden },
        { from: token.contentFrom, to: token.contentTo, decoration: fenceContentMark },
        { from: token.contentTo, to: token.closeFrom, decoration: hidden },
        { from: token.closeFrom, to: token.closeTo, decoration: hidden },
      ]
    case 'tableRow':
      return []
  }
}

/** Decora uma linha de tabela: oculta os pipes e a linha de delimitadores. */
function tableRowDecorations(token: Extract<MaskToken, { kind: 'tableRow' }>, lineText: string, lineFrom: number): DecorRange[] {
  if (token.isDelimiter) {
    // Mascara somente o texto da linha (pipes e travessoes), sem incluir a quebra.
    const marker = lineText.match(DELIMITER_MARKER_RE)
    if (marker && marker[0].length > 0) {
      return [{ from: lineFrom, to: lineFrom + marker[0].length, decoration: hidden }]
    }
    return [{ from: token.from, to: Math.min(token.to, lineFrom + lineText.length), decoration: hidden }]
  }
  const ranges: DecorRange[] = []
  const pipeRe = /\|/g
  for (const match of lineText.matchAll(pipeRe)) {
    const pipeFrom = lineFrom + (match.index ?? 0)
    ranges.push({ from: pipeFrom, to: pipeFrom + 1, decoration: hidden })
  }
  if (ranges.length > 0) {
    // Estiliza o conteudo das celulas (entre pipes) com a classe de tabela.
    const firstPipe = ranges[0].from
    const lastPipe = ranges[ranges.length - 1].to
    const cellRanges: DecorRange[] = []
    for (let index = 0; index + 1 < ranges.length; index += 1) {
      const cellFrom = ranges[index].to
      const cellTo = ranges[index + 1].from
      if (cellTo > cellFrom) cellRanges.push({ from: cellFrom, to: cellTo, decoration: tableCellMark })
    }
    void firstPipe
    void lastPipe
    return [...ranges, ...cellRanges]
  }
  return ranges
}

const DELIMITER_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/
const DELIMITER_MARKER_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?/

function isDelimiterLine(lineText: string) {
  return DELIMITER_RE.test(lineText)
}

function buildDecorations(view: EditorView) {
  const doc = view.state.doc
  const selection = view.state.selection.main
  const carets = [selection.from, selection.to]
  const viewport = view.viewport

  const tree = ensureSyntaxTree(view.state, viewport.to, 100) ?? syntaxTree(view.state)
  const mask = findTreeMaskTokens(tree, doc)

  const lineTokens = new Map<number, MaskToken[]>()
  for (const token of mask.tokens) {
    const line = lineNumberAt(doc, token.from)
    const list = lineTokens.get(line) ?? []
    list.push(token)
    lineTokens.set(line, list)
  }

  // Virtualizacao: processa somente as linhas do viewport (com pequena margem),
  // pois o CodeMirror so renderiza decoracoes nessa regiao.
  const firstLine = doc.lineAt(viewport.from).number
  const lastLine = doc.lineAt(viewport.to).number

  // Coleciona todos os ranges e adiciona ao builder em ordem global crescente
  // de `from` (+ startSide), requisito do RangeSetBuilder.
  const allRanges: DecorRange[] = []
  const push = (ranges: DecorRange[]) => {
    for (const range of ranges) allRanges.push(range)
  }

  for (let index = firstLine; index <= lastLine; index += 1) {
    const line = doc.line(index)
    const lineText = line.text
    const tokens = lineTokens.get(index) ?? []

    if (isFencedLine(index, mask.fencedLines)) {
      for (const token of tokens) {
        if (token.kind !== 'fence') continue
        const revealed = carets.some((caret) => isTokenAdjacentToCaret(token, caret))
        if (revealed) continue
        push(tokenDecorations(token))
      }
      continue
    }

    if (mask.tableLines.has(index)) {
      const rowToken = tokens.find((token): token is Extract<MaskToken, { kind: 'tableRow' }> => token.kind === 'tableRow')
      const revealed = rowToken && carets.some((caret) => isTokenAdjacentToCaret(rowToken, caret))
      if (revealed) continue
      const row = rowToken ?? {
        kind: 'tableRow' as const,
        from: line.from,
        to: line.to,
        isDelimiter: isDelimiterLine(lineText),
        revealFrom: line.from,
        revealTo: line.to,
      }
      push(tableRowDecorations(row, lineText, line.from))
      // Tokens inline dentro das celulas (negrito, etc.) continuam mascarados.
      for (const token of tokens) {
        if (token.kind === 'tableRow') continue
        if (token.kind === 'fence') continue
        const revealedInline = carets.some((caret) => isTokenAdjacentToCaret(token, caret))
        if (revealedInline) continue
        push(tokenDecorations(token))
      }
      continue
    }

    // Linha normal: mascara os tokens da arvore e os wikilinks por regex.
    const regexTokens = findMaskTokens(lineText, line.from).filter((token) => token.kind === 'wikilink')
    const allTokens = [...tokens, ...regexTokens]
    allTokens.sort((left, right) => left.from - right.from || left.to - right.to)
    for (const token of allTokens) {
      if (token.kind === 'fence') continue
      const revealed = carets.some((caret) => isTokenAdjacentToCaret(token, caret))
      if (revealed) continue
      push(tokenDecorations(token))
    }
  }

  const builder = new RangeSetBuilder<Decoration>()
  allRanges.sort((left, right) => {
    const byFrom = left.from - right.from
    if (byFrom !== 0) return byFrom
    const leftSide = left.decoration.startSide
    const rightSide = right.decoration.startSide
    return leftSide - rightSide
  })
  for (const range of allRanges) builder.add(range.from, range.to, range.decoration)

  return builder.finish()
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

export const markdownLivePreview = [livePreviewPlugin]
