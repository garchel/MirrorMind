import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CalendarCheck2, ChartColumnBig, Check, NotebookPen, RotateCcw, Search, X } from 'lucide-react'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {
  assessNoteReadiness,
  getNoteReviewState,
  resetNoteLearning,
  reviewAiErrorMessage,
  setNoteReviewEnrollment,
} from './ai'
import type { NoteReviewState, ReadinessAttempt, ReviewAiProvider } from './ai'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import './review-ai.css'

type NoteReadinessControlProps = {
  vaultPath: string
  relativePath: string
  sourceRevision: string
  isDirty: boolean
  disabled?: boolean
  /** Notifica o estado de prontidao mais recente (para indicadores externos). */
  onStatusChange?: (readiness: NoteReviewState['readiness'] | null) => void
  /** Informacoes necessarias para abrir uma sessao de revisao da nota. */
  onStartReview?: (info: ReviewStartInfo | null) => void
}

/** Dados minimos para construir um item de revisao imediata ("Fazer revisao agora"). */
export type ReviewStartInfo = {
  noteId: string
  preferredMode: 'exam' | 'conversation'
  nextReviewAtUnixMs: number | null
  firstReviewAtUnixMs: number | null
}

type AssessmentIdentity = {
  provider: ReviewAiProvider
  sourceHash: string
}

function ReviewReportMarkdown({ content }: { content: string }) {
  return (
    <div className="review-ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
const STATUS_LABELS = {
  ready: 'Pronta para revisão',
  ambiguous: 'Ambígua',
  insufficient: 'Insuficiente',
} as const

/** Rotulos do badge unificado de status ("Status: ..."). */
const STATUS_BADGE_LABELS = {
  unassessed: 'Não avaliada',
  ready: 'Nota validada',
  ambiguous: 'Ambígua',
  insufficient: 'Insuficiente',
  modified: 'Alterada',
} as const

export function NoteReadinessControl({
  vaultPath,
  relativePath,
  sourceRevision,
  isDirty,
  disabled = false,
  onStatusChange,
  onStartReview,
}: NoteReadinessControlProps) {
  const { provider, geminiConsent } = useReviewAiSettings()
  const [attempt, setAttempt] = useState<ReadinessAttempt | null>(null)
  const [assessmentIdentity, setAssessmentIdentity] = useState<AssessmentIdentity | null>(null)
  const [reviewState, setReviewState] = useState<NoteReviewState | null>(null)
  const [stateLoading, setStateLoading] = useState(true)
  const [enrollmentBusy, setEnrollmentBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState('')
  const requestGenerationRef = useRef(0)
  const stateGenerationRef = useRef(0)
  const triggerButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const resetDialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    requestGenerationRef.current += 1
    const generation = stateGenerationRef.current + 1
    stateGenerationRef.current = generation
    setAttempt(null)
    setAssessmentIdentity(null)
    setReviewState(null)
    setBusy(false)
    setEnrollmentBusy(false)
    setError('')
    setResetConfirmOpen(false)
    setResetBusy(false)
    setResetError('')
    if (isDirty) {
      setStateLoading(false)
      return
    }
    setStateLoading(true)
    void getNoteReviewState({ vaultPath, relativePath })
      .then((state) => {
        if (stateGenerationRef.current === generation) setReviewState(state)
      })
      .catch((cause) => {
        if (stateGenerationRef.current === generation) setError(reviewAiErrorMessage(cause))
      })
      .finally(() => {
        if (stateGenerationRef.current === generation) setStateLoading(false)
      })
  }, [isDirty, relativePath, sourceRevision, vaultPath])

  useEffect(() => () => {
    requestGenerationRef.current += 1
    stateGenerationRef.current += 1
  }, [])

  useEffect(() => {
    if (attempt) closeButtonRef.current?.focus()
  }, [attempt])

  useEffect(() => {
    onStatusChange?.(reviewState?.readiness ?? null)
  }, [onStatusChange, reviewState])

  const consentMissing = provider === 'gemini' && !geminiConsent
  const unavailableReason = isDirty
    ? 'Salve a nota antes de solicitar a avaliação.'
    : consentMissing
      ? 'Autorize o envio ao Gemini nas configurações de revisão.'
      : undefined

  async function runAssessment(retry = false) {
    const selectedProvider = retry && assessmentIdentity ? assessmentIdentity.provider : provider
    const expectedSourceHash = retry && assessmentIdentity ? assessmentIdentity.sourceHash : undefined
    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    setBusy(true)
    setError('')
    try {
      const nextAttempt = await assessNoteReadiness({
        vaultPath,
        relativePath,
        provider: selectedProvider,
        expectedSourceHash,
      })
      if (requestGenerationRef.current !== generation) return
      setAttempt(nextAttempt)
      setAssessmentIdentity({ provider: selectedProvider, sourceHash: nextAttempt.sourceHash })
      if (nextAttempt.outcome === 'valid') {
        const persistedState = await getNoteReviewState({ vaultPath, relativePath })
        if (requestGenerationRef.current !== generation) return
        setReviewState(persistedState)
      }
    } catch (cause) {
      if (requestGenerationRef.current === generation) setError(reviewAiErrorMessage(cause))
    } finally {
      if (requestGenerationRef.current === generation) setBusy(false)
    }
  }

  /** Abre uma revisao imediata; se a nota estiver pronta mas nao inscrita,
   *  ativa a inscricao automaticamente antes de iniciar a sessao. */
  async function startReviewNow() {
    if (!reviewState || reviewState.readiness !== 'ready') return
    const generation = stateGenerationRef.current
    let startInfo: ReviewStartInfo = {
      noteId: reviewState.noteId,
      preferredMode: reviewState.preferredMode,
      nextReviewAtUnixMs: reviewState.nextReviewAtUnixMs,
      firstReviewAtUnixMs: reviewState.firstReviewAtUnixMs,
    }
    if (!reviewState.enrolled) {
      setEnrollmentBusy(true)
      setError('')
      try {
        const state = await setNoteReviewEnrollment({ vaultPath, relativePath, enabled: true })
        if (stateGenerationRef.current !== generation) return
        setReviewState(state)
        startInfo = {
          noteId: state.noteId,
          preferredMode: state.preferredMode,
          nextReviewAtUnixMs: state.nextReviewAtUnixMs,
          firstReviewAtUnixMs: state.firstReviewAtUnixMs,
        }
      } catch (cause) {
        if (stateGenerationRef.current === generation) setError(reviewAiErrorMessage(cause))
        return
      } finally {
        if (stateGenerationRef.current === generation) setEnrollmentBusy(false)
      }
    }
    // Se a nota mudou durante a inscricao, nao inicia a sessao com dados antigos.
    if (stateGenerationRef.current !== generation) return
    onStartReview?.(startInfo)
  }

  async function performReset() {
    const generation = stateGenerationRef.current
    setResetBusy(true)
    setResetError('')
    try {
      const state = await resetNoteLearning({ vaultPath, relativePath })
      if (stateGenerationRef.current !== generation) return
      setReviewState(state)
      setResetConfirmOpen(false)
      triggerButtonRef.current?.focus()
    } catch (cause) {
      if (stateGenerationRef.current === generation) setResetError(reviewAiErrorMessage(cause))
    } finally {
      if (stateGenerationRef.current === generation) setResetBusy(false)
    }
  }

  function closeResetConfirm() {
    if (resetBusy) return
    setResetConfirmOpen(false)
    setResetError('')
    triggerButtonRef.current?.focus()
  }

  function handleResetKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (!resetBusy) {
        event.preventDefault()
        closeResetConfirm()
      }
      return
    }
    if (event.key !== 'Tab') return
    const focusable = resetDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function openPersistedReport() {
    if (!reviewState?.report) return
    setAttempt({
      outcome: 'valid',
      sourceHash: reviewState.contentHash,
      report: reviewState.report,
    })
    setAssessmentIdentity(null)
    setError('')
  }
  function closeReport() {
    requestGenerationRef.current += 1
    setAttempt(null)
    setAssessmentIdentity(null)
    setBusy(false)
    setError('')
    triggerButtonRef.current?.focus()
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeReport()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), summary, textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      {/* Cartao de status (sempre presente no menu): estado da nota + proxima
          revisao, agrupados para o layout em bento do popover. */}
      <div className="note-readiness-status-card">
        {!stateLoading ? (
          isDirty ? (
            <span className="note-readiness-state is-unassessed" role="status">Status: Alterações não salvas</span>
          ) : reviewState ? (
            <span className={`note-readiness-state is-${reviewState.readiness}`} role="status">
              {reviewState.readiness === 'ready' ? (
                <span className="note-readiness-state-check" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
              ) : null}
              Status: {STATUS_BADGE_LABELS[reviewState.readiness]}
            </span>
          ) : (
            <span className="note-readiness-state is-unassessed" role="status">Status: {STATUS_BADGE_LABELS.unassessed}</span>
          )
        ) : null}
        {reviewState?.nextReviewAtUnixMs ? (
          <span className="note-review-next-date">
            Próxima revisão: {new Date(reviewState.nextReviewAtUnixMs).toLocaleDateString('pt-BR')}
          </span>
        ) : null}
        {reviewState?.deadlineRetentionAtRisk ? (
          <span className="note-review-risk-badge" role="status" title="Mesmo antecipando revisões, a meta de retenção na data da prova não é atingida.">
            Meta de retenção em risco
          </span>
        ) : null}
      </div>
      {reviewState?.report ? (
        <button
          type="button"
          className="secondary-button note-readiness-report-trigger"
          onClick={openPersistedReport}
          disabled={disabled || isDirty || busy}
          aria-label="Abrir último relatório de prontidão"
        >
          <span className="note-review-icon-stack" aria-hidden="true">
            <ChartColumnBig size={15} strokeWidth={1.5} />
            <Search size={9} strokeWidth={2.25} className="note-review-icon-corner" />
          </span>
          <span>Ver relatório</span>
        </button>
      ) : null}
      <button
        type="button"
        className="note-review-start-trigger"
        onClick={() => void startReviewNow()}
        disabled={disabled || busy || enrollmentBusy || isDirty || !reviewState || reviewState.readiness !== 'ready'}
        title={isDirty
          ? 'Salve a nota antes de iniciar a revisão.'
          : !reviewState || reviewState.readiness !== 'ready'
            ? 'Avalie a nota para liberar a revisão.'
            : 'Iniciar a revisão desta nota agora'}
        aria-label="Iniciar revisão agora"
      >
        <CalendarCheck2 size={15} strokeWidth={1.5} aria-hidden="true" />
        <span>{enrollmentBusy ? 'Preparando…' : 'Fazer revisão agora'}</span>
      </button>
      <button
        ref={triggerButtonRef}
        type="button"
        className="secondary-button note-readiness-trigger"
        onClick={() => void runAssessment()}
        disabled={disabled || busy || stateLoading || Boolean(unavailableReason)}
        title={unavailableReason ?? 'Avaliar se a nota está pronta para revisão'}
        aria-label="Avaliar prontidão da nota"
      >
        <span className="note-review-icon-stack" aria-hidden="true">
          <NotebookPen size={15} strokeWidth={1.5} />
          <RotateCcw size={9} strokeWidth={2.25} className="note-review-icon-corner" />
        </span>
        <span>{busy ? 'Avaliando...' : reviewState ? 'Reavaliar nota' : 'Avaliar nota'}</span>
      </button>
      {!stateLoading && reviewState ? (
        <button
          type="button"
          className="note-review-reset-trigger"
          onClick={() => {
            setError('')
            setResetConfirmOpen(true)
          }}
          disabled={disabled || busy || resetBusy}
          title="Remove pontuações, estado de memória e datas de revisão desta nota"
        >
          <RotateCcw size={13} strokeWidth={1.6} aria-hidden="true" />
          <span>Reiniciar aprendizado desta nota</span>
        </button>
      ) : null}
      {error && !attempt ? <p className="review-ai-toolbar-error" role="alert">{error}</p> : null}

      {resetConfirmOpen ? (
        <div className="review-ai-dialog-backdrop" role="presentation">
          <section
            ref={resetDialogRef}
            className="review-ai-dialog review-reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-reset-title"
            aria-describedby="review-reset-description"
            onKeyDown={handleResetKeyDown}
          >
            <header>
              <div>
                <p className="card-kicker">Aprendizado da nota</p>
                <h2 id="review-reset-title">Reiniciar aprendizado?</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={closeResetConfirm}
                disabled={resetBusy}
                aria-label="Cancelar reinício"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="review-ai-report-body">
              <p id="review-reset-description">
                Esta ação remove as pontuações, o estado de memória (DSR/FSRS) e as datas de revisão
                desta nota. O Markdown, as tags, a avaliação de prontidão e a política são preservados.
              </p>
              {resetBusy ? (
                <p className="review-ai-stale-report" role="status">Reiniciando…</p>
              ) : (
                <p className="review-reset-hint">
                  O novo ciclo começa agora, usando o primeiro intervalo da política efetiva.
                </p>
              )}
              {resetError ? <p className="review-reset-error" role="alert">{resetError}</p> : null}
            </div>
            <div className="review-ai-dialog-actions">
              <button type="button" className="secondary-button" onClick={closeResetConfirm} disabled={resetBusy}>
                Cancelar
              </button>
              <button
                type="button"
                className="review-reset-confirm"
                onClick={() => void performReset()}
                disabled={resetBusy}
                autoFocus
              >
                {resetBusy ? 'Reiniciando…' : 'Reiniciar aprendizado'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {attempt ? (
        <div className="review-ai-dialog-backdrop" role="presentation">
          <section
            ref={dialogRef}
            className="review-ai-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="readiness-report-title"
            onKeyDown={handleDialogKeyDown}
          >
            <header>
              <div>
                <p className="card-kicker">Avaliacao da nota</p>
                <h2 id="readiness-report-title">
                  {attempt.outcome === 'valid'
                    ? STATUS_LABELS[attempt.report.status]
                    : 'A IA devolveu um relatorio invalido'}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="secondary-button"
                onClick={closeReport}
                aria-label="Fechar relatorio"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            {attempt.outcome === 'valid' ? (
              <div className="review-ai-report-body">
                {reviewState?.readiness === 'modified' ? (
                  <p className="review-ai-stale-report" role="note">
                    Este relatorio pertence a versao anterior da nota.
                  </p>
                ) : null}
                <ReviewReportMarkdown content={attempt.report.explanation} />
                {attempt.report.centralIdea ? (
                  <div>
                    <strong>Ideia identificada</strong>
                    <blockquote><ReviewReportMarkdown content={attempt.report.centralIdea.sourceQuote} /></blockquote>
                  </div>
                ) : null}
                {attempt.report.evaluablePoints.length ? (
                  <div>
                    <strong>Pontos avaliáveis</strong>
                    <ul className="review-ai-issue-list">
                      {attempt.report.evaluablePoints.map((point, index) => (
                        <li key={`${point.sourceStartUtf16}-${index}`}><ReviewReportMarkdown content={point.sourceQuote} /></li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {attempt.report.issues.length ? (
                  <ul className="review-ai-issue-list">
                    {attempt.report.issues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>
                        <strong>{issue.message}</strong>
                        {issue.sourceQuote ? <blockquote><ReviewReportMarkdown content={issue.sourceQuote} /></blockquote> : null}
                        <span className="review-ai-suggestion">Sugestão: {issue.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="review-ai-report-body">
                <p>{attempt.message}</p>
                <section className="review-ai-diagnostic" aria-label="Diagnostico da resposta da IA">
                  <p className="review-ai-diagnostic-summary">A IA respondeu, mas o formato nao pode ser usado com seguranca para avaliar esta nota.</p>
                  {attempt.validationErrors.length ? (
                    <div>
                      <strong>O que precisa ser corrigido</strong>
                      <ul className="review-ai-validation-list">
                        {attempt.validationErrors.map((validationError, index) => (
                          <li key={`${validationError}-${index}`}>{validationError}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <details className="review-ai-raw-response">
                    <summary>Ver resposta tecnica da IA</summary>
                    <pre data-testid="review-ai-raw-response">{attempt.rawResponse ?? 'Nenhuma resposta textual foi recebida.'}</pre>
                  </details>
                  <small>Este diagnostico nao e salvo no Vault e e descartado ao fechar.</small>
                </section>
                {error ? <p className="field-error" role="alert">{error}</p> : null}
                <div className="review-ai-dialog-actions">
                  <button type="button" onClick={() => void runAssessment(true)} disabled={busy}>
                    {busy ? 'Gerando…' : 'Gerar novo relatório da IA'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  )
}
