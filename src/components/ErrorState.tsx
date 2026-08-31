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
