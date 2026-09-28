import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntitlementProvider, localEntitlementStore, useEntitlement, type EntitlementStore } from './entitlement'
import type { ReactNode } from 'react'
import type { Entitlement, PlanId } from './billing'

function Probe() {
  const { resolved, billingEnabled, grantPlan, clearPlan } = useEntitlement()
  return (
    <div>
      <span data-testid="plan">{resolved.plan}</span>
      <span data-testid="status">{resolved.status}</span>
      <span data-testid="billing">{billingEnabled ? 'ligado' : 'desligado'}</span>
      <button type="button" onClick={() => grantPlan('ia_mensal')}>Conceder mensal</button>
      <button type="button" onClick={() => grantPlan('gratis')}>Conceder gratis</button>
      <button type="button" onClick={clearPlan}>Revogar</button>
    </div>
  )
}

function renderWith(store?: EntitlementStore) {
  return render(
    <EntitlementProvider store={store}>
      <Probe />
    </EntitlementProvider>,
  )
}

function memoryStore(initial: Entitlement | null = null) {
  let current = initial
  const store: EntitlementStore = {
    load: async () => current,
    save: async (next) => {
      current = next
    },
  }
  return store
}

describe('entitlement', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('sem cache e sem cobranca, opera como gratis', () => {
    renderWith()
    expect(screen.getByTestId('plan')).toHaveTextContent('gratis')
    expect(screen.getByTestId('billing')).toHaveTextContent('desligado')
  })

  it('plano manual concede e revoga os direitos sem cobrar', async () => {
    const user = userEvent.setup()
    vi.stubEnv('VITE_BILLING_ENABLED', 'true')
    const store = memoryStore()
    renderWith(store)

    await user.click(screen.getByRole('button', { name: 'Conceder mensal' }))
    expect(screen.getByTestId('plan')).toHaveTextContent('ia_mensal')
    expect(screen.getByTestId('status')).toHaveTextContent('active')

    await user.click(screen.getByRole('button', { name: 'Revogar' }))
    expect(screen.getByTestId('plan')).toHaveTextContent('gratis')
  })

  it('cache corrompido e tratado como sem plano', async () => {
    window.localStorage.setItem('mirrormind.entitlement.v1', '{"plan":"dourado"}')
    expect(await localEntitlementStore.load()).toBeNull()
  })

  it('cache valido sobrevive a reabertura (graca offline)', async () => {
    vi.stubEnv('VITE_BILLING_ENABLED', 'true')
    const store = memoryStore()
    renderWith(store)
    await act(async () => {
      await localEntitlementStore.save({ plan: 'ia_anual', status: 'active', periodEndUnixMs: null, checkedAtUnixMs: Date.now() })
    })
    expect(await localEntitlementStore.load()).toMatchObject({ plan: 'ia_anual' })
  })

  it('conceder um plano grava no store injetado', async () => {
    const user = userEvent.setup()
    vi.stubEnv('VITE_BILLING_ENABLED', 'true')
    const store = memoryStore()
    renderWith(store)
    await user.click(screen.getByRole('button', { name: 'Conceder gratis' }))
    const saved: PlanId | null = await store.load().then((value) => value?.plan ?? null)
    expect(saved).toBe('gratis')
  })
})

describe('entitlement sem provider', () => {
  it('hook fora do provider falha com mensagem explicita', () => {
    function Orphan(): ReactNode {
      useEntitlement()
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow('EntitlementProvider is missing.')
    consoleError.mockRestore()
  })
})
