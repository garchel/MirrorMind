import { useState } from 'react'
import { useSession, type SessionClient } from '../../lib/session'

/** Conta (fundacao F1a): login/cadastro/saida sobre `useSession`, atras da
 * flag de cobranca. Sem backend (F1b), o App injeta um cliente desabilitado.
 * Excluir conta hoje encerra localmente; a cascata no servidor chega na F5. */
export function AccountSettings({ client }: { client: SessionClient }) {
  const { snapshot, error, signIn, signUp, signInWithGoogle, signOut } = useSession(client)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (snapshot.status === 'auth') {
    return (
      <div className="settings-toggle">
        <span>
          <strong>Conta</strong>
          <small>Conectado como {snapshot.email ?? 'conta local'}.</small>
        </span>
        <div className="settings-account-actions">
          <button type="button" className="secondary-button" onClick={() => void signOut()}>
            Sair
          </button>
          <button
            type="button"
            className="secondary-button danger-button"
            onClick={() => {
              if (!confirm('Excluir a conta neste aparelho? Isso encerra a sessão local.')) return
              void signOut()
            }}
          >
            Excluir conta
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-toggle">
      <span>
        <strong>Conta</strong>
        <small>Entre para sincronizar plano e cotas quando a cobrança ativar.</small>
      </span>
      <form
        className="settings-account-form"
        onSubmit={(event) => {
          event.preventDefault()
          void signIn(email, password)
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@exemplo.com"
          aria-label="E-mail da conta"
          autoComplete="email"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Senha"
          aria-label="Senha da conta"
          autoComplete="current-password"
        />
        {error ? <p role="alert" className="settings-note">{error}</p> : null}
        <div className="settings-account-actions">
          <button type="button" className="secondary-button" onClick={() => void signInWithGoogle()}>
            Entrar com Google
          </button>
          <button type="submit">
            Entrar
          </button>
          <button type="button" className="secondary-button" onClick={() => void signUp(email, password)}>
            Criar conta
          </button>
        </div>
      </form>
    </div>
  )
}
