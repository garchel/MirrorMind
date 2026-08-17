import { Check, Columns3, Hash, Lock, RotateCcw, type LucideIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { COMMON_PROPERTIES } from '../../lib/commonProperties'
import type { BaseColumn } from './bases'

type Props = {
  /** Todas as colunas disponiveis (nome + propriedades comuns e customizadas). */
  columns: BaseColumn[]
  /** Chaves das colunas de propriedade visiveis (o nome e sempre visivel). */
  visibleKeys: ReadonlySet<string>
  onToggle: (key: string, visible: boolean) => void
  onReset: () => void
}

const COMMON_BY_KEY = new Map(COMMON_PROPERTIES.map((property) => [property.key, property]))

/**
 * Seletor de colunas da pagina Tabela: o usuario marca/desmarca quais
 * propriedades aparecem como colunas. As opcoes sao as MESMAS propriedades
 * comuns do menu de propriedades do header (arrow down) — com icone e
 * rotulo — mais as propriedades customizadas encontradas nas notas. O nome
 * da nota e sempre visivel (fixo). A escolha e persistida pelo proprio pai
 * (localStorage por vault); este componente so reporta mudancas.
 */
export function ColumnPicker({ columns, visibleKeys, onToggle, onReset }: Props) {
  const propertyColumns = columns.filter((column) => column.kind === 'property')
  const visibleCount = propertyColumns.filter((column) => visibleKeys.has(column.key)).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bases-columns-button"
          aria-label="Escolher colunas da tabela"
          title="Escolher colunas"
        >
          <Columns3 size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Colunas</span>
          {visibleCount < propertyColumns.length ? (
            <span className="bases-columns-badge">{visibleCount}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="bases-column-picker" align="end" sideOffset={6}>
        <div className="bases-column-picker-head">
          <span>Colunas visíveis</span>
          <span className="bases-column-picker-count">{visibleCount} de {propertyColumns.length}</span>
        </div>
        <div className="bases-column-picker-list" role="group" aria-label="Colunas da tabela">
          <div className="bases-column-row is-checked is-locked" aria-disabled="true">
            <span className="bases-column-check">
              <Check size={11} strokeWidth={2.5} aria-hidden="true" />
            </span>
            <span className="bases-column-label">Nota</span>
            <Lock size={11} strokeWidth={1.75} className="bases-column-lock" aria-hidden="true" />
          </div>
          {propertyColumns.map((column) => {
            const common = COMMON_BY_KEY.get(column.key)
            const Icon: LucideIcon = common?.icon ?? Hash
            const checked = visibleKeys.has(column.key)
            return (
              <button
                key={column.key}
                type="button"
                className={`bases-column-row${checked ? ' is-checked' : ''}`}
                onClick={() => onToggle(column.key, !checked)}
                aria-pressed={checked}
                aria-label={common ? `${common.label} (${column.key})` : column.key}
                title={checked ? `Ocultar coluna ${common?.label ?? column.key}` : `Mostrar coluna ${common?.label ?? column.key}`}
              >
                <span className="bases-column-check">
                  <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                </span>
                <Icon size={14} strokeWidth={1.8} aria-hidden="true" className="bases-column-row-icon" />
                <span className="bases-column-label">{common?.label ?? column.key}</span>
                {common ? <span className="bases-column-key">{column.key}</span> : null}
              </button>
            )
          })}
        </div>
        <div className="bases-column-picker-foot">
          <button
            type="button"
            className="bases-columns-reset"
            onClick={onReset}
            title="Voltar a mostrar todas as propriedades"
          >
            <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
            <span>Restaurar padrão</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
