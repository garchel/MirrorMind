import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ANON_SESSION, useSession, type SessionClient, type SessionSnapshot } from './session'

function makeFakeClient(initial: SessionSnapshot = ANON_SESSION): SessionClient & {
  listeners: Set<(snapshot: SessionSnapshot) => void>
  emit: (snapshot: SessionSnapshot) => void
} {
  const listeners = new Set<(snapshot: SessionSnapshot) => void>()
  let current = initial
  return {
    listeners,
    emit: (snapshot: SessionSnapshot) => {
      current = snapshot
      for (const listener of listeners) listener(snapshot)
    },
    getSession: vi.fn(async () => current),
    signIn: vi.fn(async (email: string) => {
      current = { status: 'auth', email, expiresAtUnixMs: 1_800_000_000_000 }
      return current
    }),
    signUp: vi.fn(async (email: string) => {
      current = { status: 'auth', email, expiresAtUnixMs: 1_800_000_000_000 }
      return current
    }),
    signInWithGoogle: vi.fn(async () => {
      current = { status: 'auth', email: 'aluno@gmail.com', expiresAtUnixMs: 1_800_000_000_000 }
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

describe('useSession', () => {
  it('comeca anonimo e carrega a sessao existente', async () => {
    const client = makeFakeClient({ status: 'auth', email: 'a@b.c', expiresAtUnixMs: 1 })
    const { result } = renderHook(() => useSession(client))
    expect(result.current.snapshot.status).toBe('anon')
    await waitFor(() => expect(result.current.snapshot).toEqual({
      status: 'auth',
      email: 'a@b.c',
      expiresAtUnixMs: 1,
    }))
  })

  it('entra, sai e acompanha mudancas externas', async () => {
    const client = makeFakeClient()
    const { result } = renderHook(() => useSession(client))
    await waitFor(() => expect(client.getSession).toHaveBeenCalled())

    await act(async () => {
      await result.current.signIn('a@b.c', 'segredo')
    })
    expect(result.current.snapshot).toEqual({
      status: 'auth',
      email: 'a@b.c',
      expiresAtUnixMs: 1_800_000_000_000,
    })
    expect(result.current.error).toBeNull()

    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.snapshot.status).toBe('anon')

    act(() => {
      client.emit({ status: 'auth', email: 'outra@janela.c', expiresAtUnixMs: 2 })
    })
    expect(result.current.snapshot.email).toBe('outra@janela.c')
  })

  it('expoe erro sem quebrar em falha de login', async () => {
    const client = makeFakeClient()
    client.signIn = vi.fn(async () => {
      throw new Error('credenciais invalidas')
    })
    const { result } = renderHook(() => useSession(client))
    await act(async () => {
      await result.current.signIn('a@b.c', 'errada')
    })
    expect(result.current.error).toBe('credenciais invalidas')
    expect(result.current.snapshot.status).toBe('anon')
  })
})
