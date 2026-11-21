import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSettings } from './AccountSettings'
import { EntitlementProvider } from '../../lib/entitlement'
import { ANON_SESSION, type SessionClient, type SessionSnapshot } from '../../lib/session'

function renderAccount(client: SessionClient) {
  return render(
    <EntitlementProvider>
      <AccountSettings client={client} onOpenAccount={() => {}} />
    </EntitlementProvider>,
  )
}

function makeFakeClient(): SessionClient & { emit: (snapshot: SessionSnapshot) => void } {
  const listeners = new Set<(snapshot: SessionSnapshot) => void>()
  let current: SessionSnapshot = { ...ANON_SESSION }
  return {
    emit: (snapshot: SessionSnapshot) => {
      current = snapshot
      for (const listener of listeners) listener(snapshot)
    },
    getSession: vi.fn(async () => current),
    signIn: vi.fn(async (email: string) => {
      current = { status: 'auth', email, expiresAtUnixMs: 1 }
      return current
    }),
    signUp: vi.fn(async (email: string) => {
      current = { status: 'auth', email, expiresAtUnixMs: 1 }
      return current
    }),
    signInWithGoogle: vi.fn(async () => {
      current = { status: 'auth', email: 'aluno@gmail.com', expiresAtUnixMs: 1 }
      return current
    }),
    signOut: vi.fn(async () => {
      current = { ...ANON_SESSION }
    }),
    onChange: vi.fn((listener: (snapshot: SessionSnapshot) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
  }
}

describe('AccountSettings', () => {
  afterEach(cleanup)

  it('sem sessao, oferece abrir a pagina de conta em vez de um formulario', async () => {
    const client = makeFakeClient()
    const user = userEvent.setup()
    const onOpenAccount = vi.fn()
    render(
      <EntitlementProvider>
        <AccountSettings client={client} onOpenAccount={onOpenAccount} />
      </EntitlementProvider>,
    )

    // O formulario saiu daqui: senha e e-mail vivem na pagina de conta.
    expect(screen.queryByLabelText('E-mail da conta')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Entrar ou criar conta' }))
    expect(onOpenAccount).toHaveBeenCalledTimes(1)
  })

  it('com sessao, mostra o e-mail e deixa sair', async () => {
    const client = makeFakeClient()
    client.emit({ status: 'auth', email: 'a@b.c', expiresAtUnixMs: 1 })
    const user = userEvent.setup()
    renderAccount(client)

    await waitFor(() => expect(screen.getByText(/a@b\.c/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(client.signOut).toHaveBeenCalled())
  })

  it('a secao aponta para a pagina de conta quando ja esta logado', async () => {
    const client = makeFakeClient()
    client.emit({ status: 'auth', email: 'a@b.c', expiresAtUnixMs: 1 })
    const user = userEvent.setup()
    const onOpenAccount = vi.fn()
    render(
      <EntitlementProvider>
        <AccountSettings client={client} onOpenAccount={onOpenAccount} />
      </EntitlementProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir conta' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Abrir conta' }))
    expect(onOpenAccount).toHaveBeenCalledTimes(1)
  })

  it('esconde o painel de plano enquanto a cobranca esta desligada', () => {
    vi.stubEnv('VITE_BILLING_ENABLED', 'false')
    try {
      renderAccount(makeFakeClient())
      expect(screen.queryByLabelText('Plano de teste')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('plano manual concede e revoga direitos sem cobrar', async () => {
    vi.stubEnv('VITE_BILLING_ENABLED', 'true')
    const user = userEvent.setup()
    try {
      renderAccount(makeFakeClient())
      const plan = await screen.findByLabelText('Plano de teste')
      await user.selectOptions(plan, 'essencial')
      await waitFor(() => expect(screen.getByText(/ajuste manual da F2/)).toHaveTextContent('Essencial'))

      await user.selectOptions(plan, 'gratis')
      await waitFor(() => expect(screen.getByText(/ajuste manual da F2/)).toHaveTextContent('Grátis'))
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
