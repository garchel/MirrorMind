import { Cloud, CloudUpload, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { formatLastSync, type CloudIndicatorState } from '../../lib/cloudSync'
import './cloud-indicator.css'

/** Indicador discreto do estado da nuvem, no topo do workspace.
 *
 * Ele existe porque a sincronização automática acontecia sem sinal nenhum: a
 * pessoa não tinha como saber se o que escreveu já saiu do computador. A regra
 * aqui é **não virar ruído**: com o ciclo concluído, o texto é a hora; sem nada
 * para dizer (vault não ligado), o indicador simplesmente não aparece.
 *
 * Apresentacional de propósito — recebe o estado pronto, não lê nada. O seletor
 * de estado mora em `lib/cloudSync` porque é função pura, e este arquivo exporta
 * só componente (o lint de fast refresh cobra isso). */


export function CloudIndicator({
  state,
  lastSyncedAt,
  onOpen,
}: {
  state: CloudIndicatorState
  lastSyncedAt: string | null
  onOpen: () => void
}) {
  if (state === 'off') return null

  const rotulo =
    state === 'syncing'
      ? 'Sincronizando…'
      : state === 'error'
        ? 'Sem sincronizar'
        : `Sincronizado ${formatLastSync(lastSyncedAt)}`

  const Icone =
    state === 'syncing' ? CloudUpload : state === 'error' ? TriangleAlert : Cloud

  const descricao =
    state === 'syncing'
      ? 'Enviando e recebendo alterações do vault na nuvem.'
      : state === 'error'
        ? 'A última sincronização não terminou. Abre a seção Nuvem para ver o motivo.'
        : 'O vault está sincronizado com a nuvem. Abre a seção Nuvem para detalhes.'

  return (
    <Button
      type="button"
      variant="bare"
      size="sm"
      className="cloud-indicator"
      data-state={state}
      onClick={onOpen}
      title={descricao}
      aria-label={`Nuvem: ${rotulo}. ${descricao}`}
    >
      <Icone size={14} strokeWidth={1.6} aria-hidden="true" />
      <span className="cloud-indicator-label" aria-hidden="true">
        {rotulo}
      </span>
    </Button>
  )
}
