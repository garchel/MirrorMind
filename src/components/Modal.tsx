import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEscapeToClose } from '../lib/escapeStack'
import { closeDialog, openDialog } from './dialog'
import './Modal.css'

/** Modal compartilhado do app sobre `<dialog>` nativo.
 *
 * Padroniza backdrop (clique fora fecha), Escape (via pilha global
 * `useEscapeToClose`, respeitando popovers por cima) e o botão fechar.
 * O conteúdo é livre — páginas com layout próprio passam `children` e
 * opcionalmente `ModalHeader`. */
export function Modal({
  open,
  onClose,
  labelledBy,
  label,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  labelledBy?: string
  label?: string
  className?: string
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  // Escape passa pela pilha global (topmost primeiro); o `cancel` nativo é
  // suprimido para não furar popovers abertos por cima do modal.
  useEscapeToClose(open, onClose)

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (open) openDialog(dlg)
    else closeDialog(dlg)
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={['modal', className].filter(Boolean).join(' ')}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      onClose={onClose}
      onCancel={(event) => event.preventDefault()}
      onMouseDown={(event) => {
        // Clique no backdrop do `<dialog>` nativo: o alvo é o próprio
        // elemento (o conteúdo é filho e não fecha). Mesmo padrão dos
        // demais backdrops do app (palette, arquivos especiais).
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </dialog>
  )
}

/** Cabeçalho padrão do modal: título + botão fechar circular. */
export function ModalHeader({
  title,
  titleId,
  closeLabel,
  onClose,
}: {
  title: string
  titleId: string
  closeLabel: string
  onClose: () => void
}) {
  return (
    <div className="modal-header">
      <h3 id={titleId}>{title}</h3>
      <button type="button" className="modal-close" onClick={onClose} aria-label={closeLabel}>
        <X size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  )
}
