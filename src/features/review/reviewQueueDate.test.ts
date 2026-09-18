import { describe, expect, it } from 'vitest'
import { formatOverdueDate, formatUpcomingDate } from './reviewQueueDate'

describe('review queue dates', () => {
  it('labels overdue notes by local calendar day', () => {
    const now = new Date(2026, 6, 22, 0, 15).getTime()
    const yesterday = new Date(2026, 6, 21, 23, 30).getTime()

    expect(formatOverdueDate(yesterday, now)).toBe('Vencida há 1 dia')
  })

  it('labels upcoming reviews from tomorrow to the formatted date', () => {
    const now = new Date(2026, 6, 22, 12, 0).getTime()
    const day = 86_400_000

    expect(formatUpcomingDate(now, now)).toBe('Vence hoje')
    expect(formatUpcomingDate(now + day, now)).toBe('Amanhã')
    expect(formatUpcomingDate(now + 3 * day, now)).toBe('Em 3 dias')
    expect(formatUpcomingDate(now + 6 * day, now)).toBe('Em 6 dias')
    expect(formatUpcomingDate(now + 10 * day, now)).toBe(
      new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(now + 10 * day)),
    )
  })
})
