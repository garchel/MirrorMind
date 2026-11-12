import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CalendarClock, CheckCircle2, Minus, Play, Plus } from 'lucide-react'
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
const PRIORITY_MIN = 1
const PRIORITY_MAX = 100

/**
 * Peso de prioridade: escala INTEIRA de 1 a 100.
 *
 * O contrato do backend aceita `(0, 100]` (peso positivo) e o padrao do vault
 * e 1.0 — ou seja, 1 e o piso, nao 0,1. O codigo antigo usava
 * `Math.round((peso + delta) * 10) / 10` com piso 0,1, entao descer de 1 caia
 * para 0,1 (um valor que nada significa na tela) e subir depois dava 1,1:
 * o arredondamento preservava a fracao em vez de somar passos inteiros.
 */
function stepPriority(current: number, delta: number): number {
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(current + delta)))
}

export function ReviewQueuePage({ vaultPath, onOpenNote, onStartReview, onBrowseNotes }: ReviewQueuePageProps) {
  const [items, setItems] = useState<DueReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  // Recarga silenciosa: mantem a lista na tela em vez de trocar por skeleton.
  // Usada quando o ajuste de prioridade ja se refletiu no estado local — a
  // pagina piscava a cada clique porque o reload zerava a fila visivel.
  const [reloadSilent, setReloadSilent] = useState(false)
  const requestReload = useCallback((silent: boolean) => {
    setReloadSilent(silent)
    setReloadRequest((request) => request + 1)
  }, [])
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
    if (!reloadSilent) setLoading(true)
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
        if (requestId === requestIdRef.current && !reloadSilent) setLoading(false)
      })
  }, [vaultPath, reloadRequest, reloadSilent])

  /** Carrega uma página da fila de vencimento. Com `reset`, recomeça do zero
   * (troca de vault ou atualização manual); sem `reset`, anexa a próxima
   * janela — a rolagem infinita do histórico: mais itens ao rolar, sem
   * recarregar o que já está na tela. */
  const loadUpcomingPage = useCallback(async (reset: boolean, silent = false) => {
    if (reset) {
      upcomingLoadingRef.current = false
      upcomingOffsetRef.current = 0
    }
    if (upcomingLoadingRef.current) return
    upcomingLoadingRef.current = true
    const offset = upcomingOffsetRef.current
    const requestId = ++upcomingRequestIdRef.current
    if (reset) {
      // `silent` mantem a lista atual na tela: sem isso, cada ajuste de
      // prioridade trocava a secao por "Carregando proximos vencimentos...".
      if (!silent) setUpcomingLoading(true)
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
    void loadUpcomingPage(true, reloadSilent)
  }, [loadUpcomingPage, reloadRequest, reloadSilent])

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
    const next = stepPriority(item.priorityWeight, delta)
    if (next === item.priorityWeight) return
    setPriorityBusy(item.noteId)
    setPriorityError(null)
    // O numero muda na hora (resposta local) e a recarga que corrige a ordem
    // vem depois, silenciosa: esperar o backend para pintar o valor fazia o
    // clique parecer que nao tinha funcionado, e recarregar com skeleton
    // piscava a pagina inteira.
    setItems((current) =>
      current.map((row) => (row.noteId === item.noteId ? { ...row, priorityWeight: next } : row)),
    )
    requestReload(true)
    try {
      await setNoteReviewPriority({ vaultPath, relativePath: item.relativePath, priorityWeight: next })
    } catch (cause) {
      // Falhou: desfaz o valor otimista e conta o erro.
      setItems((current) =>
        current.map((row) =>
          row.noteId === item.noteId ? { ...row, priorityWeight: item.priorityWeight } : row,
        ),
      )
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
        <PageRefreshButton onRefresh={() => requestReload(false)} disabled={loading} />
      </PageHeader>

      {loading ? (
        <QueueSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => requestReload(false)} />
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
            <Button type="button" className="ui-button ui-button--primary ui-button--md" onClick={onBrowseNotes}>
              Avaliar notas
            </Button>
          ) : null}
        </div>
      ) : (
        <ol className="review-queue-list" aria-label="Notas vencidas para revisão">
          {items.map((item) => (
            <li key={item.noteId}>
              <div className="review-queue-order" aria-hidden="true" />
              <div className="review-queue-copy">
                <div className="review-queue-title-row">
                  <h3 className="review-queue-title">
                    {/* O nome abre a nota: e ele que carrega o link, em vez de
                        um segundo botao "Abrir nota" ao lado do "Revisar". */}
                    <Button
                      type="button"
                      variant="bare"
                      className="ui-button review-queue-note-link"
                      onClick={() => onOpenNote(item.relativePath)}
                      title={`Abrir ${item.relativePath}`}
                    >
                      {item.title}
                    </Button>
                  </h3>
                  {item.isFirstReview ? <span className="review-queue-badge">Primeira revisão</span> : null}
                </div>
                <p className="review-queue-path">{item.relativePath}</p>
                <div className="review-queue-meta">
                  <span>{formatOverdueDate(item.nextReviewAtUnixMs)}</span>
                  <span>{item.preferredMode === 'exam' ? 'Modo prova' : 'Modo conversa'}</span>
                  <span className="review-queue-priority" aria-label={`Prioridade ${item.priorityWeight}`} aria-live="polite">
                    <Button
                      type="button"
                      className="ui-button review-queue-priority-step"
                      onClick={() => void changePriority(item, -PRIORITY_STEP)}
                      disabled={priorityBusy !== null || Math.round(item.priorityWeight) <= PRIORITY_MIN}
                      aria-label={`Diminuir prioridade de ${item.title}`}
                    >
                      <Minus size={13} strokeWidth={2} aria-hidden="true" />
                    </Button>
                    <span>Prioridade {item.priorityWeight}</span>
                    <Button
                      type="button"
                      className="ui-button review-queue-priority-step"
                      onClick={() => void changePriority(item, PRIORITY_STEP)}
                      disabled={priorityBusy !== null || Math.round(item.priorityWeight) >= PRIORITY_MAX}
                      aria-label={`Aumentar prioridade de ${item.title}`}
                    >
                      <Plus size={13} strokeWidth={2} aria-hidden="true" />
                    </Button>
                  </span>
                  {item.deadlineAtUnixMs !== null ? (
                    <span className={`review-queue-deadline${item.deadlineAtUnixMs <= Date.now() ? ' is-expired' : ''}`}>
                      Prazo {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(item.deadlineAtUnixMs))}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="review-queue-actions">
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  className="review-queue-start"
                  onClick={() => onStartReview(item)}
                  aria-label={`Revisar ${item.title}`}
                >
                  <Play size={15} strokeWidth={2} aria-hidden="true" />
                  Revisar
                </Button>
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
              <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void loadUpcomingPage(true)}>
                Tentar novamente
              </Button>
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
                      <h3 className="review-queue-title">
                        <Button
                          type="button"
                          variant="bare"
                          className="ui-button review-queue-note-link"
                          onClick={() => onOpenNote(item.relativePath)}
                          title={`Abrir ${item.relativePath}`}
                        >
                          {item.title}
                        </Button>
                      </h3>
                      {item.isFirstReview ? <span className="review-queue-badge">Primeira revisão</span> : null}
                    </div>
                    <p className="review-queue-path">{item.relativePath}</p>
                    <div className="review-queue-meta">
                      <span>{formatUpcomingDate(item.nextReviewAtUnixMs)}</span>
                      <span>{item.preferredMode === 'exam' ? 'Modo prova' : 'Modo conversa'}</span>
                    </div>
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
              <Button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm"
                onClick={() => void loadUpcomingPage(false)}
                disabled={upcomingLoadingMore}
              >
                {upcomingLoadingMore ? 'Carregando…' : 'Carregar mais'}
              </Button>
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
