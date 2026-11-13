import { REVIEW_PRIORITY_LEVELS, priorityLevelFor } from './reviewPriorityLevels'
import './review-priority-picker.css'

/**
 * Prioridade como escolha de tres niveis, em formulario.
 *
 * O numero cru (0,1 a 100) existia em dois formularios — ritmo da tag e
 * opcoes avancadas do vault — e era o mesmo conceito que a fila ja mostra
 * como Normal/Alta/Urgente. Tres modelos para a mesma coisa, e as duas
 * portas numericas reintroduziam o bug do "0,1 vira 1,1".
 *
 * Aqui a escolha e explicita: um nivel por vez, com a consequencia escrita ao
 * lado. Peso que nao e 1/2/3 (politica antiga com 2,7) aparece no nivel mais
 * proximo e o valor real fica visivel abaixo — sem reescrever nada ate o
 * usuario escolher.
 */
type Props = {
  /** Peso atual (1, 2, 3 ou qualquer valor herdado de uma politica antiga). */
  value: number
  onChange: (weight: number) => void
  /** Nome do grupo para leitor de tela. */
  label?: string
  /** Desabilita o controle durante o salvamento. */
  disabled?: boolean
}

function formatWeight(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

export function ReviewPriorityLevelPicker({
  value,
  onChange,
  label = 'Prioridade na fila',
  disabled = false,
}: Props) {
  const nivel = priorityLevelFor(value)
  const exato = value === nivel.weight

  return (
    <div className="review-priority-picker">
      <div className="review-priority-picker-options" role="radiogroup" aria-label={label}>
        {REVIEW_PRIORITY_LEVELS.map((opcao) => {
          const ativo = opcao.weight === nivel.weight
          return (
            <button
              key={opcao.weight}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={disabled}
              className={`review-priority-picker-option${ativo ? ' is-active' : ''}`}
              data-level={opcao.label.toLowerCase()}
              onClick={() => onChange(opcao.weight)}
            >
              {opcao.label}
            </button>
          )
        })}
      </div>
      <p className="review-priority-picker-hint">{nivel.description}</p>
      {exato ? null : (
        <p className="review-priority-picker-legacy">
          Peso atual {formatWeight(value)} — escolha um nível para ajustar.
        </p>
      )}
    </div>
  )
}
