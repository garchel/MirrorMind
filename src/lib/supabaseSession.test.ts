import { describe, expect, it, vi } from 'vitest'
import { createSupabaseSessionClient, supabaseConfigFromEnv } from './supabaseSession'

const config = {
  url: 'https://projeto.supabase.co',
  apiKey: 'sb_publishable_teste',
}

const snapshot = {
  status: 'auth' as const,
  email: 'pessoa@exemplo.com',
  expiresAtUnixMs: 1_800_000_000_000,
}

function fakeInvoke(result: unknown = snapshot) {
  const chamadas: Array<{ command: string; args?: Record<string, unknown> }> = []
  const call = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    chamadas.push({ command, args })
    return result as never
  })
  return { call, chamadas }
}

describe('configuração vinda do build', () => {
  it('monta o cliente quando as duas variáveis existem', () => {
    expect(supabaseConfigFromEnv({
      VITE_SUPABASE_URL: 'https://projeto.supabase.co/',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    })).toEqual({ url: 'https://projeto.supabase.co', apiKey: 'sb_publishable_x' })
  })

  it('sem chave ou com endereço inválido não existe cliente de conta', () => {
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'https://projeto.supabase.co' })).toBeNull()
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toBeNull()
    expect(supabaseConfigFromEnv({
      VITE_SUPABASE_URL: 'projeto.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    })).toBeNull()
  })
})

describe('cliente de sessão do Supabase', () => {
  it('lê a sessão pelo Rust, sem mandar token nenhum daqui', async () => {
    const { call, chamadas } = fakeInvoke()
    const client = createSupabaseSessionClient(config, call)

    await expect(client.getSession()).resolves.toEqual(snapshot)
    expect(chamadas[0].command).toBe('account_snapshot')
    expect(chamadas[0].args).toEqual({ url: config.url, apiKey: config.apiKey })
  })

  it('entra com e-mail e senha passando só as credenciais digitadas', async () => {
    const { call, chamadas } = fakeInvoke()
    const client = createSupabaseSessionClient(config, call)

    await client.signIn('pessoa@exemplo.com', 'senha-forte')

    expect(chamadas[0]).toEqual({
      command: 'account_sign_in',
      args: { url: config.url, apiKey: config.apiKey, email: 'pessoa@exemplo.com', password: 'senha-forte' },
    })
  })

  it('cadastra registrando a data dos consentimentos (LGPD)', async () => {
    const { call, chamadas } = fakeInvoke()
    const client = createSupabaseSessionClient(config, call)

    await client.signUp('pessoa@exemplo.com', 'senha-forte')

    const { command, args } = chamadas[0]
    expect(command).toBe('account_sign_up')
    expect(args?.email).toBe('pessoa@exemplo.com')
    expect(typeof args?.termsAcceptedAt).toBe('string')
    expect(args?.termsAcceptedAt).toBe(args?.privacyAcceptedAt)
    // A data precisa ser ISO: é ela que fica gravada em profiles.
    expect(new Date(String(args?.termsAcceptedAt)).toString()).not.toBe('Invalid Date')
  })

  it('sair limpa a sessão pelo Rust', async () => {
    const { call, chamadas } = fakeInvoke(undefined)
    const client = createSupabaseSessionClient(config, call)

    await client.signOut()

    expect(chamadas[0].command).toBe('account_sign_out')
  })

  it('Google falha com mensagem honesta, sem abrir fluxo pela metade', async () => {
    const { call } = fakeInvoke()
    const client = createSupabaseSessionClient(config, call)

    await expect(client.signInWithGoogle()).rejects.toThrow(/Google ainda não está disponível/i)
    expect(call).not.toHaveBeenCalled()
  })

  it('onChange devolve um cancelamento inofensivo (uma janela só)', () => {
    const { call } = fakeInvoke()
    const client = createSupabaseSessionClient(config, call)
    const stop = client.onChange(() => {})
    expect(() => stop()).not.toThrow()
  })
})
