import katex from 'katex'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { ObsidianCallout } from './ObsidianCallout'
import { EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state'
import type { Range, Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Tree } from '@lezer/common'
import { parseObsidianEmbed } from '../lib/markdown'
import { extractObsidianEmbedFragment } from '../lib/obsidianEmbed'
import type { PluginBlockLanguage } from '../lib/pluginBlocks'
import type { NoteReviewGap } from '../features/review/noteReviewGaps'
import type { NoteReviewUnit } from '../features/review/noteReviewUnits'
import { unitOutcomeLabel } from '../features/review/reportMarkdown'
import { ObsidianPdfEmbed } from './ObsidianPdfEmbed'
import { ObsidianPluginBlock } from './ObsidianPluginBlock'

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

// --- Links clicaveis ---------------------------------------------------------
//
// Quando a mascara esta ativa (cursor longe do token), o conteudo interno do
// link vira um widget clicavel que navega (mesmo comportamento do Leitura).
// Com o cursor perto, o token revela o Markdown cru e a edicao funciona como
// antes. O callback de navegacao e lido via getter (ref do componente) para
// nunca ficar obsoleto entre re-renders.

export type LinkTarget =
  | { kind: 'note'; path: string; fragment?: string }
  | { kind: 'url'; href: string }

export type LinkOpenHandler = (target: LinkTarget) => void

export type LivePreviewOptions = {
  /** Getter do callback de navegacao (via ref do componente). */
  getOpenLink?: () => LinkOpenHandler | undefined
  /** Resolve um ativo do vault (caminho relativo) para URL utilizavel (via
   * convertFileSrc no app). Usado pelas imagens do modo Misto. */
  getAssetUrl?: (relativePath: string) => string | undefined
  /** Le o corpo (sem frontmatter) de uma nota incorporada `![[nota]]`. Se
   * ausente, o campo de embeds nao e criado e a sintaxe fica com o
   * comportamento anterior (widget de imagem). */
  getEmbedContent?: (relativePath: string) => Promise<string>
  /** Caminho do vault, necessario para os embeds de PDF (leitura via IPC). */
  vaultPath?: string
  /** Profundidade atual de aninhamento (0 na nota raiz; +1 a cada embed). */
  depth?: number
  /** Profundidade maxima de embeds aninhados (padrao: 4, como o Leitura). */
  maxEmbedDepth?: number
  /** Profundidade maxima de callouts aninhados (padrao: 24, como o Leitura);
   * alem dela o callout e renderizado como citacao simples. */
  maxCalloutDepth?: number
  /** Limite de notas incorporadas por nota renderizada (padrao: 16). */
  maxNoteEmbeds?: number
  /** Limite de PDFs incorporados por nota renderizada (padrao: 4). */
  maxPdfEmbeds?: number
  /** Dados das lacunas da ultima revisao (gap marks do modo Leitura). Getter
   * via ref do componente (o fetch e assincrono); o campo de lacunas escuta
   * o efeito `reviewGapDataEffect` disparado quando a prop muda. null ou
   * `enabled: false` = sem marcas. */
  getReviewGapData?: () => ReviewGapData | null
}

/** Linhas (chave + valor YAML cru) do painel integrado de frontmatter.
 * O painel vive no cabecalho do App (FrontmatterPanelForm); estes tipos sao
 * o contrato compartilhado entre o App e o formulario. */
export type FrontmatterRow = { key: string; value: string }
export type FrontmatterBacklink = { name: string; relativePath: string }
export type FrontmatterPanelData = {
  rows: FrontmatterRow[]
  /** Exclui a propriedade `tags` (renderizada pela secao de Tags com badges). */
  tags: string[]
  availableTags: string[]
  backlinks: FrontmatterBacklink[]
}

export type ReviewGapData = {
  gaps: NoteReviewGap[]
  units: NoteReviewUnit[]
  /** As marcas so aparecem quando habilitadas (modo de exibicao != off e nota
   * limpa — mesma condicao do Leitura classico). */
  enabled: boolean
  /** Comprimento do frontmatter do markdown COMPLETO da nota. Os offsets das
   * lacunas incluem o frontmatter; quando o doc do editor nao tem frontmatter
   * (spike do Leitura usa `noteBody`), os offsets sao deslocados por ele. */
  bodyOffset: number
}

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

  // HTML inline: tags abertas pendentes (para casar com a tag de fechamento e
  // cobrir o elemento inteiro `<tag>...</tag>` com um unico token).
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
        // vazias (br, hr, img...) nao tem fechamento e ficam cruas.
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

function linkTargetsEqual(left: LinkTarget, right: LinkTarget) {
  if (left.kind === 'note') {
    return right.kind === 'note' && left.path === right.path && left.fragment === right.fragment
  }
  return right.kind === 'url' && left.href === right.href
}

/** `[[caminho|alias]]` / `[[caminho#fragmento]]` / `[[caminho#fragmento|alias]]`. */
function wikilinkTarget(inner: string): LinkTarget {
  const targetPart = inner.split('|')[0] ?? ''
  const hashIndex = targetPart.indexOf('#')
  const path = hashIndex >= 0 ? targetPart.slice(0, hashIndex) : targetPart
  const fragment = hashIndex >= 0 ? targetPart.slice(hashIndex + 1) : ''
  return { kind: 'note', path: path.trim(), fragment: fragment.trim() ? fragment.trim() : undefined }
}

/** `[texto](url)` — o href vem depois de `](` ate o `)` final (titulo opcional). */
function markdownLinkTarget(hrefSource: string): LinkTarget {
  const href = hrefSource
    .replace(/^\]\(/, '')
    .replace(/\s+"[^"]*"\)\s*$/, '')
    .replace(/\)\s*$/, '')
    .trim()
  const internalPrefix = 'https://mirrormind.local/note/'
  if (href.startsWith(internalPrefix)) {
    return { kind: 'note', path: href.slice(internalPrefix.length), fragment: undefined }
  }
  return { kind: 'url', href }
}

// Link clicavel: substitui o texto interno mascarado por um widget que navega
// ao clique (o cursor NAO esta perto — senao o token estaria revelado).
class LinkWidget extends WidgetType {
  private readonly text: string
  private readonly target: LinkTarget
  private readonly getOpenLink: LivePreviewOptions['getOpenLink']

  constructor(text: string, target: LinkTarget, getOpenLink: LivePreviewOptions['getOpenLink']) {
    super()
    this.text = text
    this.target = target
    this.getOpenLink = getOpenLink
  }

  eq(other: LinkWidget) {
    return other.text === this.text && linkTargetsEqual(other.target, this.target)
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-link cm-live-link-widget'
    span.textContent = this.text
    span.setAttribute('role', 'link')
    span.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // `getOpenLink` e um getter (via ref): resolve o handler atual e chama.
      const handler = this.getOpenLink?.()
      handler?.(this.target)
    })
    return span
  }

  ignoreEvent() {
    // O CodeMirror nao trata o clique (nao posiciona cursor): a navegacao e
    // responsabilidade do proprio widget.
    return true
  }
}

// Imagem do modo Misto: substitui a sintaxe `![alt](url)` / `![[arquivo]]`
// por um <img> real. Ativos internos (`mirrormind.local/asset/`) sao
// resolvidos via `getAssetUrl` (convertFileSrc no app); o restante passa direto.
class ImageWidget extends WidgetType {
  private readonly src: string
  private readonly alt: string
  private readonly getAssetUrl: LivePreviewOptions['getAssetUrl']

  constructor(src: string, alt: string, getAssetUrl: LivePreviewOptions['getAssetUrl']) {
    super()
    this.src = src
    this.alt = alt
    this.getAssetUrl = getAssetUrl
  }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt
  }

  toDOM() {
    const img = document.createElement('img')
    img.className = 'cm-live-image'
    img.alt = this.alt || ''
    img.loading = 'lazy'
    const internalAssetPrefix = 'https://mirrormind.local/asset/'
    if (this.src.startsWith(internalAssetPrefix)) {
      let relativePath = this.src.slice(internalAssetPrefix.length)
      try {
        relativePath = decodeURIComponent(relativePath)
      } catch {
        // Mantem o caminho cru se nao for URI valido.
      }
      const safe = !relativePath.includes('..') && !relativePath.startsWith('/')
      img.src = safe ? (this.getAssetUrl?.(relativePath) ?? this.src) : this.src
    } else {
      img.src = this.src
    }
    return img
  }

  ignoreEvent() {
    // O clique na imagem nao posiciona cursor (mascara ativa); o usuario
    // aproxima o cursor para revelar e editar o Markdown cru.
    return true
  }
}

// --- HTML inline sanitizado (Marco 5) ---------------------------------------
//
// Elementos HTML inline (`<mark>`, `<kbd>`, `<sup>`, `<a>`, ...) viram um
// widget que SANITIZA o conteudo com a mesma base do schema do Leitura
// (rehype-sanitize defaultSchema + mark): tags fora da allowlist sao
// desembrulhadas, tags perigosas (script/style/iframe) removidas por inteiro,
// atributos filtrados (sem `on*`, sem `javascript:`/`data:`). Blocos HTML
// multilinha (HTMLBlock) permanecem crus (view plugins nao cruzam linhas).

const HTML_ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'code', 'data', 'del', 'details', 'dfn', 'div',
  'dl', 'dd', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
  'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
])
const HTML_DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button', 'textarea',
  'select', 'base', 'noscript', 'template', 'svg', 'math',
])
const HTML_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'align']),
  th: new Set(['colspan', 'rowspan', 'align', 'scope']),
  ol: new Set(['start', 'type']),
  del: new Set(['datetime']),
  ins: new Set(['datetime']),
  table: new Set(['align', 'border', 'width']),
}
const HTML_COMMON_ATTRS = new Set(['class', 'title'])

/** Sanitiza HTML para exibicao (allowlist de tags/atributos, como o Leitura). */
function sanitizeHtml(source: string): string {
  let parsed: Document | null = null
  try {
    parsed = new DOMParser().parseFromString(source, 'text/html')
  } catch {
    return ''
  }
  if (!parsed) return ''

  const walkChildren = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        parent.removeChild(child)
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as Element
      const tag = el.tagName.toLowerCase()
      if (HTML_DANGEROUS_TAGS.has(tag)) {
        parent.removeChild(el)
        continue
      }
      if (!HTML_ALLOWED_TAGS.has(tag)) {
        // Desembrulha (preserva texto/filhos) e sanitiza o conteudo solto.
        const fragment = document.createDocumentFragment()
        while (el.firstChild) fragment.appendChild(el.firstChild)
        parent.replaceChild(fragment, el)
        walkChildren(fragment)
        continue
      }
      const allowed = HTML_ALLOWED_ATTRS[tag]
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        const value = attr.value
        if (!(allowed?.has(name) ?? false) && !HTML_COMMON_ATTRS.has(name)) {
          el.removeAttribute(attr.name)
          continue
        }
        if (name === 'href' || name === 'src') {
          const lower = value.trim().toLowerCase()
          if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
            el.removeAttribute(attr.name)
          }
        }
      }
      walkChildren(el)
    }
  }

  walkChildren(parsed.body)
  return parsed.body.innerHTML
}

/** Widget do HTML inline sanitizado: substitui `<tag>...</tag>` pelo conteudo
 * limpo, com o cursor perto revelando o HTML cru (edicao). */
class HtmlWidget extends WidgetType {
  private readonly source: string

  constructor(source: string) {
    super()
    this.source = source
  }

  eq(other: HtmlWidget) { return other.source === this.source }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-html'
    span.innerHTML = sanitizeHtml(this.source)
    return span
  }

  ignoreEvent() { return true }
}

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
  /** Posicao do marcador `[ ]`/`[x]` no documento (para alternar o caractere). */
  private readonly from: number

  constructor(checked: boolean, from: number) {
    super()
    this.checked = checked
    this.from = from
  }

  eq(other: CheckboxWidget) { return other.checked === this.checked && other.from === this.from }

  toDOM(view: EditorView) {
    const span = document.createElement('span')
    span.className = `cm-live-checkbox${this.checked ? ' is-checked' : ''}`
    span.setAttribute('role', 'checkbox')
    span.setAttribute('aria-checked', String(this.checked))
    span.setAttribute('tabindex', '0')
    // Alterna a tarefa no documento (mesmo efeito do toggle do Leitura), em
    // qualquer modo — inclusive no Leitura read-only (o dispatch programatico
    // nao passa pela guarda de readOnly, como o onChange do input do Leitura).
    span.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.toggle(view)
    })
    span.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        this.toggle(view)
      }
    })
    return span
  }

  /** Alterna `[ ]` <-> `[x]` no documento, no lugar do caractere entre colchetes. */
  private toggle(view: EditorView) {
    const doc = view.state.doc
    if (this.from + 1 >= doc.length) return
    const current = doc.sliceString(this.from + 1, this.from + 2)
    const next = current === 'x' || current === 'X' ? ' ' : 'x'
    view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: next } })
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

function tokenDecorations(token: MaskToken, doc: Text, options: LivePreviewOptions): DecorRange[] {
  switch (token.kind) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code': {
      const contentMark = token.kind === 'bold' ? strongMark
        : token.kind === 'italic' ? emMark
          : token.kind === 'strike' ? strikeMark
            : codeMark
      return [
        { from: token.from, to: token.innerFrom, decoration: hidden },
        { from: token.innerFrom, to: token.innerTo, decoration: contentMark },
        { from: token.innerTo, to: token.to, decoration: hidden },
      ]
    }
    case 'image': {
      // Imagem: substitui a sintaxe inteira pelo <img>. Se cruzar linhas
      // (incomum), fica cru (sem decoracao).
      const imageLine = lineNumberAt(doc, token.from)
      const spansLineBreak = lineNumberAt(doc, Math.max(token.from, token.to - 1)) !== imageLine
      if (spansLineBreak) return []
      return [{
        from: token.from,
        to: token.to,
        decoration: Decoration.replace({ widget: new ImageWidget(token.src, token.alt, options.getAssetUrl) }),
      }]
    }
    case 'html': {
      // HTML inline sanitizado; blocos multilinha (HTMLBlock) ficam crus
      // (o plugin de view nao substitui quebras de linha).
      const htmlLine = lineNumberAt(doc, token.from)
      const spansLineBreak = lineNumberAt(doc, Math.max(token.from, token.to - 1)) !== htmlLine
      if (spansLineBreak) return []
      return [{
        from: token.from,
        to: token.to,
        decoration: Decoration.replace({ widget: new HtmlWidget(token.source) }),
      }]
    }
    case 'wikilink':
    case 'link': {
      // O conteudo interno vira um widget clicavel (navegacao) quando a mascara
      // esta ativa. Se o texto interno cruzar quebras de linha (incomum),
      // mantem a marca estilizada sem clique (replaces nao cruzam linhas).
      const innerText = doc.sliceString(token.innerFrom, token.innerTo)
      const target = token.kind === 'wikilink'
        ? wikilinkTarget(innerText)
        : markdownLinkTarget(doc.sliceString(token.innerTo, token.to))
      const innerLine = lineNumberAt(doc, token.innerFrom)
      const spansLineBreak = lineNumberAt(doc, Math.max(token.innerFrom, token.innerTo - 1)) !== innerLine
      const contentDecoration = spansLineBreak
        ? linkMark
        : Decoration.replace({ widget: new LinkWidget(innerText, target, options.getOpenLink) })
      return [
        { from: token.from, to: token.innerFrom, decoration: hidden },
        { from: token.innerFrom, to: token.innerTo, decoration: contentDecoration },
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
      return [{ from: token.from, to: token.to, decoration: Decoration.replace({ widget: new CheckboxWidget(token.checked, token.from) }) }]
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

/** Linha do cabecalho: contem um pipe e pelo menos uma celula nao vazia.
 * Linhas de citacao (`> ...`) nunca iniciam tabela — o conteudo de um
 * callout (tabelas inclusas) e renderizado pelo proprio widget de callout. */
function isTableHeaderRow(text: string) {
  if (!text.includes('|')) return false
  if (/^\s*>/.test(text)) return false
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
  /** Tabela em modo de leitura (editor readOnly): sem grips nem edicao de celula. */
  private readOnly = false
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
    this.readOnly = view.state.readOnly
    ;(dom as unknown as { __liveTableWidget: TableWidget }).__liveTableWidget = this
    this.syncCells(dom)
    return true
  }

  toDOM(view: EditorView) {
    this.view = view
    this.readOnly = view.state.readOnly
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
    if (!this.readOnly) this.buildGrips(wrap)
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
    if (this.readOnly) return
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
    if (this.readOnly) return
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

// --- Embeds de nota e PDF: bloco real com conteudo assincrono ----------------
//
// `![[nota]]` e `![[arquivo.pdf]]` viram um widget de BLOCO (StateField, como
// a tabela) que le o conteudo via `getEmbedContent` e renderiza o corpo da
// nota com o MESMO motor: um editor aninhado SOMENTE LEITURA com profundidade
// +1 (mesma regra de aninhamento do Leitura, com limites iguais). PDFs
// reutilizam o `ObsidianPdfEmbed` do Leitura (pdfjs + canvas), renderizado
// via React dentro do DOM do widget. A sintaxe NUNCA e revelada (mesma
// decisao da tabela: edite a linha no modo Edicao).

export type EmbedKind = 'note' | 'pdf'

export type EmbedSpec = {
  /** Linha inteira substituida pelo bloco (de line.from a line.to). */
  from: number
  to: number
  kind: EmbedKind
  /** Caminho relativo no vault (notas normalizadas com .md). */
  path: string
  label: string
  fragment: string | null
}

const EMBED_SYNTAX_RE = /!\[\[([^\]\n]+)\]\]/g

/** Detecta embeds de nota e PDF por texto (StateFields nao tem acesso a
 * arvore), com as mesmas exclusoes da tabela: frontmatter, fences, codigo
 * indentado e linhas ja cobertas pela tabela. Imagens `![[arquivo.png]]`
 * ficam de fora (o widget de imagem cuida delas). */
function findEmbedSpecs(doc: Text, tableSpecs: TableSpec[]): EmbedSpec[] {
  const specs: EmbedSpec[] = []
  const frontmatterEnd = frontmatterEndOffset(doc)
  const tableLines = new Set<number>()
  for (const spec of tableSpecs) {
    const last = lineNumberAt(doc, Math.max(spec.from, spec.to - 1))
    for (let line = lineNumberAt(doc, spec.from); line <= last; line += 1) tableLines.add(line)
  }
  // Embeds dentro de callouts sao renderizados pelo editor aninhado do proprio
  // callout (as linhas cobertas por ele ficam de fora da deteccao externa).
  const calloutLines = new Set<number>()
  for (const spec of findCalloutSpecs(doc)) {
    const last = lineNumberAt(doc, Math.max(spec.from, spec.to - 1))
    for (let line = lineNumberAt(doc, spec.from); line <= last; line += 1) calloutLines.add(line)
  }

  let inFence = false
  let lineNumber = 1
  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber)
    const text = line.text
    if (frontmatterEnd > 0 && line.from < frontmatterEnd) {
      lineNumber += 1
      continue
    }
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      lineNumber += 1
      continue
    }
    if (inFence || /^(?: {4}|\t)/.test(text) || tableLines.has(lineNumber) || calloutLines.has(lineNumber)) {
      lineNumber += 1
      continue
    }
    EMBED_SYNTAX_RE.lastIndex = 0
    let match: RegExpExecArray | null
    let spec: EmbedSpec | null = null
    while ((match = EMBED_SYNTAX_RE.exec(text)) !== null) {
      const escapes = text.slice(0, match.index).match(/(\\+)$/)?.[1].length ?? 0
      if (escapes % 2 === 1) continue
      const parsed = parseObsidianEmbed(match[1])
      if (!parsed) continue
      // Arquivos especiais (.obsidian) nao sao incorporados — mesma regra do
      // renderer classico, que os excluia do inventario de anexos/notas.
      if (parsed.path.replace(/\\/g, '/').split('/')[0]?.toLowerCase() === '.obsidian') continue
      if (parsed.isNote) {
        spec = { from: line.from, to: line.to, kind: 'note', path: parsed.path, label: parsed.label, fragment: parsed.fragment }
        break
      }
      if (parsed.path.toLowerCase().endsWith('.pdf')) {
        spec = { from: line.from, to: line.to, kind: 'pdf', path: parsed.path, label: parsed.label, fragment: parsed.fragment }
        break
      }
    }
    if (spec) specs.push(spec)
    lineNumber += 1
  }
  return specs
}

const DEFAULT_MAX_EMBED_DEPTH = 4
const DEFAULT_MAX_NOTE_EMBEDS = 16
const DEFAULT_MAX_PDF_EMBEDS = 4
const DEFAULT_MAX_CALLOUT_DEPTH = 24

/** Deduplica leituras em voo da mesma nota incorporada (como o Leitura). */
const inFlightEmbedReads = new Map<string, Promise<string>>()

function readEmbeddedBody(options: LivePreviewOptions, relativePath: string): Promise<string> {
  const existing = inFlightEmbedReads.get(relativePath)
  if (existing) return existing
  const request = Promise.resolve().then(() => options.getEmbedContent?.(relativePath) ?? '')
  inFlightEmbedReads.set(relativePath, request)
  void request.finally(() => inFlightEmbedReads.delete(relativePath)).catch(() => undefined)
  return request
}

/** Widget de bloco do embed de NOTA: placeholder -> le o corpo -> editor
 * aninhado SOMENTE LEITURA com o mesmo motor (profundidade + 1). */
class NoteEmbedWidget extends WidgetType {
  private readonly spec: EmbedSpec
  private readonly options: LivePreviewOptions
  private container: HTMLElement | null = null
  private nestedView: EditorView | null = null

  constructor(spec: EmbedSpec, options: LivePreviewOptions) {
    super()
    this.spec = spec
    this.options = options
  }

  eq(other: NoteEmbedWidget) {
    return other.spec.path === this.spec.path
      && other.spec.fragment === this.spec.fragment
      && other.spec.from === this.spec.from
      && other.spec.to === this.spec.to
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-embed cm-live-embed-note'
    this.container = wrap
    const status = document.createElement('div')
    status.className = 'cm-live-embed-status'
    status.textContent = 'Carregando nota incorporada...'
    wrap.appendChild(status)
    void readEmbeddedBody(this.options, this.spec.path).then(
      (content) => {
        if (this.container !== wrap) return
        this.mountBody(wrap, view, content)
      },
      () => {
        if (this.container !== wrap) return
        this.renderStatus(wrap, view, 'A nota incorporada não foi encontrada.', true)
      },
    )
    return wrap
  }

  private mountBody(wrap: HTMLElement, outerView: EditorView, content: string) {
    const body = extractObsidianEmbedFragment(content, this.spec.fragment)
    if (!body.trim()) {
      this.renderStatus(wrap, outerView, 'A nota incorporada não foi encontrada.', true)
      return
    }
    wrap.textContent = ''
    const holder = document.createElement('div')
    holder.className = 'cm-live-embed-body'
    wrap.appendChild(holder)
    this.nestedView = new EditorView({
      doc: body,
      parent: holder,
      extensions: [
        // A mesma base GFM do editor principal: sem a linguagem a arvore
        // sintatica fica vazia e a mascara nao encontra os tokens.
        markdown({ base: markdownLanguage }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        markdownLivePreview({ ...this.options, depth: (this.options.depth ?? 0) + 1 }),
      ],
    })
    outerView.requestMeasure()
  }

  private renderStatus(wrap: HTMLElement, outerView: EditorView, message: string, missing: boolean) {
    wrap.textContent = ''
    const status = document.createElement('div')
    status.className = `cm-live-embed-status${missing ? ' is-missing' : ''}`
    status.textContent = message
    wrap.appendChild(status)
    outerView.requestMeasure()
  }

  destroy() {
    this.container = null
    this.nestedView?.destroy()
    this.nestedView = null
  }
}

/** Widget de bloco do embed de PDF: reutiliza o `ObsidianPdfEmbed` do modo
 * Leitura (pdfjs + canvas), renderizado via React dentro do DOM do widget. */
class PdfEmbedWidget extends WidgetType {
  private readonly spec: EmbedSpec
  private readonly options: LivePreviewOptions
  private root: Root | null = null

  constructor(spec: EmbedSpec, options: LivePreviewOptions) {
    super()
    this.spec = spec
    this.options = options
  }

  eq(other: PdfEmbedWidget) {
    return other.spec.path === this.spec.path && other.spec.label === this.spec.label
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-embed cm-live-embed-pdf'
    if (this.options.vaultPath) {
      this.root = createRoot(wrap)
      this.root.render(createElement(ObsidianPdfEmbed, {
        vaultPath: this.options.vaultPath,
        relativePath: this.spec.path,
        title: this.spec.label,
      }))
    } else {
      const status = document.createElement('div')
      status.className = 'cm-live-embed-status is-missing'
      status.textContent = 'PDF não disponível.'
      wrap.appendChild(status)
    }
    window.setTimeout(() => view.requestMeasure(), 0)
    return wrap
  }

  destroy() {
    this.root?.unmount()
    this.root = null
  }
}

/** Limite de profundidade/quantidade: bloco estatico avisando o limite (mesma
 * mensagem do Leitura) em vez de buscar o conteudo. */
class LimitedEmbedWidget extends WidgetType {
  private readonly kind: EmbedKind
  private readonly label: string

  constructor(kind: EmbedKind, label: string) {
    super()
    this.kind = kind
    this.label = label
  }

  eq(other: LimitedEmbedWidget) {
    return other.kind === this.kind && other.label === this.label
  }

  toDOM() {
    const div = document.createElement('div')
    div.className = 'cm-live-embed cm-live-embed-limited'
    div.textContent = this.kind === 'note'
      ? 'Limite de notas incorporadas atingido.'
      : 'Limite de PDFs incorporados atingido.'
    return div
  }

  ignoreEvent() { return true }
}

type EmbedFieldValue = { decorations: DecorationSet; embedLines: Set<number> }

function buildEmbedField(doc: Text, options: LivePreviewOptions): EmbedFieldValue {
  const ranges: Range<Decoration>[] = []
  const embedLines = new Set<number>()
  const depth = options.depth ?? 0
  const depthLimited = depth >= (options.maxEmbedDepth ?? DEFAULT_MAX_EMBED_DEPTH)
  const maxNotes = options.maxNoteEmbeds ?? DEFAULT_MAX_NOTE_EMBEDS
  const maxPdfs = options.maxPdfEmbeds ?? DEFAULT_MAX_PDF_EMBEDS
  let noteCount = 0
  let pdfCount = 0
  for (const spec of findEmbedSpecs(doc, findTableSpecs(doc))) {
    const countLimited = spec.kind === 'note' ? noteCount >= maxNotes : pdfCount >= maxPdfs
    if (spec.kind === 'note') noteCount += 1
    else pdfCount += 1
    const widget: WidgetType = depthLimited || countLimited
      ? new LimitedEmbedWidget(spec.kind, spec.label)
      : spec.kind === 'note'
        ? new NoteEmbedWidget(spec, options)
        : new PdfEmbedWidget(spec, options)
    ranges.push(Decoration.replace({ widget, block: true }).range(spec.from, spec.to))
    const last = lineNumberAt(doc, Math.max(spec.from, spec.to - 1))
    for (let line = lineNumberAt(doc, spec.from); line <= last; line += 1) embedLines.add(line)
  }
  return { decorations: RangeSet.of(ranges, true), embedLines }
}

/** StateField dos embeds (bloco real, como a tabela). Criado por factory para
 * capturar as opcoes (callbacks, profundidade, limites) de cada editor — os
 * editores aninhados criam o proprio campo com profundidade + 1. */
function createEmbedField(options: LivePreviewOptions) {
  return StateField.define<EmbedFieldValue>({
    create(state) {
      return buildEmbedField(state.doc, options)
    },
    update(value, transaction) {
      if (!transaction.docChanged) return value
      return buildEmbedField(transaction.state.doc, options)
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  })
}

// --- Callouts: `> [!tipo]` como bloco real, igual ao Leitura -----------------
//
// Um bloco de citacao cuja primeira linha e `> [!tipo]` (com fold `+`/`-` e
// titulo opcional) vira um widget de BLOCO (StateField, como tabela e embed)
// com o MESMO visual do Leitura: o `ObsidianCallout` (reaproveitado via React,
// com <details>/<summary> nativo para o fold) e o conteudo renderizado por um
// editor aninhado somente leitura com o mesmo motor (profundidade + 1).

export type CalloutSpec = {
  /** Range coberto pelo bloco (primeira ate a ultima linha `>`). */
  from: number
  to: number
  type: string
  /** `''` (sem fold), `'+'` (expandido) ou `'-'` (colapsado). */
  fold: string
  title: string
  /** Conteudo interno (linhas `>` com o marcador removido). */
  innerContent: string
}

const CALLOUT_HEADER_RE = /^ {0,3}(?:(?:[-+*]|\d+[.)])\s+)?(?:>\s*)+\[!([^\]\s]+)\]([+-])?\s*(.*)$/

/** Detecta os callouts por texto: uma linha `> [!tipo]` seguida de linhas de
 * citacao. Mesmas exclusoes da tabela (frontmatter, fences, codigo indentado).
 * Linhas de tabela nunca iniciam callout (nao comecam com `>`). */
function findCalloutSpecs(doc: Text): CalloutSpec[] {
  const specs: CalloutSpec[] = []
  const frontmatterEnd = frontmatterEndOffset(doc)
  let inFence = false
  let lineNumber = 1
  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber)
    const text = line.text
    if (frontmatterEnd > 0 && line.from < frontmatterEnd) {
      lineNumber += 1
      continue
    }
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      lineNumber += 1
      continue
    }
    if (inFence || /^(?: {4}|\t)/.test(text)) {
      lineNumber += 1
      continue
    }
    const header = text.match(CALLOUT_HEADER_RE)
    if (!header) {
      lineNumber += 1
      continue
    }
    const innerLines: string[] = []
    let endLine = lineNumber
    let cursor = lineNumber + 1
    while (cursor <= doc.lines) {
      const contentLine = doc.line(cursor).text
      if (!/^ {0,3}>/.test(contentLine)) break
      // Remove o marcador `>` (e um espaco opcional) de cada linha; callouts
      // aninhados (`> > [!x]`) mantem um nivel de `>` para o editor aninhado.
      innerLines.push(contentLine.replace(/^ {0,3}> ?/, ''))
      endLine = cursor
      cursor += 1
    }
    specs.push({
      from: line.from,
      to: doc.line(endLine).to,
      type: header[1],
      fold: header[2] ?? '',
      title: header[3].trim(),
      innerContent: innerLines.join('\n'),
    })
    lineNumber = endLine + 1
  }
  return specs
}

/** Formata inline simples no titulo de um callout (`**negrito**`,
 * `*italico*`, `` `codigo` ``) — mesma aparencia do renderInline do renderer
 * classico, sem depender do ReactMarkdown. */
function renderCalloutTitle(title: string | undefined) {
  if (!title) return title
  return title.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
    .map((part, index) => {
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
        return createElement('strong', { key: index }, part.slice(2, -2))
      }
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return createElement('code', { key: index }, part.slice(1, -1))
      }
      if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
        return createElement('em', { key: index }, part.slice(1, -1))
      }
      return part
    })
}

/** Widget de bloco do callout: reutiliza o `ObsidianCallout` do Leitura
 * (titulo, icone e fold nativo <details>/<summary>) e renderiza o conteudo
 * com um editor aninhado somente leitura (mesmo motor, profundidade + 1). */
class CalloutWidget extends WidgetType {
  private readonly spec: CalloutSpec
  private readonly options: LivePreviewOptions
  private root: Root | null = null
  private nestedView: EditorView | null = null

  constructor(spec: CalloutSpec, options: LivePreviewOptions) {
    super()
    this.spec = spec
    this.options = options
  }

  eq(other: CalloutWidget) {
    return other.spec.from === this.spec.from
      && other.spec.to === this.spec.to
      && other.spec.type === this.spec.type
      && other.spec.fold === this.spec.fold
      && other.spec.title === this.spec.title
      && other.spec.innerContent === this.spec.innerContent
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-callout'
    const { type, fold, title } = this.spec
    // ObsidianCallout calcula rotulo/icone e monta <aside> ou
    // <details>/<summary> (fold nativo). O DOM do callout e commitado pelo
    // React de forma assincrona; o editor aninhado e anexado ao corpo logo
    // apos (mesmo padrao do embed), sem depender do commit sincrono.
    this.root = createRoot(wrap)
    // O filho (corpo onde vive o editor aninhado) vai no terceiro argumento
    // do createElement (arquivo .ts, sem JSX), nao na prop `children`.
    this.root.render(createElement(
      ObsidianCallout,
      { type, defaultCollapsed: fold === '-', foldable: fold === '-' || fold === '+', title: renderCalloutTitle(title) },
      createElement('div', { className: 'cm-live-callout-body' }),
    ))
    window.setTimeout(() => this.attachNested(wrap, view), 0)
    return wrap
  }

  /** Anexa o editor aninhado ao corpo do callout apos o React montar o DOM. */
  private attachNested(wrap: HTMLElement, view: EditorView) {
    if (this.root === null || this.nestedView !== null) return
    const body = wrap.querySelector('.cm-live-callout-body')
    if (!body || !this.spec.innerContent.trim()) return
    this.nestedView = new EditorView({
      doc: this.spec.innerContent,
      parent: body,
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        markdownLivePreview({ ...this.options, depth: (this.options.depth ?? 0) + 1 }),
      ],
    })
    view.requestMeasure()
  }

  destroy() {
    this.nestedView?.destroy()
    this.nestedView = null
    this.root?.unmount()
    this.root = null
  }
}

type CalloutFieldValue = { decorations: DecorationSet; calloutLines: Set<number> }

function buildCalloutField(doc: Text, options: LivePreviewOptions): CalloutFieldValue {
  const ranges: Range<Decoration>[] = []
  const calloutLines = new Set<number>()
  const depth = options.depth ?? 0
  // Alem da profundidade maxima o callout vira citacao simples (mesma
  // decisao do Leitura, que desliga o parse de callouts no limite).
  const depthLimited = depth >= (options.maxCalloutDepth ?? DEFAULT_MAX_CALLOUT_DEPTH)
  for (const spec of findCalloutSpecs(doc)) {
    if (depthLimited) break
    ranges.push(Decoration.replace({ widget: new CalloutWidget(spec, options), block: true }).range(spec.from, spec.to))
    const last = lineNumberAt(doc, Math.max(spec.from, spec.to - 1))
    for (let line = lineNumberAt(doc, spec.from); line <= last; line += 1) calloutLines.add(line)
  }
  return { decorations: RangeSet.of(ranges, true), calloutLines }
}

/** StateField dos callouts (bloco real, como a tabela). Criado por factory
 * para capturar as opcoes (profundidade e callbacks dos editores aninhados). */
function createCalloutField(options: LivePreviewOptions) {
  return StateField.define<CalloutFieldValue>({
    create(state) {
      return buildCalloutField(state.doc, options)
    },
    update(value, transaction) {
      if (!transaction.docChanged) return value
      return buildCalloutField(transaction.state.doc, options)
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  })
}

// --- Blocos de plugin (Dataview/Tasks): bloco read-only real -----------------
//
// Fences com linguagem de plugin (```` ```dataview ````, ```` ```dataviewjs ````,
// ```` ```tasks ````) viram um widget de BLOCO (StateField, como tabela/embed/
// callout) que reutiliza o `ObsidianPluginBlock` do Leitura (titulo, aviso de
// seguranca e fonte crua preservada). `dataviewjs` nunca e executado. A
// sintaxe NUNCA e revelada (mesma decisao da tabela: edite no modo Edicao).

export type PluginBlockSpec = {
  /** Linha inteira substituida pelo bloco (de line.from a line.to). */
  from: number
  to: number
  language: PluginBlockLanguage
  /** Conteudo entre as cercas, sem os marcadores de fence. */
  source: string
}

const PLUGIN_FENCE_OPEN_RE = /^ {0,3}(```|~~~)\s*(dataview|dataviewjs|tasks)\b(.*)$/

/** Detecta blocos de plugin por texto (StateFields nao tem acesso a arvore):
 * uma linha de abertura com linguagem de plugin seguida do fechamento da
 * fence. Fences incompletas (sem fechamento) ficam como estao (bloco de
 * codigo comum, cru). */
function findPluginBlockSpecs(doc: Text): PluginBlockSpec[] {
  const specs: PluginBlockSpec[] = []
  const frontmatterEnd = frontmatterEndOffset(doc)
  let lineNumber = 1
  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber)
    const text = line.text
    if (frontmatterEnd > 0 && line.from < frontmatterEnd) {
      lineNumber += 1
      continue
    }
    const open = text.match(PLUGIN_FENCE_OPEN_RE)
    if (!open) {
      lineNumber += 1
      continue
    }
    const fence = open[1]
    const language = open[2] as PluginBlockLanguage
    const closeRe = new RegExp('^ {0,3}' + fence + '\\s*$')
    let endLine = lineNumber + 1
    while (endLine <= doc.lines) {
      if (closeRe.test(doc.line(endLine).text)) break
      endLine += 1
    }
    if (endLine > doc.lines) {
      // Fence sem fechamento: nao substitui (bloco de codigo comum, cru).
      lineNumber += 1
      continue
    }
    const sourceLines: string[] = []
    for (let index = lineNumber + 1; index < endLine; index += 1) sourceLines.push(doc.line(index).text)
    specs.push({
      from: line.from,
      to: doc.line(endLine).to,
      language,
      source: sourceLines.join('\n'),
    })
    lineNumber = endLine + 1
  }
  return specs
}

/** Widget de bloco do bloco de plugin: reutiliza o `ObsidianPluginBlock` do
 * Leitura (titulo, aviso de seguranca, fonte crua) via React. */
class PluginBlockWidget extends WidgetType {
  private readonly spec: PluginBlockSpec
  private root: Root | null = null

  constructor(spec: PluginBlockSpec) {
    super()
    this.spec = spec
  }

  eq(other: PluginBlockWidget) {
    return other.spec.from === this.spec.from
      && other.spec.to === this.spec.to
      && other.spec.language === this.spec.language
      && other.spec.source === this.spec.source
  }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-plugin-block'
    this.root = createRoot(wrap)
    this.root.render(createElement(ObsidianPluginBlock, {
      language: this.spec.language,
      source: this.spec.source,
    }))
    return wrap
  }

  destroy() {
    this.root?.unmount()
    this.root = null
  }
}

type PluginBlockFieldValue = { decorations: DecorationSet; pluginBlockLines: Set<number> }

function buildPluginBlockField(doc: Text): PluginBlockFieldValue {
  const ranges: Range<Decoration>[] = []
  const pluginBlockLines = new Set<number>()
  for (const spec of findPluginBlockSpecs(doc)) {
    ranges.push(Decoration.replace({ widget: new PluginBlockWidget(spec), block: true }).range(spec.from, spec.to))
    const last = lineNumberAt(doc, Math.max(spec.from, spec.to - 1))
    for (let line = lineNumberAt(doc, spec.from); line <= last; line += 1) pluginBlockLines.add(line)
  }
  return { decorations: RangeSet.of(ranges, true), pluginBlockLines }
}

/** StateField dos blocos de plugin (bloco real, como a tabela). Sem opcoes:
 * a renderizacao e estatica (nunca executa a sintaxe do plugin). */
function createPluginBlockField() {
  return StateField.define<PluginBlockFieldValue>({
    create(state) {
      return buildPluginBlockField(state.doc)
    },
    update(value, transaction) {
      if (!transaction.docChanged) return value
      return buildPluginBlockField(transaction.state.doc)
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  })
}

// --- Lacunas da revisao (gap marks): marcas e badges sobre o texto -----------
//
// O Leitura classico sobrepoe as lacunas da ultima revisao como HTML
// (`<mark data-gap>` + badges de pontuacao por unidade) antes do
// ReactMarkdown. No motor unico isso vira um campo de DECORACOES: marcas
// `cm-live-gap` nos offsets exatos das lacunas (com classe forgotten/confused)
// e widgets de badge no fim das unidades. Mesmas guardas do classico
// (multilinha, fences de codigo, matematica display) + os blocos substituidos
// do Misto (tabela, embeds, callouts, blocos de plugin, frontmatter) para
// nunca criar decoração sobreposta a um widget.

/** Carrega novos dados de lacunas para o campo (disparado pelo componente
 * quando as props mudam — o fetch de lacunas e assincrono). */
export const reviewGapDataEffect = StateEffect.define<ReviewGapData | null>()

/** Ranges de texto protegidos: blocos substituidos por widgets + fences de
 * codigo + matematica display + frontmatter. Uma lacuna nunca pode cruzar
 * esses ranges (criaria decoração sobreposta ao widget de bloco). */
function protectedGapRanges(doc: Text): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const frontmatterEnd = frontmatterEndOffset(doc)
  if (frontmatterEnd > 0) ranges.push([0, frontmatterEnd])

  // Fences de codigo e blocos de matematica display ($$...$$), por linha.
  const content = doc.toString()
  let inFence = false
  let inMath = false
  let openStart = 0
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber)
    const text = line.text
    if (inFence) {
      if (/^ {0,3}(`+|~+)\s*$/.test(text)) {
        ranges.push([openStart, line.to])
        inFence = false
      }
      continue
    }
    if (inMath) {
      if (/\$\$\s*$/.test(text)) {
        ranges.push([openStart, line.to])
        inMath = false
      }
      continue
    }
    const fenceOpen = text.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceOpen) {
      inFence = true
      openStart = line.from
      continue
    }
    if (/^\s*\$\$/.test(text)) {
      // Uma linha que e apenas `$$` abre OU fecha um bloco multilinha.
      const onlyDelimiter = /^\s*\$\$\s*$/.test(text)
      if (!onlyDelimiter && /\$\$\s*$/.test(text)) {
        // $$...$$ na mesma linha: bloco completo.
        ranges.push([line.from, line.to])
      } else {
        inMath = true
        openStart = line.from
      }
      continue
    }
  }
  if (inFence) ranges.push([openStart, content.length])
  if (inMath) ranges.push([openStart, content.length])

  // Blocos substituidos por widgets (StateFields): tabela, embeds, callouts e
  // blocos de plugin — ranges absolutos (from/to) de cada spec.
  const tableSpecs = findTableSpecs(doc)
  for (const spec of tableSpecs) ranges.push([spec.from, spec.to])
  for (const spec of findEmbedSpecs(doc, tableSpecs)) ranges.push([spec.from, spec.to])
  for (const spec of findCalloutSpecs(doc)) ranges.push([spec.from, spec.to])
  for (const spec of findPluginBlockSpecs(doc)) ranges.push([spec.from, spec.to])
  return ranges
}

/** Widget de ponto do badge de pontuacao da unidade (fim do paragrafo), com
 * as mesmas classes/rotulos do Leitura classico (`review-unit-score`). */
class UnitScoreWidget extends WidgetType {
  private readonly unit: NoteReviewUnit

  constructor(unit: NoteReviewUnit) {
    super()
    this.unit = unit
  }

  eq(other: UnitScoreWidget) {
    return other.unit === this.unit
  }

  toDOM() {
    const span = document.createElement('span')
    if (!this.unit.evaluated && this.unit.inconclusive) {
      // Evidencia insuficiente: nunca vira zero, nao altera DSR/FSRS.
      span.className = 'review-unit-score is-inconclusive'
      span.setAttribute('data-inconclusive', 'true')
      span.title = 'Evidência insuficiente nesta sessão'
      span.textContent = 'inconclusivo'
      return span
    }
    if (!this.unit.evaluated) {
      // Conteudo nao perguntado nesta sessao: badge neutro, nao zero.
      span.className = 'review-unit-score is-not-evaluated'
      span.setAttribute('data-evaluated', 'false')
      span.title = 'Não avaliado nesta sessão'
      span.textContent = 'não avaliado'
      return span
    }
    const label = unitOutcomeLabel(this.unit.outcome)
    span.className = `review-unit-score is-${this.unit.outcome}`
    span.setAttribute('data-score', String(this.unit.score))
    span.setAttribute('data-outcome', this.unit.outcome)
    span.title = `${label}: ${this.unit.score}`
    span.textContent = String(this.unit.score)
    return span
  }
}

type ReviewGapFieldValue = { decorations: DecorationSet }

function buildReviewGapField(doc: Text, data: ReviewGapData | null): ReviewGapFieldValue {
  const ranges: Range<Decoration>[] = []
  if (!data || !data.enabled) return { decorations: RangeSet.of(ranges, true) }
  if (data.gaps.length === 0 && data.units.length === 0) return { decorations: RangeSet.of(ranges, true) }

  const content = doc.toString()
  // Os offsets das lacunas sao no markdown COMPLETO (com frontmatter). Quando
  // o doc do editor ja tem o frontmatter (Misto), nada a deslocar; quando nao
  // tem (spike usa noteBody), desloca pelo frontmatter da nota original.
  const shift = frontmatterEndOffset(doc) > 0 ? 0 : Math.min(data.bodyOffset, content.length)
  const protectedRanges = protectedGapRanges(doc)
  const insideProtected = (position: number) => {
    if (position < 0 || position >= content.length) return true
    return protectedRanges.some(([start, end]) => position >= start && position < end)
  }

  // Lacunas: marca `cm-live-gap` no texto exato. Mesmas regras do classico:
  // multilinha descartada, sobrepostas descartadas (mantem a primeira),
  // dentro de blocos protegidos descartada.
  const keptGaps = data.gaps
    .map((gap) => ({
      classification: gap.classification,
      start: gap.sourceStartUtf16 - shift,
      end: gap.sourceEndUtf16 - shift,
    }))
    .filter((gap) => gap.start >= 0 && gap.end <= content.length && gap.end > gap.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)

  let cursor = 0
  for (const gap of keptGaps) {
    if (gap.start < cursor) continue
    const slice = content.slice(gap.start, gap.end)
    if (slice.includes('\n') || slice.includes('\r')) continue
    if (insideProtected(gap.start) || insideProtected(gap.end - 1)) continue
    ranges.push(Decoration.mark({ class: `cm-live-gap is-${gap.classification}` }).range(gap.start, gap.end))
    cursor = gap.end
  }

  // Badges de unidade: widget de ponto no fim da unidade. Se o fim cai dentro
  // de um bloco protegido (fence, tabela, embed...), move para o inicio da
  // proxima linha (como o classico); sem proxima linha, descarta.
  const badges: Array<{ at: number; unit: NoteReviewUnit }> = []
  for (const unit of data.units) {
    let at = Math.min(unit.sourceEndUtf16 - shift, content.length)
    if (at < 0) continue
    if (insideProtected(Math.max(0, at - 1))) {
      const nextLine = doc.lineAt(Math.min(at, content.length)).number + 1
      if (nextLine > doc.lines) continue
      at = doc.line(nextLine).from
    }
    badges.push({ at, unit })
  }
  badges.sort((left, right) => left.at - right.at)
  for (const badge of badges) {
    ranges.push(Decoration.widget({ widget: new UnitScoreWidget(badge.unit), side: 1 }).range(badge.at, badge.at))
  }

  return { decorations: RangeSet.of(ranges, true) }
}

/** StateField das lacunas da revisao (marcas + badges). Escuta o efeito
 * `reviewGapDataEffect` para dados que chegam assincronamente. */
function createReviewGapField(options: LivePreviewOptions) {
  return StateField.define<ReviewGapFieldValue>({
    create(state) {
      return buildReviewGapField(state.doc, options.getReviewGapData?.() ?? null)
    },
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(reviewGapDataEffect)) {
          return buildReviewGapField(transaction.state.doc, effect.value)
        }
      }
      if (!transaction.docChanged) return value
      return buildReviewGapField(transaction.state.doc, options.getReviewGapData?.() ?? null)
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  })
}

// --- Frontmatter oculto (design do usuario) --------------------------------
//
// O YAML inicial (`---` ... `---`) NAO fica no topo da nota: o bloco e
// substituido por um espaco invisivel (zero altura) no documento. O resumo e
// a edicao estruturada vivem no CABECALHO do App: uma barra (resumo + arrow
// down) que expande o painel integrado (`FrontmatterPanelForm`) abaixo dela —
// o YAML cru nunca e exibido em lugar nenhum.

/** Resumo do frontmatter para a barra do cabecalho: titulo · N tags (ou N
 * props). Exportado para o App montar a barra inferior do header. */
export function frontmatterSummary(frontmatterText: string): string {
  const lines = frontmatterText.split('\n')
  let title = ''
  let tagCount = 0
  let propertyCount = 0
  let inTagsList = false
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '---' || line.trim() === '') continue
    const titleMatch = line.match(/^title\s*:\s*(.+?)\s*$/)
    if (titleMatch) title = titleMatch[1].replace(/^["']|["']$/g, '')
    const inlineTags = line.match(/^tags\s*:\s*\[(.*)\]\s*$/)
    if (inlineTags) {
      tagCount = (inlineTags[1].match(/[^,\s]+/g) ?? []).length
      inTagsList = false
      continue
    }
    if (/^tags\s*:\s*$/.test(line)) {
      inTagsList = true
      continue
    }
    if (inTagsList) {
      if (/^\s*-\s*/.test(line)) {
        tagCount += 1
        continue
      }
      if (!/^\s/.test(line)) inTagsList = false
    }
    if (/^[^\s:]+:\s*/.test(line)) propertyCount += 1
  }
  const parts: string[] = []
  if (title) parts.push(title)
  if (tagCount > 0) parts.push(`${tagCount} ${tagCount === 1 ? 'tag' : 'tags'}`)
  if (parts.length === 0) parts.push(`${Math.max(1, propertyCount)} ${propertyCount === 1 ? 'propriedade' : 'propriedades'}`)
  return `YAML · ${parts.join(' · ')}`
}

/** Espaco invisivel que substitui o bloco YAML no documento (zero altura):
 * o frontmatter nunca aparece no topo da nota. Nao interativo — o resumo e a
 * edicao estruturada ficam na barra do cabecalho (App). */
class FrontmatterHiddenWidget extends WidgetType {
  eq() { return true }

  toDOM() {
    const div = document.createElement('div')
    div.className = 'cm-live-frontmatter-hidden'
    div.setAttribute('aria-hidden', 'true')
    return div
  }

  ignoreEvent() { return true }
}

type FrontmatterFieldValue = {
  /** Offset apos o `---` de fechamento (fim do bloco oculto). */
  end: number
  decorations: DecorationSet
}

function buildFrontmatterField(doc: Text): FrontmatterFieldValue {
  const end = frontmatterEndOffset(doc)
  if (end <= 0) return { end: 0, decorations: RangeSet.empty }
  const widget = new FrontmatterHiddenWidget()
  const decorations = RangeSet.of([Decoration.replace({ widget, block: true }).range(0, end)], true)
  return { end, decorations }
}

/** StateField do frontmatter: substitui o bloco YAML (0..end) por um espaco
 * invisivel no modo Misto/Leitura. Sem expansao/colapso — o menu vive no
 * cabecalho do App. */
function createFrontmatterField() {
  return StateField.define<FrontmatterFieldValue>({
    create(state) {
      return buildFrontmatterField(state.doc)
    },
    update(value, transaction) {
      if (!transaction.docChanged) return value
      return buildFrontmatterField(transaction.state.doc)
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  })
}

function buildDecorations(view: EditorView, focused: boolean, options: LivePreviewOptions, embedField: StateField<EmbedFieldValue> | null, calloutField: StateField<CalloutFieldValue> | null, pluginBlockField: StateField<PluginBlockFieldValue> | null) {
  const doc = view.state.doc
  const selection = view.state.selection.main
  // A revelacao e condicionada ao foco real do editor: ao abrir a nota (sem
  // foco, caret padrao 0), NADA e revelado — a primeira linha permanece
  // formatada. A revelacao so acontece quando o usuario clica/digita (focus).
  // Em modo de leitura (readOnly) a mascara e sempre ativa: nada revela.
  const carets = focused && !view.state.readOnly ? [selection.from, selection.to] : []
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
  // substituida por um <table> real, entao o plugin nao as decora. O mesmo
  // vale para os embeds (widgets de bloco assincronos).
  const tableLines = view.state.field(livePreviewTableField, false)?.tableLines ?? new Set<number>()
  const embedLines = embedField
    ? (view.state.field(embedField, false)?.embedLines ?? new Set<number>())
    : new Set<number>()
  const calloutLines = calloutField
    ? (view.state.field(calloutField, false)?.calloutLines ?? new Set<number>())
    : new Set<number>()
  const pluginBlockLines = pluginBlockField
    ? (view.state.field(pluginBlockField, false)?.pluginBlockLines ?? new Set<number>())
    : new Set<number>()

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
    // Matematica dentro de tabelas/embeds/callouts/blocos de plugin e
    // renderizada pelo proprio widget (nada de replaces sobrepostos ao widget
    // de bloco).
    const startLine = lineNumberAt(doc, token.from)
    const endLine = lineNumberAt(doc, Math.max(token.from, token.to - 1))
    let inBlockWidget = false
    for (let line = startLine; line <= endLine; line += 1) {
      if (tableLines.has(line) || embedLines.has(line) || calloutLines.has(line) || pluginBlockLines.has(line)) {
        inBlockWidget = true
        break
      }
    }
    if (inBlockWidget) continue
    push(token.kind === 'math' ? mathDecorations(token, doc) : tokenDecorations(token, doc, options))
  }

  for (let index = firstLine; index <= lastLine; index += 1) {
    const line = doc.line(index)
    const lineText = line.text
    const tokens = lineTokens.get(index) ?? []

    // Tabelas, embeds, callouts e blocos de plugin: os StateFields substituem
    // o range inteiro por um widget de bloco — o ViewPlugin nao decora nenhuma
    // linha coberta.
    if (tableLines.has(index) || embedLines.has(index) || calloutLines.has(index) || pluginBlockLines.has(index)) continue

    // Frontmatter YAML: permanece cru (nada e mascarado).
    if (mask.frontmatterLines.has(index)) continue

    if (isFencedLine(index, mask.fencedLines)) {
      for (const token of tokens) {
        if (token.kind !== 'fence') continue
        if (isTokenRevealed(token, carets, doc)) continue
        push(tokenDecorations(token, doc, options))
      }
      continue
    }

    // Linha normal: mascara os tokens da arvore e os wikilinks por regex.
    // O parser Lezer cria nos `Link` para a sintaxe `[[...]]` (reference-like)
    // que se sobrepoem ao wikilink por regex — o regex e o correto (alvo,
    // alias e fragmento). Exclui da arvore os tokens que sobrepoem um wikilink.
    // Imagens `![[...]]` tambem geram `Link` interno: o token `image` vence
    // sobre QUALQUER token sobreposto (Link da arvore e wikilink por regex).
    const imageTokens = tokens.filter((token) => token.kind === 'image')
    const imageRanges = imageTokens.map((token) => ({ from: token.from, to: token.to }))
    const wikilinkTokens = findMaskTokens(lineText, line.from)
      .filter((token) => token.kind === 'wikilink')
      .filter((wiki) => !rangesOverlap(wiki.from, wiki.to, imageRanges))
    // HTML aninhado (`<a><b>x</b></a>`): so o token mais EXTERNO renderiza
    // (o par interno e coberto pelo token externo).
    const htmlTokens = tokens.filter((token) => token.kind === 'html')
    const treeTokens = tokens.filter((token) => {
      if (token.kind === 'image') return true
      if (rangesOverlap(token.from, token.to, imageRanges)) return false
      if (token.kind === 'html') {
        return !htmlTokens.some((other) => other !== token && other.from <= token.from && other.to >= token.to)
      }
      return !wikilinkTokens.some((wiki) => rangesOverlap(wiki.from, wiki.to, [token]))
    })
    const allTokens = [...treeTokens, ...wikilinkTokens]
    allTokens.sort((left, right) => left.from - right.from || left.to - right.to)
    for (const token of allTokens) {
      if (token.kind === 'fence' || token.kind === 'math' || token.kind === 'hr') continue
      if (isTokenRevealed(token, carets, doc)) continue
      push(tokenDecorations(token, doc, options))
    }
  }

  // RangeSet.of ordena internamente (permite misturar decoracoes de ponto,
  // como linhas de tabela, com decoracoes de intervalo).
  const ranges = allRanges.map(({ from, to, decoration }) => decoration.range(from, to))
  return RangeSet.of(ranges, true)
}

// A revelacao do Markdown cru acompanha o FOCO real do editor (nao apenas o
// caret do estado): ao abrir a nota sem foco, o caret padrao (posicao 0) nao
// deve exibir a primeira linha em Markdown cru. Um ping vazio disparado pelos
// handlers de focus/blur avisa o plugin para recalcular a mascara.
const focusPing = StateEffect.define<boolean>()

const focusTracking = EditorView.domEventHandlers({
  focus: (_event, view) => {
    view.dispatch({ effects: focusPing.of(true) })
    return false
  },
  blur: (_event, view) => {
    view.dispatch({ effects: focusPing.of(false) })
    return false
  },
})

function livePreviewPlugin(options: LivePreviewOptions, embedField: StateField<EmbedFieldValue> | null, calloutField: StateField<CalloutFieldValue> | null, pluginBlockField: StateField<PluginBlockFieldValue> | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: ReturnType<typeof buildDecorations>
      private focused = false

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, this.focused, options, embedField, calloutField, pluginBlockField)
      }

      update(update: ViewUpdate) {
        let focusChanged = false
        for (const transaction of update.transactions) {
          for (const effect of transaction.effects) {
            if (effect.is(focusPing)) {
              this.focused = effect.value
              focusChanged = true
            }
          }
        }
        if (update.docChanged || update.selectionSet || update.viewportChanged || focusChanged) {
          this.decorations = buildDecorations(update.view, this.focused, options, embedField, calloutField, pluginBlockField)
        }
      }
    },
    { decorations: (value) => value.decorations },
  )
}

/**
 * Extensoes do modo Misto. Vira uma factory para receber as opcoes do
 * componente (ex.: callback de navegacao de links, lido via getter para
 * nunca ficar obsoleto entre re-renders).
 */
export function markdownLivePreview(options: LivePreviewOptions = {}) {
  // O campo de embeds so existe quando ha como ler o conteudo (getEmbedContent)
  // — sem ele, `![[nota]]` fica com o comportamento anterior (widget de imagem).
  const embedField = options.getEmbedContent ? createEmbedField(options) : null
  const calloutField = createCalloutField(options)
  const pluginBlockField = createPluginBlockField()
  const reviewGapField = createReviewGapField(options)
  const frontmatterField = createFrontmatterField()
  return [
    livePreviewTableField,
    focusTracking,
    livePreviewPlugin(options, embedField, calloutField, pluginBlockField),
    ...(embedField ? [embedField] : []),
    calloutField,
    pluginBlockField,
    reviewGapField,
    frontmatterField,
  ]
}
