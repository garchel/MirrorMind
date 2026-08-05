import { useEffect, useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock3, Layers, ListTodo, RefreshCw, TimerReset, TrendingUp } from 'lucide-react'
import { forecastDayLabel, getVaultReviewDashboard, type DailyLoadItem, type UpcomingDeadlineItem, type VaultReviewDashboard } from './reviewDashboard'
import './review-dashboard.css'

type Props = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
}

function formatPercentage(value: number | null) {
  if (value === null) return '—'
  return `${Math.round(value * 100)}%`
}

function formatStability(value: number | null) {
  if (value === null) return '—'
  return `${value.toFixed(1)} dias`
}

function formatDeadline(deadline: number) {
  const formatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
  return formatter.format(new Date(deadline))
}

function deadlineClass(deadline: number) {
  const withinWeek = deadline <= Date.now() + 7 * 86_400_000
  return withinWeek ? 'is-urgent' : ''
}

function StatCard({ icon, label, value, hint }: {
  icon: React.ReactNode
  label: string
  value: string | number
  hint: string
}) {
  return (
    <div className="review-dashboard-card">
      <span className="review-dashboard-card-icon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
      <small>{hint}</small>
    </div>
  )
}

export function ReviewDashboardPage({ vaultPath, onOpenNote }: Props) {
  const [dashboard, setDashboard] = useState<VaultReviewDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    void getVaultReviewDashboard(vaultPath)
      .then((next) => {
        if (requestId === requestIdRef.current) setDashboard(next)
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Não foi possível carregar o painel do vault.')
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [reloadRequest, vaultPath])

  return (
    <section className="workspace-page review-dashboard-page w-full" aria-labelledby="review-dashboard-title">
      <header className="review-dashboard-header">
        <div>
          <p className="card-kicker">Aprendizado</p>
          <h2 id="review-dashboard-title">Painel do vault</h2>
          <p>Visão geral da retenção de memória, prazos e carga de revisão.</p>
        </div>
        <button
          type="button"
          className="secondary-button review-dashboard-refresh"
          onClick={() => setReloadRequest((request) => request + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Atualizar
        </button>
      </header>

      {loading ? (
        <div className="review-dashboard-status" role="status">Calculando métricas do vault...</div>
      ) : error ? (
        <div className="review-dashboard-status is-error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={() => setReloadRequest((request) => request + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : dashboard ? (
        <>
          <div className="review-dashboard-grid">
            <StatCard
              icon={<CheckCircle2 size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Notas em aprendizado"
              value={dashboard.enrolledNoteCount}
              hint="Prontas e participando da revisão."
            />
            <StatCard
              icon={<Clock3 size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Vencidas agora"
              value={dashboard.dueNoteCount}
              hint="Prontas para revisar hoje."
            />
            <StatCard
              icon={<TimerReset size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Vencendo em 7 dias"
              value={dashboard.dueWithinWeekCount}
              hint="Inclui as já vencidas."
            />
            <StatCard
              icon={<CalendarClock size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Prazos ativos"
              value={dashboard.activeDeadlineNoteCount}
              hint="Notas com prazo futuro."
            />
            <StatCard
              icon={<Layers size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Unidades acompanhadas"
              value={dashboard.trackedUnitCount}
              hint="Fragmentos com estado de memória."
            />
            <StatCard
              icon={<TrendingUp size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Retenção média"
              value={formatPercentage(dashboard.averageRetrievability)}
              hint={`Estabilidade média: ${formatStability(dashboard.averageStabilityDays)} · ${dashboard.fragileUnitCount} ${dashboard.fragileUnitCount === 1 ? 'parágrafo frágil' : 'parágrafos frágeis'}`}
            />
            <StatCard
              icon={<ListTodo size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Aguardando 1ª revisão"
              value={dashboard.awaitingFirstReviewCount}
              hint="Prontas e habilitadas, sem sessão concluída."
            />
          </div>

          <ForecastSection forecast={dashboard.loadForecast} />

          <section className="review-dashboard-deadlines" aria-labelledby="review-dashboard-deadlines-title">
            <div className="review-dashboard-section-heading">
              <h3 id="review-dashboard-deadlines-title">Próximos prazos</h3>
              <span>{dashboard.completedSessionCount} {dashboard.completedSessionCount === 1 ? 'sessão concluída' : 'sessões concluídas'}</span>
            </div>
            {dashboard.upcomingDeadlines.length === 0 ? (
              <p className="review-dashboard-deadlines-empty">Nenhuma nota com prazo futuro. Configure um prazo em uma regra de tag para vê-lo aqui.</p>
            ) : (
              <ol className="review-dashboard-deadline-list" aria-label="Notas com prazo de estudo futuro">
                {dashboard.upcomingDeadlines.map((item: UpcomingDeadlineItem) => (
                  <li key={item.noteId}>
                    <span className={`review-dashboard-deadline-date ${deadlineClass(item.deadlineAtUnixMs)}`}>
                      {formatDeadline(item.deadlineAtUnixMs)}
                    </span>
                    <div className="review-dashboard-deadline-copy">
                      <strong>{item.title}</strong>
                      <small>{item.relativePath}</small>
                    </div>
                    <button
                      type="button"
                      className="secondary-button review-dashboard-deadline-open"
                      onClick={() => onOpenNote(item.relativePath)}
                      aria-label={`Abrir nota ${item.title}`}
                    >
                      Abrir
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </section>
  )
}

function ForecastSection({ forecast }: { forecast: DailyLoadItem[] }) {
  const maxCount = Math.max(1, ...forecast.map((day) => day.dueCount))
  const total = forecast.reduce((sum, day) => sum + day.dueCount, 0)

  return (
    <section className="review-dashboard-forecast" aria-labelledby="review-dashboard-forecast-title">
      <div className="review-dashboard-section-heading">
        <h3 id="review-dashboard-forecast-title">Carga prevista</h3>
        <span>{`${total} ${total === 1 ? 'revisão' : 'revisões'} nos próximos 7 dias`}</span>
      </div>
      <ol className="review-dashboard-forecast-list" aria-label="Revisões previstas por dia">
        {forecast.map((day) => {
          const isToday = day.dayOffset === 0
          return (
            <li key={day.dayOffset} className={isToday ? 'is-today' : ''}>
              <span className="review-dashboard-forecast-day">{forecastDayLabel(day.dayOffset)}</span>
              <span className="review-dashboard-forecast-track" aria-hidden="true">
                <span
                  className="review-dashboard-forecast-bar"
                  style={{ width: `${(day.dueCount / maxCount) * 100}%` }}
                />
              </span>
              <strong className="review-dashboard-forecast-count">{day.dueCount}</strong>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
