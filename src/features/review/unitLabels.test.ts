import { describe, expect, it } from 'vitest'
import { dominantUnitKind, unitCountLabel, unitNoun, unitPluralNoun } from './unitLabels'

describe('unitLabels', () => {
  it('labels a homogeneous section collection as seções', () => {
    expect(dominantUnitKind(['section', 'section'])).toBe('section')
    expect(unitNoun('section')).toBe('seção')
    expect(unitPluralNoun('section')).toBe('seções')
    expect(unitCountLabel(1, ['section'])).toBe('1 seção')
    expect(unitCountLabel(3, ['section', 'section'])).toBe('3 seções')
  })

  it('labels a homogeneous paragraph collection as parágrafos', () => {
    expect(dominantUnitKind(['paragraph'])).toBe('paragraph')
    expect(unitCountLabel(1, ['paragraph'])).toBe('1 parágrafo')
    expect(unitCountLabel(8, ['paragraph', 'paragraph'])).toBe('8 parágrafos')
  })

  it('falls back to the neutral unidades for mixed or unknown kinds', () => {
    // Preambulo em paragrafo + secoes, ou kinds ausentes, ficam neutros.
    expect(dominantUnitKind(['paragraph', 'section'])).toBe('mixed')
    expect(unitCountLabel(5, ['paragraph', 'section'])).toBe('5 unidades')
    expect(unitCountLabel(2, [])).toBe('2 unidades')
    expect(unitCountLabel(1, [undefined])).toBe('1 unidade')
  })

  it('treats the whole-note kind as neutral', () => {
    expect(dominantUnitKind(['wholeNote'])).toBe('mixed')
    expect(unitCountLabel(1, ['wholeNote'])).toBe('1 unidade')
  })
})
