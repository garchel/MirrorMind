import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from './ui/Button'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export type GraphFilterOption = {
  value: string
  label: string
}

type GraphFilterSelectProps = {
  /** Nome acessivel do filtro (ex.: "Filtrar pasta do grafo"). */
  label: string
  /** Rotulo da opcao neutra (ex.: "Todas as pastas"). */
  allLabel: string
  /** Icone a esquerda do valor no trigger. */
  icon: ReactNode
  /** Valor selecionado ('' = sem filtro). */
  value: string
  options: GraphFilterOption[]
  onChange: (value: string) => void
  /** Largura fixa do trigger: evita o shift de layout do <select> nativo. */
  width?: number
}

/** Dropdown de filtro do grafo no padrao dos popovers do app (Exportar /
 * Configurar): trigger de largura fixa com ellipsis, menu com busca e check
 * na opcao ativa. Substitui o <select> nativo da pasta e da tag. */
export function GraphFilterSelect({
  label,
  allLabel,
  icon,
  value,
  options,
  onChange,
  width = 148,
}: GraphFilterSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = options.find((option) => option.value === value) ?? null

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) => option.label.toLowerCase().includes(term))
  }, [options, query])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setQuery('')
  }

  function choose(next: string) {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  /** Setas navegam entre as opcoes; Escape fecha (padrao do Radix). */
  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : event.key === 'ArrowUp'
          ? (current - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : items.length - 1
    items[next]?.focus()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          className={`graph-filter-select${value !== '' ? ' is-active' : ''}`}
          style={{ width }}
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={selected?.label ?? allLabel}
        >
          <span className="graph-filter-select-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="graph-filter-select-value">{selected?.label ?? allLabel}</span>
          <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="graph-filter-select-menu"
        onKeyDown={handleMenuKeyDown}
      >
        <label className="graph-filter-select-search">
          <Search size={13} strokeWidth={2} aria-hidden="true" />
          <span className="graph-sr-only">Buscar em {label}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar"
            aria-label={`Buscar em ${label}`}
          />
        </label>
        <div className="graph-filter-select-list" role="listbox" aria-label={label}>
          <Button
            type="button"
            role="option"
            aria-selected={value === ''}
            className="ui-button graph-filter-select-option"
            onClick={() => choose('')}
          >
            <span className="graph-filter-select-check" aria-hidden="true">
              {value === '' ? <Check size={13} strokeWidth={2.5} /> : null}
            </span>
            <span className="graph-filter-select-option-label">{allLabel}</span>
          </Button>
          {visible.map((option) => (
            <Button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="ui-button graph-filter-select-option"
              title={option.label}
              onClick={() => choose(option.value)}
            >
              <span className="graph-filter-select-check" aria-hidden="true">
                {option.value === value ? <Check size={13} strokeWidth={2.5} /> : null}
              </span>
              <span className="graph-filter-select-option-label">{option.label}</span>
            </Button>
          ))}
          {visible.length === 0 ? (
            <p className="graph-filter-select-empty">Nenhum resultado para “{query.trim()}”.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
