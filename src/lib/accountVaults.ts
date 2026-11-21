/** Vaults que a **conta logada** usa nesta máquina.
 *
 * A conta não é dona das notas (a pasta é). O vínculo é memória: no primeiro login
 * desta conta aqui não há nada, então a abertura pergunta onde ficam as notas; a
 * resposta vira o vínculo e a próxima abertura vai direto.
 *
 * Vazio significa "sem sessão" **ou** "conta nova" — nos dois casos a abertura cai
 * na regra dos vaults conhecidos da máquina, que já funciona sem conta.
 */

export type AccountVault = {
  path: string
  name: string
  lastOpenedAtMs: number
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type AccountVaultsClient = {
  list(): Promise<AccountVault[]>
  remember(vaultRoot: string): Promise<AccountVault[]>
}

export function createAccountVaultsClient(invoke: InvokeFn): AccountVaultsClient {
  return {
    // `?? []` porque um comando sem resposta não pode quebrar a abertura.
    list: () => invoke<AccountVault[]>('account_vaults_list').then((lista) => lista ?? []),
    remember: (vaultRoot) =>
      invoke<AccountVault[]>('account_vault_remember', { vaultRoot }).then((lista) => lista ?? []),
  }
}
