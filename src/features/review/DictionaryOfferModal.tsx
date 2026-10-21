import { useState } from 'react'
import { Modal, ModalHeader } from '../../components/Modal'
import { Button } from '../../components/ui/Button'
import { BookMarked, Check } from 'lucide-react'
import type { NoteImprovementSuggestion } from './calibrationComparison'

/**
 * O modal que fecha o ciclo: as definicoes que faltam na nota podem virar
 * verbetes do Dicionario.
 *
 * ## Por que um modal e nao aplicar direto
 *
 * Porque o Dicionario e **por Vault** e o conceito de um termo depende do
 * assunto: "rubisco" na biologia e na fisica nao e a mesma coisa. Registrar
 * no Dicionario e uma decisao do usuario, e o modal e onde ela acontece.
 *
 * ## O que acontece depois
 *
 * A palavra registrada passa a ter o balo de conceito em **qualquer nota do
 * Vault** (a extensao do dicionario marca e responde ao hover). E a
 * expansao da nota, que e a outra metade da feature, continua no rascunho.
 */
export function DictionaryOfferModal({
  open,
  suggestions,
  onClose,
  onSave,
  saved,
}: {
  open: boolean
  /** As definicoes que o motor confirmou faltar. */
  suggestions: NoteImprovementSuggestion[]
  onClose: () => void
  /**
   * Registra um conceito no Dicionario.
   *
   * Devolve `true` quando gravou. O erro ja e mostrado pelo chamador.
   */
  onSave: (term: string, concept: string) => Promise<boolean>
  /** Os termos que ja entraram no Dicionario nesta sessao. */
  saved: string[]
}) {
  const [concepts, setConcepts] = useState<Record<string, string>>({})
  const [busyTerm, setBusyTerm] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!open) return null

  const conceptOf = (suggestion: NoteImprovementSuggestion) =>
    concepts[suggestion.term] ?? suggestion.definition

  const save = async (suggestion: NoteImprovementSuggestion) => {
    setBusyTerm(suggestion.term)
    setError('')
    try {
      const wrote = await onSave(suggestion.term, conceptOf(suggestion))
      if (wrote) {
        setConcepts((current) => ({
          ...current,
          [suggestion.term]: conceptOf(suggestion),
        }))
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusyTerm(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Adicionar conceitos ao dicionário"
      labelledBy="dictionary-offer-title"
      className="dictionary-offer-dialog"
    >
      <ModalHeader
        titleId="dictionary-offer-title"
        title="Adicionar conceitos ao dicionário"
        kicker="Depois eles aparecem ao passar o mouse, em qualquer nota deste Vault."
        closeLabel="Fechar o dicionário"
        onClose={onClose}
      />

      <p className="dictionary-offer-intro">
        Estas palavras são usadas na nota como premissa sem nunca explicar. Ao
        registrar aqui, você não precisa reescrever a definição em cada nota
        que falar do assunto.
      </p>

      {error ? <p className="field-error" role="alert">{error}</p> : null}

      <ul className="dictionary-offer-list">
        {suggestions.map((suggestion) => {
          const already = saved.includes(suggestion.term)
          return (
            <li key={suggestion.term} className="dictionary-offer-item">
              <div className="dictionary-offer-item-head">
                <strong className="dictionary-offer-term">{suggestion.term}</strong>
                {already ? (
                  <span className="dictionary-offer-saved">
                    <Check size={13} aria-hidden="true" />
                    no dicionário
                  </span>
                ) : null}
              </div>
              <label className="dictionary-offer-label">
                <span className="visually-hidden">Conceito de {suggestion.term}</span>
                <textarea
                  value={conceptOf(suggestion)}
                  rows={3}
                  onChange={(event) =>
                    setConcepts((current) => ({
                      ...current,
                      [suggestion.term]: event.target.value,
                    }))
                  }
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                className="ui-button ui-button--secondary ui-button--sm"
                disabled={busyTerm !== null || already}
                onClick={() => void save(suggestion)}
              >
                <BookMarked size={14} aria-hidden="true" />
                {already
                  ? 'Já registrado'
                  : busyTerm === suggestion.term
                    ? 'Registrando…'
                    : 'Adicionar ao dicionário'}
              </Button>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
