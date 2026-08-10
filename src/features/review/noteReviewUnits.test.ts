import { describe, expect, it } from 'vitest'
import { parseNoteReviewUnits } from './noteReviewUnits'

const units = [
  {
    sourceStartUtf16: 0,
    sourceEndUtf16: 100,
    evaluated: true,
    inconclusive: false,
    score: 85,
    outcome: 'good',
  },
  {
    sourceStartUtf16: 100,
    sourceEndUtf16: 200,
    evaluated: true,
    inconclusive: false,
    score: 30,
    outcome: 'forgotten',
  },
]

describe('note review units schema', () => {
  it('accepts a list of evaluated units', () => {
    expect(parseNoteReviewUnits(units)).toEqual(units)
  })

  it('accepts an empty list for notes without a session', () => {
    expect(parseNoteReviewUnits([])).toEqual([])
  })

  it('defaults inconclusive to false', () => {
    const [first] = parseNoteReviewUnits([{ ...units[0], inconclusive: undefined }])
    expect(first.inconclusive).toBe(false)
  })

  it('accepts an inconclusive unit (not evaluated, no band match)', () => {
    const inconclusive = {
      sourceStartUtf16: 0,
      sourceEndUtf16: 100,
      evaluated: false,
      inconclusive: true,
      score: 0,
      outcome: 'forgotten',
    }
    expect(parseNoteReviewUnits([inconclusive])).toEqual([inconclusive])
  })

  it('rejects an inverted or empty range', () => {
    const inverted = [{ ...units[0], sourceEndUtf16: 0 }]
    expect(() => parseNoteReviewUnits([inverted])).toThrow()
  })

  it('rejects a score out of the 0-100 band', () => {
    const outOfBand = [{ ...units[0], score: 101 }]
    expect(() => parseNoteReviewUnits([outOfBand])).toThrow()
  })

  it('rejects an unknown outcome', () => {
    const unknown = [{ ...units[0], outcome: 'skipped' }]
    expect(() => parseNoteReviewUnits([unknown])).toThrow()
  })
})
