import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { useSession, type SessionClient } from '../../lib/session'
import { useEntitlement } from '../../lib/entitlement'
import { PLANS, type PlanId } from '../../lib/billing'
import { Field } from '../../components/ui/Field'

/** Conta (fundacao F1a): login/cadastro/saida sobre `useSession`, atras da
 * flag de cobranca. Sem backend (F1b), o App injeta um cliente desabilitado.
 * Excluir conta hoje encerra localmente; a cascata no servidor chega na F5.
 *
 * Com a cobranca ligada, o painel de plano e o controle manual da F2: concede
 * ou revoga os direitos cacheados sem passar por checkout (o servidor assume
 * o lugar dele na F3). */
export function AccountSettings({ client }: { client: SessionClient }) {
  const { snapshot, error, signIn, signUp, signInWithGoogle, signOut } = useSession(client)
  const { resolved, billingEnabled, grantPlan, clearPlan } = useEntitlement()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  function planPanel() {
    if (!billingEnabled) return null
    return (
      <div className="settings-toggle">
        <span>
          <strong>Plano</strong>
          <small>
            {PLANS[resolved.plan].name}
            {resolved.status === 'active' ? '' : ` (${resolved.status === 'past_due' ? 'pendente' : 'expirado'})`} — ajuste manual da F2,
            sem cobrança. O servidor assume este painel na F3.
          </small>
        </span>
        <div className="settings-account-actions">
          <Field as="select"
            className="settings-select"
            value={resolved.plan}
            aria-label="Plano de teste"
            onChange={(event) => {
              if (event.target.value === 'gratis') clearPlan()
              else grantPlan(event.target.value as PlanId)
            }}
          >
            {Object.values(PLANS).map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name}</option>
            ))}
          </Field>
        </div>
      </div>
    )
  }

  if (snapshot.status === 'auth') {
    return (
      <>
        <div className="settings-toggle">
          <span>
            <strong>Conta</strong>
            <small>Conectado como {snapshot.email ?? 'conta local'}.</small>
          </span>
          <div className="settings-account-actions">
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void signOut()}>
              Sair
            </Button>
            <Button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => {
                if (!confirm('Excluir a conta neste aparelho? Isso encerra a sessão local.')) return
                void signOut()
              }}
            >
              Excluir conta
            </Button>
          </div>
        </div>
        {planPanel()}
      </>
    )
  }

  return (
    <>
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
          <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void signInWithGoogle()}>
            Entrar com Google
          </Button>
          <button type="submit">
            Entrar
          </button>
          <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void signUp(email, password)}>
            Criar conta
          </Button>
        </div>
      </form>
      </div>
      {planPanel()}
    </>
  )
}
