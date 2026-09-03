import { useEffect, useRef, useState } from 'react'
import { BookOpen, Minus, Plus } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/ErrorState'
import { PageHeader, PageRefreshButton } from '../../components/PageHeader'
import { setNoteReviewPriority } from './reviewPolicy'
import { getDueReviewQueue, type DueReviewItem } from './reviewQueue'
import { formatOverdueDate } from './reviewQueueDate'
import './review-queue.css'

type ReviewQueuePageProps = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
  onStartReview: (item: DueReviewItem) => void
}

const PRIORITY_STEP = 1

export function ReviewQueuePage({ vaultPath, onOpenNote, onStartReview }: ReviewQueuePageProps) {
  const [items, setItems] = useState<DueReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const [priorityBusy, setPriorityBusy] = useState<string | null>(null)
  const [priorityError, setPriorityError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    void getDueReviewQueue(vaultPath)
      .then((nextItems) => {
        if (requestId === requestIdRef.current) setItems(nextItems)
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Não foi possível carregar a fila de revisão.')
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [vaultPath, reloadRequest])

  async function changePriority(item: DueReviewItem, delta: number) {
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

  return (
    <section className="workspace-page review-queue-page" aria-labelledby="review-queue-title">
      <PageHeader
        kicker="Revisão"
        title="Revisar agora"
        titleId="review-queue-title"
        description="Notas vencidas, ordenadas por prioridade e pelo maior atraso."
      >
        <PageRefreshButton onRefresh={() => setReloadRequest((request) => request + 1)} disabled={loading} />
      </PageHeader>

      {loading ? (
        <LoadingState message="Carregando revisões vencidas..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadRequest((request) => request + 1)} />
      ) : items.length === 0 ? (
        <div className="review-queue-status is-empty">
          <BookOpen size={22} strokeWidth={1.4} aria-hidden="true" />
          <strong>Nenhuma revisão vencida.</strong>
          <p>Quando uma nota pronta atingir a data agendada, ela aparecerá aqui.</p>
        </div>
      ) : (
        <ol className="review-queue-list" aria-label="Notas vencidas para revisão">
          {items.map((item) => (
            <li key={item.noteId}>
              <div className="review-queue-order" aria-hidden="true" />
              <div className="review-queue-copy">
                <div className="review-queue-title-row">
                  <h3>{item.title}</h3>
                  {item.isFirstReview ? <span className="review-queue-badge">Primeira revisão</span> : null}
                </div>
                <p className="review-queue-path">{item.relativePath}</p>
                <div className="review-queue-meta">
                  <span>{formatOverdueDate(item.nextReviewAtUnixMs)}</span>
                  <span>{item.preferredMode === 'exam' ? 'Modo prova' : 'Modo conversa'}</span>
                  <span className="review-queue-priority" aria-label={`Prioridade ${item.priorityWeight}`} aria-live="polite">
                    <button
                      type="button"
                      className="review-queue-priority-step"
                      onClick={() => void changePriority(item, -PRIORITY_STEP)}
                      disabled={priorityBusy !== null || item.priorityWeight <= 0.1}
                      aria-label={`Diminuir prioridade de ${item.title}`}
                    >
                      <Minus size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span>Prioridade {item.priorityWeight}</span>
                    <button
                      type="button"
                      className="review-queue-priority-step"
                      onClick={() => void changePriority(item, PRIORITY_STEP)}
                      disabled={priorityBusy !== null || item.priorityWeight >= 100}
                      aria-label={`Aumentar prioridade de ${item.title}`}
                    >
                      <Plus size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </span>
                  {item.deadlineAtUnixMs !== null ? (
                    <span className={`review-queue-deadline${item.deadlineAtUnixMs <= Date.now() ? ' is-expired' : ''}`}>
                      Prazo {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(item.deadlineAtUnixMs))}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="review-queue-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onStartReview(item)}
                  aria-label={`Revisar ${item.title}`}
                >
                  Revisar
                </button>
                <button
                  type="button"
                  className="secondary-button review-queue-open"
                  onClick={() => onOpenNote(item.relativePath)}
                  aria-label={`Abrir nota ${item.title}`}
                >
                  Abrir nota
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {priorityError ? (
        <p className="review-queue-priority-error" role="alert">{priorityError}</p>
      ) : null}
    </section>
  )
}
