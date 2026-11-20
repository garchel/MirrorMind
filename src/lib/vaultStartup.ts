/** Decisão da primeira tela: abrir direto, ou perguntar onde ficam as notas.
 *
 * A regra existe porque a pergunta era diária e a resposta não mudava:
 *
 * | vaults conhecidos | o que acontece |
 * |---|---|
 * | 0 | tela de escolha (primeiro uso) |
 * | 1 | **abre direto** — sem modal, sem tela |
 * | 2 ou mais | tela de escolha, já com a lista |
 *
 * Função pura: entra a lista lembrada pelo app, sai a decisão. Testável sem
 * IPC, e é aqui que a regra fica visível em vez de espalhada em efeitos.
 */

export type KnownVault = {
  path: string
  name: string
  /** Quando foi aberto por último (unix ms); 0 = migrado de versão antiga. */
  lastOpenedAtMs: number
}

export type VaultStartupDecision =
  | { kind: 'open'; path: string }
  | { kind: 'choose' }

export function decideVaultStartup(knownVaults: KnownVault[]): VaultStartupDecision {
  if (knownVaults.length === 1) {
    return { kind: 'open', path: knownVaults[0].path }
  }
  return { kind: 'choose' }
}

/** Lista para a tela de escolha: mais recente primeiro, sem caminho repetido. */
export function sortKnownVaults(knownVaults: KnownVault[]): KnownVault[] {
  const vistos = new Set<string>()
  return [...knownVaults]
    .filter((vault) => {
      if (vistos.has(vault.path)) return false
      vistos.add(vault.path)
      return true
    })
    .sort((a, b) => b.lastOpenedAtMs - a.lastOpenedAtMs)
}

/** Nome amigável de um caminho, para quando a lista vier sem `name`. */
export function vaultNameFromPath(path: string): string {
  const pedacos = path.split(/[\\/]/).filter(Boolean)
  return pedacos[pedacos.length - 1] ?? path
}
