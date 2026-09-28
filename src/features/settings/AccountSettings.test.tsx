import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSettings } from './AccountSettings'
import { ANON_SESSION, type SessionClient, type SessionSnapshot } from '../../lib/session'

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

  it('entra com e-mail e mostra o painel logado', async () => {
    const client = makeFakeClient()
    const user = userEvent.setup()
    render(<AccountSettings client={client} />)
    await user.type(screen.getByLabelText('E-mail da conta'), 'a@b.c')
    await user.type(screen.getByLabelText('Senha da conta'), 'segredo')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(screen.getByText(/a@b\.c/)).toBeInTheDocument())
  })

  it('mostra erro sem quebrar e sai da conta', async () => {
    const client = makeFakeClient()
    client.signIn = vi.fn(async () => {
      throw new Error('credenciais invalidas')
    })
    const user = userEvent.setup()
    render(<AccountSettings client={client} />)
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('credenciais invalidas'))

    client.signIn = makeFakeClient().signIn
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(screen.getByLabelText('E-mail da conta')).toBeInTheDocument())
  })

  it('excluir conta confirma antes de sair', async () => {
    const client = makeFakeClient()
    client.emit({ status: 'auth', email: 'a@b.c', expiresAtUnixMs: 1 })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    try {
      render(<AccountSettings client={client} />)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Excluir conta' }))
      expect(confirmSpy).toHaveBeenCalled()
      expect(client.signOut).not.toHaveBeenCalled()
      confirmSpy.mockReturnValue(true)
      await user.click(screen.getByRole('button', { name: 'Excluir conta' }))
      await waitFor(() => expect(client.signOut).toHaveBeenCalled())
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
