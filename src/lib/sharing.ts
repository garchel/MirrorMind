/** Aviso de pasta compartilhada: quem já usou e o que isso significa.
 *
 * A pasta é a unidade de compartilhamento: notas e anexos são de todos que abrem
 * aquela pasta; progresso, metas, dicionário e consumo são de cada perfil. O aviso
 * existe para que abrir junto seja **escolha**, não surpresa.
 */

export type SharingClient = {
  /** Nomes registrados no espelho da pasta (quem já usou). */
  names(vaultRoot: string): Promise<string[]>
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export function createSharingClient(invoke: InvokeFn): SharingClient {
  return {
    names: (vaultRoot) => invoke<string[]>('vault_sharing', { vaultRoot }).then((lista) => lista ?? []),
  }
}

/**
 * Quem usou a pasta **além de mim**.
 *
 * Sem identidade conhecida (primeiro uso, convidado), qualquer nome conta como
 * outra pessoa: a pasta foi usada por alguém, e é isso que importa avisar. A
 * comparação ignora caixa e espaços porque nome de perfil é digitado à mão.
 */
export function othersWhoUsed(names: string[], myName?: string | null): string[] {
  const eu = (myName ?? '').trim().toLowerCase()
  const vistos = new Set<string>()
  const outros: string[] = []
  for (const nome of names) {
    const limpo = nome.trim()
    if (!limpo) continue
    if (eu && limpo.toLowerCase() === eu) continue
    const chave = limpo.toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    outros.push(limpo)
  }
  return outros
}

const DISMISSED_KEY = 'mirrormind.vault.shared-dismissed'

function readDismissed(): string[] {
  try {
    const bruto = localStorage.getItem(DISMISSED_KEY)
    if (!bruto) return []
    const dados: unknown = JSON.parse(bruto)
    return Array.isArray(dados) ? dados.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function isSharingWarningDismissed(vaultPath: string): boolean {
  return readDismissed().includes(vaultPath)
}

/** Dispensa o aviso apenas para esta pasta. */
export function dismissSharingWarning(vaultPath: string): void {
  try {
    const atuais = readDismissed()
    if (atuais.includes(vaultPath)) return
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...atuais, vaultPath]))
  } catch {
    // Sem localStorage o app continua: no pior caso o aviso volta a aparecer.
  }
}
