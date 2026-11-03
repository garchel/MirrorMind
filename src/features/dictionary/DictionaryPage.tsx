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

/** As letras da barra de filtro. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * A inicial de um termo, na mesma normalizacao do hover.
 *
 * "Glicólise" cai em "G" e "ácido" cai em "A": a barra filtra pela letra que
 * o usuario ve, nao pela letra que o arquivo guardou. O que nao comeca com
 * letra (numero, simbolo) cai no grupo "#", que so aparece quando existe.
 */
function initialOf(term: string): string {
  const first = normalizeTerm(term).charAt(0)
  return /^[a-z]$/.test(first) ? first.toUpperCase() : '#'
}

/** O cabecalho de contextos de um verbete: onde ele apareceu, um por nota. */
function TermContexts({ entry }: { entry: DictionaryEntry }) {
  if (entry.contexts.length === 0) return null
  return (
    <details className="dictionary-item-contexts dictionary-detail-contexts">
      <summary>
        {entry.contexts.length === 1
          ? 'Contexto em 1 nota'
          : `Contextos em ${entry.contexts.length} notas`}
      </summary>
      <ul>
        {entry.contexts.map((context) => (
          <li key={context.notePath}>
            <p className="dictionary-item-context-note">{context.notePath}</p>
            <p className="dictionary-item-context-body">{context.context}</p>
          </li>
        ))}
      </ul>
    </details>
  )
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
 * ## Duas colunas
 *
 * A lista de termos fica a esquerda, como a arvore de tags: e por ela que se
 * escolhe o verbete. A direita mostra o conceito escolhido (ou o formulario,
 * quando se esta criando ou editando). A lista rola sozinha, para um
 * dicionario grande nao empurrar o resto da pagina.
 *
 * ## A busca e a barra A–Z
 *
 * A busca filtra por termo **enquanto se digita**, e ignora caixa e acentos —
 * a mesma regra do hover. Se as duas divergissem, o usuario buscaria
 * "glicolise" e nao encontraria "Glicólise", e pensaria que o dicionario
 * estava vazio.
 *
 * A barra de letras e o atalho para "so os termos que comecam com G": clicar
 * de novo na mesma letra limpa o filtro, e as letras sem nenhum termo ficam
 * desabilitadas. A letra e a busca se somam — "glic" + "G" mostra so o que
 * comeca com G e contem "glic".
 */
export function DictionaryPage({ vaultPath }: DictionaryPageProps) {
  const { entries, save, remove, error, busy } = useDictionary(vaultPath)
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<DictionaryEntry | null>(null)
  const [creating, setCreating] = useState(false)
  const [term, setTerm] = useState('')
  const [concept, setConcept] = useState('')
  const [formError, setFormError] = useState('')

  const filtered = useMemo(() => {
    const needle = normalizeTerm(query)
    return entries.filter((entry) => {
      if (letter && initialOf(entry.term) !== letter) return false
      if (!needle) return true
      return normalizeTerm(entry.term).includes(needle)
    })
  }, [entries, query, letter])

  /** As letras que tem pelo menos um termo. As vazias ficam desabilitadas. */
  const availableLetters = useMemo(() => {
    const initials = new Set<string>()
    for (const entry of entries) initials.add(initialOf(entry.term))
    return initials
  }, [entries])

  /**
   * O verbete que a coluna da direita mostra.
   *
   * A selecao e derivada da lista filtrada: se o termo escolhido saiu do
   * filtro (a busca mudou), a pagina cai no primeiro resultado em vez de
   * mostrar um conceito que a lista nao esta exibindo.
   */
  const activeEntry = useMemo(() => {
    const selected = filtered.find((entry) => normalizeTerm(entry.term) === selectedKey)
    return selected ?? filtered[0] ?? null
  }, [filtered, selectedKey])

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

  /** Clique na lista lateral: troca o verbete e abandona o formulario aberto. */
  const selectEntry = (entry: DictionaryEntry) => {
    setSelectedKey(normalizeTerm(entry.term))
    if (creating || editing) cancel()
  }

  const submit = async () => {
    setFormError('')
    try {
      await save(term, concept)
      const savedKey = normalizeTerm(term)
      const needle = normalizeTerm(query)
      const stillVisible =
        (!letter || initialOf(term) === letter) &&
        (!needle || savedKey.includes(needle))
      setSelectedKey(savedKey)
      // Um termo novo (ou renomeado) que nao casa com a busca/letra atual
      // sumiria da lista logo depois de salvo. Limpar o filtro o mostra.
      if (!stillVisible) {
        setQuery('')
        setLetter(null)
      }
      cancel()
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const removeEntry = async (entry: DictionaryEntry) => {
    setFormError('')
    try {
      await remove(entry.term)
      if (selectedKey === normalizeTerm(entry.term)) setSelectedKey(null)
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
      />

      {/* O erro do formulario fica no formulario: e ali que o usuario
          esta, e a mensagem diz o que corrigir. O `ErrorState` da pagina
          mostra so a falha de **carregar** o dicionario — uma falha de
          leitura e diferente de uma falha de gravacao. */}
      {error && !formError ? <ErrorState message={error} /> : null}

      <div className="dictionary-filters">
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

        <div className="dictionary-alphabet" role="group" aria-label="Filtrar termos por letra">
          <Button
            type="button"
            variant="bare"
            size="xs"
            className={`dictionary-letter dictionary-letter--all${letter === null ? ' is-active' : ''}`}
            aria-pressed={letter === null}
            onClick={() => setLetter(null)}
          >
            Todas
          </Button>
          {ALPHABET.map((value) => {
            const active = letter === value
            const hasTerms = availableLetters.has(value)
            return (
              <Button
                key={value}
                type="button"
                variant="bare"
                size="xs"
                className={`dictionary-letter${active ? ' is-active' : ''}`}
                aria-label={`Letra ${value}`}
                aria-pressed={active}
                disabled={!hasTerms}
                title={
                  hasTerms
                    ? `Termos que começam com ${value}`
                    : `Nenhum termo começa com ${value}`
                }
                onClick={() => setLetter(active ? null : value)}
              >
                {value}
              </Button>
            )
          })}
          {availableLetters.has('#') ? (
            <Button
              type="button"
              variant="bare"
              size="xs"
              className={`dictionary-letter${letter === '#' ? ' is-active' : ''}`}
              aria-label="Letra número ou símbolo"
              aria-pressed={letter === '#'}
              title="Termos que começam com número ou símbolo"
              onClick={() => setLetter(letter === '#' ? null : '#')}
            >
              #
            </Button>
          ) : null}
        </div>
      </div>

      <div className="dictionary-layout">
        <aside className="dictionary-terms-pane" aria-label="Termos salvos">
          <Button
            type="button"
            variant="bare"
            size="sm"
            className="dictionary-term-create"
            onClick={startCreating}
            disabled={busy}
          >
            <Plus size={14} aria-hidden="true" />
            Novo conceito
          </Button>

          {entries.length === 0 ? (
            <div className="dictionary-terms-empty">
              <BookMarked size={20} aria-hidden="true" />
              <strong>Nenhum termo ainda</strong>
              <p>Registre o primeiro conceito para começar.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="dictionary-terms-empty">
              <Search size={20} aria-hidden="true" />
              <strong>Nenhum termo encontrado</strong>
              <p>Tente outra busca ou outra letra.</p>
            </div>
          ) : (
            <div className="dictionary-terms-scroll">
              <ul className="dictionary-term-list">
                {filtered.map((entry) => {
                  const selected =
                    activeEntry !== null &&
                    normalizeTerm(activeEntry.term) === normalizeTerm(entry.term)
                  return (
                    <li key={normalizeTerm(entry.term)}>
                      <Button
                        type="button"
                        variant="bare"
                        size="sm"
                        className={`dictionary-term-row${selected ? ' is-selected' : ''}`}
                        onClick={() => selectEntry(entry)}
                        aria-label={entry.term}
                        aria-current={selected ? 'true' : undefined}
                        title={entry.term}
                      >
                        <BookMarked size={13} aria-hidden="true" className="dictionary-term-icon" />
                        <span className="dictionary-term-name">{entry.term}</span>
                        {entry.contexts.length > 0 ? (
                          <span
                            className="dictionary-term-count"
                            aria-hidden="true"
                            title={
                              entry.contexts.length === 1
                                ? 'Registrado em 1 nota'
                                : `Registrado em ${entry.contexts.length} notas`
                            }
                          >
                            {entry.contexts.length}
                          </span>
                        ) : null}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="dictionary-terms-summary">
            <span>{entries.length} termo{entries.length === 1 ? '' : 's'}</span>
            <span>
              {entries.filter((entry) => entry.contexts.length > 0).length} com contexto
            </span>
          </div>
        </aside>

        <main className="dictionary-detail">
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
          ) : activeEntry ? (
            <article className="dictionary-detail-card">
              <header className="dictionary-detail-heading">
                <div className="dictionary-detail-title">
                  <p className="card-kicker">Conceito</p>
                  <h3>{activeEntry.term}</h3>
                </div>
                <div className="dictionary-item-actions">
                  <Button
                    type="button"
                    variant="bare"
                    className="ui-button"
                    onClick={() => startEditing(activeEntry)}
                    disabled={busy}
                    aria-label={`Editar ${activeEntry.term}`}
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="bare"
                    className="ui-button"
                    onClick={() => void removeEntry(activeEntry)}
                    disabled={busy}
                    aria-label={`Remover ${activeEntry.term}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
              </header>
              <p className="dictionary-detail-concept">{activeEntry.concept}</p>
              <TermContexts entry={activeEntry} />
            </article>
          ) : entries.length === 0 ? (
            <EmptyState
              title="Nenhum conceito registrado"
              description="Registre um conceito e ele passa a aparecer ao passar o mouse sobre a palavra, em qualquer nota do Vault."
              icon={<BookMarked size={22} aria-hidden="true" />}
            />
          ) : (
            <EmptyState
              title="Nenhum conceito encontrado"
              description="Nenhum termo corresponde à busca ou à letra selecionada."
              icon={<BookMarked size={22} aria-hidden="true" />}
            />
          )}
        </main>
      </div>
    </section>
  )
}
