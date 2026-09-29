import type { ReactNode } from 'react'
import { Button } from './ui/Button'
import { RefreshCw } from 'lucide-react'
import './PageHeader.css'

/** Cabecalho padrao das paginas do workspace: kicker + titulo + descricao a
 * direita e acao opcional (tipicamente o botao Atualizar) a esquerda. Usado
 * por Revisar/Painel/Relatorios para manter hierarquia e ritmo identicos. */
export function PageHeader({
  kicker,
  title,
  titleId,
  description,
  children,
}: {
  kicker: string
  title: string
  titleId?: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="workspace-page-header">
      <div>
        <p className="card-kicker">{kicker}</p>
        <h2 id={titleId}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </header>
  )
}

/** Botao Atualizar padrao dos cabecalhos de pagina (mesma acao de reload em
 * Queue/Dashboard/Reports). */
export function PageRefreshButton({
  onRefresh,
  disabled,
}: {
  onRefresh: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      className="ui-button ui-button--secondary ui-button--sm workspace-page-refresh"
      onClick={onRefresh}
      disabled={disabled}
    >
      <RefreshCw size={15} aria-hidden="true" />
      Atualizar
    </Button>
  )
}
