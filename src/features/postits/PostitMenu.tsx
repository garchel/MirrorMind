import { useState } from 'react'
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
}

/** Menu de post-its da nota (abaixo do titulo): lista com previa para
 * navegar — clicar abre o popover posicionado na ancora (ou no centro, para
 * orfaos, de onde dá para re-ancorar). */
export function PostitMenu({ items, onOpen }: PostitMenuProps) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="postit-menu-trigger"
          aria-label={`Post-its da nota (${items.length})`}
          title="Listar post-its da nota"
        >
          Post-its ({items.length})
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="postit-menu-popover">
        <div className="postit-menu-list" role="group" aria-label="Post-its da nota">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="postit-menu-item"
              onClick={() => {
                setOpen(false)
                onOpen(item.id)
              }}
              aria-label={`Post-it: ${item.text}`}
            >
              <span
                className="postit-menu-dot"
                style={{ background: POSTIT_COLOR_HEX[item.color] }}
                aria-hidden="true"
              />
              <span className="postit-menu-text">{item.text}</span>
              {item.detail ? <span className="postit-menu-detail">{item.detail}</span> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
