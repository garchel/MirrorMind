import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileFooter } from './ProfileFooter'
import { EntitlementProvider, type EntitlementStore } from '../../lib/entitlement'
import type { Entitlement } from '../../lib/billing'
import type { SessionClient } from '../../lib/session'

const storeWith = (entitlement: Entitlement | null): EntitlementStore => ({
  load: async () => entitlement,
  save: async () => {},
})

const authClient = (email: string): SessionClient => ({
  getSession: async () => ({ status: 'auth', email, expiresAtUnixMs: null }),
  signIn: async () => ({ status: 'auth', email, expiresAtUnixMs: null }),
  signUp: async () => ({ status: 'auth', email, expiresAtUnixMs: null }),
  signInWithGoogle: async () => ({ status: 'auth', email, expiresAtUnixMs: null }),
  signOut: async () => {},
  onChange: () => () => {},
})

function renderFooter(
  accountClient: SessionClient | null,
  entitlement: Entitlement | null,
  extras: {
    localProfile?: { name: string; color: string } | null
    onSwitchProfile?: () => void
    onLeaveAccount?: () => void
  } = {},
) {
  const onOpenSettings = vi.fn()
  render(
    <EntitlementProvider store={storeWith(entitlement)}>
      <ProfileFooter
        accountClient={accountClient}
        onOpenSettings={onOpenSettings}
        onOpenAccount={() => {}}
        localProfile={extras.localProfile}
        onSwitchProfile={extras.onSwitchProfile}
        onLeaveAccount={extras.onLeaveAccount}
      />
    </EntitlementProvider>,
  )
  return { onOpenSettings }
}

describe('ProfileFooter', () => {
  beforeEach(() => {
    // `resolveEntitlement` devolve Grátis com a cobranca desligada; para
    // exercitar o plano pago, ligamos o kill-switch pelo override local.
    localStorage.setItem('mirrormind.billing-enabled', 'true')
  })

  it('convidado vê "Sair" e o botão leva à tela de login', async () => {
    const onOpenAccount = vi.fn()
    const anonClient: SessionClient = {
      ...authClient('paulo@exemplo.com'),
      getSession: async () => ({ status: 'anon', email: null, expiresAtUnixMs: null }),
    }
    render(
      <EntitlementProvider store={storeWith(null)}>
        <ProfileFooter
          accountClient={anonClient}
          onOpenSettings={() => {}}
          onOpenAccount={onOpenAccount}
        />
      </EntitlementProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Abrir menu do perfil/ }))
    // Sem conta não existe "Entrar na conta": o caminho de volta é "Sair".
    expect(screen.queryByRole('button', { name: 'Entrar na conta' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(onOpenAccount).toHaveBeenCalledTimes(1))
  })

  it('"Sair" fecha o vault e volta ao login em vez de abrir a página de conta', async () => {
    const onOpenAccount = vi.fn()
    const onLeaveAccount = vi.fn()
    render(
      <EntitlementProvider store={storeWith({ plan: 'gratis' } as Entitlement)}>
        <ProfileFooter
          accountClient={authClient('paulo@exemplo.com')}
          onOpenSettings={() => {}}
          onOpenAccount={onOpenAccount}
          onLeaveAccount={onLeaveAccount}
        />
      </EntitlementProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Abrir menu do perfil/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))

    await waitFor(() => expect(onLeaveAccount).toHaveBeenCalledTimes(1))
    expect(onOpenAccount).not.toHaveBeenCalled()
  })

  it('mostra o perfil local no lugar da conta e oferece trocar de perfil', async () => {
    const onSwitchProfile = vi.fn()
    renderFooter(authClient('paulo@exemplo.com'), null, {
      localProfile: { name: 'Maria Silva', color: 'sage' },
      onSwitchProfile,
    })

    // Quem está estudando é a Maria; a conta continua sendo a mesma.
    expect(await screen.findByText('Maria Silva')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Abrir menu do perfil/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Trocar de perfil' }))
    expect(onSwitchProfile).toHaveBeenCalledTimes(1)
  })

  afterEach(() => {
    localStorage.removeItem('mirrormind.billing-enabled')
    cleanup()
  })

  it('autenticado: mostra email, iniciais e plano resolvido', async () => {
    renderFooter(authClient('paulo.victor@exemplo.com'), {
      plan: 'ia_mensal',
      status: 'active',
      periodEndUnixMs: null,
      checkedAtUnixMs: Date.now(),
    })
    await waitFor(() => expect(screen.getAllByText('paulo.victor@exemplo.com').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getByText('IA Mensal')).toBeInTheDocument())
    expect(screen.getByText('PV')).toBeInTheDocument()
  })

  it('anonimo: conta local e plano gratis', async () => {
    renderFooter(null, null)
    await waitFor(() => expect(screen.getByText('Conta local')).toBeInTheDocument())
    expect(screen.getByText('CL')).toBeInTheDocument()
    expect(screen.getByText('Grátis')).toBeInTheDocument()
  })

  it('o menu do perfil abre Configuracoes', async () => {
    const { onOpenSettings } = renderFooter(null, null)
    const trigger = await screen.findByRole('button', { name: /Abrir menu do perfil/ })
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    const item = await screen.findByRole('button', { name: 'Configurações' })
    fireEvent.click(item)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('"Fazer upgrade do plano" abre a página de planos', async () => {
    const onOpenUpgrade = vi.fn()
    render(
      <EntitlementProvider store={storeWith(null)}>
        <ProfileFooter
          accountClient={authClient('paulo@exemplo.com')}
          onOpenSettings={() => {}}
          onOpenAccount={() => {}}
          onOpenUpgrade={onOpenUpgrade}
        />
      </EntitlementProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Abrir menu do perfil/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fazer upgrade do plano' }))
    expect(onOpenUpgrade).toHaveBeenCalledTimes(1)
  })

  it('o upgrade não mora ao lado do gatilho, só dentro do menu', async () => {
    // decisão de produto: nada de botão permanente à direita do perfil
    renderFooter(authClient('paulo@exemplo.com'), null, {})
    expect(screen.queryByRole('button', { name: /fazer upgrade/i })).not.toBeInTheDocument()
  })

  it('o cabeçalho do menu leva à conta', async () => {
    const onOpenAccount = vi.fn()
    render(
      <EntitlementProvider store={storeWith(null)}>
        <ProfileFooter
          accountClient={authClient('paulo@exemplo.com')}
          onOpenSettings={() => {}}
          onOpenAccount={onOpenAccount}
        />
      </EntitlementProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Abrir menu do perfil/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Abrir conta de/i }))
    expect(onOpenAccount).toHaveBeenCalledTimes(1)
  })

  it('quem tem conta vê "Perfil" e mantém as mesmas portas', async () => {
    renderFooter(authClient('paulo@exemplo.com'), null)
    fireEvent.click(screen.getByRole('button', { name: /Abrir menu do perfil/ }))
    expect(await screen.findByRole('button', { name: 'Perfil' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configurações' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('o gatilho do perfil tem rotulo acessivel', async () => {
    renderFooter(null, null)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Abrir menu do perfil/ })).toBeInTheDocument(),
    )
  })
})
