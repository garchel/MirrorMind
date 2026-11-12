import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'

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
export const REVIEW_PRIORITY_LEVELS = [
  { label: 'Normal', weight: 1, description: 'Entra na fila pelo atraso, como as demais.' },
  { label: 'Alta', weight: 2, description: 'Passa na frente das normais.' },
  { label: 'Urgente', weight: 3, description: 'Vai para o topo da fila.' },
] as const

export type ReviewPriorityLevel = (typeof REVIEW_PRIORITY_LEVELS)[number]

/** Nivel correspondente ao peso salvo.
 *
 *  O peso pode vir fracionario de uma politica (tag, prazo ou nota antiga que
 *  ficou com 0,1). A tela mostra o degrau mais proximo — `0,1` e `0,4` sao
 *  "Normal", `2,7` e "Urgente" — e o valor exato aparece no `title` do
 *  controle, para nao esconder o dado de quem procura. Nada e reescrito ate o
 *  usuario escolher um nivel. */
export function priorityLevelFor(weight: number): ReviewPriorityLevel {
  const index = Math.min(
    REVIEW_PRIORITY_LEVELS.length - 1,
    Math.max(0, Math.round(weight) - 1),
  )
  return REVIEW_PRIORITY_LEVELS[index]
}

function formatWeight(weight: number): string {
  return weight.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

type ReviewPriorityControlProps = {
  weight: number
  noteTitle: string
  busy?: boolean
  onChange: (weight: number) => void
}

export function ReviewPriorityControl({
  weight,
  noteTitle,
  busy = false,
  onChange,
}: ReviewPriorityControlProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const level = priorityLevelFor(weight)
  const exact = weight === level.weight
  const detail = exact ? level.label : `${level.label} (peso ${formatWeight(weight)})`

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
        <p className="review-priority-hint">Vale só para esta nota.</p>
      </PopoverContent>
    </Popover>
  )
}
