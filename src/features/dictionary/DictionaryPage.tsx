import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { BookMarked, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { EmptyState, ErrorState } from '../../components/ErrorState'
import { PageHeader } from '../../components/PageHeader'
import { useDictionary } from './useDictionary'
import { normalizeTerm, type DictionaryEntry } from './dictionarySchema'
import './dictionary.css'

type DictionaryPageProps = {
  vaultPath: string
}

/**
 * A pagina do dicionario de conceitos.
 *
 * ## O que ela resolve
 *
 * Uma definicao que ja foi escrita em uma nota nao precisa ser reescrita em
 * todas as outras. O usuario registra o conceito uma vez; depois, passar o
 * mouse sobre a palavra em qualquer nota do Vault mostra a definicao.
 *
 * ## A busca
 *
 * Filtra por termo **enquanto se digita**, e ignora caixa e acentos — a
 * mesma regra do hover. Se as duas divergissem, o usuario buscaria "glicolise"
 * e nao encontraria "Glicólise", e pensaria que o dicionario estava vazio.
 */
export function DictionaryPage({ vaultPath }: DictionaryPageProps) {
  const { entries, save, remove, error, busy } = useDictionary(vaultPath)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<DictionaryEntry | null>(null)
  const [creating, setCreating] = useState(false)
  const [term, setTerm] = useState('')
  const [concept, setConcept] = useState('')
  const [formError, setFormError] = useState('')

  const filtered = useMemo(() => {
    const needle = normalizeTerm(query)
    if (!needle) return entries
    return entries.filter((entry) => normalizeTerm(entry.term).includes(needle))
  }, [entries, query])

  const startCreating = () => {
    setCreating(true)
    setEditing(null)
    setTerm('')
    setConcept('')
    setFormError('')
  }

  const startEditing = (entry: DictionaryEntry) => {
    setEditing(entry)
    setCreating(false)
    setTerm(entry.term)
    setConcept(entry.concept)
    setFormError('')
  }

  const cancel = () => {
    setCreating(false)
    setEditing(null)
    setTerm('')
    setConcept('')
    setFormError('')
  }

  const submit = async () => {
    setFormError('')
    try {
      await save(term, concept)
      cancel()
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const removeEntry = async (entry: DictionaryEntry) => {
    setFormError('')
    try {
      await remove(entry.term)
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <section className="workspace-page dictionary-page" aria-labelledby="dictionary-page-title">
      <PageHeader
        kicker="Dicionário"
        title="Conceitos registrados"
        titleId="dictionary-page-title"
        description="Registre um conceito uma vez e ele aparece ao passar o mouse sobre a palavra, em qualquer nota deste Vault."
      >
        <Button
          type="button"
          className="ui-button ui-button--primary ui-button--sm"
          onClick={startCreating}
          disabled={busy}
        >
          <Plus size={15} aria-hidden="true" />
          Novo conceito
        </Button>
      </PageHeader>

      {/* O erro do formulario fica no formulario: e ali que o usuario
          esta, e a mensagem diz o que corrigir. O `ErrorState` da pagina
          mostra so a falha de **carregar** o dicionario — uma falha de
          leitura e diferente de uma falha de gravacao. */}
      {error && !formError ? <ErrorState message={error} /> : null}

      <div className="dictionary-toolbar">
        <label className="dictionary-search">
          <Search size={15} aria-hidden="true" />
          <span className="visually-hidden">Buscar conceito</span>
          <input
            type="search"
            value={query}
            placeholder="Buscar por termo"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <p className="dictionary-count">
          {filtered.length === entries.length
            ? `${entries.length} conceito${entries.length === 1 ? '' : 's'}`
            : `${filtered.length} de ${entries.length}`}
        </p>
      </div>

      {creating || editing ? (
        <form
          className="dictionary-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <h3>{editing ? 'Editar conceito' : 'Novo conceito'}</h3>
          <label>
            <span>Termo</span>
            <input
              type="text"
              value={term}
              placeholder="ex.: glicólise aeróbica"
              autoFocus
              onChange={(event) => setTerm(event.target.value)}
            />
          </label>
          <label>
            <span>Conceito</span>
            <textarea
              value={concept}
              rows={4}
              placeholder="A definição que aparece ao passar o mouse sobre a palavra."
              onChange={(event) => setConcept(event.target.value)}
            />
          </label>
          {formError ? <p className="dictionary-form-error">{formError}</p> : null}
          <div className="dictionary-form-actions">
            <Button
              type="button"
              variant="bare"
              className="ui-button"
              onClick={cancel}
              disabled={busy}
            >
              <X size={15} aria-hidden="true" />
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="ui-button ui-button--primary"
              disabled={busy}
            >
              {editing ? 'Salvar' : 'Registrar'}
            </Button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? 'Nenhum conceito registrado' : 'Nenhum conceito encontrado'}
          description={
            entries.length === 0
              ? 'Registre um conceito e ele passa a aparecer ao passar o mouse sobre a palavra, em qualquer nota do Vault.'
              : 'Nenhum termo corresponde à busca.'
          }
          icon={<BookMarked size={22} aria-hidden="true" />}
        />
      ) : (
        <ul className="dictionary-list">
          {filtered.map((entry) => (
            <li key={normalizeTerm(entry.term)} className="dictionary-item">
              <div className="dictionary-item-body">
                <p className="dictionary-item-term">{entry.term}</p>
                <p className="dictionary-item-concept">{entry.concept}</p>
              </div>
              <div className="dictionary-item-actions">
                <Button
                  type="button"
                  variant="bare"
                  className="ui-button"
                  onClick={() => startEditing(entry)}
                  disabled={busy}
                  aria-label={`Editar ${entry.term}`}
                >
                  <Pencil size={15} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="bare"
                  className="ui-button"
                  onClick={() => void removeEntry(entry)}
                  disabled={busy}
                  aria-label={`Remover ${entry.term}`}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
