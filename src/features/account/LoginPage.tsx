import type { SessionClient } from '../../lib/session'
import { AccountForm } from './AccountForm'
import './login-page.css'

/**
 * Página de conta do workspace (rota "Conta"): aberta pelo menu do perfil ou
 * pelas Configurações, depois que o app já está em uso.
 *
 * A primeira tela do app usa o mesmo `AccountForm`, mas em outra moldura — ver
 * `VaultSelection`.
 */
export function LoginPage({
  client,
  onAuthenticated,
  onSkip,
}: {
  client: SessionClient
  onAuthenticated: () => void
  onSkip: () => void
}) {
  return (
    <section className="workspace-page login-page" data-builder-name="login-page">
      <div className="login-card">
        <AccountForm client={client} onAuthenticated={onAuthenticated} onSkip={onSkip} />
      </div>
    </section>
  )
}
