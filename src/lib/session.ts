import { useCallback, useEffect, useState } from 'react'

/** Sessao da conta (fundacao F1a): porta desacoplada do provedor.
 *
 * O `SessionClient` real (Supabase Auth via PKCE + deep-link) chega na F1b;
 * ate la, o hook opera contra qualquer implementacao — inclusive fake nos
 * testes. Tokens nunca passam por aqui: vivem no OS keyring (Rust).
 */

export type SessionStatus = 'anon' | 'auth'

export type SessionSnapshot = {
  status: SessionStatus
  email: string | null
  expiresAtUnixMs: number | null
}

export const ANON_SESSION: SessionSnapshot = {
  status: 'anon',
  email: null,
  expiresAtUnixMs: null,
}

export interface SessionClient {
  getSession(): Promise<SessionSnapshot>
  signIn(email: string, password: string): Promise<SessionSnapshot>
  signUp(email: string, password: string): Promise<SessionSnapshot>
  signInWithGoogle(): Promise<SessionSnapshot>
  signOut(): Promise<void>
  /** Ouve mudancas externas (refresh, expiracao, outra janela); retorna unsubscribe. */
  onChange(listener: (snapshot: SessionSnapshot) => void): () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function useSession(client: SessionClient) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(ANON_SESSION)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    client
      .getSession()
      .then((current) => {
        if (!cancelled) setSnapshot(current)
      })
      .catch(() => {
        // Sem sessao recuperavel: permanece anonimo, sem erro visivel.
      })
    return client.onChange((next) => {
      if (!cancelled) setSnapshot(next)
    })
  }, [client])

  const run = useCallback(
    async (action: () => Promise<SessionSnapshot | void>) => {
      setError(null)
      try {
        const result = await action()
        if (result !== undefined) setSnapshot(result)
        else setSnapshot({ ...ANON_SESSION })
      } catch (cause) {
        setError(errorMessage(cause))
      }
    },
    [],
  )

  const signIn = useCallback(
    (email: string, password: string) => run(() => client.signIn(email, password)),
    [client, run],
  )
  const signUp = useCallback(
    (email: string, password: string) => run(() => client.signUp(email, password)),
    [client, run],
  )
  const signInWithGoogle = useCallback(() => run(() => client.signInWithGoogle()), [client, run])
  const signOut = useCallback(() => run(() => client.signOut()), [client, run])

  return { snapshot, error, signIn, signUp, signInWithGoogle, signOut }
}
