import { describe, expect, it } from 'vitest'
import { MAX_DUE_REVIEW_ITEMS, parseDueReviewQueue, UPCOMING_PAGE_SIZE } from './reviewQueue'

describe('review queue contract', () => {
  it('accepts the ordered due-note payload exposed by the backend', () => {
    const payload = [{
      noteId: 'note-1',
      relativePath: 'Biologia/Fotossintese.md',
      title: 'Fotossintese',
      nextReviewAtUnixMs: 1_720_000_000_000,
      priorityWeight: 3,
      prioritySource: { kind: 'tag', sourceId: 'revisao/prova' },
      deadlineAtUnixMs: null,
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
      prioritySource: { kind: 'vaultDefault', sourceId: null },
      deadlineAtUnixMs: null,
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
      prioritySource: { kind: 'vaultDefault', sourceId: null },
      preferredMode: 'unknown',
      isFirstReview: true,
    }])).toThrow()
  })

  it('requests the upcoming page in chunks of five', () => {
    expect(UPCOMING_PAGE_SIZE).toBe(5)
  })
})