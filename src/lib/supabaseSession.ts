import { invoke as tauriInvoke } from './tauri'
import type { SessionClient, SessionSnapshot } from './session'

/**
 * Cliente de sessão contra o Supabase Auth (F1b-2).
 *
 * O trabalho pesado é no Rust (`src-tauri/src/account.rs`): lá o par de tokens
 * nasce, é renovado e morre no cofre do sistema. Aqui só existem chamadas IPC e
 * o retrato `{ status, email, expiração }` — nenhum token passa por este módulo,
 * então um XSS no WebView não consegue roubar a sessão.
 *
 * Google usa PKCE com loopback: o Rust abre o navegador, escuta 127.0.0.1 e
 * troca o código por tokens no cofre — o renderer não vê token em nenhum passo.
 */

export type SupabaseConfig = {
  /** `https://<ref>.supabase.co` */
  url: string
  /** Chave publicável (`sb_publishable_…`). Não é segredo: identifica o projeto. */
  apiKey: string
}

export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/** Lê a configuração do build. Sem as duas variáveis não existe cliente de conta. */
export function supabaseConfigFromEnv(env?: Record<string, string | undefined>): SupabaseConfig | null {
  const source = env ?? (import.meta.env as unknown as Record<string, string | undefined>)
  const url = source.VITE_SUPABASE_URL?.trim()
  const apiKey = source.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !apiKey) return null
  if (!/^https?:\/\//.test(url)) return null
  return { url: url.replace(/\/+$/, ''), apiKey }
}

export function createSupabaseSessionClient(
  config: SupabaseConfig,
  call: InvokeFn = tauriInvoke,
): SessionClient {
  const { url, apiKey } = config

  return {
    getSession(): Promise<SessionSnapshot> {
      return call<SessionSnapshot>('account_snapshot', { url, apiKey })
    },

    signIn(email: string, password: string): Promise<SessionSnapshot> {
      return call<SessionSnapshot>('account_sign_in', { url, apiKey, email, password })
    },

    signUp(email: string, password: string): Promise<SessionSnapshot> {
      // Consentimentos com data: o servidor grava em `profiles` pelo trigger.
      const agora = new Date().toISOString()
      return call<SessionSnapshot>('account_sign_up', {
        url,
        apiKey,
        email,
        password,
        termsAcceptedAt: agora,
        privacyAcceptedAt: agora,
      })
    },

    async signInWithGoogle(): Promise<SessionSnapshot> {
      // O fluxo inteiro (navegador, porta local, troca do código) acontece no
      // Rust: aqui só esperamos o retrato da sessão.
      return call<SessionSnapshot>('account_sign_in_google', { url, apiKey })
    },

    async signOut(): Promise<void> {
      await call<void>('account_sign_out', { url, apiKey })
    },

    /** Não há sessão em outra janela: o app tem uma janela só. */
    onChange(): () => void {
      return () => {}
    },
  }
}
