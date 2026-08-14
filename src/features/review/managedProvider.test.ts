import { describe, expect, it } from 'vitest'
import {
  canUseManagedProvider,
  estimateManagedCallCostUsd,
  MANAGED_PROVIDER_UNAVAILABLE_MESSAGE,
  SCAFFOLD_MANAGED_STATUS,
} from './managedProvider'

describe('managedProvider scaffolding', () => {
  it('estimates the managed call cost from the prompt size', () => {
    expect(estimateManagedCallCostUsd(0)).toBeGreaterThan(0)
    const small = estimateManagedCallCostUsd(1_000)
    const large = estimateManagedCallCostUsd(100_000)
    expect(large).toBeGreaterThan(small)
    // 100k caracteres ~ 25k tokens de entrada a US$0,30/M + saida estimada.
    const expected = 25_000 / 1_000_000 * 0.3 + 2_000 / 1_000_000 * 1.5
    expect(large).toBeCloseTo(expected, 9)
  })

  it('starts unsubscribed and refuses calls until the managed service exists', () => {
    expect(SCAFFOLD_MANAGED_STATUS.subscribed).toBe(false)
    expect(SCAFFOLD_MANAGED_STATUS.plan).toBe('free')
    expect(SCAFFOLD_MANAGED_STATUS.includedCostUsdPerMonth).toBe(0)
    expect(canUseManagedProvider(SCAFFOLD_MANAGED_STATUS, 0.01)).toBe(false)
  })

  it('gates calls on the remaining monthly quota once subscribed', () => {
    const status = {
      subscribed: true,
      plan: 'pro' as const,
      includedCostUsdPerMonth: 20,
      usedCostUsdMonth: 19.9,
    }
    expect(canUseManagedProvider(status, 0.05)).toBe(true)
    expect(canUseManagedProvider(status, 0.2)).toBe(false)
  })

  it('explains that the managed provider is not yet available', () => {
    expect(MANAGED_PROVIDER_UNAVAILABLE_MESSAGE).toContain('assinatura')
  })
})
