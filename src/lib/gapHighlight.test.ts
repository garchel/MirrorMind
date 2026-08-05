import { describe, expect, it } from 'vitest'
import { applyGapHighlight } from './gapHighlight'

describe('applyGapHighlight', () => {
  it('wraps a single gap range with the correct classification', () => {
    const content = 'A energia luminosa alimenta a fotossintese.'
    const result = applyGapHighlight(content, [{
      classification: 'forgotten',
      sourceStartUtf16: 2,
      sourceEndUtf16: 18,
    }], 0)
    expect(result).toBe(
      'A <mark data-gap="forgotten">energia luminosa</mark> alimenta a fotossintese.',
    )
  })

  it('preserves the untouched content when there are no gaps', () => {
    const content = 'Conteudo sem lacunas.'
    expect(applyGapHighlight(content, [], 0)).toBe(content)
  })

  it('shifts ranges by the body offset', () => {
    const fullContent = 'frontmatter-extra\nConteudo do corpo.'
    const body = 'Conteudo do corpo.'
    const bodyOffset = fullContent.length - body.length
    const result = applyGapHighlight(body, [{
      classification: 'confused',
      sourceStartUtf16: bodyOffset + 0,
      sourceEndUtf16: bodyOffset + 8,
    }], bodyOffset)
    expect(result).toBe('<mark data-gap="confused">Conteudo</mark> do corpo.')
  })

  it('sorts overlapping ranges and skips ranges outside the visible body', () => {
    const content = 'abcde'
    const result = applyGapHighlight(content, [
      { classification: 'forgotten', sourceStartUtf16: 1, sourceEndUtf16: 3 },
      { classification: 'confused', sourceStartUtf16: 2, sourceEndUtf16: 4 },
      { classification: 'forgotten', sourceStartUtf16: 100, sourceEndUtf16: 110 },
      { classification: 'confused', sourceStartUtf16: -5, sourceEndUtf16: 0 },
    ], 0)
    expect(result).toBe('a<mark data-gap="forgotten">bc</mark>de')
  })
})
