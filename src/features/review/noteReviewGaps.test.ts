import { describe, expect, it } from 'vitest'
import { parseNoteReviewGaps } from './noteReviewGaps'

const gaps = [
  {
    classification: 'forgotten',
    sourceQuote: 'energia luminosa',
    sourceStartUtf16: 24,
    sourceEndUtf16: 40,
  },
  {
    classification: 'confused',
    sourceQuote: 'glicose e oxigênio',
    sourceStartUtf16: 145,
    sourceEndUtf16: 162,
  },
]

describe('note review gaps schema', () => {
  it('accepts a list of grounded gaps', () => {
    expect(parseNoteReviewGaps(gaps)).toEqual(gaps)
  })

  it('accepts an empty list for notes without a session', () => {
    expect(parseNoteReviewGaps([])).toEqual([])
  })

  it('rejects a gap whose range is inverted or empty', () => {
    const inverted = [{ ...gaps[0], sourceEndUtf16: 20 }]
    expect(() => parseNoteReviewGaps(inverted)).toThrow()
  })

  it('rejects an unknown classification', () => {
    const unknown = [{ ...gaps[0], classification: 'skipped' }]
    expect(() => parseNoteReviewGaps(unknown)).toThrow()
  })

  it('rejects an empty source quote', () => {
    const emptyQuote = [{ ...gaps[0], sourceQuote: '  ' }]
    expect(() => parseNoteReviewGaps(emptyQuote)).toThrow()
  })
})
