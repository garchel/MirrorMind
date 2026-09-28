import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'
import type { Tree } from '@lezer/common'

/** Motor da mascara do live preview (tokens, builder, cache, delecao de
 * math, reveal): extraido de markdownLivePreview.ts sem mudanca de
 * comportamento. */
export type MaskToken =
  | { kind: 'bold' | 'italic' | 'strike' | 'code' | 'wikilink' | 'link'; from: number; to: number; innerFrom: number; innerTo: number; revealFrom: number; revealTo: number }
  | { kind: 'image'; from: number; to: number; src: string; alt: string; revealFrom: number; revealTo: number }
  | { kind: 'html'; from: number; to: number; source: string; block: boolean; revealFrom: number; revealTo: number }
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

export type TreeMask = {
  tokens: MaskToken[]
  /** Linhas dentro de blocos de codigo (a partir de 1) — nada e mascarado nelas. */
  fencedLines: Set<number>
  /** Linhas dentro de tabelas (a partir de 1) — pipes e linha de delimitadores sao mascarados. */
  tableLines: Set<number>
  /** Linhas do frontmatter YAML inicial (a partir de 1) — ficam cruas. */
  frontmatterLines: Set<number>
}

export function isFencedLine(lineNumber: number, fencedLines: Set<number>) {
  return fencedLines.has(lineNumber)
}

export function lineNumberAt(doc: { lineAt: (pos: number) => { number: number } }, pos: number) {
  return doc.lineAt(pos).number
}

export function rangesOverlap(from: number, to: number, ranges: Array<{ from: number; to: number }>) {
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

  // HTML inline: tags abertas pendentes (para casar com a tag de fechamento e
  // cobrir o elemento inteiro `<tag>...</tag>` com um único token).
  const htmlTagStack: Array<{ name: string; from: number }> = []

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
        const taskMark = task ? task.getChildren('TaskMarker')[0] : undefined
        // O bullet cobre apenas o marcador da lista; o marcador de tarefa
        // (`[ ]`/`[x]`) fica com o proprio widget de checkbox — antes o bullet
        // se estendia ate o fim do colchetes e sobrepunha (e escondia) o
        // checkbox, que nunca era renderizado nem alternavel.
        const markerEnd = extendMarker(mark.to)
        mask.tokens.push({
          kind: 'bullet',
          from: mark.from,
          to: markerEnd,
          textFrom: markerEnd,
          textTo: to,
          revealFrom: mark.from,
          revealTo: markerEnd,
        })
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
        return
      }

      if (type === 'HTMLTag') {
        // HTML inline: `<tag>...</tag>` vira um token cobrindo o elemento
        // inteiro (da abertura ao fechamento), renderizado sanitizado. Tags
        // vazias (br, hr, img...) não tem fechamento e ficam cruas.
        const tagSource = text.slice(from, to)
        const closeMatch = tagSource.match(/^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>$/)
        if (closeMatch) {
          const closeName = closeMatch[1].toLowerCase()
          for (let index = htmlTagStack.length - 1; index >= 0; index -= 1) {
            const opener = htmlTagStack[index]
            if (opener.name.toLowerCase() !== closeName) continue
            htmlTagStack.splice(index, 1)
            mask.tokens.push({
              kind: 'html',
              from: opener.from,
              to,
              source: text.slice(opener.from, to),
              block: false,
              revealFrom: opener.from,
              revealTo: to,
            })
            break
          }
          return false
        }
        const openMatch = tagSource.match(/^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?\/?>$/)
        if (openMatch) {
          const name = openMatch[1]
          const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
          const selfClosing = /\/>$/.test(tagSource)
          if (!selfClosing && !voidElements.has(name.toLowerCase())) {
            htmlTagStack.push({ name, from })
          }
        }
        return false
      }

      if (type === 'HTMLBlock') {
        // Bloco HTML multilinha: o plugin de view nao pode substituir quebras
        // de linha, entao o token existe mas so renderiza quando couber em uma
        // unica linha (tokenDecorations descarta os multilinha — ficam crus).
        mask.tokens.push({
          kind: 'html',
          from,
          to,
          source: text.slice(from, to),
          block: true,
          revealFrom: from,
          revealTo: to,
        })
        return false
      }

      if (type === 'Image') {
        // Imagem: `![alt](url)` ou embed Obsidian `![[caminho|legenda]]`
        // (o Lezer representa ambos como `Image` com marcas `LinkMark`).
        const marks = markChildren(node.node, 'LinkMark')
        if (marks.length < 2) return
        const first = marks[0]
        const last = marks[marks.length - 1]
        let src: string
        let alt: string
        if (marks.length >= 4 && text[marks[2].from] === '(') {
          // ![alt](url): marcas = [`![`, `]`, `(`, `)`].
          alt = text.slice(first.to, marks[1].from)
          src = text.slice(marks[2].to, last.from)
        } else {
          // ![[caminho|legenda]]: o caminho fica entre as marcas externas.
          // Imagens por referencia `![alt][ref]` nao sao mascaradas (cruas).
          if (marks.length > 2) return
          const inner = text.slice(first.to, last.from).replace(/^\[/, '').replace(/\]$/, '')
          const [pathPart, labelPart] = inner.split('|')
          const path = pathPart.trim()
          if (!path) return
          src = `https://mirrormind.local/asset/${encodeURIComponent(path)}`
          alt = (labelPart ?? path.split('/').at(-1) ?? path).trim()
        }
        mask.tokens.push({
          kind: 'image',
          from,
          to,
          src,
          alt,
          revealFrom: from,
          revealTo: to,
        })
        // Nao desce nos filhos (o Link interno de `![[...]]` nao vira token).
        return false
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

/** Máscara memoizada por (doc, árvore): `findTreeMaskTokens` é pura nesses
 * dois argumentos, e o `Text` do CodeMirror é imutável — seleções/viewport
 * sem mudança de doc reaproveitam (o caso quente a cada cursor). WeakMap:
 * morre com o doc, sem vazamento. */
type MaskCacheEntry = { tree: Tree; mask: TreeMask }
const treeMaskCache = new WeakMap<object, MaskCacheEntry>()
export function cachedTreeMaskTokens(tree: Tree, doc: Text): TreeMask {
  const cached = treeMaskCache.get(doc)
  if (cached && cached.tree === tree) return cached.mask
  const mask = findTreeMaskTokens(tree, doc)
  treeMaskCache.set(doc, { tree, mask })
  return mask
}

export function isTokenAdjacentToCaret(token: MaskToken, caret: number) {
  return caret >= token.revealFrom - 1 && caret <= token.revealTo + 1
}

export type HighlightHtml = {
  /** Comprimento da tag de abertura (`<mark ...>`) no doc. */
  openLength: number
  /** Comprimento da tag de fechamento (`</mark>`) no doc. */
  closeLength: number
  /** Classes `hl-*` preservadas (allowlist; resto descartado). */
  classes: string
}

/** Marca-texto do usuário: `<mark>` (com ou sem `class="hl-*"`). Retorna
 * null para qualquer outro HTML (kbd, links, sup...). */
export function parseHighlightHtml(source: string): HighlightHtml | null {
  const open = source.match(/^<mark(\s[^>]*)?>/i)
  if (!open) return null
  const close = source.match(/<\/mark\s*>$/i)
  if (!close) return null
  const classAttr = open[1]?.match(/\sclass\s*=\s*"([^"]*)"/i)?.[1] ?? ''
  const classes = classAttr.split(/\s+/).filter((cls) => /^hl-[a-z]+$/.test(cls)).join(' ')
  return { openLength: open[0].length, closeLength: close[0].length, classes }
}

export type MathDeletionDirection = 'backward' | 'forward'

/**
 * Localiza a fórmula matemática EXATAMENTE adjacente ao cursor (fim == head
 * para Backspace, início == head para Delete). Pré-cheque barato no `$`
 * (toda fórmula começa e termina com `$`); só monta a máscara quando há
 * chance real. Retorna null quando não há fórmula adjacente.
 */
export function findMathTokenForDeletion(state: EditorState, head: number, direction: MathDeletionDirection): { from: number; to: number } | null {
  const doc = state.doc
  if (direction === 'backward') {
    if (head <= 0 || doc.sliceString(head - 1, head) !== '$') return null
  } else {
    if (head >= doc.length || doc.sliceString(head, head + 1) !== '$') return null
  }
  const tree = ensureSyntaxTree(state, doc.length, 100) ?? syntaxTree(state)
  if (!tree) return null
  const mask = cachedTreeMaskTokens(tree, doc)
  for (const token of mask.tokens) {
    if (token.kind !== 'math') continue
    if (direction === 'backward' && token.to === head) return { from: token.from, to: token.to }
    if (direction === 'forward' && token.from === head) return { from: token.from, to: token.to }
  }
  return null
}

/**
 * O cursor so revela o Markdown cru de um elemento quando esta NA MESMA LINHA
 * do elemento (tocando-o). Cursor em linha em branco ou vizinha nao revela
 * nada das linhas adjacentes — a tolerancia de +/-1 posicao de
 * `isTokenAdjacentToCaret` atravessa quebras de linha, entao a linha do cursor
 * e comparada com a faixa de linhas do token. Tokens multilinha (fence,
 * formula $$...$$) revelam quando o cursor esta em qualquer linha interna.
 */
export function isTokenRevealed(token: MaskToken, carets: number[], doc: Text) {
  // Matemática e marca-texto NUNCA revelam o Markdown cru no Misto/Leitura:
  // a fórmula segue renderizada e o `<mark>` segue oculto mesmo com o cursor
  // em cima (a fórmula sai inteira no Backspace/Delete; o destaque edita
  // letra a letra por dentro).
  if (token.kind === 'math') return false
  if (token.kind === 'html' && parseHighlightHtml(token.source) !== null) return false
  if (!carets.some((caret) => isTokenAdjacentToCaret(token, caret))) return false
  const firstLine = lineNumberAt(doc, token.from)
  const lastLine = lineNumberAt(doc, Math.max(token.from, token.to - 1))
  return carets.some((caret) => {
    const caretLine = lineNumberAt(doc, caret)
    return caretLine >= firstLine && caretLine <= lastLine
  })
}
