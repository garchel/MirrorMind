import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultSelection, type VaultSelectionProps } from './VaultSelection'
import { ANON_SESSION, type SessionClient } from '../../lib/session'
import type { AppUpdaterController } from '../../lib/useAppUpdater'

function makeClient(): SessionClient {
  return {
    getSession: vi.fn(async () => ({ ...ANON_SESSION })),
    signIn: vi.fn(async (email: string) => ({ status: 'auth' as const, email, expiresAtUnixMs: 1 })),
    signUp: vi.fn(async (email: string) => ({ status: 'auth' as const, email, expiresAtUnixMs: 1 })),
    signInWithGoogle: vi.fn(async () => ({ ...ANON_SESSION })),
    signOut: vi.fn(async () => {}),
    onChange: () => () => {},
  }
}

const updater: AppUpdaterController = {
  status: { kind: 'idle' } as AppUpdaterController['status'],
  checkNow: async () => {},
  install: async () => {},
  dismiss: () => {},
}

function renderSelection(overrides: Partial<VaultSelectionProps> = {}) {
  const props: VaultSelectionProps = {
    accountClient: makeClient(),
    loading: false,
    status: 'Pronto para abrir um vault.',
    error: null,
    chooseExistingVault: vi.fn(),
    chooseVaultParent: vi.fn(),
    createVault: vi.fn(),
    createForm: { name: '', parentPath: '' },
    setCreateForm: vi.fn(),
    showRecentVaultModal: false,
    recentVaultPreference: null,
    dismissRecentVault: vi.fn(),
    confirmRecentVault: vi.fn(),
    skipRecentVaultPrompt: false,
    setSkipRecentVaultPrompt: vi.fn(),
    appUpdater: updater,
    isBuilderModeEnabled: false,
    setBuilderModeEnabled: vi.fn(),
    ...overrides,
  }
  const view = render(<VaultSelection {...props} />)
  return { props, view }
}

describe('VaultSelection (abertura do app)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('pede conta antes de escolher o vault', async () => {
    renderSelection()
    expect(await screen.findByRole('heading', { name: 'Entrar no MirrorMind' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Onde ficam suas notas?' })).not.toBeInTheDocument()
  })

  it('"continuar sem conta" leva ao vault e não pergunta de novo', async () => {
    const user = userEvent.setup()
    renderSelection()

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))

    expect(await screen.findByRole('heading', { name: 'Onde ficam suas notas?' })).toBeInTheDocument()
    expect(localStorage.getItem('mirrormind.account.login-skipped')).toBe('true')
  })

  it('quem já dispensou a conta cai direto no vault', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'true')
    renderSelection()

    expect(await screen.findByRole('heading', { name: 'Onde ficam suas notas?' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Entrar no MirrorMind' })).not.toBeInTheDocument()
  })

  it('sem cliente de conta o app não inventa um passo de login', async () => {
    renderSelection({ accountClient: null })

    expect(await screen.findByRole('heading', { name: 'Onde ficam suas notas?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entrar na conta' })).not.toBeInTheDocument()
  })

  it('de dentro do vault dá para voltar e entrar na conta', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'true')
    const user = userEvent.setup()
    renderSelection()

    await user.click(await screen.findByRole('button', { name: 'Entrar na conta' }))

    expect(await screen.findByRole('heading', { name: 'Entrar no MirrorMind' })).toBeInTheDocument()
  })

  it('as ações do vault continuam funcionando depois do login', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'true')
    const user = userEvent.setup()
    const { props } = renderSelection()

    await user.click(await screen.findByRole('button', { name: 'Escolher pasta' }))
    expect(props.chooseExistingVault).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Criar vault' }))
    expect(props.createVault).toHaveBeenCalledTimes(1)
  })

  it('sessão já autenticada pula o passo da conta', async () => {
    const client = makeClient()
    client.getSession = vi.fn(async () => ({ status: 'auth' as const, email: 'a@b.c', expiresAtUnixMs: 1 }))
    renderSelection({ accountClient: client })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Onde ficam suas notas?' })).toBeInTheDocument(),
    )
  })
})
