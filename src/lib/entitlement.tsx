// oxlint-disable react/only-export-components -- store, provider e hook formam uma fronteira publica unica.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  isBillingEnabled,
  PLANS,
  resolveEntitlement,
  type Entitlement,
  type EntitlementStatus,
  type PlanId,
} from './billing'

/** Direitos do plano (fundacao de monetizacao, F2).
 *
 * O plano nao e segredo: o cache dos direitos vive em localStorage e vale por
 * 30 dias sem internet (fail-open). Os tokens continuam no OS keyring (Rust).
 * Enquanto a F3 nao existir, o `EntitlementStore` local e a unica fonte: o
 * plano manual gravado por `grantPlan` e exatamente o que o servidor emitiria,
 * o que permite testar liberacao e negacao sem cobrar ninguem.
 */

const ENTITLEMENT_CACHE_KEY = 'mirrormind.entitlement.v1'

export type ResolvedEntitlement = {
  plan: PlanId
  status: EntitlementStatus
  periodEndUnixMs: number | null
}

function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS
}

function parseEntitlement(raw: string | null): Entitlement | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { plan, status, periodEndUnixMs, checkedAtUnixMs } = parsed as Record<string, unknown>
    if (!isPlanId(plan)) return null
    if (status !== 'active' && status !== 'past_due' && status !== 'expired') return null
    if (typeof checkedAtUnixMs !== 'number' || !Number.isFinite(checkedAtUnixMs)) return null
    if (periodEndUnixMs !== null && (typeof periodEndUnixMs !== 'number' || !Number.isFinite(periodEndUnixMs))) {
      return null
    }
    return { plan, status, periodEndUnixMs, checkedAtUnixMs }
  } catch {
    return null
  }
}

export interface EntitlementStore {
  load(): Promise<Entitlement | null>
  save(entitlement: Entitlement | null): Promise<void>
}

/** Cache local dos direitos; cache corrompido e tratado como sem plano. */
export const localEntitlementStore: EntitlementStore = {
  async load() {
    try {
      return parseEntitlement(window.localStorage.getItem(ENTITLEMENT_CACHE_KEY))
    } catch {
      return null
    }
  },
  async save(entitlement) {
    try {
      if (entitlement === null) window.localStorage.removeItem(ENTITLEMENT_CACHE_KEY)
      else window.localStorage.setItem(ENTITLEMENT_CACHE_KEY, JSON.stringify(entitlement))
    } catch {
      // localStorage indisponivel (privacidade do WebView): segue sem cache.
    }
  },
}

type EntitlementValue = {
  entitlement: Entitlement | null
  resolved: ResolvedEntitlement
  billingEnabled: boolean
  /** Plano manual (F2): concede ou revoga os direitos sem cobrar. */
  grantPlan: (plan: PlanId) => void
  clearPlan: () => void
}

const EntitlementContext = createContext<EntitlementValue | null>(null)

export function EntitlementProvider({
  children,
  store = localEntitlementStore,
}: {
  children: ReactNode
  store?: EntitlementStore
}) {
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)

  useEffect(() => {
    let cancelled = false
    void store
      .load()
      .then((loaded) => {
        if (!cancelled) setEntitlement(loaded)
      })
      .catch(() => {
        if (!cancelled) setEntitlement(null)
      })
    return () => {
      cancelled = true
    }
  }, [store])

  const grantPlan = useCallback(
    (plan: PlanId) => {
      const next: Entitlement = { plan, status: 'active', periodEndUnixMs: null, checkedAtUnixMs: Date.now() }
      setEntitlement(next)
      void store.save(next)
    },
    [store],
  )

  const clearPlan = useCallback(() => {
    setEntitlement(null)
    void store.save(null)
  }, [store])

  const value = useMemo<EntitlementValue>(() => ({
    entitlement,
    resolved: resolveEntitlement(entitlement, Date.now()),
    billingEnabled: isBillingEnabled(),
    grantPlan,
    clearPlan,
  }), [clearPlan, entitlement, grantPlan])

  return <EntitlementContext value={value}>{children}</EntitlementContext>
}

export function useEntitlement(): EntitlementValue {
  const value = useContext(EntitlementContext)
  if (!value) throw new Error('EntitlementProvider is missing.')
  return value
}
