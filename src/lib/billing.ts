/** Fundacao de monetizacao (F1a): catalogo de planos, direitos e kill-switch.
 *
 * Precos moram no Stripe (servidor); aqui vivem apenas identificadores,
 * cotas e tipos. Cobranca desligada por padrao (`billing_enabled=false`):
 * sem backend de contas, todo ponto de uso opera como gratis.
 */

export type PlanId = 'gratis' | 'essencial' | 'pro'

export type PlanQuota = {
  /** Chamadas unicas da conta gratuita (nao renovam). null = nao se aplica. */
  lifetime: number | null
  /** Chamadas por ciclo mensal (uso justo). null = nao se aplica. */
  monthly: number | null
  daily: number
  perMinute: number
  /** Teto de custo mensal em USD; null = sem teto. */
  costUsdMonthly: number | null
}

export type PlanDefinition = {
  id: PlanId
  name: string
  quota: PlanQuota
}

// Mesmos numeros do banco (`ai_limits`): o servidor e a autoridade, isto aqui
// e a leitura para a interface e a mensagem.
export const PLANS: Record<PlanId, PlanDefinition> = {
  gratis: {
    id: 'gratis',
    name: 'Grátis',
    // 50 chamadas para sentir o valor uma vez. Nao renovam: e convite, nao cota.
    quota: { lifetime: 50, monthly: null, daily: 20, perMinute: 10, costUsdMonthly: null },
  },
  essencial: {
    id: 'essencial',
    name: 'Essencial',
    quota: { lifetime: null, monthly: 1_000, daily: 300, perMinute: 20, costUsdMonthly: 4 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    quota: { lifetime: null, monthly: 1_200, daily: 400, perMinute: 30, costUsdMonthly: 5 },
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
): { plan: PlanId; status: EntitlementStatus; periodEndUnixMs: number | null } {
  if (!isBillingEnabled() || entitlement === null) {
    return { plan: DEFAULT_PLAN, status: 'active', periodEndUnixMs: null }
  }
  if (nowUnixMs - entitlement.checkedAtUnixMs > ENTITLEMENT_OFFLINE_GRACE_MS) {
    return { plan: DEFAULT_PLAN, status: 'expired', periodEndUnixMs: null }
  }
  if (entitlement.status === 'expired') {
    return { plan: DEFAULT_PLAN, status: 'expired', periodEndUnixMs: null }
  }
  return { plan: entitlement.plan, status: entitlement.status, periodEndUnixMs: entitlement.periodEndUnixMs }
}

/** IA gerenciada liberada por plano? Ollama/BYOK nunca passam por aqui.
 *
 * `gratis` tem 50 chamadas unicas: o app libera a opcao e o servidor recusa a
 * 51ª com mensagem propria — quem conta de verdade e o banco, nao a interface.
 */
export function canUseManagedAi(plan: PlanId): boolean {
  const quota = PLANS[plan]?.quota
  if (!quota) return false
  return quota.lifetime !== null || quota.monthly !== null
}

/** Quanto a conta gratuita ainda tem, a partir do uso que o servidor informou. */
export function freeCallsRemaining(usedLifetime: number): number {
  const total = PLANS.gratis.quota.lifetime ?? 0
  return Math.max(0, total - usedLifetime)
}
