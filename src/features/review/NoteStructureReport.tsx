import { useEffect, useRef } from 'react'
import { Button } from '../../components/ui/Button'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, CheckSquare, RotateCcw } from 'lucide-react'
import { HugeiconsIcon } from '@hugeicons/react'
import { StructureCheckIcon } from '@hugeicons/core-free-icons'
import type { StructuralAudit } from './ai'

export type NoteStructureReportProps = {
  /** Resultado da auditoria (null = ainda sem resultado). */
  audit: StructuralAudit | null
  loading: boolean
  error: string | null
  /** Indice do achado aplicado no rascunho (so um por vez). */
  appliedIndex: number | null
  onBack: () => void
  onRetry: () => void
  onApply: (index: number) => void
}

/** Pagina de estrutura dentro do popover: espelha a pagina de avaliacao da
 *  nota (topbar com voltar + kicker, titulo-resumo, bloco de sumario, secao
 *  de achados numerados, rodape de acoes). Deterministico, sem IA. */
export function NoteStructureReport({ audit, loading, error, appliedIndex, onBack, onRetry, onApply }: NoteStructureReportProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    backButtonRef.current?.focus()
  }, [audit])

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onBack()
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

  const findingCount = audit?.findings.length ?? 0
  const title = loading
    ? 'Analisando a estrutura…'
    : error
      ? 'Não foi possível analisar'
      : !audit
        ? 'Estrutura da nota'
        : findingCount === 0
          ? 'Estrutura pronta para revisão'
          : `${findingCount} ${findingCount === 1 ? 'ponto de atenção' : 'pontos de atenção'}`

  return (
    <div
      ref={dialogRef}
      className="note-review-report-view note-audit-report-view structural-audit-scope"
      role="dialog"
      aria-modal="false"
      aria-labelledby="structure-report-title"
      onKeyDown={handleDialogKeyDown}
    >
      <div className="note-review-report-topbar">
        <Button
          ref={backButtonRef}
          type="button"
          className="ui-button note-review-report-back"
          onClick={onBack}
          aria-label="Voltar ao menu de avaliação"
        >
          <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Voltar</span>
        </Button>
        <p className="card-kicker">Estrutura da nota</p>
      </div>
      <h2 id="structure-report-title" className="note-review-report-title">
        {title}
      </h2>
      {loading ? (
        <div className="review-ai-report-body">
          <div className="structural-audit-state">Analisando a estrutura da nota…</div>
        </div>
      ) : error ? (
        <div className="review-ai-report-body">
          <div className="structural-audit-state is-error">
            <span>{error}</span>
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onRetry}>Tentar novamente</Button>
          </div>
        </div>
      ) : !audit ? (
        <div className="review-ai-report-body">
          <div className="structural-audit-state">Avaliação de estrutura ainda sem resultado.</div>
        </div>
      ) : (
        <div className="review-ai-report-body review-readiness-report">
          <div className={`review-readiness-summary ${findingCount === 0 ? 'is-ready' : 'is-ambiguous'}`}>
            <span className="review-readiness-status" role="status">
              <span className="review-readiness-status-icon" aria-hidden="true">
                {findingCount === 0 ? (
                  <CheckCircle2 size={15} strokeWidth={1.8} />
                ) : (
                  <AlertTriangle size={15} strokeWidth={1.8} />
                )}
              </span>
              <span>{findingCount === 0 ? 'Estrutura pronta' : findingCount === 1 ? '1 ajuste sugerido' : `${findingCount} ajustes sugeridos`}</span>
            </span>
            <div className="review-readiness-explanation">
              {audit.noteWords.toLocaleString('pt-BR')} palavras · {audit.unitCount} {audit.unitCount === 1 ? 'unidade' : 'unidades'} de revisão.
              Cada seção vira uma unidade — um tema por seção.
            </div>
          </div>
          {findingCount > 0 ? (
            <section className="review-readiness-section" aria-label="O que ajustar">
              <h3><span aria-hidden="true"><HugeiconsIcon icon={StructureCheckIcon} size={13} strokeWidth={1.8} /></span> O que ajustar <span className="review-readiness-count">{findingCount}</span></h3>
              <ol className="review-readiness-point-list">
                {audit.findings.map((finding, index) => (
                  <li key={`${finding.code}-${index}`}>
                    <span className="review-readiness-point-index" aria-hidden="true">{index + 1}</span>
                    <div className="review-structure-finding-body">
                      <span className="structural-audit-severity">
                        {finding.severity === 'warning' ? 'Atenção' : 'Dica'}
                      </span>
                      <strong>{finding.message}</strong>
                      <p className="structural-audit-suggestion">{finding.suggestion}</p>
                      {finding.sourceQuote ? (
                        <pre className="structural-audit-quote">{finding.sourceQuote}</pre>
                      ) : null}
                      {finding.edit ? (
                        <div className="structural-audit-apply-row">
                          <Button
                            type="button"
                            className="ui-button ui-button--primary ui-button--md structural-audit-apply"
                            onClick={() => onApply(index)}
                            disabled={appliedIndex !== null && appliedIndex !== index}
                          >
                            {appliedIndex === index ? (
                              <><CheckSquare size={13} strokeWidth={1.8} aria-hidden="true" /> Aplicado no rascunho</>
                            ) : (
                              'Aplicar no rascunho'
                            )}
                          </Button>
                          {appliedIndex !== null && appliedIndex !== index ? (
                            <small className="structural-audit-hint">Aplique uma de cada vez; re-execute a auditoria depois.</small>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <footer className="structural-audit-footer">
            <Button
              type="button"
              className="ui-button structural-audit-rerun"
              onClick={onRetry}
            >
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>Re-executar auditoria</span>
            </Button>
          </footer>
        </div>
      )}
    </div>
  )
}
