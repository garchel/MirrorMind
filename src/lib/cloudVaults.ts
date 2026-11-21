/** Vaults que a **conta** tem na nuvem, para baixar numa máquina nova.
 *
 * Numa máquina nova o vínculo conta→pasta não existe (ele é local), então a
 * abertura só teria "escolher uma pasta vazia" a oferecer. Esta lista é o que
 * faz a pergunta "onde ficam suas notas?" ter uma resposta.
 */

export type AccountVaultCloud = {
  id: string
  name: string
  files: number
  lastSyncedAt: string | null
}

/** O que veio no download; o App usa para dizer o que aconteceu. */
export type DownloadSummary = {
  path: string
  name: string
  downloaded: number
  identical: number
  conflicts: number
  bytes: number
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type CloudVaultsClient = {
  list(url: string, apiKey: string): Promise<AccountVaultCloud[]>
  download(input: {
    vaultId: string
    /** Pasta escolhida pela pessoa; o vault entra numa subpasta com o nome dele. */
    parentDir: string
    folderName: string
    url: string
    apiKey: string
  }): Promise<DownloadSummary>
}

export function createCloudVaultsClient(invoke: InvokeFn): CloudVaultsClient {
  return {
    list: (url, apiKey) =>
      invoke<AccountVaultCloud[]>('cloud_account_vaults', { url, apiKey }).then((lista) => lista ?? []),
    download: ({ vaultId, parentDir, folderName, url, apiKey }) =>
      invoke<DownloadSummary>('cloud_download_vault', {
        vaultId,
        parentDir,
        folderName,
        url,
        apiKey,
      }),
  }
}
