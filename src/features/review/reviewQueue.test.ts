import { describe, expect, it } from 'vitest'
import { MAX_DUE_REVIEW_ITEMS, parseDueReviewQueue } from './reviewQueue'

describe('review queue contract', () => {
  it('accepts the ordered due-note payload exposed by the backend', () => {
    const payload = [{
      noteId: 'note-1',
      relativePath: 'Biologia/Fotossintese.md',
      title: 'Fotossintese',
      nextReviewAtUnixMs: 1_720_000_000_000,
      priorityWeight: 3,
      preferredMode: 'exam',
      isFirstReview: true,
    }]

    expect(parseDueReviewQueue(payload)).toEqual(payload)
  })

  it('rejects a payload above the backend queue limit', () => {
    const item = {
      noteId: 'note-1',
      relativePath: 'Nota.md',
      title: 'Nota',
      nextReviewAtUnixMs: 1,
      priorityWeight: 1,
      preferredMode: 'exam' as const,
      isFirstReview: true,
    }

    expect(() => parseDueReviewQueue(Array.from({ length: MAX_DUE_REVIEW_ITEMS + 1 }, () => item))).toThrow()
  })

  it('rejects queue items without a safe review date and mode', () => {
    expect(() => parseDueReviewQueue([{
      noteId: 'note-1',
      relativePath: 'Nota.md',
      title: 'Nota',
      nextReviewAtUnixMs: -1,
      priorityWeight: 1,
      preferredMode: 'unknown',
      isFirstReview: true,
    }])).toThrow()
  })
})