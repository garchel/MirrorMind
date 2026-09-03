import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEscapeToClose } from '../lib/escapeStack'
import { closeDialog, openDialog } from './dialog'
import './Modal.css'

/** Elementos que participam da contenção de Tab dentro do modal. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  dismissable = true,
  builderName,
}: {
  open: boolean
  onClose: () => void
  labelledBy?: string
  label?: string
  className?: string
  children: ReactNode
  /** `false` = modal bloqueante: Escape e clique no backdrop não dispensam
   * (só o `onClose` explícito da UI interna). Padrão `true`. */
  dismissable?: boolean
  /** Repassado como `data-builder-name` ao `<dialog>` (modo construtor
   * identifica o componente sob o mouse por esse atributo). */
  builderName?: string
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  // Escape passa pela pilha global (topmost primeiro); o `cancel` nativo é
  // suprimido para não furar popovers abertos por cima do modal.
  // Bloqueante (`dismissable={false}`) ignora o Escape como o backdrop.
  useEscapeToClose(open && dismissable, onClose)

  // Sistema de foco do modal (absorve o `useDialogFocus` que existia nas
  // Tags): foco inicial no primeiro elemento focável, contenção de
  // Tab/Shift+Tab e restauração do foco ao fechar. Funciona também no
  // fallback sem `showModal` (jsdom), onde o navegador não faz nada disso.
  const previousFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    openDialog(dlg)
    const first = dlg.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(first ?? dlg).focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (elements.length === 0) {
        event.preventDefault()
        return
      }
      const firstEl = elements[0]
      const lastEl = elements[elements.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (event.shiftKey && (active === firstEl || !dlg.contains(active))) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && (active === lastEl || !dlg.contains(active))) {
        event.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // Fechamento + restauração do foco (efeito separado para rodar também
  // quando `open` volta a `false` e na desmontagem com o modal aberto).
  useEffect(() => {
    if (open) return
    const dlg = dialogRef.current
    if (dlg) closeDialog(dlg)
    previousFocusRef.current?.focus?.()
    previousFocusRef.current = null
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={['modal', className].filter(Boolean).join(' ')}
      data-builder-name={builderName}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      onClose={onClose}
      onCancel={(event) => event.preventDefault()}
      onMouseDown={(event) => {
        // Clique no backdrop do `<dialog>` nativo: o alvo é o próprio
        // elemento (o conteúdo é filho e não fecha). Mesmo padrão dos
        // demais backdrops do app (palette, arquivos especiais).
        // Bloqueante (`dismissable={false}`) ignora o clique como o Escape.
        if (dismissable && event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </dialog>
  )
}

/** Cabeçalho padrão do modal: kicker opcional + título + botão fechar. */
export function ModalHeader({
  title,
  titleId,
  closeLabel,
  onClose,
  kicker,
}: {
  title: string
  titleId: string
  closeLabel: string
  onClose: () => void
  kicker?: string
}) {
  return (
    <div className="modal-header">
      <div>
        {kicker ? <p className="card-kicker">{kicker}</p> : null}
        <h3 id={titleId}>{title}</h3>
      </div>
      <button type="button" className="modal-close" onClick={onClose} aria-label={closeLabel}>
        <X size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  )
}
