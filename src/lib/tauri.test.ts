import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { invoke } from './tauri'

const mockedInvoke = vi.mocked(tauriInvoke)

describe('invoke (wrapper do IPC do Tauri)', () => {
  it('propaga o valor de sucesso com o tipo preservado', async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true })
    await expect(invoke<{ ok: boolean }>('comando', { a: 1 })).resolves.toEqual({ ok: true })
    expect(mockedInvoke).toHaveBeenCalledWith('comando', { a: 1 })
  })

  it('normaliza a rejeicao por STRING do runtime Tauri para Error com a mensagem real', async () => {
    // No runtime Tauri v2, `Err(...)` chega ao JS como valor serializado (string).
    mockedInvoke.mockRejectedValueOnce("Nao foi possivel salvar 'bloqueada.md': Acesso negado.")
    await expect(invoke('save_note')).rejects.toThrow(
      "Nao foi possivel salvar 'bloqueada.md': Acesso negado.",
    )
  })

  it('normaliza a rejeicao por objeto com campo message', async () => {
    mockedInvoke.mockRejectedValueOnce({ message: 'Falha ao carregar o vault.' })
    await expect(invoke('load_vault')).rejects.toThrow('Falha ao carregar o vault.')
  })

  it('passa adiante um Error ja existente sem alterar a mensagem', async () => {
    const original = new Error('Erro ja estruturado.')
    mockedInvoke.mockRejectedValueOnce(original)
    await expect(invoke('comando')).rejects.toThrow('Erro ja estruturado.')
  })

  it('cai para a representacao do valor quando nada legivel existe', async () => {
    mockedInvoke.mockRejectedValueOnce(42)
    await expect(invoke('comando')).rejects.toThrow('42')
  })
})
