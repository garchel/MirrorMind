import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from './Button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/**
 * Ajuda contextual de um bloco: um "?" discreto ao lado do titulo que explica
 * o que aquele componente mostra e para que serve.
 *
 * Abre no hover (com atraso, para nao abrir ao passar o mouse por cima) e no
 * clique/toque — sem hover, o toque e o unico jeito de chegar ao texto. O
 * Radix Popover resolve clique fora, Escape e o portal (o painel tem
 * `overflow`, e um balao absoluto seria cortado).
 *
 * O icone nao e decorativo: e o alvo do foco. Por isso o `aria-label` diz de
 * que bloco se trata ("Como funciona: Prontidão para revisar") em vez de um
 * "?" generico repetido em toda a tela.
 */
type InfoTipProps = {
  /** Nome do bloco, usado no rotulo acessivel do gatilho. */
  label: string
  children: ReactNode
}

/** Atrasos em ms: abrir espera um pouco (evita balao ao atravessar a tela);
 *  fechar espera mais, para dar tempo de mover o mouse do "?" para o texto. */
const ABRIR_MS = 160
const FECHAR_MS = 220

export function InfoTip({ label, children }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const abrirRef = useRef<number | null>(null)
  const fecharRef = useRef<number | null>(null)

  const cancelar = (ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current)
      ref.current = null
    }
  }

  const agendarAbrir = () => {
    cancelar(fecharRef)
    cancelar(abrirRef)
    abrirRef.current = window.setTimeout(() => setOpen(true), ABRIR_MS)
  }

  const agendarFechar = () => {
    cancelar(abrirRef)
    cancelar(fecharRef)
    fecharRef.current = window.setTimeout(() => setOpen(false), FECHAR_MS)
  }

  useEffect(() => () => {
    cancelar(abrirRef)
    cancelar(fecharRef)
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="bare"
          className="info-tip-trigger"
          aria-label={`Como funciona: ${label}`}
          onMouseEnter={agendarAbrir}
          onMouseLeave={agendarFechar}
          onFocus={() => setOpen(true)}
          // Dentro de <label> ou <summary>, o clique no "?" borbulharia e
          // ativaria o controle/botao de tras (focando o campo ou fechando o
          // bloco). stopPropagation para o pai, sem impedir o Radix no proprio
          // elemento.
          onClick={(event) => event.stopPropagation()}
        >
          <CircleHelp size={13} strokeWidth={2} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="info-tip-content"
        role="tooltip"
        align="start"
        sideOffset={6}
        // Hover nao deve roubar o foco de quem esta digitando/lendo.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={() => cancelar(fecharRef)}
        onMouseLeave={agendarFechar}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
