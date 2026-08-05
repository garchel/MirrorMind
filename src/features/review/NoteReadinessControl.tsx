import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CalendarCheck2, FileCheck2, X } from 'lucide-react'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {
  assessNoteReadiness,
  getNoteReviewState,
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

const PERSISTED_STATUS_LABELS = {
  unassessed: 'Não avaliada',
  ready: 'Pronta',
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
}: NoteReadinessControlProps) {
  const { provider, geminiConsent } = useReviewAiSettings()
  const [attempt, setAttempt] = useState<ReadinessAttempt | null>(null)
  const [assessmentIdentity, setAssessmentIdentity] = useState<AssessmentIdentity | null>(null)
  const [reviewState, setReviewState] = useState<NoteReviewState | null>(null)
  const [stateLoading, setStateLoading] = useState(true)
  const [enrollmentBusy, setEnrollmentBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestGenerationRef = useRef(0)
  const stateGenerationRef = useRef(0)
  const triggerButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

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

  async function toggleEnrollment() {
    if (!reviewState || (reviewState.readiness !== 'ready' && !reviewState.enrolled)) return
    const generation = stateGenerationRef.current
    setEnrollmentBusy(true)
    setError('')
    try {
      const state = await setNoteReviewEnrollment({
        vaultPath,
        relativePath,
        enabled: !reviewState.enrolled,
      })
      if (stateGenerationRef.current === generation) setReviewState(state)
    } catch (cause) {
      if (stateGenerationRef.current === generation) setError(reviewAiErrorMessage(cause))
    } finally {
      if (stateGenerationRef.current === generation) setEnrollmentBusy(false)
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
      {reviewState ? (
        <span className={`note-readiness-state is-${reviewState.readiness}`} role="status">
          {PERSISTED_STATUS_LABELS[reviewState.readiness]}
        </span>
      ) : null}
      {reviewState && (reviewState.readiness === 'ready' || reviewState.enrolled) ? (
        <button
          type="button"
          className={`secondary-button note-review-enrollment${reviewState.enrolled ? ' is-active' : ''}`}
          onClick={() => void toggleEnrollment()}
          disabled={disabled || isDirty || enrollmentBusy}
          aria-label={reviewState.enrolled ? 'Pausar revisões espaçadas' : 'Ativar revisões espaçadas'}
          title={reviewState.enrolled ? 'Pausar revisões desta nota' : 'Ativar revisões desta nota'}
        >
          <CalendarCheck2 size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>{enrollmentBusy ? 'Salvando...' : reviewState.enrolled ? 'Revisão ativa' : 'Ativar revisões'}</span>
        </button>
      ) : null}
      {reviewState?.report ? (
        <button
          type="button"
          className="secondary-button note-readiness-report-trigger"
          onClick={openPersistedReport}
          disabled={disabled || isDirty || busy}
          aria-label="Abrir último relatório de prontidão"
        >
          Ver relatório
        </button>
      ) : null}
      {reviewState?.nextReviewAtUnixMs ? (
        <span className="note-review-next-date">
          Próxima: {new Date(reviewState.nextReviewAtUnixMs).toLocaleDateString('pt-BR')}
        </span>
      ) : null}
      <button
        ref={triggerButtonRef}
        type="button"
        className="secondary-button note-readiness-trigger"
        onClick={() => void runAssessment()}
        disabled={disabled || busy || stateLoading || Boolean(unavailableReason)}
        title={unavailableReason ?? 'Avaliar se a nota está pronta para revisão'}
        aria-label="Avaliar prontidão da nota"
      >
        <FileCheck2 size={15} strokeWidth={1.5} aria-hidden="true" />
        <span>{busy ? 'Avaliando...' : reviewState ? 'Reavaliar nota' : 'Avaliar nota'}</span>
      </button>
      {error && !attempt ? <p className="review-ai-toolbar-error" role="alert">{error}</p> : null}

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
