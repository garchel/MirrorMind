import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import {
  REVIEW_PRIORITY_LEVELS,
  describePrioritySource,
  priorityLevelFor,
  type PrioritySourceLike,
} from './reviewPriorityLevels'

function formatWeight(weight: number): string {
  return weight.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

type ReviewPriorityControlProps = {
  weight: number
  noteTitle: string
  /** De onde veio o peso. Sem isso, "Alta" parece escolha da nota. */
  source?: PrioritySourceLike | null
  busy?: boolean
  onChange: (weight: number) => void
}

/**
 * Prioridade como ESCOLHA, nao como numero.
 *
 * O motor de revisao sempre trabalhou com tres degraus: as tags padrao de
 * revisao valem `revisao/leve` = 1, `revisao/manter` = 2 e `revisao/prova` = 3,
 * e o padrao do vault e 1. O stepper antigo, porem, expunha esses degraus como
 * "Prioridade 1" com botoes -/+ e permitia qualquer valor de 0,1 a 100 —
 * um numero sem escala visivel, que obrigava o usuario a adivinhar se 1 era
 * muito ou pouco. Aqui a tela fala a mesma lingua da politica: tres estados
 * nomeados, cada um dizendo o efeito na fila.
 *
 * Os pesos gravados sao exatamente os que o backend ja entende (1, 2, 3), sem
 * migracao de dados: uma nota que hoje tem peso 2 continua "Alta".
 */
export function ReviewPriorityControl({
  weight,
  noteTitle,
  source = null,
  busy = false,
  onChange,
}: ReviewPriorityControlProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const level = priorityLevelFor(weight)
  const exact = weight === level.weight
  const detail = exact ? level.label : `${level.label} (peso ${formatWeight(weight)})`
  const origem = describePrioritySource(source)
  const herdada = source?.kind === 'tag'
    || source?.kind === 'activeDeadlineTag'
    || source?.kind === 'expiredDeadlineTag'

  // Ao abrir, o foco vai para o nivel atual — o Radix foca o painel, nao a
  // opcao, e sem isso o teclado teria que tabular desde o topo do popover.
  useEffect(() => {
    if (!open) return
    const marcado = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    const primeiro = menuRef.current?.querySelector<HTMLButtonElement>('button')
    ;(marcado ?? primeiro)?.focus()
  }, [open])

  // Setas/Home/End dentro do menu (o Popover do Radix nao faz roving focus;
  // o DropdownMenu faria, mas nao esta entre as dependencias do projeto).
  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const itens = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('.review-priority-option') ?? [],
    )
    if (itens.length === 0) return
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const passo = event.key === 'ArrowDown' ? 1 : -1
      itens[(atual + passo + itens.length) % itens.length].focus()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      itens[event.key === 'Home' ? 0 : itens.length - 1].focus()
    }
  }

  return (
    <Popover open={open && !busy} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="bare"
          className="review-priority-trigger"
          data-level={level.label.toLowerCase()}
          disabled={busy}
          aria-label={`Prioridade de ${noteTitle}: ${detail}`}
          title={`Prioridade: ${detail}`}
        >
          <span className="review-priority-dot" aria-hidden="true" />
          {level.label}
          <ChevronDown size={12} strokeWidth={2} className="review-priority-caret" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="review-priority-menu" align="start" sideOffset={6}>
        <p className="review-priority-menu-title">Prioridade desta nota</p>
        {origem ? <p className="review-priority-source">{origem}</p> : null}
        <div role="menu" aria-label="Prioridade da nota" ref={menuRef} onKeyDown={handleMenuKeyDown}>
          {REVIEW_PRIORITY_LEVELS.map((option) => {
            const checked = option.weight === level.weight
            return (
              <button
                key={option.weight}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className="review-priority-option"
                onClick={() => {
                  setOpen(false)
                  if (!checked) onChange(option.weight)
                }}
              >
                <span className="review-priority-mark" aria-hidden="true">
                  {checked ? <Check size={13} strokeWidth={2.4} /> : null}
                </span>
                <span className="review-priority-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            )
          })}
        </div>
        <p className="review-priority-hint">
          {herdada
            ? 'Mudar aqui vale só para esta nota; a tag continua valendo para as outras.'
            : 'Vale só para esta nota.'}
        </p>
      </PopoverContent>
    </Popover>
  )
}
