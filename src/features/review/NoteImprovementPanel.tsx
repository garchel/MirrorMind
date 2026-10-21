import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { NoteImprovementDiff } from './NoteImprovementDiff'
import { proposeNoteImprovements, type NoteImprovementReport } from './calibrationComparison'
import type { ReviewAiProvider } from './ai'

/**
 * O painel de "melhorar a nota".
 *
 * ## O que ele faz
 *
 * Pede ao provider generativo os termos que a nota usa sem definir, deixa o
 * filtro deterministico e o motor calibrado descartarem o que nao presta, e
 * mostra o que sobrou **lado a lado**: a nota como esta, e a nota com a
 * definicao inserida.
 *
 * ## O que ele nao faz
 *
 * Nao altera a nota sozinho. A sugestao e **aplicada ao rascunho** e o
 * usuario revisa antes de salvar — o mesmo cuidado do `applyStructuralAuditEdit`
 * que a auditoria estrutural ja usa.
 *
 * ## O provider
 *
 * O gerador de texto e separado do motor de julgamento. O provider
 * generativo **propoe** (ele escreve texto); o motor calibrado **confirma** (ele
 * julga). A estrategia do Vault decide se o motor calibrado participa.
 */
export function NoteImprovementPanel({
  vaultPath,
  relativePath,
  provider,
  before,
  onApply,
  onBack,
}: {
  vaultPath: string
  relativePath: string
  provider: ReviewAiProvider
  /** O conteudo atual da nota, para o painel "antes". */
  before: string
  /** Aplica a sugestao ao rascunho. Devolve `false` quando a edicao e invalida. */
  onApply: (suggestion: { term: string; definition: string; startUtf16: number }) => boolean
  onBack: () => void
}) {
  const [report, setReport] = useState<NoteImprovementReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)

  async function run() {
    setLoading(true)
    setError('')
    setApplied(false)
    try {
      setReport(
        await proposeNoteImprovements(vaultPath, relativePath, provider),
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="review-setup review-improvement-panel">
      <p className="review-session-kicker">Melhorar a nota</p>
      <p className="review-improvement-intro">
        Procura termos que a nota usa como premissa sem nunca definir, e escreve a
        definição que faltava. Você revisa antes de salvar.
      </p>

      <div className="review-ai-inline-actions">
        <Button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          onClick={() => void run()}
          disabled={loading}
        >
          {loading ? 'Analisando…' : 'Sugerir melhorias'}
        </Button>
        <Button type="button" className="ui-button ui-button--sm" onClick={onBack}>
          Voltar
        </Button>
      </div>

      {error ? <p className="field-error" role="alert">{error}</p> : null}

      {report && !loading ? (
        report.invalid ? (
          <p className="review-improvement-empty">
            A IA não respondeu no formato esperado. Nenhuma sugestão foi feita.
          </p>
        ) : report.suggestions.length === 0 ? (
          <p className="review-improvement-empty">
            Nenhuma definição faltando nesta nota.
            {report.rejected > 0
              ? ` ${report.rejected} sugestão(ões) foram descartadas por não se sustentarem.`
              : ''}
          </p>
        ) : (
          <>
            <NoteImprovementDiff
              before={before}
              suggestions={report.suggestions}
            />
            <div className="review-ai-inline-actions">
              <Button
                type="button"
                className="ui-button ui-button--sm"
                disabled={applied}
                onClick={() => {
                  const first = report.suggestions[0]
                  if (first && onApply(first)) setApplied(true)
                }}
              >
                {applied ? 'Aplicada ao rascunho' : 'Aplicar a primeira sugestão'}
              </Button>
            </div>
            <small className="review-improvement-hint">
              A sugestão vai para o rascunho. Revise e salve para valer.
            </small>
          </>
        )
      ) : null}
    </div>
  )
}
