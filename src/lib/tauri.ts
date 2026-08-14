import { invoke as tauriInvoke } from '@tauri-apps/api/core'

/**
 * Normaliza a rejeicao do IPC do Tauri para um `Error` com mensagem legivel.
 *
 * No runtime Tauri v2, um comando que retorna `Err(...)` rejeita a Promise do
 * `invoke` com o VALOR serializado (geralmente uma string), nao com uma
 * instancia de `Error`. Sem essa normalizacao, os `catch` da aplicacao que
 * fazem `caughtError instanceof Error ? caughtError.message : fallback`
 * descartariam a causa real (ex.: "Acesso negado" em arquivo bloqueado) e
 * mostrariam apenas a mensagem generica de fallback.
 */
function normalizeRejection(value: unknown): Error {
  if (value instanceof Error && value.message.trim()) return value
  if (typeof value === 'string' && value.trim()) return new Error(value)
  if (value && typeof value === 'object') {
    const candidate = (value as { message?: unknown }).message
    if (typeof candidate === 'string' && candidate.trim()) return new Error(candidate)
  }
  return new Error(String(value))
}

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args).catch((error: unknown) => {
    throw normalizeRejection(error)
  })
}
