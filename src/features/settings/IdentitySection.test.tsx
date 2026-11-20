import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdentitySection } from './IdentitySection'
import type { IdentityClient, IdentitySummary } from '../../lib/identities'

const paulo: IdentitySummary = {
  id: 'i1',
  name: 'Paulo',
  color: 'sage',
  hasPin: false,
  linked: false,
  updatedAtUnixMs: 10,
}

const ana: IdentitySummary = {
  id: 'i2',
  name: 'Ana',
  color: 'brick',
  hasPin: true,
  linked: false,
  updatedAtUnixMs: 5,
}

function fakeClient(overrides: Partial<IdentityClient> = {}): IdentityClient {
  return {
    list: vi.fn(async () => [paulo, ana]),
    adopt: vi.fn(async () => []),
    create: vi.fn(async () => paulo),
    rename: vi.fn(async (id: string, name: string) => ({ ...paulo, id, name })),
    setPin: vi.fn(async (id: string, pin: string | null) => ({ ...paulo, id, hasPin: pin !== null })),
    verifyPin: vi.fn(async () => true),
    enterVault: vi.fn(async () => ({ ...paulo, isDefault: false })),
    ...overrides,
  }
}

describe('Perfil local nas configurações', () => {
  // O app não liga o cleanup automático: sem isto o DOM de um teste vaza para o
  // seguinte e "Salvar nome" passa a existir duas vezes.
  afterEach(cleanup)

  it('lista as identidades desta máquina com o estado do PIN', async () => {
    render(<IdentitySection client={fakeClient()} />)

    expect(await screen.findByText('Paulo')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText(/PIN ativo/)).toBeInTheDocument()
    expect(screen.getByText(/Sem PIN/)).toBeInTheDocument()
  })

  it('renomear grava e atualiza a lista', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    render(<IdentitySection client={client} />)

    await user.click((await screen.findAllByRole('button', { name: 'Renomear' }))[0])
    const campo = screen.getByLabelText('Novo nome do perfil')
    await user.clear(campo)
    await user.type(campo, 'Paulo H.')
    await user.click(screen.getByRole('button', { name: 'Salvar nome' }))

    await waitFor(() => expect(client.rename).toHaveBeenCalledWith('i1', 'Paulo H.', 'sage'))
    expect(await screen.findByText('Paulo H.')).toBeInTheDocument()
  })

  it('nome vazio não é aceito', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    render(<IdentitySection client={client} />)

    await user.click((await screen.findAllByRole('button', { name: 'Renomear' }))[0])
    await user.clear(screen.getByLabelText('Novo nome do perfil'))
    await user.click(screen.getByRole('button', { name: 'Salvar nome' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('O perfil precisa de um nome.')
    expect(client.rename).not.toHaveBeenCalled()
  })

  it('definir PIN em quem não tinha pede só o número novo', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    render(<IdentitySection client={client} />)

    await user.click((await screen.findAllByRole('button', { name: 'Definir PIN' }))[0])
    await user.type(screen.getByLabelText('Novo PIN'), '1234')
    await user.click(screen.getByRole('button', { name: 'Salvar PIN' }))

    await waitFor(() => expect(client.setPin).toHaveBeenCalledWith('i1', '1234'))
    expect(client.verifyPin).not.toHaveBeenCalled()
  })

  it('trocar PIN exige o atual e recusa quando ele está errado', async () => {
    const user = userEvent.setup()
    const client = fakeClient({ verifyPin: vi.fn(async () => false) })
    render(<IdentitySection client={client} />)

    await user.click(await screen.findByRole('button', { name: 'Trocar PIN' }))
    await user.type(screen.getByLabelText('PIN atual'), '0000')
    await user.type(screen.getByLabelText('Novo PIN'), '4321')
    await user.click(screen.getByRole('button', { name: 'Salvar PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('PIN atual incorreto.')
    expect(client.setPin).not.toHaveBeenCalled()
  })

  it('PIN fora de 4 a 12 dígitos é recusado antes de gravar', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    render(<IdentitySection client={client} />)

    await user.click((await screen.findAllByRole('button', { name: 'Definir PIN' }))[0])
    await user.type(screen.getByLabelText('Novo PIN'), '12')
    await user.click(screen.getByRole('button', { name: 'Salvar PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('O PIN precisa ter de 4 a 12 dígitos.')
    expect(client.setPin).not.toHaveBeenCalled()
  })

  it('remover PIN manda null sem pedir nada', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    render(<IdentitySection client={client} />)

    await user.click(await screen.findByRole('button', { name: 'Remover PIN' }))

    await waitFor(() => expect(client.setPin).toHaveBeenCalledWith('i2', null))
  })
})
