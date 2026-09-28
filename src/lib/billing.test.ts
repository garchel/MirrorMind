import { describe, expect, it, vi } from 'vitest'
import {
  canUseManagedAi,
  DEFAULT_PLAN,
  ENTITLEMENT_OFFLINE_GRACE_MS,
  isBillingEnabled,
  PLANS,
  resolveEntitlement,
  type Entitlement,
} from './billing'

describe('billing foundation', () => {
  it('cobraca desligada por padrao (rollback sem deploy)', () => {
    expect(isBillingEnabled()).toBe(false)
    expect(DEFAULT_PLAN).toBe('gratis')
    expect(PLANS.gratis.quota.managedAiCallsPerCycle).toBeNull()
    expect(PLANS.ia_mensal.quota.managedAiCallsPerCycle).toBe(200)
  })

  it('sem cobranca ou sem direitos, tudo opera como gratis', () => {
    const now = 1_700_000_000_000
    expect(resolveEntitlement(null, now)).toEqual({ plan: 'gratis', status: 'active', periodEndUnixMs: null })
    expect(
      resolveEntitlement({ plan: 'ia_mensal', status: 'active', periodEndUnixMs: null, checkedAtUnixMs: now }, now),
    ).toEqual({ plan: 'gratis', status: 'active', periodEndUnixMs: null })
  })

  it('graca offline de 30 dias expira para gratis', () => {
    const checked = 1_700_000_000_000
    const active: Entitlement = { plan: 'ia_mensal', status: 'active', periodEndUnixMs: null, checkedAtUnixMs: checked }
    vi.stubEnv('VITE_BILLING_ENABLED', 'true')
    try {
      expect(resolveEntitlement(active, checked).plan).toBe('ia_mensal')
      expect(resolveEntitlement(active, checked + ENTITLEMENT_OFFLINE_GRACE_MS + 1).plan).toBe('gratis')
      expect(
        resolveEntitlement({ ...active, status: 'expired' }, checked).plan,
      ).toBe('gratis')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('IA gerenciada so com cota positiva; Ollama/BYOK fora do gate', () => {
    expect(canUseManagedAi('gratis')).toBe(false)
    expect(canUseManagedAi('ia_mensal')).toBe(true)
    expect(canUseManagedAi('ia_anual')).toBe(true)
  })
})
