import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Tag, X } from 'lucide-react'
import { nudgeCursor } from '../lib/nudgeCursor'
import { Badge } from './ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

type NoteTagRowProps = {
  /** Tags atuais da nota (badges com X no hover, apos expandir). */
  tags: string[]
  /** Todas as tags do vault (sugestoes do popover). */
  availableTags: string[]
  /** Aplica uma tag (cria com Enter ou aplica uma sugestao existente). */
  onApplyTag: (tag: string) => void
  /** Remove uma tag da nota (X no hover da badge). */
  onRemoveTag: (tag: string) => void
}

/** Linha de tags abaixo do titulo, colapsada por padrao (uso raro, 1-2x por
 * nota): resumo de uma linha (`#a #b +N` ou fantasma `+ tags`) que expande
 * para o editor completo (badges + "+"). Sem titulo de secao. */
export function NoteTagRow({ availableTags, onApplyTag, onRemoveTag, tags }: NoteTagRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

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

  const visibleTags = tags.slice(0, 2)
  const hiddenCount = tags.length - visibleTags.length
  const summary = [...visibleTags.map((tag) => `#${tag}`), ...(hiddenCount > 0 ? [`+${hiddenCount}`] : [])].join(' ')
  // Fechado informa (nomes); aberto edita (badges assumem) e o toggle encurta
  // para nao duplicar — cada estado tem um trabalho.
  const toggleLabel = tags.length === 0 || expanded
    ? 'Tags da nota'
    : `Tags da nota: ${[...visibleTags.map((tag) => `#${tag}`), ...(hiddenCount > 0 ? [`e mais ${hiddenCount}`] : [])].join(' ')}`

  return (
    <div className="note-header-tags">
      {/* Sem `title` nativo de proposito: o tooltip do Chromium/WebView2 e
          um overlay assincrono do browser — ao entrar no editor logo depois
          do hover, o dismiss dele corre contra a troca de cursor e prende o
          I-beam em branco (invisivel no tema claro). O `aria-label` segue
          como nome acessivel. */}
      <button
        type="button"
        className={`note-tags-toggle${tags.length === 0 ? ' is-empty' : ''}`}
        aria-expanded={expanded}
        aria-label={toggleLabel}
        onClick={() => setExpanded((open) => !open)}
      >
        <Tag size={12} strokeWidth={1.8} aria-hidden="true" />
        <span className="note-tags-summary">{tags.length === 0 || expanded ? 'Tags' : summary}</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" className="note-tags-chevron" />
      </button>
      {expanded ? (
        <div className="frontmatter-panel-tag-row" role="group" aria-label="Editar tags da nota">
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
              >
                <X size={10} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </Badge>
          ))}
          <Popover open={tagsPopoverOpen} onOpenChange={(open) => { setTagsPopoverOpen(open); if (!open) setTagQuery(''); nudgeCursor(30) }}>
            <PopoverTrigger asChild>
              {/* Entrar no "+" e abrir/fechar o popover sao mudancas de
                  composicao (transicao de hover + portal animado) que prendem
                  o I-beam em branco no WebView2: reemite o cursor nativo. */}
              <button type="button" className="frontmatter-panel-add" aria-label="Adicionar tag" onMouseEnter={() => nudgeCursor(30)}>
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
      ) : null}
    </div>
  )
}
