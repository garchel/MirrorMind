import { useEffect, useState } from 'react'
import { Loader2, BookMarked, RefreshCw } from 'lucide-react'
import { Modal, ModalHeader } from '../../components/Modal'
import { Button } from '../../components/ui/Button'
import { normalizeTerm } from './dictionarySchema'
import type { DictionaryConceptSuggestion } from './dictionarySuggestion'
import './dictionary.css'

/** Espelham `MAX_TERM_CHARS` e `MAX_CONCEPT_CHARS` no backend. O limite que
 * vale e o do backend; estes so evitam mandar um texto que ja seria recusado. */
const MAX_TERM_CHARS = 120
const MAX_CONCEPT_CHARS = 2000

/**
 * O termo que o formulario mostra: sempre o trecho selecionado.
 *
 * A IA escreve o conceito; ela nao escolhe o verbete. Quando escolhia,
 * selecionar `fase clara` numa nota sobre fotossintese voltava como
 * `Fase Escura` — o assunto que o modelo tinha em mente, nao o que o usuario
 * selecionou. A mesma regra vale no backend (`term_for_selection`), que decide
 * o "ja existe" sobre o termo que sera gravado: as duas pontas precisam
 * concordar.
 */
function termFromSelection(selection: string): string {
  return selection.trim().slice(0, MAX_TERM_CHARS)
}

/**
 * O modal de "adicionar o trecho selecionado ao dicionario".
 *
 * ## Por que a IA sugere, mas o usuario decide
 *
 * O dicionario e **por Vault** e o conceito depende do assunto: "rubisco" na
 * biologia e na fisica nao e a mesma coisa. A IA le a nota e propoe; quem
 * registra e o usuario. Por isso o termo e o conceito sao editaveis.
 *
 * O termo, porem, nunca e escolha da IA: o verbete e o que o usuario
 * selecionou (ver `termFromSelection`). A IA so escreve o conceito.
 *
 * ## O que a tela mostra em cada estado
 *
 * - carregando: o termo ja mostra a selecao e um aviso com spinner diz que a
 *   IA esta preparando o conceito;
 * - sugestao valida: termo e conceito preenchidos;
 * - resposta fora do formato: o trecho volta no termo, o conceito fica vazio
 *   e o usuario pode escrever ou tentar de novo;
 * - falha do provider: a mensagem real e o botao de tentar de novo;
 * - termo ja registrado: o aviso de que salvar vai atualizar o conceito.
 */
export function DictionarySelectionModal({
  open,
  selection,
  loading,
  suggestion,
  error,
  onClose,
  onRetry,
  onSave,
}: {
  open: boolean
  /** O trecho que o usuario selecionou na nota. */
  selection: string
  loading: boolean
  suggestion: DictionaryConceptSuggestion | null
  /** Falha ao pedir a sugestao (provider fora do ar, orcamento, etc.). */
  error: string
  onClose: () => void
  onRetry: () => void
  /** Grava o verbete. Lanca quando o backend recusa. */
  onSave: (term: string, concept: string) => Promise<void>
}) {
  const [term, setTerm] = useState('')
  const [concept, setConcept] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!open) {
      setTerm('')
      setConcept('')
      setSaving(false)
      setSaveError('')
      return
    }
    setTerm(termFromSelection(selection))
    setConcept(suggestion?.concept ?? '')
    setSaveError('')
  }, [open, selection, suggestion])

  if (!open) return null

  const invalid = suggestion?.invalid ?? false
  const existing = suggestion?.existing ?? null
  // O aviso so vale enquanto o termo editado ainda e o que o backend comparou:
  // trocar o termo a mao torna o "ja existe" uma afirmacao sobre outro verbete.
  const existingApplies = existing !== null
    && suggestion !== null
    && normalizeTerm(term) === normalizeTerm(suggestion.term)
  const canSave = !loading && !saving
    && term.trim().length > 0
    && concept.trim().length > 0

  async function save() {
    if (!canSave) return
    setSaving(true)
    setSaveError('')
    try {
      await onSave(term.trim(), concept.trim())
      onClose()
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="dictionary-selection-title"
      className="dictionary-selection-dialog"
      busy={loading}
    >
      <ModalHeader
        titleId="dictionary-selection-title"
        title="Adicionar ao dicionário"
        kicker="O conceito aparece ao passar o mouse, em qualquer nota deste Vault."
        closeLabel="Fechar o dicionário"
        onClose={onClose}
      />

      <p className="dictionary-selection-intro">
        A IA lê o trecho e a nota para sugerir o conceito. Revise e edite antes
        de registrar.
      </p>

      {loading ? (
        <p className="dictionary-selection-status" role="status" aria-live="polite">
          <Loader2
            className="dictionary-selection-spinner"
            size={14}
            aria-hidden="true"
          />
          <span>Preparando o conceito…</span>
        </p>
      ) : null}

      {error ? (
        <div className="dictionary-selection-failure" role="alert">
          <p className="field-error">{error}</p>
          <Button
            type="button"
            variant="secondary"
            className="ui-button ui-button--secondary ui-button--sm"
            onClick={onRetry}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {invalid && !loading && !error ? (
        <div className="dictionary-selection-failure" role="alert">
          <p className="dictionary-selection-warning">
            A IA não respondeu no formato esperado. Escreva o conceito ou tente de novo.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="ui-button ui-button--secondary ui-button--sm"
            onClick={onRetry}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {existingApplies ? (
        <div className="dictionary-selection-existing">
          <p>
            <strong>{existing.term}</strong> já está no dicionário deste Vault.
            Salvar vai atualizar o conceito.
          </p>
          <p className="dictionary-selection-existing-concept">{existing.concept}</p>
        </div>
      ) : null}

      <label className="dictionary-selection-label">
        <span>Termo</span>
        <input
          type="text"
          value={term}
          maxLength={MAX_TERM_CHARS}
          disabled={loading || saving}
          onChange={(event) => setTerm(event.target.value)}
        />
      </label>

      <label className="dictionary-selection-label">
        <span>Conceito</span>
        <textarea
          value={concept}
          rows={3}
          maxLength={MAX_CONCEPT_CHARS}
          disabled={loading || saving}
          placeholder={
            loading
              ? 'A IA está escrevendo a definição…'
              : 'A definição que aparece ao passar o mouse sobre o termo.'
          }
          onChange={(event) => setConcept(event.target.value)}
        />
      </label>

      {saveError ? <p className="field-error" role="alert">{saveError}</p> : null}

      <div className="dictionary-selection-actions">
        <Button
          type="button"
          variant="secondary"
          className="ui-button ui-button--secondary ui-button--sm"
          onClick={onClose}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          className="ui-button ui-button--sm"
          onClick={() => void save()}
          disabled={!canSave}
        >
          <BookMarked size={14} aria-hidden="true" />
          {saving
            ? 'Registrando…'
            : existingApplies
              ? 'Atualizar conceito'
              : 'Adicionar ao dicionário'}
        </Button>
      </div>
    </Modal>
  )
}
