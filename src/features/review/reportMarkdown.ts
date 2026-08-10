import { getMarkdownBody } from '../../lib/markdown'

export type ReviewReportGap = {
  classification: 'forgotten' | 'confused'
  sourceStartUtf16: number
  sourceEndUtf16: number
}

export type ReviewReportUnit = {
  sourceStartUtf16: number
  sourceEndUtf16: number
  // Unidade efetivamente avaliada nesta sessão (alvo da cobertura adaptativa).
  // Unidades fora do alvo ficam marcadas como não avaliadas, sem pontuar zero.
  evaluated: boolean
  // Unidade do alvo com evidência insuficiente (inconclusiva): nunca pontua
  // zero, não altera DSR/FSRS e não entra na média.
  inconclusive?: boolean
  score: number
  outcome: 'forgotten' | 'partial' | 'good' | 'complete'
}

const UNIT_OUTCOME_LABELS: Record<ReviewReportUnit['outcome'], string> = {
  forgotten: 'Esquecida',
  partial: 'Dificil',
  good: 'Boa',
  complete: 'Completa',
}

export function unitOutcomeLabel(outcome: ReviewReportUnit['outcome']) {
  return UNIT_OUTCOME_LABELS[outcome]
}

type Line = { start: number; end: number; text: string }
type Range = [number, number]

function lineOffsets(content: string): Line[] {
  const lines: Line[] = []
  const pattern = /[^\r\n]*(?:\r\n|\n)?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match[0].length === 0) break
    const text = match[0].replace(/\r?\n$/, '')
    lines.push({ start: match.index, end: match.index + text.length, text })
  }
  return lines
}

function displayMathRanges(lines: Line[], contentLength: number): Range[] {
  const ranges: Range[] = []
  let openStart: number | null = null
  for (const line of lines) {
    const text = line.text
    const opening = /^\s*\$\$/.test(text)
    const closing = /\$\$\s*$/.test(text)
    if (openStart === null) {
      if (opening) {
        // Uma linha que e apenas o delimitador ($$) e abertura OU fechamento
        // de um bloco multilinha, nunca um bloco completo de uma linha.
        const onlyDelimiter = /^\s*\$\$\s*$/.test(text)
        if (closing && !onlyDelimiter) {
          // $$...$$ na mesma linha: bloco completo em uma unica linha.
          ranges.push([line.start, line.end])
        } else {
          openStart = line.start
        }
      }
    } else if (closing) {
      ranges.push([openStart, line.end])
      openStart = null
    }
  }
  // Um bloco de matematica sem fechamento protege todo o restante do corpo,
  // como os fences de codigo nao fechados.
  if (openStart !== null) ranges.push([openStart, contentLength])
  return ranges
}

function fenceRanges(lines: Line[], contentLength: number): Range[] {
  const ranges: Range[] = []
  let fence: { character: string; length: number } | null = null
  let openStart = 0
  for (const line of lines) {
    const text = line.text
    if (fence) {
      const closing = text.match(/^ {0,3}(`+|~+)\s*$/)
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        ranges.push([openStart, line.end])
        fence = null
      }
      continue
    }
    const opening = text.match(/^ {0,3}(`{3,}|~{3,})/)
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length }
      openStart = line.start
    }
  }
  // Um fence aberto sem fechamento protege todo o restante do corpo, da
  // mesma forma que o renderizador trata blocos de codigo nao fechados.
  if (fence) ranges.push([openStart, contentLength])
  return ranges
}

function unitScoreBadge(unit: ReviewReportUnit) {
  if (!unit.evaluated && unit.inconclusive) {
    // Evidência insuficiente mesmo após esclarecimento: nunca vira zero, não
    // altera DSR/FSRS e não entra na média.
    return '<span class="review-unit-score is-inconclusive" data-inconclusive="true" title="Evidência insuficiente nesta sessão">inconclusivo</span>'
  }
  if (!unit.evaluated) {
    // Conteúdo não perguntado nesta sessão não vira zero: badge neutro que
    // diferencia explicitamente "não avaliado" de "esquecido".
    return '<span class="review-unit-score is-not-evaluated" data-evaluated="false" title="Não avaliado nesta sessão">não avaliado</span>'
  }
  const label = UNIT_OUTCOME_LABELS[unit.outcome] ?? 'Avaliada'
  return `<span class="review-unit-score is-${unit.outcome}" data-score="${unit.score}" data-outcome="${unit.outcome}" title="${label}: ${unit.score}">${unit.score}</span>`
}

/**
 * Annotates the evaluated note with:
 * - `<mark data-gap="forgotten|confused">` around each grounded gap, at the
 *   exact UTF-16 offsets of the full markdown (shifted by the frontmatter).
 * - `<span class="review-unit-score is-...">` with the unit score, placed at
 *   the end of each evaluated paragraph so the rendered note shows the score
 *   of every paragraph.
 *
 * The overlay is deterministic and safe: multi-line gaps and gaps inside
 * fenced code are skipped (they remain listed in the gap summary), and a
 * badge never lands inside a fence so the Markdown stays parseable.
 */
export function annotateReviewMarkdown(
  markdown: string,
  gaps: ReviewReportGap[],
  units: ReviewReportUnit[],
) {
  const body = getMarkdownBody(markdown)
  const bodyOffset = markdown.length - body.length
  const lines = lineOffsets(body)
  const fences = fenceRanges(lines, body.length)
  // Blocos de matematica exibicao ($$...$$) sao protegidos como os fences:
  // um marca-texto ou badge dentro deles quebraria o KaTeX.
  const mathBlocks = displayMathRanges(lines, body.length)
  const protectedRanges = [...fences, ...mathBlocks]
  const insideProtected = (position: number) =>
    protectedRanges.some(([start, end]) => position >= start && position < end)

  const candidateGaps = gaps
    .map((gap) => ({
      classification: gap.classification,
      start: gap.sourceStartUtf16 - bodyOffset,
      end: gap.sourceEndUtf16 - bodyOffset,
    }))
    .filter((gap) => gap.start >= 0 && gap.end <= body.length && gap.end > gap.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)

  const keptGaps: typeof candidateGaps = []
  let cursor = 0
  for (const gap of candidateGaps) {
    if (gap.start < cursor) continue
    const slice = body.slice(gap.start, gap.end)
    if (slice.includes('\n') || slice.includes('\r')) continue
    if (insideProtected(gap.start) || insideProtected(gap.end)) continue
    keptGaps.push(gap)
    cursor = gap.end
  }

  const badges = units
    .map((unit) => {
      const start = unit.sourceStartUtf16 - bodyOffset
      const end = unit.sourceEndUtf16 - bodyOffset
      if (end <= 0 || start >= body.length || end > body.length) return null
      let at = Math.max(0, Math.min(end, body.length))
      let html = unitScoreBadge(unit)
      for (const [blockStart, blockEnd] of protectedRanges) {
        if (at >= blockStart && at <= blockEnd) {
          const nextLine = lines.find((line) => line.start > blockEnd)
          if (nextLine) {
            at = nextLine.start
          } else {
            // Sem linha seguinte, o bloco protegido vai ate o fim do corpo e
            // o badge nunca pode ficar na linha dele (quebraria codigo ou
            // KaTeX): ele vira um bloco proprio apos uma quebra de linha.
            html = `\n${html}`
            at = body.length
          }
          break
        }
      }
      return { at, html }
    })
    .filter((badge) => badge !== null) as Array<{ at: number; html: string }>
  badges.sort((left, right) => left.at - right.at)

  const opens = new Map<number, string>()
  const closes = new Set<number>()
  for (const gap of keptGaps) {
    opens.set(gap.start, gap.classification)
    closes.add(gap.end)
  }
  const badgeAt = new Map<number, string>()
  for (const badge of badges) badgeAt.set(badge.at, badge.html)

  const positions = [...new Set([
    ...opens.keys(),
    ...closes,
    ...badgeAt.keys(),
  ])].sort((left, right) => left - right)

  let result = ''
  let offset = 0
  for (const position of positions) {
    result += body.slice(offset, position)
    offset = position
    const opening = opens.get(position)
    if (opening) result += `<mark data-gap="${opening}">`
    if (closes.has(position)) result += '</mark>'
    const badge = badgeAt.get(position)
    if (badge) result += badge
  }
  result += body.slice(offset)
  return result
}
