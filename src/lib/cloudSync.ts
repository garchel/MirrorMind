import { invoke } from '@tauri-apps/api/core'

/** Ponte com o motor de sincronização (`src-tauri/src/cloud_commands.rs`).
 *
 * Nenhum token passa por aqui: o Rust pega o par do cofre do sistema, usa e
 * descarta. O que o frontend recebe são contagens e o relatório do ciclo. */

export type RemoteVault = {
  id: string
  name: string
  files: number
}

export type CloudStatus = {
  signedIn: boolean
  linked: boolean
  vaultName: string
  localFiles: number
  remoteFiles: number | null
  accountVaults: RemoteVault[]
  /** Há dados dos dois lados: a tela precisa perguntar antes de ligar. */
  needsChoice: boolean
  /** ISO-8601 da última sincronização concluída (`null` = nunca). */
  lastSyncedAt: string | null
}

export type CloudFail = { path: string; reason: string }

export type CloudReport = {
  uploaded: string[]
  downloaded: string[]
  conflicts: string[]
  deleted: string[]
  skipped: string[]
  failed: CloudFail[]
  bytesUp: number
  bytesDown: number
}

/** `merge` = mesmo vault dos dois lados (conflito gera cópia);
 *  `separate` = "manter os dois" (vault novo na nuvem, nada é mesclado). */
export type LinkStrategy = 'merge' | 'separate'

export type CloudTarget = {
  /** Raiz do vault aberto. */
  path: string
  url: string
  apiKey: string
}

function target({ path, url, apiKey }: CloudTarget) {
  return { path, url, apiKey }
}

export function readCloudStatus(t: CloudTarget): Promise<CloudStatus> {
  return invoke<CloudStatus>('cloud_status', target(t))
}

export function linkVault(t: CloudTarget, strategy: LinkStrategy): Promise<CloudStatus> {
  return invoke<CloudStatus>('cloud_link_vault', { ...target(t), strategy })
}

export function unlinkVault(path: string): Promise<CloudStatus> {
  return invoke<CloudStatus>('cloud_unlink_vault', { path })
}

export function syncNow(t: CloudTarget): Promise<CloudReport> {
  return invoke<CloudReport>('cloud_sync_now', target(t))
}

/** Quantos itens o relatório mexeu — é o número que interessa mostrar. */
export function reportCount(report: CloudReport): number {
  return (
    report.uploaded.length +
    report.downloaded.length +
    report.conflicts.length +
    report.deleted.length +
    report.skipped.length
  )
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** Frase única para o resultado do ciclo. Vazio é um resultado legítimo: tudo
 *  já estava sincronizado, e dizer isso é melhor do que esconder o botão atrás
 *  de silêncio. */
export function summarizeReport(report: CloudReport): string {
  const partes: string[] = []
  if (report.uploaded.length) partes.push(`${report.uploaded.length} enviado(s)`)
  if (report.downloaded.length) partes.push(`${report.downloaded.length} recebido(s)`)
  if (report.conflicts.length) partes.push(`${report.conflicts.length} conflito(s)`)
  if (report.deleted.length) partes.push(`${report.deleted.length} removido(s)`)
  if (report.skipped.length) partes.push(`${report.skipped.length} grande(s) demais`)
  if (report.failed.length) partes.push(`${report.failed.length} com erro`)

  if (!partes.length) return 'Tudo já estava sincronizado.'
  return `Tudo em dia: ${partes.join(', ')}.`
}

/** "19/11 às 17:30" a partir do ISO da nuvem. `null` = nunca sincronizou. */
export function formatLastSync(iso: string | null): string {
  if (!iso) return 'nunca'
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return 'nunca'
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
