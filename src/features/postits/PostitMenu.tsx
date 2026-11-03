import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { StickyNote, Trash2 } from 'lucide-react'
import { POSTIT_COLOR_HEX, type PostitColor } from '../../lib/postits'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'

export type PostitMenuItem = {
  id: string
  color: PostitColor
  text: string
  /** Citacao da area, null para pino de paragrafo, 'sem âncora' para orfao. */
  detail: string | null
  orphan: boolean
}

export type PostitMenuProps = {
  items: PostitMenuItem[]
  onOpen: (postitId: string) => void
  /** Exclui e devolve o erro (ou null). */
  onDelete: (postitId: string) => string | null
}

type MenuRowProps = {
  item: PostitMenuItem
  armedId: string | null
  onOpen: (item: PostitMenuItem) => void
  onRequestDelete: (item: PostitMenuItem) => void
}

/** Uma linha do menu: o corpo navega/abre, o lixeira exclui em dois cliques. */
function MenuRow({ item, armedId, onOpen, onRequestDelete }: MenuRowProps) {
  const armed = armedId === item.id
  return (
    <div className="postit-menu-row">
      <Button
        type="button"
        className="ui-button postit-menu-item"
        onClick={() => onOpen(item)}
        aria-label={`Abrir post-it: ${item.text}`}
        title={item.orphan ? 'Abrir este post-it no centro da nota' : 'Abrir este post-it na nota'}
      >
        <span
          className="postit-menu-dot"
          style={{ background: POSTIT_COLOR_HEX[item.color] }}
          aria-hidden="true"
        />
        <span className="postit-menu-copy">
          <span className="postit-menu-text">{item.text}</span>
          {item.detail ? (
            <span className={`postit-menu-detail${item.orphan ? ' is-orphan' : ''}`}>{item.detail}</span>
          ) : null}
        </span>
      </Button>
      <Button
        type="button"
        className={`ui-button postit-menu-delete${armed ? ' is-armed' : ''}`}
        onClick={() => onRequestDelete(item)}
        aria-label={armed ? `Confirmar exclusão de ${item.text}` : `Excluir post-it: ${item.text}`}
        title={armed ? 'Confirmar exclusão' : 'Excluir este post-it'}
      >
        {armed ? 'Excluir?' : <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />}
      </Button>
    </div>
  )
}

/**
 * Menu de post-its da nota (abaixo do titulo): navegacao unica, ancoras e
 * orfaos no mesmo popover.
 *
 * A lista e ordenada pelo documento (topo -> fim); os sem ancora ficam no
 * fim, numa secao propria — um post-it invisivel no editor continua
 * recuperavel aqui. Clicar num item rola o editor ate a ancora e abre o
 * popover do post-it; `Enter` abre, `↑`/`↓` percorrem os itens, `Esc` fecha
 * (o Radix cuida do Escape). Excluir e em dois cliques: arma, depois apaga.
 */
export function PostitMenu({ items, onOpen, onDelete }: PostitMenuProps) {
  const [open, setOpen] = useState(false)
  // O item em "excluir armado" (primeiro clique arma, o segundo apaga).
  const [armedId, setArmedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (items.length === 0) return null

  const anchored = items.filter((item) => !item.orphan)
  const orphans = items.filter((item) => item.orphan)
  const orphansCount = orphans.length

  const openPostit = (item: PostitMenuItem) => {
    setOpen(false)
    setArmedId(null)
    setError(null)
    onOpen(item.id)
  }

  /** Excluir em dois cliques: arma neste item; o segundo clique apaga. */
  const requestDelete = (item: PostitMenuItem) => {
    if (armedId === item.id) {
      const failure = onDelete(item.id)
      if (failure) {
        setError(failure)
        return
      }
      setArmedId(null)
      setError(null)
      return
    }
    setArmedId(item.id)
    setError(null)
  }

  /** ↑/↓/Home/End percorrem os botoes focaveis do menu; Enter aciona o
   * botao focado (comportamento nativo do botao). */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault()
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (current === -1) next = event.key === 'ArrowDown' ? 0 : buttons.length - 1
    else {
      const delta = event.key === 'ArrowDown' ? 1 : -1
      next = (current + delta + buttons.length) % buttons.length
    }
    buttons[next]?.focus()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setArmedId(null)
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          className="ui-button postit-menu-trigger"
          aria-label={
            `Post-its da nota (${anchored.length} ${anchored.length === 1 ? 'ancorado' : 'ancorados'}` +
            (orphansCount > 0 ? `, ${orphansCount} sem âncora)` : ')')
          }
          title="Listar post-its da nota"
        >
          <StickyNote size={13} aria-hidden="true" />
          Post-its ({items.length})
          {orphansCount > 0 ? (
            <span
              className="postit-menu-orphans-badge"
              title={`${orphansCount} ${orphansCount === 1 ? 'post-it sem âncora' : 'post-its sem âncora'}`}
              aria-hidden="true"
            >
              {orphansCount} sem âncora
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="postit-menu-popover">
        <div
          className="postit-menu-list"
          role="group"
          aria-label="Post-its da nota"
          onKeyDown={handleKeyDown}
        >
          {anchored.map((item) => (
            <MenuRow key={item.id} item={item} armedId={armedId} onOpen={openPostit} onRequestDelete={requestDelete} />
          ))}
          {orphans.length > 0 ? (
            <div className="postit-menu-section" role="separator" aria-label="Post-its sem âncora">
              Sem âncora
            </div>
          ) : null}
          {orphans.map((item) => (
            <MenuRow key={item.id} item={item} armedId={armedId} onOpen={openPostit} onRequestDelete={requestDelete} />
          ))}
          {error ? <p className="postit-menu-error" role="alert">{error}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
