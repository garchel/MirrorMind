import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { matchesQuery, useSettingsSearch } from './settingsSearch'

/**
 * Uma linha de configuração: rótulo, explicação e o controle à direita.
 *
 * Existe por três motivos que a marcação solta não dava conta:
 *
 * - **busca**: cada linha se compara com o termo digitado e se esconde;
 * - **"fora do padrão"**: um ponto discreto no rótulo diz o que o usuário
 *   mexeu, em vez de deixá-lo comparar com a memória;
 * - **restaurar por linha**: o botão só existe quando a linha está alterada.
 */
type Props = {
  label: string
  description?: ReactNode
  /** Palavras que não estão no rótulo mas levam até ele (busca). */
  keywords?: string
  /** Valor atual difere do padrão. */
  changed?: boolean
  onReset?: () => void
  children: ReactNode
}

export function SettingRow({
  label,
  description,
  keywords = '',
  changed = false,
  onReset,
  children,
}: Props) {
  const { query } = useSettingsSearch()
  const visible = matchesQuery(
    query,
    label,
    typeof description === 'string' ? description : '',
    keywords,
  )

  return (
    <div className="settings-row" data-match={visible} hidden={!visible}>
      {/* `div`, e nao `label`: envelopar um grupo de radios num label batiza
          todos com o texto do rotulo e o controle perde o proprio nome. */}
      <div className="settings-toggle">
        <span>
          <strong>
            {label}
            {changed ? <span className="settings-changed" role="img" aria-label="Fora do padrão" title="Fora do padrão" /> : null}
          </strong>
          {description ? <small>{description}</small> : null}
        </span>
        {children}
      </div>
      {changed && onReset ? (
        <Button
          type="button"
          variant="bare"
          size="sm"
          className="settings-reset"
          onClick={onReset}
          title={`Restaurar ${label} para o padrão`}
          aria-label={`Restaurar ${label} para o padrão`}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}
