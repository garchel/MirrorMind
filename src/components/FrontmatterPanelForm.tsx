import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Badge } from './ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { COMMON_PROPERTIES, propertyIcon } from '../lib/commonProperties'
import type { FrontmatterBacklink, FrontmatterRow } from './markdownLivePreview'

type FrontmatterPanelFormProps = {
  /** Linhas atuais (chave + valor YAML cru) do frontmatter, SEM a propriedade
   * `tags` (que e renderizada pela secao de Tags com badges). */
  rows: FrontmatterRow[]
  /** Tags atuais da nota (badges). */
  tags: string[]
  /** Todas as tags do vault (sugestoes do popover de adicionar tag). */
  availableTags: string[]
  /** Aplica uma tag (cria com Enter ou aplica uma sugestao existente). */
  onApplyTag: (tag: string) => void
  /** Remove uma tag da nota (X no hover da badge). */
  onRemoveTag: (tag: string) => void
  /** Notas que referenciam a nota atual ("Referenciada por"). */
  backlinks: FrontmatterBacklink[]
  /** Aplica as linhas (ao vivo, com debounce); retorna mensagem de erro ou
   * null. O App atualiza o draft preservando o YAML byte a byte. */
  onApply: (rows: FrontmatterRow[]) => string | null
  /** Abre a nota de um backlink. */
  onOpenBacklink: (relativePath: string) => void
}

/* Propriedades comuns (chave, rotulo, icone) vivem em lib/commonProperties.ts
   — a MESMA lista usada pelo seletor de colunas da pagina Tabela. */

/** Painel integrado do frontmatter (modo Misto): secao de Tags (badges + "+"
 * com campo de digitação e sugestões) e de Propriedades (chave + valor, com
 * "+" abrindo um popover só com ícones das propriedades comuns), além dos
 * backlinks. Sem borda, título nem botoes de Aplicar/Cancelar — parece parte
 * do header e grava ao vivo (debounce). */
export function FrontmatterPanelForm({ availableTags, backlinks, onApply, onApplyTag, onOpenBacklink, onRemoveTag, rows, tags }: FrontmatterPanelFormProps) {
  const [draft, setDraft] = useState<FrontmatterRow[]>(rows)
  const [error, setError] = useState<string | null>(null)
  const [propertiesPopoverOpen, setPropertiesPopoverOpen] = useState(false)
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
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

  /** Tags existentes que casam com a digitacao (exclui as ja aplicadas). */
  const suggestedTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase()
    return [...new Set(availableTags)]
      .filter((tag) => !tags.includes(tag))
      .filter((tag) => !query || tag.toLowerCase().includes(query))
      .sort((left, right) => left.localeCompare(right, 'pt-BR'))
  }, [availableTags, tags, tagQuery])

  function applyTag(tag: string) {
    const normalized = tag.trim().replace(/^#/, '')
    if (!normalized) return
    onApplyTag(normalized)
    setTagsPopoverOpen(false)
    setTagQuery('')
  }

  return (
    <div className="frontmatter-panel" data-testid="frontmatter-panel">
      {/* Secao de Tags: badges das tags atuais + botao "+" que abre um popover
          com campo de digitacao na primeira linha e as tags existentes como
          sugestoes (filtra conforme digita; Enter cria a tag digitada). */}
      <section className="frontmatter-panel-section frontmatter-panel-tags" aria-label="Tags">
        <div className="frontmatter-panel-section-head">
          <span className="frontmatter-panel-section-title">Tags</span>
          <Popover open={tagsPopoverOpen} onOpenChange={(open) => { setTagsPopoverOpen(open); if (!open) setTagQuery('') }}>
            <PopoverTrigger asChild>
              <button type="button" className="frontmatter-panel-add" aria-label="Adicionar tag" title="Adicionar tag">
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="frontmatter-tag-popover">
              <input
                autoFocus
                value={tagQuery}
                onChange={(event) => setTagQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyTag(tagQuery)
                  }
                }}
                placeholder="Digite e Enter para criar"
                aria-label="Nome da nova tag"
                spellCheck={false}
                autoComplete="off"
              />
              {suggestedTags.length > 0 ? (
                <div className="frontmatter-tag-popover-list">
                  {suggestedTags.map((tag) => (
                    <button key={tag} type="button" onClick={() => applyTag(tag)}>
                      #{tag}
                    </button>
                  ))}
                </div>
              ) : null}
              {suggestedTags.length === 0 && tagQuery.trim() ? (
                <p className="frontmatter-tag-popover-hint">Pressione Enter para criar #{tagQuery.trim().replace(/^#/, '')}</p>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
        <div className="frontmatter-panel-tag-row">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="frontmatter-panel-tag-badge">
              #{tag}
              {/* X dentro da badge, visivel no hover (a badge cresce para
                  revela-lo): remove a tag da nota. */}
              <button
                type="button"
                className="frontmatter-panel-tag-remove"
                onClick={() => onRemoveTag(tag)}
                aria-label={`Remover tag ${tag}`}
                title={`Remover #${tag}`}
              >
                <X size={10} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </Badge>
          ))}
          {tags.length === 0 ? <span className="frontmatter-panel-empty">Nenhuma tag ainda.</span> : null}
        </div>
      </section>

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
          <span className="frontmatter-panel-section-title">Referenciada por</span>
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
        </section>
      ) : null}
    </div>
  )
}
