import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, Minus, Plus } from 'lucide-react'
import { ErrorState } from '../../components/ErrorState'
import { PageHeader, PageRefreshButton } from '../../components/PageHeader'
import { QueueSkeleton } from '../../components/PageSkeleton'
import { setNoteReviewPriority } from './reviewPolicy'
import { listUpcomingReviewQueue, getDueReviewQueue, UPCOMING_PAGE_SIZE, type DueReviewItem } from './reviewQueue'
import { formatOverdueDate, formatUpcomingDate } from './reviewQueueDate'
import './review-queue.css'
import { errorMessage } from '../../lib/tauri'

type ReviewQueuePageProps = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
  onStartReview: (item: DueReviewItem) => void
  onBrowseNotes?: () => void
}

const PRIORITY_STEP = 1

export function ReviewQueuePage({ vaultPath, onOpenNote, onStartReview, onBrowseNotes }: ReviewQueuePageProps) {
  const [items, setItems] = useState<DueReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const [priorityBusy, setPriorityBusy] = useState<string | null>(null)
  const [priorityError, setPriorityError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const [upcomingItems, setUpcomingItems] = useState<DueReviewItem[]>([])
  const [upcomingTotal, setUpcomingTotal] = useState(0)
  const [upcomingLoading, setUpcomingLoading] = useState(false)
  const [upcomingLoadingMore, setUpcomingLoadingMore] = useState(false)
  const [upcomingError, setUpcomingError] = useState<string | null>(null)
  const upcomingRequestIdRef = useRef(0)
  const upcomingOffsetRef = useRef(0)
  const upcomingLoadingRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    void getDueReviewQueue(vaultPath)
      .then((nextItems) => {
        if (requestId === requestIdRef.current) setItems(nextItems)
      })
      .catch((cause: unknown) => {
        // Mostra o erro REAL do backend (ex.: documento corrompido, limite
        // excedido) em vez de uma mensagem genérica — sem isso, diagnosticar
        // a fila em vaults reais é impossível (`invoke` já normaliza a
        // rejeição para `Error` com a mensagem do Rust).
        if (requestId === requestIdRef.current) {
          setError(
            cause instanceof Error && cause.message.trim()
              ? cause.message
              : 'Não foi possível carregar a fila de revisão.',
          )
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [vaultPath, reloadRequest])

  /** Carrega uma página da fila de vencimento. Com `reset`, recomeça do zero
   * (troca de vault ou atualização manual); sem `reset`, anexa a próxima
   * janela — a rolagem infinita do histórico: mais itens ao rolar, sem
   * recarregar o que já está na tela. */
  const loadUpcomingPage = useCallback(async (reset: boolean) => {
    if (reset) {
      upcomingLoadingRef.current = false
      upcomingOffsetRef.current = 0
    }
    if (upcomingLoadingRef.current) return
    upcomingLoadingRef.current = true
    const offset = upcomingOffsetRef.current
    const requestId = ++upcomingRequestIdRef.current
    if (reset) {
      setUpcomingLoading(true)
      setUpcomingError(null)
    } else {
      setUpcomingLoadingMore(true)
    }
    try {
      const page = await listUpcomingReviewQueue(vaultPath, UPCOMING_PAGE_SIZE, offset)
      if (requestId !== upcomingRequestIdRef.current) return
      upcomingOffsetRef.current = offset + page.items.length
      setUpcomingTotal(page.total)
      setUpcomingItems((current) => (reset ? page.items : [...current, ...page.items]))
      setUpcomingError(null)
    } catch (cause: unknown) {
      if (requestId !== upcomingRequestIdRef.current) return
      setUpcomingError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : 'Não foi possível carregar os próximos vencimentos.',
      )
    } finally {
      // Sem `return` aqui de propósito (oxlint `no-unsafe-finally`): só a
      // requisição vigente pode baixar a trava — uma resposta obsoleta nunca
      // libera nem trava loads futuros, então refresh duplo não deadlocka.
      if (requestId === upcomingRequestIdRef.current) {
        upcomingLoadingRef.current = false
        if (reset) setUpcomingLoading(false)
        else setUpcomingLoadingMore(false)
      }
    }
  }, [vaultPath])

  useEffect(() => {
    void loadUpcomingPage(true)
  }, [loadUpcomingPage, reloadRequest])

  const hasMoreUpcoming = upcomingItems.length < upcomingTotal

  // Sentinela da rolagem infinita: ao entrar na viewport, puxa a próxima
  // página sozinha (como subir a conversa e ver mais histórico). Sem
  // IntersectionObserver (ex.: testes), vale só o botão "Carregar mais".
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    if (!hasMoreUpcoming || upcomingLoading || upcomingLoadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadUpcomingPage(false)
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadUpcomingPage, hasMoreUpcoming, upcomingLoading, upcomingLoadingMore, upcomingItems.length])

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
      setPriorityError(errorMessage(cause, String(cause)))
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
        <QueueSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadRequest((request) => request + 1)} />
      ) : items.length === 0 ? (
        <div className="review-queue-empty">
          <span className="review-queue-empty-badge" aria-hidden="true">
            <CheckCircle2 size={30} strokeWidth={1.5} />
          </span>
          <h3>Nenhuma revisão vencida.</h3>
          <p>A fila está em dia — novas revisões entram aqui assim que atingirem a data agendada.</p>
          <ol className="review-queue-empty-steps" aria-label="Como a fila funciona">
            <li>Avalie a prontidão</li>
            <li>Inscreva as prontas</li>
            <li>Volte quando vencer</li>
          </ol>
          {onBrowseNotes ? (
            <button type="button" className="primary-button" onClick={onBrowseNotes}>
              Avaliar notas
            </button>
          ) : null}
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
      {!loading && !error ? (
        <section className="review-queue-upcoming" aria-labelledby="review-queue-upcoming-title">
          <div className="review-queue-subhead">
            <h3 id="review-queue-upcoming-title">Próximos vencimentos</h3>
            {upcomingLoading ? null : upcomingTotal > 0 ? (
              <span>Mostrando {upcomingItems.length} de {upcomingTotal}</span>
            ) : (
              <span>Nada agendado</span>
            )}
          </div>
          {upcomingLoading ? (
            <p className="review-queue-upcoming-loading" role="status">Carregando próximos vencimentos…</p>
          ) : upcomingError && upcomingItems.length === 0 ? (
            <div className="review-queue-upcoming-error" role="alert">
              <p>{upcomingError}</p>
              <button type="button" className="secondary-button" onClick={() => void loadUpcomingPage(true)}>
                Tentar novamente
              </button>
            </div>
          ) : upcomingItems.length === 0 ? (
            <div className="review-queue-upcoming-empty">
              <span className="review-queue-upcoming-empty-badge" aria-hidden="true">
                <CalendarClock size={22} strokeWidth={1.6} />
              </span>
              <strong>Nada agendado por enquanto.</strong>
              <p>Avalie e inscreva notas para vê-las aqui em ordem de vencimento.</p>
            </div>
          ) : (
            <ol className="review-queue-list" aria-label="Notas com vencimento próximo">
              {upcomingItems.map((item) => (
                <li key={item.noteId}>
                  <div className="review-queue-order" aria-hidden="true" />
                  <div className="review-queue-copy">
                    <div className="review-queue-title-row">
                      <h3>{item.title}</h3>
                      {item.isFirstReview ? <span className="review-queue-badge">Primeira revisão</span> : null}
                    </div>
                    <p className="review-queue-path">{item.relativePath}</p>
                    <div className="review-queue-meta">
                      <span>{formatUpcomingDate(item.nextReviewAtUnixMs)}</span>
                      <span>{item.preferredMode === 'exam' ? 'Modo prova' : 'Modo conversa'}</span>
                    </div>
                  </div>
                  <div className="review-queue-actions">
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
          {upcomingError && upcomingItems.length > 0 ? (
            <p className="review-queue-upcoming-error" role="alert">{upcomingError}</p>
          ) : null}
          {hasMoreUpcoming && !upcomingLoading ? (
            <>
              <div ref={sentinelRef} className="review-queue-sentinel" aria-hidden="true" />
              <button
                type="button"
                className="secondary-button"
                onClick={() => void loadUpcomingPage(false)}
                disabled={upcomingLoadingMore}
              >
                {upcomingLoadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </>
          ) : null}
          {upcomingLoadingMore ? <p role="status">Carregando mais…</p> : null}
        </section>
      ) : null}
      {priorityError ? (
        <p className="review-queue-priority-error" role="alert">{priorityError}</p>
      ) : null}
    </section>
  )
}
