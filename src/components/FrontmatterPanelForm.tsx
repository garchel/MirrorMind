import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { COMMON_PROPERTIES, propertyIcon } from '../lib/commonProperties'
import type { FrontmatterBacklink, FrontmatterBrokenLink, FrontmatterRow } from './markdownLivePreview'

type FrontmatterPanelFormProps = {
  /** Linhas atuais (chave + valor YAML cru) do frontmatter, SEM a propriedade
   * `tags` (que e renderizada pela linha de Tags abaixo do titulo). */
  rows: FrontmatterRow[]
  /** Notas que referenciam a nota atual ("Referenciada por"). */
  backlinks: FrontmatterBacklink[]
  /** Links quebrados da nota atual (chips nao clicaveis com nome curto). */
  brokenLinks: FrontmatterBrokenLink[]
  /** Avisos em linguagem simples sobre trechos com exibicao limitada
   * (ex.: HTML simplificado). Secao discreta no fim do painel. */
  compatibilityNotes?: string[]
  /** Aplica as linhas (ao vivo, com debounce); retorna mensagem de erro ou
   * null. O App atualiza o draft preservando o YAML byte a byte. */
  onApply: (rows: FrontmatterRow[]) => string | null
  /** Abre a nota de um backlink. */
  onOpenBacklink: (relativePath: string) => void
}

/* Propriedades comuns (chave, rotulo, icone) vivem em lib/commonProperties.ts
   — a MESMA lista usada pelo seletor de colunas da pagina Tabela. */

/** Painel integrado do frontmatter (modo Misto): secao de Propriedades
 * (chave + valor, com "+" abrindo um popover só com ícones das propriedades
 * comuns), além dos backlinks. As Tags moram na linha abaixo do titulo
 * (NoteTagRow). Sem borda, título nem botoes de Aplicar/Cancelar — parece
 * parte do header e grava ao vivo (debounce). */
export function FrontmatterPanelForm({ backlinks, brokenLinks, compatibilityNotes = [], onApply, onOpenBacklink, rows }: FrontmatterPanelFormProps) {
  const [draft, setDraft] = useState<FrontmatterRow[]>(rows)
  const [error, setError] = useState<string | null>(null)
  const [propertiesPopoverOpen, setPropertiesPopoverOpen] = useState(false)
  const [backlinksOpen, setBacklinksOpen] = useState(true)
  const [brokenOpen, setBrokenOpen] = useState(true)
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const skipFirstApplyRef = useRef(true)

  // Aplicacao ao vivo: qualquer mudanca nas linhas grava no rascunho apos uma
  // breve pausa de digitacao (nao ha botao Aplicar).
  useEffect(() => {
    if (skipFirstApplyRef.current) {
      skipFirstApplyRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      setError(onApplyRef.current(draft))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [draft])

  function updateRow(index: number, patch: Partial<FrontmatterRow>) {
    setDraft((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
    setError(null)
  }

  function removeRow(index: number) {
    setDraft((current) => current.filter((_, rowIndex) => rowIndex !== index))
    setError(null)
  }

  function addProperty(key: string) {
    setDraft((current) => [...current, { key, value: '' }])
    setError(null)
  }

  return (
    <div className="frontmatter-panel" data-testid="frontmatter-panel">
      {/* Secao de Propriedades: chave + valor YAML cru (sem a propriedade
          tags). O botao "+" abre um popover com apenas os icones das
          propriedades comuns (ex.: telefone → phone). */}
      <section className="frontmatter-panel-section frontmatter-panel-props" aria-label="Propriedades">
        <div className="frontmatter-panel-section-head">
          <span className="frontmatter-panel-section-title">Propriedades</span>
          <Popover open={propertiesPopoverOpen} onOpenChange={setPropertiesPopoverOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="frontmatter-panel-add" aria-label="Nova propriedade" title="Adicionar propriedade comum">
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="frontmatter-property-popover">
              {COMMON_PROPERTIES.map((property) => (
                <button
                  key={property.key}
                  type="button"
                  className="frontmatter-property-item"
                  title={`${property.label} (${property.key})`}
                  aria-label={`${property.label} (${property.key})`}
                  onClick={() => {
                    addProperty(property.key)
                    setPropertiesPopoverOpen(false)
                  }}
                >
                  <property.icon size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
        <div className="frontmatter-panel-rows">
          {draft.map((row, index) => {
            const Icon = propertyIcon(row.key)
            return (
              <div className="frontmatter-panel-row" key={index}>
                <div className="frontmatter-panel-key-wrap">
                  <span className="frontmatter-panel-row-icon" aria-hidden="true"><Icon size={14} strokeWidth={1.8} /></span>
                  <input
                    className="frontmatter-panel-key"
                    value={row.key}
                    onChange={(event) => updateRow(index, { key: event.target.value })}
                    placeholder="propriedade"
                    aria-label={`Nome da propriedade ${index + 1}`}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <textarea
                  className="frontmatter-panel-value"
                  value={row.value}
                  onChange={(event) => updateRow(index, { value: event.target.value })}
                  placeholder="texto, número, [lista] ou chave: valor"
                  aria-label={`Valor YAML da propriedade ${index + 1}`}
                  spellCheck={false}
                  rows={Math.max(1, row.value.split(/\r?\n/).length)}
                />
                <button
                  type="button"
                  className="frontmatter-panel-remove"
                  onClick={() => removeRow(index)}
                  aria-label={`Remover propriedade ${row.key || index + 1}`}
                  title="Remover propriedade"
                >
                  <X size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </section>

      {backlinks.length > 0 ? (
        <section className="frontmatter-panel-section frontmatter-panel-backlinks" aria-label="Backlinks">
          <button
            type="button"
            className="frontmatter-panel-section-toggle"
            aria-expanded={backlinksOpen}
            onClick={() => setBacklinksOpen((open) => !open)}
          >
            <span className="frontmatter-panel-section-title">Referenciada por ({backlinks.length})</span>
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className="frontmatter-panel-section-chevron" />
          </button>
          {backlinksOpen ? (
            <div className="frontmatter-panel-backlink-list">
              {backlinks.map((backlink) => (
                <button
                  key={backlink.relativePath}
                  type="button"
                  className="frontmatter-panel-backlink"
                  onClick={() => onOpenBacklink(backlink.relativePath)}
                >
                  {backlink.name}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Links pendentes: apontam para notas que ainda nao existem (contagem
          no titulo + chips compactos com o nome curto e alvo completo no
          tooltip). Nao sao botoes: o destino nao existe. */}
      {brokenLinks.length > 0 ? (
        <section className="frontmatter-panel-section frontmatter-panel-backlinks" aria-label="Links pendentes">
          <button
            type="button"
            className="frontmatter-panel-section-toggle"
            aria-expanded={brokenOpen}
            title="Apontam para notas que ainda não existem"
            onClick={() => setBrokenOpen((open) => !open)}
          >
            <span className="frontmatter-panel-section-title">Links pendentes ({brokenLinks.length})</span>
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className="frontmatter-panel-section-chevron" />
          </button>
          {brokenOpen ? (
            <div className="frontmatter-panel-backlink-list">
              {brokenLinks.map((broken) => (
                <span key={broken.target} className="frontmatter-panel-broken" title={broken.target}>
                  {broken.displayName}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {/* Observacoes sobre a nota: trechos com exibicao limitada, explicados
          em linguagem simples (o texto original segue intacto). */}
      {compatibilityNotes.length > 0 ? (
        <section className="frontmatter-panel-section frontmatter-panel-backlinks" aria-label="Observações sobre a nota">
          <span className="frontmatter-panel-section-title">Observações</span>
          {compatibilityNotes.map((note) => (
            <p key={note} className="frontmatter-panel-note">{note}</p>
          ))}
        </section>
      ) : null}
    </div>
  )
}
