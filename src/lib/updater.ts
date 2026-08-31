import { check, type Update } from '@tauri-apps/plugin-updater'
import { isTauriRuntime } from './tauri'

/** Estado de uma verificacao de atualizacoes devolvida à UI. */
export type UpdateCheckStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: AvailableUpdate }
  | { kind: 'upToDate' }
  | { kind: 'failed'; message: string }
  | { kind: 'downloading'; progress: number }
  | { kind: 'installing' }

/** Dados da atualizacao que a UI exibe (versao atual → nova + notas). */
export type AvailableUpdate = {
  version: string
  currentVersion: string
  notes: string
}

export type UpdateProgressEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export const UPDATE_IDLE: UpdateCheckStatus = { kind: 'idle' }

/** Resultado de uma verificacao: `status` alimenta a UI; `update` e a
 * referencia nativa do plugin (fora do estado React) usada apenas para
 * baixar/instalar quando o usuario aceita. */
export type UpdateCheckResult = {
  status: UpdateCheckStatus
  update: Update | null
}

/** Verifica atualizacoes. Fora do runtime Tauri (navegador durante o
 * desenvolvimento com Vite) devolve 'idle' em vez de falhar: o IPC do updater
 * nao existe fora do app desktop. */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriRuntime()) return { status: UPDATE_IDLE, update: null }
  try {
    const update = await check()
    return update
      ? { status: { kind: 'available', update: toAvailableUpdate(update) }, update }
      : { status: { kind: 'upToDate' }, update: null }
  } catch (error) {
    return { status: { kind: 'failed', message: toUpdateErrorMessage(error) }, update: null }
  }
}

/** Baixa e instala a atualizacao. No Windows o instalador NSIS/MSI e lancado e
 * o app encerra; em caso de falha devolve 'failed' para a UI reexibir o
 * banner com o erro. */
export async function downloadAndInstallAppUpdate(
  update: Update,
  onProgress?: (progress: number) => void,
): Promise<UpdateCheckStatus> {
  let expectedTotal = 0
  let received = 0
  try {
    await update.downloadAndInstall((event: UpdateProgressEvent) => {
      if (event.event === 'Started' && event.data.contentLength) {
        expectedTotal = event.data.contentLength
      } else if (event.event === 'Progress') {
        received += event.data.chunkLength
        if (expectedTotal > 0 && onProgress) {
          onProgress(Math.min(99, Math.round((received / expectedTotal) * 100)))
        }
      }
    })
    return { kind: 'installing' }
  } catch (error) {
    return { kind: 'failed', message: toUpdateErrorMessage(error) }
  }
}

/** Converte o Update do plugin no payload de exibicao (desacopla a UI do tipo
 * nativo). */
export function toAvailableUpdate(update: Update): AvailableUpdate {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: typeof update.body === 'string' ? update.body : '',
  }
}

/** Mensagem amigavel: falhas de rede (endpoint fora do ar, sem internet) nao
 * devem soar como bug do app. */
export function toUpdateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/(os error|failed to lookup|timed out|timed? ?out|network|dns|connection refused|unreachable)/i.test(message)) {
    return 'Não foi possível verificar atualizações agora (sem conexão ou endpoint indisponível). Tente mais tarde.'
  }
  return `Falha ao verificar atualizações: ${message}`
}
