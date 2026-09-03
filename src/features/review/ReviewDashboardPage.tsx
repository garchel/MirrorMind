import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Clock3, FileText, Layers, ListTodo, Minus, Pencil, Plus, TimerReset, TrendingUp, X } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/ErrorState'
import { PageHeader, PageRefreshButton } from '../../components/PageHeader'
import { applyDeadlineChange, getVaultReviewPolicyConfig, previewDeadlineChange } from './vaultReviewPolicy'
import { setNoteReviewPriority } from './reviewPolicy'
import { getVaultReviewDashboard, type CalibrationNoteItem, type ExpiredDeadlineItem, type ReadinessAttentionItem, type UpcomingDeadlineItem, type VaultReviewDashboard } from './reviewDashboard'
import { Modal } from '../../components/Modal'
import './review-dashboard.css'

type Props = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
  onStartReview: (item: UpcomingDeadlineItem | ExpiredDeadlineItem) => void
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

function formatExpiredDeadline(deadline: number) {
  const days = Math.floor((Date.now() - deadline) / 86_400_000)
  if (days <= 0) return 'Hoje'
  if (days === 1) return 'Há 1 dia'
  return `Há ${days} dias`
}

/** Forma minima de um item de prazo editavel pelo dialogo (ativo ou encerrado). */
type DeadlineEditable = {
  sourceTag: string | null
  deadlineAtUnixMs: number
  title: string
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

function deadlineDateValue(deadline: number) {
  const date = new Date(deadline)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function deadlineFromDateInput(value: string): number | null {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

function DeadlineChangeDialog({ vaultPath, item, onClose, onApplied }: {
  vaultPath: string
  item: DeadlineEditable
  onClose: () => void
  onApplied: () => void
}) {
  const [newDeadline, setNewDeadline] = useState<string>(deadlineDateValue(item.deadlineAtUnixMs))
  const [preview, setPreview] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [revision, setRevision] = useState<number | null>(null)

  const deadline = deadlineFromDateInput(newDeadline)
  const deadlineChanged = deadline !== item.deadlineAtUnixMs

  useEffect(() => {
    let cancelled = false
    void getVaultReviewPolicyConfig(vaultPath)
      .then((config) => {
        if (!cancelled) setRevision(config.revision)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar a configuração de revisão.')
      })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  async function refreshPreview() {
    if (!item.sourceTag || revision === null) return
    const next = deadlineFromDateInput(newDeadline)
    setError('')
    setBusy(true)
    try {
      const result = await previewDeadlineChange(vaultPath, item.sourceTag, next)
      setPreview(result.affectedNoteCount)
    } catch (cause) {
      setPreview(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!item.sourceTag || preview === null || revision === null || applying) return
    setApplying(true)
    setError('')
    try {
      await applyDeadlineChange({
        vaultPath,
        expectedRevision: revision,
        tag: item.sourceTag,
        newDeadline: deadline,
        expectedAffectedNoteCount: preview,
      })
      onApplied()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setApplying(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!applying) onClose()
      }}
      labelledBy="deadline-dialog-title"
      className="review-dashboard-dialog"
    >
      <section>
        <div className="review-dashboard-dialog-heading">
          <div>
            <p className="card-kicker">Prazo de estudo</p>
            <h3 id="deadline-dialog-title">Alterar prazo · #{item.sourceTag ?? 'sem origem'}</h3>
          </div>
          <button type="button" className="secondary-button review-dashboard-dialog-close" onClick={onClose} disabled={applying} aria-label="Fechar alteração de prazo">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="review-dashboard-dialog-copy">
          A data vale para todas as notas com a tag <strong>#{item.sourceTag}</strong>. Confirmar recalcula a próxima revisão de cada uma, preservando pontuações, histórico e estado de memória.
        </p>
        <label className="review-dashboard-dialog-field">
          <span>Nova data da prova</span>
          <div>
            <CalendarDays size={16} aria-hidden="true" />
            <input
              aria-label="Nova data da prova"
              type="date"
              value={newDeadline}
              disabled={applying}
              onChange={(event) => {
                setNewDeadline(event.target.value)
                setPreview(null)
                setError('')
              }}
            />
          </div>
          <small>Deixe vazio para remover o prazo da regra.</small>
        </label>

        {preview !== null ? (
          <div className="review-dashboard-dialog-preview" role="status">
            <strong>{preview}</strong>
            <span>{preview === 1 ? 'nota terá a próxima data recalculada' : 'notas terão a próxima data recalculada'}</span>
          </div>
        ) : busy ? (
          <p className="review-dashboard-dialog-hint" role="status">Calculando impacto...</p>
        ) : null}

        {error ? (
          <div className="review-dashboard-dialog-error" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="review-dashboard-dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={applying}>Cancelar</button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void refreshPreview()}
            disabled={!item.sourceTag || !deadlineChanged || busy || applying}
          >
            {busy ? 'Calculando…' : 'Ver impacto'}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!item.sourceTag || revision === null || preview === null || !deadlineChanged || busy || applying}
          >
            {applying ? 'Aplicando…' : 'Confirmar alteração'}
          </button>
        </div>
      </section>
    </Modal>
  )
}

export function ReviewDashboardPage({ vaultPath, onOpenNote, onStartReview }: Props) {
  const [dashboard, setDashboard] = useState<VaultReviewDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const [deadlineItem, setDeadlineItem] = useState<DeadlineEditable | null>(null)
  const [priorityBusy, setPriorityBusy] = useState<string | null>(null)
  const [priorityError, setPriorityError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  async function changePriority(item: UpcomingDeadlineItem, delta: number) {
    if (priorityBusy) return
    const next = Math.min(100, Math.max(0.1, Math.round((item.priorityWeight + delta) * 10) / 10))
    if (next === item.priorityWeight) return
    setPriorityBusy(item.noteId)
    setPriorityError(null)
    try {
      await setNoteReviewPriority({ vaultPath, relativePath: item.relativePath, priorityWeight: next })
      setReloadRequest((request) => request + 1)
    } catch (cause) {
      setPriorityError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPriorityBusy(null)
    }
  }

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
      <PageHeader
        kicker="Aprendizado"
        title="Painel do vault"
        titleId="review-dashboard-title"
        description="Visão geral da retenção de memória, prazos e carga de revisão."
      >
        <PageRefreshButton onRefresh={() => setReloadRequest((request) => request + 1)} disabled={loading} />
      </PageHeader>

      {loading ? (
        <LoadingState message="Calculando métricas do vault..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadRequest((request) => request + 1)} />
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
              hint={`Estabilidade média: ${formatStability(dashboard.averageStabilityDays)} · ${dashboard.fragileUnitCount} ${dashboard.fragileUnitCount === 1 ? 'unidade frágil' : 'unidades frágeis'}`}
            />
            <StatCard
              icon={<ListTodo size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Aguardando 1ª revisão"
              value={dashboard.awaitingFirstReviewCount}
              hint="Prontas e habilitadas, sem sessão concluída."
            />
          </div>

          <ReadinessSection
            unassessed={dashboard.readinessUnassessedNoteCount}
            ready={dashboard.readinessReadyNoteCount}
            ambiguous={dashboard.readinessAmbiguousNoteCount}
            insufficient={dashboard.readinessInsufficientNoteCount}
            modified={dashboard.readinessModifiedNoteCount}
            attention={dashboard.readinessAttentionNotes}
            attentionCount={dashboard.readinessAttentionNoteCount}
            onOpenNote={onOpenNote}
          />

          <CalibrationSection notes={dashboard.calibrationNotes} count={dashboard.calibrationNoteCount} onOpenNote={onOpenNote} />

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
                      <span className="review-dashboard-deadline-priority" aria-label={`Prioridade ${item.priorityWeight}`} aria-live="polite">
                        <button
                          type="button"
                          className="review-dashboard-deadline-priority-step"
                          onClick={() => void changePriority(item, -1)}
                          disabled={priorityBusy !== null || item.priorityWeight <= 0.1}
                          aria-label={`Diminuir prioridade de ${item.title}`}
                        >
                          <Minus size={13} strokeWidth={2} aria-hidden="true" />
                        </button>
                        <span>Prioridade {item.priorityWeight}</span>
                        <button
                          type="button"
                          className="review-dashboard-deadline-priority-step"
                          onClick={() => void changePriority(item, 1)}
                          disabled={priorityBusy !== null || item.priorityWeight >= 100}
                          aria-label={`Aumentar prioridade de ${item.title}`}
                        >
                          <Plus size={13} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </span>
                      {item.retentionAtRisk ? (
                        <span className="review-deadline-risk-badge" title="Mesmo antecipando revisões, a meta de retenção na data da prova não é atingida.">
                          Meta de retenção em risco
                        </span>
                      ) : null}
                    </div>
                    <div className="review-dashboard-deadline-actions">
                      {item.due ? (
                        <button
                          type="button"
                          className="primary-button review-dashboard-deadline-review"
                          onClick={() => onStartReview(item)}
                          aria-label={`Revisar ${item.title}`}
                        >
                          Revisar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary-button review-dashboard-deadline-open"
                        onClick={() => onOpenNote(item.relativePath)}
                        aria-label={`Abrir nota ${item.title}`}
                      >
                        Abrir
                      </button>
                      {item.sourceTag ? (
                        <button
                          type="button"
                          className="secondary-button review-dashboard-deadline-edit"
                          onClick={() => setDeadlineItem(item)}
                          aria-label={`Alterar prazo de ${item.title}`}
                        >
                          <Pencil size={13} strokeWidth={1.6} aria-hidden="true" />
                          Alterar prazo
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {priorityError ? (
              <p className="review-dashboard-deadline-priority-error" role="alert">{priorityError}</p>
            ) : null}
          </section>

          <ExpiredDeadlinesSection
            items={dashboard.expiredDeadlines}
            count={dashboard.expiredDeadlineNoteCount}
            onOpenNote={onOpenNote}
            onEditDeadline={setDeadlineItem}
            onStartReview={onStartReview}
          />
        </>
      ) : null}

      {deadlineItem ? (
        <DeadlineChangeDialog
          vaultPath={vaultPath}
          item={deadlineItem}
          onClose={() => setDeadlineItem(null)}
          onApplied={() => {
            setDeadlineItem(null)
            setReloadRequest((request) => request + 1)
          }}
        />
      ) : null}
    </section>
  )
}

const READINESS_LABELS: Record<ReadinessAttentionItem['status'], string> = {
  unassessed: 'Não avaliada',
  ready: 'Pronta',
  ambiguous: 'Ambígua',
  insufficient: 'Insuficiente',
  modified: 'Modificada',
}

function readinessStatusLabel(status: ReadinessAttentionItem['status']) {
  return READINESS_LABELS[status]
}

function readinessDateLabel(assessedAtUnixMs: number | null) {
  if (assessedAtUnixMs === null) return 'sem data'
  const date = new Date(assessedAtUnixMs)
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function ReadinessSection({ unassessed, ready, ambiguous, insufficient, modified, attention, attentionCount, onOpenNote }: {
  unassessed: number
  ready: number
  ambiguous: number
  insufficient: number
  modified: number
  attention: ReadinessAttentionItem[]
  attentionCount: number
  onOpenNote: (relativePath: string) => void
}) {
  const totals = [
    { key: 'ready', label: 'Prontas', value: ready },
    { key: 'ambiguous', label: 'Ambíguas', value: ambiguous },
    { key: 'insufficient', label: 'Insuficientes', value: insufficient },
    { key: 'modified', label: 'Modificadas', value: modified },
    { key: 'unassessed', label: 'Não avaliadas', value: unassessed },
  ] as const

  return (
    <section className="review-dashboard-readiness" aria-labelledby="review-dashboard-readiness-title">
      <div className="review-dashboard-section-heading">
        <h3 id="review-dashboard-readiness-title">Qualidade das notas</h3>
        <span>
          {attentionCount} {attentionCount === 1 ? 'nota precisa' : 'notas precisam'} de atenção
        </span>
      </div>

      <div className="review-dashboard-readiness-totals" aria-label="Contagens por estado de prontidão">
        {totals.map(({ key, label, value }) => (
          <div key={key} className={`review-dashboard-readiness-total is-${key}`}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {attention.length === 0 ? (
        <p className="review-dashboard-readiness-empty">
          Nenhuma nota precisa de atenção. Avalie novas notas para ver o resultado da qualidade aqui.
        </p>
      ) : (
        <>
          <ol className="review-dashboard-readiness-list" aria-label="Notas cuja qualidade exige atenção">
            {attention.map((item) => (
              <li key={item.noteId}>
                <span className={`review-dashboard-readiness-badge is-${item.status}`}>
                  {readinessStatusLabel(item.status)}
                </span>
                <div className="review-dashboard-readiness-copy">
                  <strong>{item.title}</strong>
                  <small>{item.relativePath}</small>
                  {item.explanation ? (
                    <p className="review-dashboard-readiness-explanation" title={item.explanation}>
                      {item.explanation}
                    </p>
                  ) : null}
                  <span className="review-dashboard-readiness-meta">
                    Avaliada em {readinessDateLabel(item.assessedAtUnixMs)}
                    {item.issueCount > 0 ? ` · ${item.issueCount} ${item.issueCount === 1 ? 'problema' : 'problemas'} apontados` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary-button review-dashboard-readiness-open"
                  onClick={() => onOpenNote(item.relativePath)}
                  aria-label={`Abrir nota ${item.title}`}
                >
                  <FileText size={13} strokeWidth={1.6} aria-hidden="true" />
                  Abrir
                </button>
              </li>
            ))}
          </ol>
          {attentionCount > attention.length ? (
            <p className="review-dashboard-readiness-empty">
              Algumas notas precisam de atenção, mas a lista está limitada aos primeiros itens.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

function CalibrationSection({ notes, count, onOpenNote }: {
  notes: CalibrationNoteItem[]
  count: number
  onOpenNote: (relativePath: string) => void
}) {
  return (
    <section className="review-dashboard-calibration" aria-labelledby="review-dashboard-calibration-title">
      <div className="review-dashboard-section-heading">
        <h3 id="review-dashboard-calibration-title">Em calibração</h3>
        <span>
          {count} {count === 1 ? 'nota longa' : 'notas longas'} — retenção parcial até todas as unidades serem avaliadas
        </span>
      </div>
      {notes.length === 0 ? (
        <p className="review-dashboard-calibration-empty">
          Nenhuma nota longa em calibração. Notas com mais de um parágrafo passam por uma etapa por dia até cada parágrafo ser avaliado.
        </p>
      ) : (
        <>
          <ol className="review-dashboard-calibration-list" aria-label="Notas longas com unidades ainda não avaliadas">
            {notes.map((item) => {
              const progress = Math.round((item.observedUnitCount / item.totalUnitCount) * 100)
              const remaining = item.totalUnitCount - item.observedUnitCount
              return (
                <li key={item.noteId}>
                  <div className="review-dashboard-calibration-copy">
                    <strong>{item.title}</strong>
                    <small>{item.relativePath}</small>
                  </div>
                  <div className="review-dashboard-calibration-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={item.totalUnitCount}
                    aria-valuenow={item.observedUnitCount}
                    aria-label={`Progresso da calibração de ${item.title}`}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <span className="review-dashboard-calibration-count">
                    {item.observedUnitCount} de {item.totalUnitCount} {item.unitKind === 'section' ? (item.totalUnitCount === 1 ? 'seção' : 'seções') : item.unitKind === 'paragraph' ? (item.totalUnitCount === 1 ? 'parágrafo' : 'parágrafos') : (item.totalUnitCount === 1 ? 'unidade' : 'unidades')} · {remaining} {remaining === 1 ? 'restante' : 'restantes'}
                  </span>
                  <button
                    type="button"
                    className="secondary-button review-dashboard-calibration-open"
                    onClick={() => onOpenNote(item.relativePath)}
                    aria-label={`Abrir nota ${item.title}`}
                  >
                    Abrir
                  </button>
                </li>
              )
            })}
          </ol>
          {count > notes.length ? (
            <p className="review-dashboard-calibration-empty">
              Algumas notas longas estão em calibração, mas a lista está limitada aos primeiros itens.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

function ExpiredDeadlinesSection({ items, count, onOpenNote, onEditDeadline, onStartReview }: {
  items: ExpiredDeadlineItem[]
  count: number
  onOpenNote: (relativePath: string) => void
  onEditDeadline: (item: ExpiredDeadlineItem) => void
  onStartReview: (item: ExpiredDeadlineItem) => void
}) {
  return (
    <section className="review-dashboard-expired" aria-labelledby="review-dashboard-expired-title">
      <div className="review-dashboard-section-heading">
        <h3 id="review-dashboard-expired-title">Prazos encerrados</h3>
        <span>
          {count} {count === 1 ? 'nota' : 'notas'} — a data-limite da tag já passou
        </span>
      </div>
      <p className="review-dashboard-expired-hint">
        A nota segue em aprendizado. Depois da prova: remova a tag, troque o perfil
        nas Configurações ou mantenha a política atual.
      </p>
      {items.length === 0 ? (
        <p className="review-dashboard-deadlines-empty">Nenhuma nota com prazo de estudo encerrado.</p>
      ) : (
        <>
          <ol className="review-dashboard-expired-list" aria-label="Notas com prazo de estudo encerrado">
            {items.map((item) => (
              <li key={item.noteId}>
                <span className="review-dashboard-expired-date">
                  {formatExpiredDeadline(item.deadlineAtUnixMs)}
                </span>
                <div className="review-dashboard-deadline-copy">
                  <strong>{item.title}</strong>
                  <small>{item.relativePath}</small>
                  {item.sourceTag ? (
                    <span className="review-dashboard-expired-tag">#{item.sourceTag}</span>
                  ) : null}
                </div>
                <div className="review-dashboard-deadline-actions">
                  <button
                    type="button"
                    className="primary-button review-dashboard-deadline-review"
                    onClick={() => onStartReview(item)}
                    aria-label={`Revisar ${item.title}`}
                  >
                    Revisar
                  </button>
                  <button
                    type="button"
                    className="secondary-button review-dashboard-deadline-open"
                    onClick={() => onOpenNote(item.relativePath)}
                    aria-label={`Abrir nota ${item.title}`}
                  >
                    Abrir
                  </button>
                  {item.sourceTag ? (
                    <button
                      type="button"
                      className="secondary-button review-dashboard-deadline-edit"
                      onClick={() => onEditDeadline(item)}
                      aria-label={`Alterar prazo de ${item.title}`}
                    >
                      <Pencil size={13} strokeWidth={1.6} aria-hidden="true" />
                      Alterar prazo
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {count > items.length ? (
            <p className="review-dashboard-calibration-empty">
              Algumas notas têm prazo encerrado, mas a lista está limitada aos primeiros itens.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}


