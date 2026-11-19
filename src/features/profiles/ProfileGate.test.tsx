import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileGate } from './ProfileGate'
import type { ProfileClient, ProfileSummary } from '../../lib/profiles'

function perfil(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: 'padrao',
    name: 'Eu',
    color: 'sage',
    isDefault: true,
    hasPin: false,
    ...overrides,
  }
}

function makeClient(overrides: Partial<ProfileClient> = {}): ProfileClient {
  return {
    list: vi.fn(async () => [perfil()]),
    create: vi.fn(async (_root, input) => perfil({ id: 'novo', name: input.name, isDefault: false })),
    rename: vi.fn(async (_root, _id, input) => perfil({ name: input.name })),
    remove: vi.fn(async () => {}),
    setPin: vi.fn(async () => {}),
    verifyPin: vi.fn(async () => true),
    select: vi.fn(async () => {}),
    ...overrides,
  }
}

const VAULT = 'C:/notas/vault'

describe('ProfileGate', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('lista os perfis e entra no escolhido sem PIN', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    const onReady = vi.fn()
    render(
      <ProfileGate
        vaultRoot={VAULT}
        client={client}
        initialProfiles={[perfil(), perfil({ id: 'maria', name: 'Maria', isDefault: false })]}
        onReady={onReady}
      />,
    )

    expect(screen.getByRole('heading', { name: /Quem está usando/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Maria/ }))

    await waitFor(() => expect(client.select).toHaveBeenCalledWith('maria'))
    expect(onReady).toHaveBeenCalledTimes(1)
    // A escolha fica lembrada na máquina para a próxima abertura deste vault.
    expect(JSON.parse(localStorage.getItem('mirrormind.profile.last') ?? '{}')).toEqual({
      [VAULT]: 'maria',
    })
  })

  it('pede o PIN quando o perfil é protegido e recusa o errado', async () => {
    const user = userEvent.setup()
    const client = makeClient({ verifyPin: vi.fn(async (_r, _i, pin) => pin === '2468') })
    const onReady = vi.fn()
    render(
      <ProfileGate
        vaultRoot={VAULT}
        client={client}
        initialProfiles={[perfil({ id: 'joao', name: 'João', isDefault: true, hasPin: true })]}
        onReady={onReady}
      />,
    )

    await user.click(screen.getByRole('button', { name: /João/ }))
    expect(await screen.findByRole('heading', { name: /PIN de João/i })).toBeInTheDocument()

    await user.type(screen.getByLabelText('PIN'), '1357')
    await user.click(screen.getByRole('button', { name: 'Abrir perfil' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN incorreto')
    expect(onReady).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('PIN'))
    await user.type(screen.getByLabelText('PIN'), '2468')
    await user.click(screen.getByRole('button', { name: 'Abrir perfil' }))

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(client.select).toHaveBeenCalledWith('joao')
  })

  it('cria um perfil novo offline e já entra nele', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    const onReady = vi.fn()
    render(
      <ProfileGate
        vaultRoot={VAULT}
        client={client}
        initialProfiles={[perfil()]}
        onReady={onReady}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Novo perfil/ }))
    await user.type(screen.getByLabelText('Nome do novo perfil'), 'Maria')
    await user.click(screen.getByRole('button', { name: 'Criar e entrar' }))

    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(VAULT, {
        name: 'Maria',
        color: 'sage',
        pin: null,
      }),
    )
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
  })

  it('cria com PIN quando o campo é preenchido', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(
      <ProfileGate vaultRoot={VAULT} client={client} initialProfiles={[perfil()]} onReady={() => {}} />,
    )

    await user.click(screen.getByRole('button', { name: /Novo perfil/ }))
    await user.type(screen.getByLabelText('Nome do novo perfil'), 'Ana')
    await user.type(screen.getByLabelText('PIN (opcional)'), '4321')
    await user.click(screen.getByRole('button', { name: 'Criar e entrar' }))

    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(VAULT, { name: 'Ana', color: 'sage', pin: '4321' }),
    )
  })

  it('sem perfis ainda, abre direto no formulário de criação', async () => {
    render(<ProfileGate vaultRoot={VAULT} client={makeClient()} initialProfiles={[]} onReady={() => {}} />)

    expect(await screen.findByLabelText('Nome do novo perfil')).toBeInTheDocument()
    // Sem perfis não há "cancelar": o primeiro perfil é obrigatório.
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar e entrar' })).toBeDisabled()
  })

  it('erro do servidor aparece na tela em vez de sumir', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      create: vi.fn(async () => {
        throw 'Já existe um perfil com esse nome.'
      }),
    })
    render(
      <ProfileGate vaultRoot={VAULT} client={client} initialProfiles={[perfil()]} onReady={() => {}} />,
    )

    await user.click(screen.getByRole('button', { name: /Novo perfil/ }))
    await user.type(screen.getByLabelText('Nome do novo perfil'), 'Eu')
    await user.click(screen.getByRole('button', { name: 'Criar e entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um perfil')
  })
})
