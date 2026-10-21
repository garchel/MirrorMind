import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { BookMarked, Wand2 } from 'lucide-react'
import { NoteImprovementDiff } from './NoteImprovementDiff'
import { DictionaryOfferModal } from './DictionaryOfferModal'
import { proposeNoteImprovements, type NoteImprovementReport } from './calibrationComparison'
import type { ReviewAiProvider } from './ai'

/**
 * O painel de "melhorar a nota".
 *
 * ## O que ele faz
 *
 * Faz duas perguntas ao provider generativo, e mostra o resultado **lado a
 * lado** com a nota:
 *
 * 1. **Expansao**: os trechos que o aluno escreveu apressado — anotacao de
 *    video aula, contao de propria autoria — viram a frase que ele quis dizer.
 * 2. **Definicoes**: os termos que a nota usa como premissa sem nunca
 *    explicar, com a definicao que faltava.
 *
 * ## O que ele nao faz
 *
 * Nao altera a nota sozinho. Tudo e **aplicado ao rascunho** e o usuario
 * revisa antes de salvar — o mesmo cuidado do `applyStructuralAuditEdit` que a
 * auditoria estrutural ja usa.
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
  externalError,
  onApply,
  onApplyExpansion,
  onSaveToDictionary,
  onBack,
}: {
  vaultPath: string
  relativePath: string
  provider: ReviewAiProvider
  /** O conteudo atual da nota, para o painel "antes". */
  before: string
  /**
   * Erro vindo do pai (edicao desatualizada, falha ao gravar no
   * Dicionario). Aparece junto do erro local.
   */
  externalError?: string | null
  /** Aplica a sugestao ao rascunho. Devolve `false` quando a edicao e invalida. */
  onApply: (suggestion: { term: string; definition: string; startUtf16: number }) => boolean
  /**
   * Aplica a expansao ao rascunho: substitui o trecho original pela frase
   * completa. Devolve `false` quando a edicao e invalida.
   */
  onApplyExpansion: (expansion: { startUtf16: number; endUtf16: number; expanded: string }) => boolean
  /**
   * Registra um conceito no Dicionario do Vault.
   *
   * Devolve `true` quando gravou.
   */
  onSaveToDictionary: (term: string, concept: string) => Promise<boolean>
  onBack: () => void
}) {
  const [report, setReport] = useState<NoteImprovementReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)
  const [appliedExpansions, setAppliedExpansions] = useState<number[]>([])
  const [dictionaryOpen, setDictionaryOpen] = useState(false)
  const [dictionarySaved, setDictionarySaved] = useState<string[]>([])

  async function run() {
    setLoading(true)
    setError('')
    setApplied(false)
    setAppliedExpansions([])
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

  const expansions = report?.expansions ?? []
  const suggestions = report?.suggestions ?? []
  const nothingToDo =
    expansions.length === 0 && suggestions.length === 0

  return (
    <div className="review-setup review-improvement-panel">
      <p className="review-session-kicker">Melhorar a nota</p>
      <p className="review-improvement-intro">
        Expande os trechos que você escreveu apressado e escreve a definição dos
        termos que a nota usa sem explicar. Você revisa antes de salvar.
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

      {error || externalError ? (
        <p className="field-error" role="alert">{error || externalError}</p>
      ) : null}

      {report && !loading ? (
        report.invalid ? (
          <p className="review-improvement-empty">
            A IA não respondeu no formato esperado. Nenhuma sugestão foi feita.
          </p>
        ) : nothingToDo ? (
          <p className="review-improvement-empty">
            Nada a melhorar nesta nota.
            {report.rejected > 0
              ? ` ${report.rejected} sugestão(ões) foram descartadas por não se sustentarem.`
              : ''}
          </p>
        ) : (
          <>
            {expansions.length > 0 ? (
              <section className="review-improvement-expansions">
                <h3 className="review-improvement-section-title">
                  <Wand2 size={15} aria-hidden="true" />
                  Trechos que você escreveu apressado
                </h3>
                {expansions.map((expansion, index) => (
                  <div key={`${expansion.startUtf16}`} className="review-improvement-expansion">
                    <div className="review-improvement-pair">
                      <div className="review-improvement-column">
                        <p className="review-improvement-column-title">Como está</p>
                        <p className="review-improvement-block is-removed">
                          {expansion.sourceQuote}
                        </p>
                      </div>
                      <div className="review-improvement-column">
                        <p className="review-improvement-column-title">O que você quis dizer</p>
                        <p className="review-improvement-block is-inserted">
                          {expansion.expanded}
                        </p>
                      </div>
                    </div>
                    <div className="review-ai-inline-actions">
                      <Button
                        type="button"
                        className="ui-button ui-button--sm"
                        disabled={appliedExpansions.includes(index)}
                        onClick={() => {
                          if (onApplyExpansion(expansion)) {
                            setAppliedExpansions((current) => [...current, index])
                          }
                        }}
                      >
                        {appliedExpansions.includes(index)
                          ? 'Aplicada ao rascunho'
                          : 'Aplicar ao rascunho'}
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {suggestions.length > 0 ? (
              <>
                <NoteImprovementDiff
                  before={before}
                  suggestions={suggestions}
                />
                <div className="review-ai-inline-actions">
                  <Button
                    type="button"
                    className="ui-button ui-button--sm"
                    disabled={applied}
                    onClick={() => {
                      const first = suggestions[0]
                      if (first && onApply(first)) setApplied(true)
                    }}
                  >
                    {applied ? 'Aplicada ao rascunho' : 'Aplicar a primeira sugestão'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="ui-button ui-button--secondary ui-button--sm"
                    onClick={() => setDictionaryOpen(true)}
                  >
                    <BookMarked size={14} aria-hidden="true" />
                    Adicionar ao dicionário
                  </Button>
                </div>
                <small className="review-improvement-hint">
                  A sugestão vai para o rascunho. Revise e salve para valer.
                </small>
              </>
            ) : null}
          </>
        )
      ) : null}

      <DictionaryOfferModal
        open={dictionaryOpen}
        suggestions={suggestions}
        saved={dictionarySaved}
        onClose={() => setDictionaryOpen(false)}
        onSave={async (term, concept) => {
          const wrote = await onSaveToDictionary(term, concept)
          if (wrote) {
            setDictionarySaved((current) =>
              current.includes(term) ? current : [...current, term],
            )
          }
          return wrote
        }}
      />
    </div>
  )
}
