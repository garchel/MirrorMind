export function formatOverdueDate(timestamp: number, nowTimestamp = Date.now()): string {
  const today = new Date(nowTimestamp)
  const dueDate = new Date(timestamp)
  const todayUtcDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const dueUtcDay = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
  const overdueDays = Math.max(0, Math.round((todayUtcDay - dueUtcDay) / 86_400_000))
  if (overdueDays === 0) return 'Venceu hoje'
  if (overdueDays === 1) return 'Vencida há 1 dia'
  return `Vencida há ${overdueDays} dias`
}

/** Rótulo de um vencimento futuro ("Amanhã", "Em 3 dias", "12 de out"). */
export function formatUpcomingDate(timestamp: number, nowTimestamp = Date.now()): string {
  const today = new Date(nowTimestamp)
  const dueDate = new Date(timestamp)
  const todayUtcDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const dueUtcDay = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
  const aheadDays = Math.max(0, Math.round((dueUtcDay - todayUtcDay) / 86_400_000))
  if (aheadDays === 0) return 'Vence hoje'
  if (aheadDays === 1) return 'Amanhã'
  if (aheadDays < 7) return `Em ${aheadDays} dias`
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(dueDate)
}