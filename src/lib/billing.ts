/** Fundacao de monetizacao (F1a): catalogo de planos, direitos e kill-switch.
 *
 * Precos moram no Stripe (servidor); aqui vivem apenas identificadores,
 * cotas e tipos. Cobranca desligada por padrao (`billing_enabled=false`):
 * sem backend de contas, todo ponto de uso opera como gratis.
 */

export type PlanId = 'gratis' | 'ia_mensal' | 'ia_anual'

export type PlanQuota = {
  /** Chamadas de IA gerenciada por ciclo; null = bloqueado, Infinity = livre. */
  managedAiCallsPerCycle: number | null
}

export type PlanDefinition = {
  id: PlanId
  name: string
  quota: PlanQuota
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  gratis: {
    id: 'gratis',
    name: 'Grátis',
    quota: { managedAiCallsPerCycle: null },
  },
  ia_mensal: {
    id: 'ia_mensal',
    name: 'IA Mensal',
    quota: { managedAiCallsPerCycle: 200 },
  },
  ia_anual: {
    id: 'ia_anual',
    name: 'IA Anual',
    quota: { managedAiCallsPerCycle: 200 },
  },
}

export const DEFAULT_PLAN: PlanId = 'gratis'

export type EntitlementStatus = 'active' | 'past_due' | 'expired'

export type Entitlement = {
  plan: PlanId
  status: EntitlementStatus
  /** Fim do ciclo atual (unix ms) ou null (gratis). */
  periodEndUnixMs: number | null
  /** Quando os direitos foram verificados pela ultima vez (unix ms). */
  checkedAtUnixMs: number
}

/** Graca offline em ms (30 dias): sem internet o plano pago continua valendo. */
export const ENTITLEMENT_OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000

const BILLING_FLAG_KEY = 'mirrormind.billing-enabled'

/** Kill-switch da cobranca: override local > env > desligado. Desligado, o
 * app inteiro opera como gratis (rollback sem deploy). */
export function isBillingEnabled(): boolean {
  try {
    const override = localStorage.getItem(BILLING_FLAG_KEY)
    if (override === 'true') return true
    if (override === 'false') return false
  } catch {
    // localStorage indisponivel (privacidade do WebView): cai para o env.
  }
  return import.meta.env.VITE_BILLING_ENABLED === 'true'
}

/** Direitos efetivos: gratis quando a cobranca esta desligada, expirada a
 * graca, ou inadimplente alem da tolerancia. */
export function resolveEntitlement(
  entitlement: Entitlement | null,
  nowUnixMs: number,
): { plan: PlanId; status: EntitlementStatus } {
  if (!isBillingEnabled() || entitlement === null) {
    return { plan: DEFAULT_PLAN, status: 'active' }
  }
  if (nowUnixMs - entitlement.checkedAtUnixMs > ENTITLEMENT_OFFLINE_GRACE_MS) {
    return { plan: DEFAULT_PLAN, status: 'expired' }
  }
  if (entitlement.status === 'expired') {
    return { plan: DEFAULT_PLAN, status: 'expired' }
  }
  return { plan: entitlement.plan, status: entitlement.status }
}

/** IA gerenciada liberada? Ollama/BYOK nunca passam por aqui (sempre livres). */
export function canUseManagedAi(plan: PlanId): boolean {
  const quota = PLANS[plan]?.quota.managedAiCallsPerCycle
  return quota !== null && quota !== undefined && quota > 0
}
