import type { PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Check, Trash2, X } from 'lucide-react'
import {
  POSTIT_COLOR_HEX,
  POSTIT_COLOR_LABELS,
  POSTIT_COLORS,
  POSTIT_MAX_CHARS,
  type PostitColor,
} from '../../lib/postits'
import type { PostitPopoverState } from './usePostitPopover'

export type PostitPopoverProps = {
  popover: PostitPopoverState
  containerRef: React.RefObject<HTMLDivElement | null>
  size: { width: number; height: number } | null
  /** Troca de area disponivel (fora do modo Leitura). */
  editable: boolean
  /** Troca de area armada (aguardando selecao). */
  rangeArming: boolean
  /** Ha selecao nao-colapsada para confirmar como area. */
  canReanchor: boolean
  /** Id com previa aberta (peek) ou null. */
  peekPostitId: string | null
  onArmRange: () => void
  onConfirmRange: () => void
  onClose: () => void
  onResizeStart: (event: ReactPointerEvent<HTMLSpanElement>) => void
  onPeekEnter: () => void
  onPeekLeave: (postitId: string) => void
  onDeleteRequest: () => void
  onDraftTextChange: (text: string) => void
  onDraftColorChange: (color: PostitColor) => void
}

/** Popover do post-it (papel colorido): cabecalho, texto, cores, troca de
 * area em dois tempos e alca de resize. Extraido do App sem mudar
 * comportamento; a logica mora em usePostitPopover. */
export function PostitPopover({
  popover,
  containerRef,
  size,
  editable,
  rangeArming,
  canReanchor,
  peekPostitId,
  onArmRange,
  onConfirmRange,
  onClose,
  onResizeStart,
  onPeekEnter,
  onPeekLeave,
  onDeleteRequest,
  onDraftTextChange,
  onDraftColorChange,
}: PostitPopoverProps) {
  return (
    <div
      ref={containerRef}
      className={`postit-popover is-${popover.flip ? 'below' : 'above'} postit-paper is-${popover.draftColor}`}
      role="dialog"
      aria-label={popover.postitId ? 'Editar post-it' : 'Novo post-it'}
      onMouseEnter={onPeekEnter}
      onMouseLeave={() => {
        if (peekPostitId) onPeekLeave(peekPostitId)
      }}
      style={size ? { left: popover.x, top: popover.y, width: size.width, height: size.height } : { left: popover.x, top: popover.y }}
    >
      <div className="postit-popover-head">
        <span className="postit-popover-pin" style={{ background: POSTIT_COLOR_HEX[popover.draftColor] }} aria-hidden="true" />
        <span className="postit-popover-spacer" aria-hidden="true" />
        {popover.postitId ? (
          <button
            type="button"
            className={`postit-popover-delete${popover.deleteArmed ? ' is-armed' : ''}`}
            onClick={onDeleteRequest}
            title={popover.deleteArmed ? 'Clique de novo para excluir' : 'Excluir post-it'}
            aria-label={popover.deleteArmed ? 'Confirmar exclusão do post-it' : 'Excluir post-it'}
          >
            {popover.deleteArmed ? 'Excluir?' : <Trash2 size={13} strokeWidth={1.7} aria-hidden="true" />}
          </button>
        ) : null}
        <button type="button" className="postit-popover-close" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar post-it">
          <X size={13} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
      <textarea
        className="postit-popover-input"
        value={popover.draftText}
        onChange={(event) => onDraftTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            onClose()
          }
        }}
        placeholder="Sua anotação sobre este parágrafo…"
        aria-label="Texto do post-it"
        autoFocus={!popover.peek}
        rows={3}
        maxLength={POSTIT_MAX_CHARS}
      />
      <div className="postit-popover-actions">
        <div className="postit-popover-colors" role="radiogroup" aria-label="Cor do post-it">
          {POSTIT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`postit-color-dot is-${color}${popover.draftColor === color ? ' is-selected' : ''}`}
              onClick={() => onDraftColorChange(color)}
              title={`${POSTIT_COLOR_LABELS[color]}${popover.draftColor === color ? ' (atual)' : ''}`}
              aria-label={`Cor ${POSTIT_COLOR_LABELS[color]}`}
              aria-checked={popover.draftColor === color}
              role="radio"
            >
              {popover.draftColor === color ? <Check size={10} strokeWidth={3} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <span className={`postit-popover-count${popover.draftText.length >= POSTIT_MAX_CHARS - 40 ? ' is-warning' : ''}`} aria-live="off">
          {popover.draftText.length}/{POSTIT_MAX_CHARS}
        </span>
      </div>
      {editable ? (
        <div className="postit-popover-range">
          {!rangeArming ? (
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onArmRange}>Alterar área</Button>
          ) : canReanchor ? (
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onConfirmRange}>Confirmar área</Button>
          ) : (
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled>Selecione o texto…</Button>
          )}
        </div>
      ) : null}
      <span
        className="postit-popover-resize"
        title="Redimensionar"
        aria-hidden="true"
        onPointerDown={onResizeStart}
      />
    </div>
  )
}
