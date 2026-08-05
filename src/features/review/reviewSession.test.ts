import { describe, expect, it } from 'vitest'
import {
  parseConversationTurnAttempt,
  parseReviewCompletionAttempt,
  parseReviewGenerationAttempt,
} from './reviewSession'

describe('review session IPC contracts', () => {
  it('accepts a generated exam draft without exposing note content', () => {
    const payload = {
      outcome: 'valid',
      draft: {
        sessionId: 'session-1',
        noteId: 'note-1',
        relativePath: 'Biologia/Fotossintese.md',
        noteContentHash: 'sha256:content',
        mode: 'exam',
        provider: 'ollama',
        prompts: [
          {
            id: 'question-1', text: 'Como a energia muda?', assistance: 'Pense nas formas de energia.',
            options: ['Quimica', 'Luminosa', 'Termica', 'Nuclear'],
          },
          {
            id: 'question-2', text: 'Quais substancias participam?', assistance: 'Considere os reagentes.',
            options: ['Agua e gas carbonico', 'Oxigenio e hidrogenio', 'Glucose e ATP', 'Sais e proteinas'],
          },
          {
            id: 'question-3', text: 'O que e liberado?', assistance: 'A nota cita um gas.',
            options: ['Nitrogenio', 'Hidrogenio', 'Oxigenio', 'Metano'],
          },
        ],
        minimumAnswers: 3,
        maximumAnswers: 5,
      },
    }

    expect(parseReviewGenerationAttempt(payload)).toEqual(payload)
    expect(JSON.stringify(payload)).not.toContain('sourceMarkdown')
    // A alternativa correta nunca e exposta ao cliente no contrato do rascunho.
    expect(JSON.stringify(payload)).not.toContain('correctOptionIndex')
  })

  it('accepts a progressive conversation turn and a grounded final report', () => {
    expect(parseConversationTurnAttempt({
      outcome: 'valid',
      prompt: {
        id: 'turn-2',
        text: 'Por que isso acontece?',
        assistance: 'Considere o mecanismo descrito.',
      },
      shouldFinish: false,
    })).toMatchObject({ outcome: 'valid', shouldFinish: false })

    expect(parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 72,
        outcome: 'good',
        summary: 'Bom dominio, com uma imprecisao.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [{
          id: 'unit-1', ordinal: 0, sourceStartUtf16: 0, sourceEndUtf16: 46,
          sectionPath: [], score: 72, outcome: 'good',
        }],
        gaps: [{
          classification: 'confused',
          sourceQuote: 'energia luminosa',
          sourceStartUtf16: 2,
          sourceEndUtf16: 18,
        }],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toMatchObject({
      outcome: 'valid',
      report: { overallScore: 72, outcome: 'good', units: [{ score: 72 }] },
    })
  })

  it('rejects a report whose overall score is not the rounded mean of the units', () => {
    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 90,
        outcome: 'complete',
        summary: 'Inconsistente.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [
          { id: 'unit-1', ordinal: 0, sourceStartUtf16: 0, sourceEndUtf16: 23, sectionPath: [], score: 100, outcome: 'complete' },
          { id: 'unit-2', ordinal: 1, sourceStartUtf16: 25, sourceEndUtf16: 46, sectionPath: [], score: 100, outcome: 'complete' },
        ],
        gaps: [],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toThrow()
  })

  it('rejects a unit scored 100 while a gap lies inside its range', () => {
    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 95,
        outcome: 'complete',
        summary: 'Inconsistente.',
        markdown: 'A energia luminosa alimenta a fotossintese.',
        units: [{
          id: 'unit-1', ordinal: 0, sourceStartUtf16: 0, sourceEndUtf16: 46,
          sectionPath: [], score: 100, outcome: 'complete',
        }],
        gaps: [{ classification: 'forgotten', sourceQuote: 'energia', sourceStartUtf16: 2, sourceEndUtf16: 9 }],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toThrow()
  })

  it('rejects unbounded or structurally inconsistent payloads', () => {
    expect(() => parseReviewGenerationAttempt({
      outcome: 'valid',
      draft: {
        sessionId: 'session-1',
        noteId: 'note-1',
        relativePath: 'Nota.md',
        noteContentHash: 'sha256:content',
        mode: 'exam',
        provider: 'ollama',
        prompts: [],
        minimumAnswers: 3,
        maximumAnswers: 5,
      },
    })).toThrow()

    expect(() => parseReviewCompletionAttempt({
      outcome: 'valid',
      report: {
        sessionId: 'session-1',
        overallScore: 120,
        outcome: 'complete',
        summary: 'Invalido.',
        markdown: 'Conteudo.',
        units: [{ id: 'unit-1', ordinal: 0, sourceStartUtf16: 0, sourceEndUtf16: 9, sectionPath: [], score: 120, outcome: 'complete' }],
        gaps: [],
        completedAtUnixMs: 1,
        nextReviewAtUnixMs: 2,
      },
    })).toThrow()
  })
})