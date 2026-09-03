import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Lightbulb, ListChecks, ShieldAlert } from 'lucide-react'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { remarkSetextDividerAsSeparator } from '../../lib/remarkSetextDivider'
import type { ReadinessAttempt } from './ai'
import { prepareReportMarkdown } from './readinessReportMarkdown'

const STATUS_LABELS = {
  ready: 'Pronta para revisão',
  ambiguous: 'Ambígua',
  insufficient: 'Insuficiente',
} as const

function ReviewReportMarkdown({ content }: { content: string }) {
  return (
    <div className="review-ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkSetextDividerAsSeparator]}
        rehypePlugins={[rehypeKatex]}
      >
        {prepareReportMarkdown(content)}
      </ReactMarkdown>
    </div>
  )
}

export type NoteReadinessReportProps = {
  attempt: ReadinessAttempt
  /** O relatorio pertence a versao anterior da nota (aviso de stale). */
  isStaleReport: boolean
  error: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
}

/** Visao do relatorio dentro do popover: substitui TODO o conteudo do menu
 *  (inclusive o cabecalho, que o pai oculta) e oferece a seta de voltar.
 *  Nenhum backdrop escurecido: e uma visao dentro do proprio popover. */
export function NoteReadinessReport({ attempt, isStaleReport, error, busy, onClose, onRetry }: NoteReadinessReportProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [attempt])

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
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
    <div
      ref={dialogRef}
      className="note-review-report-view"
      role="dialog"
      aria-modal="false"
      aria-labelledby="readiness-report-title"
      onKeyDown={handleDialogKeyDown}
    >
      <div className="note-review-report-topbar">
        <button
          ref={closeButtonRef}
          type="button"
          className="note-review-report-back"
          onClick={onClose}
          aria-label="Voltar ao menu de avaliação e revisão"
        >
          <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Voltar</span>
        </button>
        <p className="card-kicker">Avaliação da nota</p>
      </div>
      <h2 id="readiness-report-title" className="note-review-report-title">
        {attempt.outcome === 'valid'
          ? STATUS_LABELS[attempt.report.status]
          : 'A IA devolveu um relatório inválido'}
      </h2>
      {attempt.outcome === 'valid' ? (
        <div className="review-ai-report-body review-readiness-report">
          {isStaleReport ? (
            <p className="review-ai-stale-report" role="note">
              Este relatório pertence à versão anterior da nota.
            </p>
          ) : null}
          <div className={`review-readiness-summary is-${attempt.report.status}`}>
            <span className="review-readiness-status" role="status">
              <span className="review-readiness-status-icon" aria-hidden="true">
                {attempt.report.status === 'ready' ? (
                  <CheckCircle2 size={15} strokeWidth={1.8} />
                ) : attempt.report.status === 'ambiguous' ? (
                  <AlertTriangle size={15} strokeWidth={1.8} />
                ) : (
                  <ShieldAlert size={15} strokeWidth={1.8} />
                )}
              </span>
              <span>{STATUS_LABELS[attempt.report.status]}</span>
            </span>
            <div className="review-readiness-explanation">
              <ReviewReportMarkdown content={attempt.report.explanation} />
            </div>
          </div>
          {attempt.report.centralIdea ? (
            <section className="review-readiness-section review-readiness-central-idea" aria-label="Ideia central">
              <h3><Lightbulb size={13} strokeWidth={1.8} aria-hidden="true" /> Ideia central</h3>
              <blockquote><ReviewReportMarkdown content={attempt.report.centralIdea.sourceQuote} /></blockquote>
            </section>
          ) : null}
          {attempt.report.evaluablePoints.length ? (
            <section className="review-readiness-section review-readiness-points" aria-label="Pontos avaliáveis">
              <h3><ListChecks size={13} strokeWidth={1.8} aria-hidden="true" /> Pontos avaliáveis <span className="review-readiness-count">{attempt.report.evaluablePoints.length}</span></h3>
              <ol className="review-readiness-point-list">
                {attempt.report.evaluablePoints.map((point, index) => (
                  <li key={`${point.sourceStartUtf16}-${index}`}>
                    <span className="review-readiness-point-index" aria-hidden="true">{index + 1}</span>
                    <ReviewReportMarkdown content={point.sourceQuote} />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {attempt.report.issues.length ? (
            <section className="review-readiness-section review-readiness-issues" aria-label="O que impede a revisão">
              <h3><AlertTriangle size={13} strokeWidth={1.8} aria-hidden="true" /> O que impede a revisão segura</h3>
              <ul className="review-readiness-issue-list">
                {attempt.report.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className={`review-readiness-issue is-${issue.code}`}>
                    <strong>{issue.message}</strong>
                    {issue.sourceQuote ? <blockquote><ReviewReportMarkdown content={issue.sourceQuote} /></blockquote> : null}
                    <span className="review-ai-suggestion">Sugestão: {issue.suggestion}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="review-ai-report-body">
          <p>{attempt.message}</p>
          <section className="review-ai-diagnostic" aria-label="Diagnostico da resposta da IA">
            <p className="review-ai-diagnostic-summary">A IA respondeu, mas o formato não é seguro para avaliar a nota.</p>
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
              <summary>Ver resposta técnica da IA</summary>
              <pre data-testid="review-ai-raw-response">{attempt.rawResponse ?? 'Nenhuma resposta textual foi recebida.'}</pre>
            </details>
            <small>Diagnóstico não salvo no Vault; descartado ao fechar.</small>
          </section>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <div className="review-ai-dialog-actions">
            <button type="button" onClick={onRetry} disabled={busy}>
              {busy ? 'Gerando…' : 'Gerar novo relatório da IA'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
