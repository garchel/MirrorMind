import { useEffect, useRef, useState } from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import { getDueReviewQueue, type DueReviewItem } from './reviewQueue'
import { formatOverdueDate } from './reviewQueueDate'
import './review-queue.css'

type ReviewQueuePageProps = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
  onStartReview: (item: DueReviewItem) => void
}



export function ReviewQueuePage({ vaultPath, onOpenNote, onStartReview }: ReviewQueuePageProps) {
  const [items, setItems] = useState<DueReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
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

  return (
    <section className="workspace-page review-queue-page" aria-labelledby="review-queue-title">
      <header className="review-queue-header">
        <div>
          <p className="review-queue-kicker">Aprendizado</p>
          <h2 id="review-queue-title">Revisar agora</h2>
          <p>Notas vencidas, ordenadas por prioridade e pelo maior atraso.</p>
        </div>
        <button
          type="button"
          className="secondary-button review-queue-refresh"
          onClick={() => setReloadRequest((request) => request + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Atualizar
        </button>
      </header>

      {loading ? (
        <div className="review-queue-status" role="status">Carregando revisões vencidas...</div>
      ) : error ? (
        <div className="review-queue-status is-error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={() => setReloadRequest((request) => request + 1)}>
            Tentar novamente
          </button>
        </div>
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
                  <span>Prioridade {item.priorityWeight}</span>
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
    </section>
  )
}
