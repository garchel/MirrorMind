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
          { id: 'question-1', text: 'Como a energia muda?', assistance: 'Pense nas formas de energia.' },
          { id: 'question-2', text: 'Quais substancias participam?', assistance: 'Considere os reagentes.' },
          { id: 'question-3', text: 'O que e liberado?', assistance: 'A nota cita um gas.' },
        ],
        minimumAnswers: 3,
        maximumAnswers: 5,
      },
    }

    expect(parseReviewGenerationAttempt(payload)).toEqual(payload)
    expect(JSON.stringify(payload)).not.toContain('sourceMarkdown')
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
        gaps: [{
          classification: 'confused',
          sourceQuote: 'energia luminosa',
          sourceStartUtf16: 24,
          sourceEndUtf16: 40,
        }],
        completedAtUnixMs: 1_730_000_000_000,
        nextReviewAtUnixMs: 1_730_604_800_000,
      },
    })).toMatchObject({
      outcome: 'valid',
      report: { overallScore: 72, outcome: 'good' },
    })
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
        gaps: [],
        completedAtUnixMs: 1,
        nextReviewAtUnixMs: 2,
      },
    })).toThrow()
  })
})