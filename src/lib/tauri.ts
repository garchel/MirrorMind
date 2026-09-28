import { invoke as tauriInvoke } from '@tauri-apps/api/core'

/** Detecta o runtime Tauri (app desktop). No navegador com Vite o IPC nao
 * existe: recursos desktop (updater, versao do app) devem ficar inertes. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Mensagem legivel de qualquer valor lancado, com fallback.
 *
 * Centraliza os ~50 `X instanceof Error ? X.message : ...` espalhados pelo
 * app: preserva a causa real (string do IPC, Error, objeto com `message`) e
 * so usa o fallback quando nao ha nada legivel. Substitui os ternarios
 * manuais e os ajudantes por-feature (`reviewAiErrorMessage`,
 * `goalErrorMessage`), que viraram wrappers finos com seu fallback.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return fallback
}

/**
 * Normaliza a rejeicao do IPC do Tauri para um `Error` com mensagem legivel.
 *
 * No runtime Tauri v2, um comando que retorna `Err(...)` rejeita a Promise do
 * `invoke` com o VALOR serializado (geralmente uma string), nao com uma
 * instancia de `Error`.
 */
function normalizeRejection(value: unknown): Error {
  if (value instanceof Error && value.message.trim()) return value
  return new Error(errorMessage(value, String(value)))
}

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args).catch((error: unknown) => {
    throw normalizeRejection(error)
  })
}
