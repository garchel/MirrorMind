import { invoke } from '../../lib/tauri'
import {
  dictionaryLimitsSchema,
  dictionarySnapshotSchema,
  type DictionaryEntry,
  type DictionaryLimits,
  type DictionarySnapshot,
} from './dictionarySchema'

/**
 * Transporte do dicionário.
 *
 * Injetável como o de `calibrationEngine.ts`, pelo mesmo motivo: os testes
 * batem nesta interface em vez de fazer mock de `invoke` função por função.
 */
export type DictionaryTransport = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>

const tauriTransport: DictionaryTransport = <T>(
  command: string,
  args?: Record<string, unknown>,
) => invoke<T>(command, args)

export function createDictionaryEngine(transport: DictionaryTransport = tauriTransport) {
  return {
    /** Lê o dicionário do Vault aberto. */
    async entries(vaultPath: string): Promise<DictionarySnapshot> {
      const payload = await transport('list_dictionary_entries', { vaultRoot: vaultPath })
      return dictionarySnapshotSchema.parse(payload)
    },

    /**
     * Registra ou atualiza um verbete.
     *
     * O backend decide a ordenação e decide o que acontece quando o termo já
     * existe (atualiza, não duplica). Por isso os dois comandos de escrita
     * devolvem o dicionário inteiro: a interface não precisa adivinhar o
     * estado depois da gravação.
     */
    async save(
      vaultPath: string,
      term: string,
      concept: string,
    ): Promise<DictionarySnapshot> {
      const payload = await transport('save_dictionary_entry', {
        vaultRoot: vaultPath,
        term,
        concept,
      })
      return dictionarySnapshotSchema.parse(payload)
    },

    /** Apaga um verbete pelo termo. */
    async remove(vaultPath: string, term: string): Promise<DictionarySnapshot> {
      const payload = await transport('remove_dictionary_entry', {
        vaultRoot: vaultPath,
        term,
      })
      return dictionarySnapshotSchema.parse(payload)
    },

    /** Os limites que o backend aplica. */
    async limits(): Promise<DictionaryLimits> {
      const payload = await transport('dictionary_limits')
      return dictionaryLimitsSchema.parse(payload)
    },
  }
}

export type DictionaryEngine = ReturnType<typeof createDictionaryEngine>

/**
 * Traduz uma falha de leitura para algo acionável.
 *
 * O mesmo cuidado de `useCalibration`: um erro cru na tela vira um caminho de
 * campo que o usuário não sabe usar.
 */
export function readableDictionaryFailure(failure: unknown): string {
  const raw = failure instanceof Error ? failure.message : String(failure)
  if (/not authorized|fora do vault|nao autorizado/i.test(raw)) {
    return 'Este Vault não está autorizado. Reabra-o para usar o dicionário.'
  }
  return raw
}

export type { DictionaryEntry }
