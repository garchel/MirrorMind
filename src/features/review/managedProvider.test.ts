import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENTITLEMENT_OFFLINE_GRACE_MS, type Entitlement } from '../../lib/billing'
import {
  estimateManagedCallCostUsd,
  formatManagedRenewal,
  managedAiGate,
  MANAGED_PROVIDER_UNAVAILABLE_MESSAGE,
} from './managedProvider'

const NOW = 1_700_000_000_000

function paidPlan(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    plan: 'ia_mensal',
    status: 'active',
    periodEndUnixMs: NOW + 30 * 24 * 60 * 60 * 1000,
    checkedAtUnixMs: NOW,
    ...overrides,
  }
}

function withBilling(on: boolean) {
  vi.stubEnv('VITE_BILLING_ENABLED', on ? 'true' : 'false')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('managedProvider', () => {
  it('estimates the managed call cost from the prompt size', () => {
    expect(estimateManagedCallCostUsd(0)).toBeGreaterThan(0)
    const small = estimateManagedCallCostUsd(1_000)
    const large = estimateManagedCallCostUsd(100_000)
    expect(large).toBeGreaterThan(small)
    // 100k caracteres ~ 25k tokens de entrada a US$0,30/M + saida estimada.
    const expected = 25_000 / 1_000_000 * 0.3 + 2_000 / 1_000_000 * 1.5
    expect(large).toBeCloseTo(expected, 9)
  })

  it('formata a renovacao em pt-BR', () => {
    expect(formatManagedRenewal(NOW)).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('desligado, nega e explica que o servico ainda nao existe', () => {
    withBilling(false)
    const gate = managedAiGate(paidPlan(), NOW)
    expect(gate.allowed).toBe(false)
    expect(gate.message).toBe(MANAGED_PROVIDER_UNAVAILABLE_MESSAGE)
    expect(gate.label).toContain('em breve')
  })

  it('plano manual libera a IA gerenciada com cota e renovacao', () => {
    withBilling(true)
    const gate = managedAiGate(paidPlan(), NOW)
    expect(gate.allowed).toBe(true)
    expect(gate.label).toContain('IA Mensal')
    expect(gate.message).toContain('200 chamadas por ciclo')
    expect(gate.message).toContain('renovação em')
  })

  it('plano gratis nega com alternativa local, sem exigir assinatura paga', () => {
    withBilling(true)
    const gate = managedAiGate(paidPlan({ plan: 'gratis' }), NOW)
    expect(gate.allowed).toBe(false)
    expect(gate.message).toContain('Ollama')
    expect(gate.label).toContain('exige plano')
  })

  it('inadimplente nega com caminho de regularizacao', () => {
    withBilling(true)
    const gate = managedAiGate(paidPlan({ status: 'past_due' }), NOW)
    expect(gate.allowed).toBe(false)
    expect(gate.message).toContain('pendente')
  })

  it('expiracao simulada: passing da graca volta a negar', () => {
    withBilling(true)
    const checked = NOW
    const entitlement = paidPlan({ checkedAtUnixMs: checked })
    expect(managedAiGate(entitlement, checked).allowed).toBe(true)
    const afterGrace = managedAiGate(entitlement, checked + ENTITLEMENT_OFFLINE_GRACE_MS + 1)
    expect(afterGrace.allowed).toBe(false)
    expect(afterGrace.message).toContain('planos pagos')
  })
})
