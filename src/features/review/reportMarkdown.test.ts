import { describe, expect, it } from 'vitest'
import { annotateReviewMarkdown, unitOutcomeLabel } from './reportMarkdown'

describe('annotateReviewMarkdown', () => {
  it('marks a gap and appends the unit score badge at the paragraph end', () => {
    const markdown = 'A energia luminosa alimenta a fotossintese.'
    const result = annotateReviewMarkdown(
      markdown,
      [{ classification: 'forgotten', sourceStartUtf16: 2, sourceEndUtf16: 18 }],
      [{ sourceStartUtf16: 0, sourceEndUtf16: markdown.length, score: 72, outcome: 'good' }],
    )
    expect(result).toBe(
      'A <mark data-gap="forgotten">energia luminosa</mark> alimenta a fotossintese.'
      + '<span class="review-unit-score is-good" data-score="72" data-outcome="good" title="Boa: 72">72</span>',
    )
  })

  it('shifts UTF-16 ranges by the frontmatter length', () => {
    const markdown = '---\ntitle: Nota\n---\n\nA energia luminosa alimenta a fotossintese.'
    const bodyStart = markdown.indexOf('A energia')
    const bodyEnd = markdown.length
    const result = annotateReviewMarkdown(
      markdown,
      [{ classification: 'confused', sourceStartUtf16: bodyStart + 2, sourceEndUtf16: bodyStart + 18 }],
      [{ sourceStartUtf16: bodyStart, sourceEndUtf16: bodyEnd, score: 50, outcome: 'partial' }],
    )
    expect(result).toContain('<mark data-gap="confused">energia luminosa</mark>')
    expect(result.endsWith('class="review-unit-score is-partial" data-score="50" data-outcome="partial" title="Dificil: 50">50</span>')).toBe(true)
    expect(result).not.toContain('---')
  })

  it('skips gap marks inside fenced code and moves the badge of a code unit after the fence', () => {
    const markdown = '```js\nconst energia = 1\n```\n\nA energia e conservada.'
    const fenceEnd = markdown.indexOf('```', 3) + 3
    const paraStart = markdown.indexOf('A energia')
    const result = annotateReviewMarkdown(
      markdown,
      [{ classification: 'forgotten', sourceStartUtf16: 5, sourceEndUtf16: 20 }],
      [
        { sourceStartUtf16: 0, sourceEndUtf16: fenceEnd, score: 45, outcome: 'partial' },
        { sourceStartUtf16: paraStart, sourceEndUtf16: markdown.length, score: 88, outcome: 'good' },
      ],
    )
    // Nenhum mark dentro do bloco de codigo: o texto do fence permanece intacto.
    expect(result).not.toContain('<mark data-gap')
    expect(result).toContain('```\n<span class="review-unit-score is-partial" data-score="45"')
    expect(result).toContain('A energia e conservada.<span class="review-unit-score is-good" data-score="88"')
  })

  it('skips overlapping and multi-line gaps while keeping the first one', () => {
    const markdown = 'abcdefghij'
    const result = annotateReviewMarkdown(
      markdown,
      [
        { classification: 'forgotten', sourceStartUtf16: 1, sourceEndUtf16: 3 },
        { classification: 'confused', sourceStartUtf16: 2, sourceEndUtf16: 5 },
        { classification: 'forgotten', sourceStartUtf16: 0, sourceEndUtf16: 11 },
      ],
      [],
    )
    expect(result).toBe('a<mark data-gap="forgotten">bc</mark>defghij')
  })

  it('skips a multi-line gap entirely', () => {
    const markdown = 'Linha um\nLinha dois'
    const result = annotateReviewMarkdown(
      markdown,
      [{ classification: 'forgotten', sourceStartUtf16: 0, sourceEndUtf16: 17 }],
      [],
    )
    expect(result).toBe(markdown)
  })

  it('keeps the closing fence intact when the note ends with a fence and no trailing newline', () => {
    const markdown = '```\nconst energia = 1\n```'
    const result = annotateReviewMarkdown(
      markdown,
      [],
      [{ sourceStartUtf16: 0, sourceEndUtf16: markdown.length, score: 88, outcome: 'good' }],
    )
    // O badge vira um bloco proprio apos uma quebra de linha: a linha de
    // fechamento do fence permanece valida.
    expect(result).toBe('```\nconst energia = 1\n```\n<span class="review-unit-score is-good" data-score="88" data-outcome="good" title="Boa: 88">88</span>')
  })

  it('protects unclosed fences from marks and badges', () => {
    const markdown = '```js\nconst energia = 1\nresto do codigo'
    const result = annotateReviewMarkdown(
      markdown,
      [{ classification: 'forgotten', sourceStartUtf16: 10, sourceEndUtf16: 24 }],
      [{ sourceStartUtf16: 0, sourceEndUtf16: markdown.length, score: 60, outcome: 'partial' }],
    )
    expect(result).not.toContain('<mark data-gap')
    expect(result.endsWith('\n<span class="review-unit-score is-partial" data-score="60" data-outcome="partial" title="Dificil: 60">60</span>')).toBe(true)
  })

  it('keeps the body unchanged when there is nothing to annotate', () => {
    const markdown = 'Conteudo sem lacunas nem unidades.'
    expect(annotateReviewMarkdown(markdown, [], [])).toBe(markdown)
  })

  it('labels each outcome band', () => {
    expect(unitOutcomeLabel('forgotten')).toBe('Esquecida')
    expect(unitOutcomeLabel('partial')).toBe('Dificil')
    expect(unitOutcomeLabel('good')).toBe('Boa')
    expect(unitOutcomeLabel('complete')).toBe('Completa')
  })
})
