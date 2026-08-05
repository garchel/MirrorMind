export type GapHighlightInput = {
  classification: 'forgotten' | 'confused'
  sourceStartUtf16: number
  sourceEndUtf16: number
}

/**
 * Wraps each gap range with an inline `<mark data-gap="...">` element, using
 * UTF-16 offsets relative to `content` (after shifting by `bodyOffset`).
 * Returns the original content unchanged when no gap fits the visible body.
 */
export function applyGapHighlight(
  content: string,
  gaps: GapHighlightInput[],
  bodyOffset: number,
) {
  if (gaps.length === 0) return content
  const sorted = gaps
    .map((gap) => ({
      start: gap.sourceStartUtf16 - bodyOffset,
      end: gap.sourceEndUtf16 - bodyOffset,
      classification: gap.classification,
    }))
    .filter((gap) => gap.start >= 0 && gap.end <= content.length && gap.end > gap.start)
    .sort((left, right) => left.start - right.start)
  if (sorted.length === 0) return content

  let result = ''
  let cursor = 0
  for (const gap of sorted) {
    if (gap.start < cursor) continue
    result += content.slice(cursor, gap.start)
    result += `<mark data-gap="${gap.classification}">${content.slice(gap.start, gap.end)}</mark>`
    cursor = gap.end
  }
  result += content.slice(cursor)
  return result
}
