import { describe, expect, it, vi } from 'vitest'
import { createCloudVaultsClient } from './cloudVaults'

function cliente(registro: unknown[][]) {
  const invoke = vi.fn(async (comando: string, args?: Record<string, unknown>) => {
    registro.push([comando, args])
    return []
  })
  return createCloudVaultsClient(invoke as never)
}

describe('cliente da nuvem', () => {
  it('lista os vaults da conta com os nomes de argumento que o Rust espera', async () => {
    const registro: unknown[][] = []
    await cliente(registro).list('https://projeto.supabase.co', 'chave')

    expect(registro[0][0]).toBe('cloud_account_vaults')
    expect(registro[0][1]).toEqual({ url: 'https://projeto.supabase.co', apiKey: 'chave' })
  })

  it('baixar manda a pasta pai e o nome da subpasta, não o caminho final', async () => {
    const registro: unknown[][] = []
    await cliente(registro).download({
      vaultId: 'v1',
      parentDir: 'C:/Estudos',
      folderName: 'Direito',
      url: 'u',
      apiKey: 'k',
    })

    expect(registro[0][0]).toBe('cloud_download_vault')
    // Quem monta o caminho é o Rust: assim a regra de nome seguro mora num lugar só.
    expect(registro[0][1]).toEqual({
      vaultId: 'v1',
      parentDir: 'C:/Estudos',
      folderName: 'Direito',
      url: 'u',
      apiKey: 'k',
    })
  })

  it('lista vazia quando o comando não devolve nada', async () => {
    const invoke = vi.fn(async () => undefined)
    const client = createCloudVaultsClient(invoke as never)
    await expect(client.list('u', 'k')).resolves.toEqual([])
  })
})
