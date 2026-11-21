import { describe, expect, it, vi } from 'vitest'
import {
  canUseManagedAi,
  DEFAULT_PLAN,
  ENTITLEMENT_OFFLINE_GRACE_MS,
  isBillingEnabled,
  PLANS,
  resolveEntitlement,
  type Entitlement,
  freeCallsRemaining,
} from './billing'

describe('billing foundation', () => {
  it('cobraca desligada por padrao (rollback sem deploy)', () => {
    expect(isBillingEnabled()).toBe(false)
    expect(DEFAULT_PLAN).toBe('gratis')
    // Gratis: 50 chamadas unicas, nao renovaveis (convite, nao cota).
    expect(PLANS.gratis.quota.lifetime).toBe(50)
    expect(PLANS.gratis.quota.monthly).toBeNull()
    expect(PLANS.essencial.quota.monthly).toBe(1_000)
    expect(PLANS.pro.quota.monthly).toBe(1_200)
  })

  it('sem cobranca ou sem direitos, tudo opera como gratis', () => {
    const now = 1_700_000_000_000
    expect(resolveEntitlement(null, now)).toEqual({ plan: 'gratis', status: 'active', periodEndUnixMs: null })
    expect(
      resolveEntitlement({ plan: 'essencial', status: 'active', periodEndUnixMs: null, checkedAtUnixMs: now }, now),
    ).toEqual({ plan: 'gratis', status: 'active', periodEndUnixMs: null })
  })

  it('graca offline de 30 dias expira para gratis', () => {
    const checked = 1_700_000_000_000
    const active: Entitlement = { plan: 'essencial', status: 'active', periodEndUnixMs: null, checkedAtUnixMs: checked }
    vi.stubEnv('VITE_BILLING_ENABLED', 'true')
    try {
      expect(resolveEntitlement(active, checked).plan).toBe('essencial')
      expect(resolveEntitlement(active, checked + ENTITLEMENT_OFFLINE_GRACE_MS + 1).plan).toBe('gratis')
      expect(
        resolveEntitlement({ ...active, status: 'expired' }, checked).plan,
      ).toBe('gratis')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('IA gerenciada liberada por plano; gratis tem 50 chamadas unicas', () => {
    // Decisao de pacotes do beta: a conta gratuita inclui 50 chamadas uma vez,
    // para sentir o valor. Quem conta de verdade e o servidor.
    expect(canUseManagedAi('gratis')).toBe(true)
    expect(canUseManagedAi('essencial')).toBe(true)
    expect(canUseManagedAi('pro')).toBe(true)
    expect(freeCallsRemaining(50)).toBe(0)
    expect(freeCallsRemaining(12)).toBe(38)
  })
})
