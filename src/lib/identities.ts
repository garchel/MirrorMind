/** Identidade da máquina: quem é a pessoa, antes de saber qual vault abrir.
 *
 * O cartão vive na pasta do app (`identities.json`) e uma cópia dele viaja dentro
 * de cada vault (`.mirmind/identities.json`). Quando os dois discordam, o
 * registro mais recente vence — a mesma regra do motor de sync.
 *
 * Aqui só há o cliente IPC; a regra de fusão mora no Rust (`identities.rs`).
 */

import type { ProfileSummary } from './profiles'

export type IdentitySummary = {
  id: string
  name: string
  /** Token de cor do app (ex.: "sage"). */
  color: string
  /** O perfil pede PIN para abrir. */
  hasPin: boolean
  /** Ligada a uma conta (não aparece na lista de convidados). */
  linked: boolean
  updatedAtUnixMs: number
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type IdentityClient = {
  /** Convidados desta máquina, mais recente primeiro. */
  list(): Promise<IdentitySummary[]>
  /** Funde o espelho de um vault com a lista da máquina. */
  adopt(vaultRoot: string): Promise<IdentitySummary[]>
  create(input: { name: string; color?: string; pin?: string | null }): Promise<IdentitySummary>
  rename(id: string, name: string, color?: string): Promise<IdentitySummary>
  setPin(id: string, pin: string | null): Promise<IdentitySummary>
  verifyPin(id: string, pin: string): Promise<boolean>
  /** Identidade da conta logada (criada na primeira entrada); `null` sem sessão. */
  ensureAccount(): Promise<IdentitySummary | null>
  /** Abre o vault como esta identidade e devolve o perfil correspondente. */
  enterVault(vaultRoot: string, id: string): Promise<ProfileSummary>
}

export function createIdentityClient(invoke: InvokeFn): IdentityClient {
  return {
    // `?? []` porque um comando que responde vazio não pode quebrar a abertura:
    // lista desconhecida é "nenhuma identidade", não erro.
    list: () => invoke<IdentitySummary[]>('identities_list').then((lista) => lista ?? []),
    adopt: (vaultRoot) =>
      invoke<IdentitySummary[]>('identities_adopt', { vaultRoot }).then((lista) => lista ?? []),
    create: ({ name, color, pin }) =>
      invoke<IdentitySummary>('identity_create', {
        name,
        color: color ?? 'sage',
        pin: pin ?? null,
      }),
    rename: (id, name, color) =>
      invoke<IdentitySummary>('identity_rename', { id, name, color: color ?? null }),
    setPin: (id, pin) => invoke<IdentitySummary>('identity_set_pin', { id, pin }),
    verifyPin: (id, pin) => invoke<boolean>('identity_verify_pin', { id, pin }),
    ensureAccount: () =>
      invoke<IdentitySummary | null>('identity_ensure_account').then((item) => item ?? null),
    enterVault: (vaultRoot, id) =>
      invoke<ProfileSummary>('identity_enter_vault', { vaultRoot, identityId: id }),
  }
}
