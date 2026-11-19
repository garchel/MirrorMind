import { Button } from '../../components/ui/Button'
import { useSession, type SessionClient } from '../../lib/session'
import { useEntitlement } from '../../lib/entitlement'
import { PLANS, type PlanId } from '../../lib/billing'
import { Field } from '../../components/ui/Field'

/** Conta (F1b): login, cadastro e saída sobre `useSession`.
 *
 * O App injeta o cliente do Supabase quando o build tem `VITE_SUPABASE_URL` e a
 * chave publicável; sem elas a seção nem aparece. Login com Google ainda não
 * está ligado — o cliente responde com mensagem honesta nesse caso.
 *
 * Excluir conta hoje encerra localmente; a cascata no servidor chega na F5.
 *
 * Com a cobranca ligada, o painel de plano e o controle manual da F2: concede
 * ou revoga os direitos cacheados sem passar por checkout (o servidor assume
 * o lugar dele na F3). */
export function AccountSettings({
  client,
  onOpenAccount,
}: {
  client: SessionClient
  /** Os formulários de entrar/criar moraram aqui; agora vivem na página de conta. */
  onOpenAccount: () => void
}) {
  const { snapshot, signOut } = useSession(client)
  const { resolved, billingEnabled, grantPlan, clearPlan } = useEntitlement()

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
            <Button type="button" variant="secondary" size="md" onClick={onOpenAccount}>
              Abrir conta
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={() => void signOut()}>
              Sair
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
          <small>Sem conta o app funciona igual: notas, revisão com Ollama e BYOK.</small>
        </span>
        <div className="settings-account-actions">
          <Button type="button" variant="primary" size="sm" onClick={onOpenAccount}>
            Entrar ou criar conta
          </Button>
        </div>
      </div>
      {planPanel()}
    </>
  )
}
