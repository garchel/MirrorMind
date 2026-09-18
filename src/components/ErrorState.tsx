/** Estado de erro padrao das paginas do workspace: mensagem + botao Tentar
 * novamente, com role=alert para leitores de tela. Substitui as 11 copias
 * duplicadas de bloco de erro nas paginas de features. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="workspace-error-state is-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="secondary-button" onClick={onRetry}>
          Tentar novamente
        </button>
      ) : null}
    </div>
  )
}

/** Estado de carregamento padrao das paginas do workspace. */
export function LoadingState({ message }: { message: string }) {
  return (
    <div className="workspace-error-status" role="status">{message}</div>
  )
}

/** Estado vazio padrao das paginas do workspace (Metas, Revisar, ...):
 * selo com icone, titulo, descricao, mini-guia numerado opcional e acao
 * opcional — o vazio vira orientação em vez de beco sem saída. */
export function EmptyState({ icon, title, description, steps, action }: {
  icon: React.ReactNode
  title: string
  description?: React.ReactNode
  steps?: string[]
  action?: React.ReactNode
}) {
  return (
    <div className="workspace-empty-state" role="status">
      <span className="workspace-empty-icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {steps && steps.length > 0 ? (
        <ol className="workspace-empty-steps">
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      ) : null}
      {action}
    </div>
  )
}
