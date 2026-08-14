import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Database, Search, Table2 } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '../../lib/tauri'
import { parseNoteDocumentList } from '../../lib/vault'
import { getMarkdownFrontmatterProperties } from '../../lib/markdown'
import {
  collectColumns,
  filterRows,
  frontmatterValueToText,
  NAME_COLUMN_KEY,
  sortRows,
  type BaseColumn,
  type BaseRow,
} from './bases'
import './bases.css'

type Props = {
  vaultPath: string
  /** Previews de todas as notas do vault (para o total exibido no progresso). */
  notePreviews: ReadonlyArray<{ name: string; relativePath: string }>
  onOpenNote: (relativePath: string) => void
}

/** Coluna padrao (nome) quando ainda nao ha linhas/colunas carregadas. */
const NAME_COLUMN_FALLBACK: BaseColumn = { key: NAME_COLUMN_KEY, label: 'Nota', kind: 'name' }

/** Pagina Bases: tabela de notas com as propriedades do frontmatter como
 * colunas (estilo Obsidian Bases). Le o conteudo das notas em lotes com
 * progresso, ordena por coluna, filtra por busca e abre a nota na linha. */
export function BasesPage({ vaultPath, notePreviews, onOpenNote }: Props) {
  const [rows, setRows] = useState<BaseRow[] | null>(null)
  const [loadProgress, setLoadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string>(NAME_COLUMN_KEY)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const loadRequestRef = useRef(0)

  useEffect(() => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setRows(null)
    setError(null)
    setLoadProgress(0)
    let cancelled = false
    let unlistenProgress: (() => void) | undefined

    void (async () => {
      try {
        // Leitura unificada: UMA chamada IPC devolve todos os conteudos; o
        // backend emite progresso em lotes para a tabela nao parecer travada
        // em Vaults grandes. Pedidos novos (troca de Vault/abas) descartam o
        // resultado pendente via `loadRequestRef`.
        unlistenProgress = await listen<{ processed: number; total: number }>('vault-notes-read-progress', (event) => {
          if (!cancelled && requestId === loadRequestRef.current) {
            setLoadProgress(event.payload.processed)
          }
        })
        if (cancelled || requestId !== loadRequestRef.current) return
        const allNotes = parseNoteDocumentList(
          await invoke<unknown>('read_vault_notes', { path: vaultPath }),
        )
        if (cancelled || requestId !== loadRequestRef.current) return
        setRows(allNotes.map((document) => ({
          relativePath: document.relativePath,
          name: document.name,
          properties: getMarkdownFrontmatterProperties(document.content),
        } satisfies BaseRow)))
      } catch {
        if (!cancelled && requestId === loadRequestRef.current) {
          setRows((currentRows) => currentRows ?? [])
          setError('Nao foi possivel ler todas as notas; a tabela pode estar incompleta.')
        }
      } finally {
        unlistenProgress?.()
      }
    })()

    return () => { cancelled = true }
  }, [vaultPath, notePreviews])

  const columns = useMemo(() => collectColumns(rows ?? []), [rows])
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns])
  const sortColumn = columnByKey.get(sortKey) ?? columns[0] ?? NAME_COLUMN_FALLBACK

  const visibleRows = useMemo(() => {
    if (!rows) return []
    const filtered = filterRows(rows, query)
    return sortRows(filtered, sortColumn, sortDirection)
  }, [rows, query, sortColumn, sortDirection])

  function toggleSort(column: BaseColumn) {
    if (column.key === sortKey) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(column.key)
      setSortDirection('asc')
    }
  }

  return (
    <section className="workspace-page bases-page" data-builder-name="bases-page" aria-label="Bases de notas">
      <header className="bases-header">
        <div>
          <p className="card-kicker">Bases</p>
          <h2>Tabela de notas por propriedade</h2>
          <p className="bases-header-description">
            Todas as notas do vault com as propriedades do frontmatter como colunas — como as Bases do Obsidian.
            {rows !== null ? ` ${rows.length} ${rows.length === 1 ? 'nota' : 'notas'}.` : ''}
          </p>
        </div>
      </header>

      <div className="bases-toolbar">
        <label className="bases-search">
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar por nome, caminho ou propriedade..."
            aria-label="Filtrar linhas da tabela"
          />
        </label>
        {rows !== null && visibleRows.length !== rows.length ? (
          <span className="bases-count" role="status">{visibleRows.length} de {rows.length} linhas</span>
        ) : null}
      </div>

      {error ? <p className="bases-error" role="alert">{error}</p> : null}

      {rows === null ? (
        <p className="bases-loading" role="status">
          {loadProgress > 0
            ? `Lendo as notas... (${loadProgress} de ${notePreviews.length} notas)`
            : 'Lendo as notas...'}
        </p>
      ) : rows.length === 0 ? (
        <div className="bases-empty">
          <Database size={22} strokeWidth={1.5} aria-hidden="true" />
          <p>Nenhuma nota no vault para exibir na tabela.</p>
        </div>
      ) : (
        <div className="bases-table-wrap" role="region" aria-label="Tabela de notas" tabIndex={0}>
          <table className="bases-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col" aria-sort={
                    column.key === sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined
                  }>
                    <button
                      type="button"
                      className="bases-th-button"
                      onClick={() => toggleSort(column)}
                      aria-label={`Ordenar por ${column.label}${column.key === sortKey ? ` (${sortDirection === 'asc' ? 'crescente' : 'decrescente'})` : ''}`}
                    >
                      <span>{column.label}</span>
                      {column.key === sortKey ? (
                        sortDirection === 'asc' ? <ArrowUp size={12} strokeWidth={2} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.relativePath}
                  className="bases-row"
                  onClick={() => onOpenNote(row.relativePath)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenNote(row.relativePath)
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Abrir ${row.name}`}
                >
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.kind === 'name' ? (
                        <span className="bases-note-name">{row.name.replace(/\.md$/i, '')}</span>
                      ) : (
                        <span className="bases-cell-value">{frontmatterValueToText(row.properties[column.key]) || '\u2014'}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 ? (
            <div className="bases-empty">
              <Table2 size={22} strokeWidth={1.5} aria-hidden="true" />
              <p>Nenhuma linha corresponde ao filtro.</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
