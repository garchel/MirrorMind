import type { MouseEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bold,
  Code2,
  Italic,
  Link,
  Sigma,
  Strikethrough,
  Subscript,
  Superscript,
} from 'lucide-react'
import { HugeiconsIcon } from '@hugeicons/react'
import { HighlighterIcon, StickyNote02Icon } from '@hugeicons/core-free-icons'
import { POSTIT_COLOR_HEX, POSTIT_COLOR_LABELS, POSTIT_COLORS, type PostitColor } from '../../lib/postits'
import type { MarkdownFormat } from '../../lib/markdown'
import type { SelectionPopoverState } from './useFormatToolbar'

/** Itens do submenu de marca-texto: formato, rotulo em minusculas (composto
 * nos titles/aria) e classe do dot. */
const HIGHLIGHT_MENU_ITEMS: Array<{ format: MarkdownFormat; label: string; dotClass: string }> = [
  { format: 'highlightYellow', label: 'amarelo', dotClass: 'hl-yellow' },
  { format: 'highlightGreen', label: 'verde', dotClass: 'hl-green' },
  { format: 'highlightBlue', label: 'azul', dotClass: 'hl-blue' },
  { format: 'highlightPink', label: 'rosa', dotClass: 'hl-pink' },
  { format: 'highlightOrange', label: 'laranja', dotClass: 'hl-orange' },
  { format: 'highlightPurple', label: 'roxo', dotClass: 'hl-purple' },
  { format: 'highlightRed', label: 'vermelho', dotClass: 'hl-red' },
]

export type FormatToolbarProps = {
  popover: SelectionPopoverState | null
  popoverRef: React.RefObject<HTMLDivElement | null>
  submenu: null | 'highlight' | 'postit'
  setSubmenu: (submenu: null | 'highlight' | 'postit') => void
  onOpenSubmenu: (submenu: 'highlight' | 'postit') => void
  onScheduleCloseSubmenu: (submenu: 'highlight' | 'postit') => void
  onApplyFormat: (format: MarkdownFormat) => void
  onOpenPostit: (color: PostitColor) => void
}

/** Evita que o mousedown nos botoes roube o foco/selecao do editor. */
function preserveEditorSelection(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

/** Toolbar flutuante de formatacao da selecao (extraida do App sem mudar
 * comportamento): formatos inline + submenus de cores para cima
 * (marca-texto e post-it, por clique ou hover). */
export function FormatToolbar({
  popover,
  popoverRef,
  submenu,
  setSubmenu,
  onOpenSubmenu,
  onScheduleCloseSubmenu,
  onApplyFormat,
  onOpenPostit,
}: FormatToolbarProps) {
  if (!popover) return null
  return (
    <div
      ref={popoverRef}
      className={`selection-format-popover is-${popover.flip ? 'below' : 'above'}`}
      role="toolbar"
      aria-label="Formatar seleção"
      style={{ left: popover.x + popover.shiftX, top: popover.y }}
    >
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('bold')} title="Negrito" aria-label="Negrito (seleção)"><Bold size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('italic')} title="Itálico" aria-label="Itálico (seleção)"><Italic size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('strikethrough')} title="Riscado" aria-label="Riscado (seleção)"><Strikethrough size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('code')} title="Código" aria-label="Código (seleção)"><Code2 size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('math')} title="Matemática" aria-label="Matemática (seleção)"><Sigma size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('subscript')} title="Subscrito (fórmula química)" aria-label="Subscrito (seleção)"><Subscript size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('superscript')} title="Sobrescrito (expoente)" aria-label="Sobrescrito (seleção)"><Superscript size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('reactionArrow')} title="Seta de reação com texto acima" aria-label="Seta de reação (seleção)"><ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('reverseReactionArrow')} title="Seta reversa com texto acima" aria-label="Seta reversa (seleção)"><ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => onApplyFormat('link')} title="Link" aria-label="Link (seleção)"><Link size={15} strokeWidth={1.8} aria-hidden="true" /></button>
      <span className="hl-separator" aria-hidden="true" />
      <div
        className="format-submenu-wrap"
        onMouseEnter={() => onOpenSubmenu('postit')}
        onMouseLeave={() => onScheduleCloseSubmenu('postit')}
      >
        <button
          type="button"
          onMouseDown={preserveEditorSelection}
          onClick={() => setSubmenu('postit')}
          onKeyDown={(event) => { if (event.key === 'Escape') setSubmenu(null) }}
          title="Post-it no trecho selecionado"
          aria-label="Adicionar post-it"
          aria-expanded={submenu === 'postit'}
        >
          <HugeiconsIcon icon={StickyNote02Icon} size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {submenu === 'postit' ? (
          <div className="format-submenu" role="group" aria-label="Cor do post-it">
            {POSTIT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onMouseDown={preserveEditorSelection}
                onClick={() => { setSubmenu(null); onOpenPostit(color) }}
                title={`Post-it ${POSTIT_COLOR_LABELS[color].toLowerCase()}`}
                aria-label={`Criar post-it ${POSTIT_COLOR_LABELS[color].toLowerCase()}`}
              >
                <span className="hl-dot" style={{ background: POSTIT_COLOR_HEX[color] }} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div
        className="format-submenu-wrap"
        onMouseEnter={() => onOpenSubmenu('highlight')}
        onMouseLeave={() => onScheduleCloseSubmenu('highlight')}
      >
        <button
          type="button"
          onMouseDown={preserveEditorSelection}
          onClick={() => setSubmenu('highlight')}
          onKeyDown={(event) => { if (event.key === 'Escape') setSubmenu(null) }}
          title="Marca-texto"
          aria-label="Marca-texto"
          aria-expanded={submenu === 'highlight'}
        >
          <HugeiconsIcon icon={HighlighterIcon} size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {submenu === 'highlight' ? (
          <div className="format-submenu" role="group" aria-label="Cor do marca-texto">
            {HIGHLIGHT_MENU_ITEMS.map((item) => (
              <button
                key={item.format}
                type="button"
                onMouseDown={preserveEditorSelection}
                onClick={() => { setSubmenu(null); onApplyFormat(item.format) }}
                title={`Marca-texto ${item.label}`}
                aria-label={`Marca-texto ${item.label} (seleção)`}
              >
                <span className={`hl-dot ${item.dotClass}`} aria-hidden="true" />
              </button>
            ))}
            <button type="button" onMouseDown={preserveEditorSelection} onClick={() => { setSubmenu(null); onApplyFormat('highlightNone') }} title="Remover marca-texto" aria-label="Remover marca-texto (seleção)"><span className="hl-dot hl-none" aria-hidden="true" /></button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
