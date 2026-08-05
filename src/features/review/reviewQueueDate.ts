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