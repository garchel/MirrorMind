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
    knownVaults: [],
    onOpenKnownVault: vi.fn(),
    guestIdentities: null,
    guestIdentityBusy: false,
    guestIdentityError: null,
    onIdentitySelect: vi.fn(async () => true),
    onIdentityCreate: vi.fn(async () => true),
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


  const doisVaults = [
    { path: 'C:/notas/vault', name: 'vault', lastOpenedAtMs: 5 },
    { path: 'C:/notas/estudo', name: 'estudo', lastOpenedAtMs: 4 },
  ]

  it('a lista de vaults conhecidos só aparece depois da escolha de conta', async () => {
    const user = userEvent.setup()
    renderSelection({ knownVaults: doisVaults })

    // Ainda decidindo conta: nada de lista por cima da pergunta.
    expect(await screen.findByRole('heading', { name: 'Entrar no MirrorMind' })).toBeInTheDocument()
    expect(screen.queryByText('Vaults neste computador')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continuar sem conta' }))

    expect(await screen.findByText('Vaults neste computador')).toBeInTheDocument()
  })

  it('quem já dispensou a conta vê a lista como todo mundo', async () => {
    // Regressão relatada: a mesma pessoa, uma sessão depois, não recebia nada —
    // a flag local `escolheuConta` só existia quando ela escolhia naquela
    // sessão. Estar no passo do vault JÁ é a resposta da pergunta de conta.
    localStorage.setItem('mirrormind.account.login-skipped', 'true')
    renderSelection({ knownVaults: doisVaults })

    expect(await screen.findByRole('heading', { name: 'Onde ficam suas notas?' })).toBeInTheDocument()
    expect(await screen.findByText('Vaults neste computador')).toBeInTheDocument()
  })

  it('clicar num vault da lista pede para abrir aquele caminho', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'true')
    const user = userEvent.setup()
    const { props } = renderSelection({ knownVaults: doisVaults })

    await user.click(await screen.findByRole('button', { name: /estudo/ }))
    expect(props.onOpenKnownVault).toHaveBeenCalledWith('C:/notas/estudo')
  })

  it('convidado que acabou de escolher entra e vê a lista', async () => {
    const user = userEvent.setup()
    renderSelection({ knownVaults: doisVaults })

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))
    expect(await screen.findByText('Vaults neste computador')).toBeInTheDocument()
  })


  it('convidado sem perfil criado é convidado a criar um, com nome e PIN opcional', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'false')
    const user = userEvent.setup()
    const { props } = renderSelection({ guestIdentities: [] })

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))

    // Em vez de "Onde ficam suas notas?", o convite ao perfil — com os dois campos.
    expect(await screen.findByRole('heading', { name: 'Crie seu perfil' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ex.: Paulo')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('4 a 12 dígitos')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Ex.: Paulo'), 'Paulo')
    await user.type(screen.getByPlaceholderText('4 a 12 dígitos'), '1234')
    await user.click(screen.getByRole('button', { name: 'Criar perfil' }))

    await waitFor(() =>
      expect(props.onIdentityCreate).toHaveBeenCalledWith('Paulo', '1234'),
    )
  })

  it('sem PIN o perfil é criado sem senha nenhuma', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'false')
    const user = userEvent.setup()
    const { props } = renderSelection({ guestIdentities: [] })

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))
    await user.type(await screen.findByPlaceholderText('Ex.: Paulo'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Criar perfil' }))

    await waitFor(() => expect(props.onIdentityCreate).toHaveBeenCalledWith('Ana', null))
  })

  it('nome vazio não cria perfil', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'false')
    const user = userEvent.setup()
    const { props } = renderSelection({ guestIdentities: [] })

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))
    await user.click(await screen.findByRole('button', { name: 'Criar perfil' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Dê um nome ao perfil.')
    expect(props.onIdentityCreate).not.toHaveBeenCalled()
  })

  it('com identidades já criadas, mostra a lista e deixa abrir a sua', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'false')
    const user = userEvent.setup()
    const paulo = { id: 'p1', name: 'Paulo', color: 'sage', hasPin: false, linked: false, updatedAtUnixMs: 1 }
    const ana = { id: 'p2', name: 'Ana', color: 'brick', hasPin: false, linked: false, updatedAtUnixMs: 1 }
    const { props } = renderSelection({ guestIdentities: [paulo, ana] })

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))
    expect(await screen.findByRole('heading', { name: 'Quem está estudando?' })).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Entrar' })[1])
    await waitFor(() => expect(props.onIdentitySelect).toHaveBeenCalledWith(ana, undefined))
  })

  it('perfil com PIN só entra depois do número', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'false')
    const user = userEvent.setup()
    const comPin = { id: 'p1', name: 'Paulo', color: 'sage', hasPin: true, linked: false, updatedAtUnixMs: 1 }
    const { props } = renderSelection({ guestIdentities: [comPin] })

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))
    await user.click(await screen.findByRole('button', { name: 'Pedir PIN' }))

    // Escolher o perfil não basta: o PIN é conferido antes de abrir.
    expect(props.onIdentitySelect).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('PIN do perfil Paulo'), '1234')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => expect(props.onIdentitySelect).toHaveBeenCalledWith(comPin, '1234'))
  })

  it('sem vault conhecido o convidado segue para a escolha do vault', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'false')
    const user = userEvent.setup()
    renderSelection({ guestIdentities: null })

    await user.click(await screen.findByRole('button', { name: 'Continuar sem conta' }))

    // Perfis moram no vault: sem saber qual é, não há o que listar aqui.
    expect(await screen.findByRole('heading', { name: 'Onde ficam suas notas?' })).toBeInTheDocument()
  })

  it('avisa o App uma vez quando a pergunta de conta termina', async () => {
    localStorage.setItem('mirrormind.account.login-skipped', 'true')
    const onAccountSettled = vi.fn()
    renderSelection({ onAccountSettled })

    await screen.findByRole('heading', { name: 'Onde ficam suas notas?' })
    await waitFor(() => expect(onAccountSettled).toHaveBeenCalledTimes(1))

    // e não avisa de novo a cada render
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onAccountSettled).toHaveBeenCalledTimes(1)
  })

  it('no passo de conta não avisa que a conta foi resolvida', async () => {
    const onAccountSettled = vi.fn()
    renderSelection({ onAccountSettled })

    await screen.findByRole('heading', { name: 'Entrar no MirrorMind' })
    expect(onAccountSettled).not.toHaveBeenCalled()
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
