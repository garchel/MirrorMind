import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readCloudStatus,
  syncNow,
  type CloudReport,
  type CloudStatus,
  type CloudTarget,
} from './cloudSync'

/** Implementações reais, num objeto estável.
 *
 * `deps = { readCloudStatus, syncNow }` no parâmetro seria recriado a cada render
 * e, como o efeito de abertura depende de `run` (que depende de `deps`), a tela
 * inteira ficava relendo o estado da nuvem em laço. */
const DEPS_PADRAO = { readCloudStatus, syncNow }

/** Sincronização automática do vault ligado à nuvem.
 *
 * Duas perguntas definem o desenho:
 *
 * 1. **Quando rodar?** Ao abrir o vault e depois de salvar uma nota — com espera,
 *    porque arrumar uma frase gera dez salvamentos em vinte segundos e dez ciclos
 *    seriam dez vezes o mesmo trabalho.
 * 2. **O que fazer quando falha?** Nada que o usuário perceba como erro. Estar
 *    sem rede não pode virar alerta no meio da escrita: o ciclo só volta a
 *    acontecer na próxima oportunidade.
 *
 * A trava de ciclo simultâneo está no Rust; aqui a garantia é não empilhar
 * pedidos enquanto um está em andamento. */

export type AutoSyncDeps = {
  readCloudStatus: typeof readCloudStatus
  syncNow: typeof syncNow
}

export type AutoSyncState = {
  /** Ligado à nuvem e sincronizando agora. */
  syncing: boolean
  /** Último relatório, quando houve trabalho. */
  report: CloudReport | null
  /** Mensagem só para diagnóstico silencioso (não é erro de tela). */
  lastError: string | null
  /** ISO-8601 da última sincronização concluída, vindo da nuvem. */
  lastSyncedAt: string | null
  /** Ligado: só faz sentido pedir ciclo quando isto é verdadeiro. */
  linked: boolean
}

export function useCloudAutoSync({
  vaultPath,
  config,
  enabled = true,
  deps = DEPS_PADRAO,
  debounceMs = 8_000,
}: {
  vaultPath: string | null
  config: { url: string; apiKey: string } | null
  enabled?: boolean
  deps?: AutoSyncDeps
  debounceMs?: number
}) {
  const [state, setState] = useState<AutoSyncState>({
    syncing: false,
    report: null,
    lastError: null,
    lastSyncedAt: null,
    linked: false,
  })

  const depsRef = useRef(deps)
  depsRef.current = deps

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(false)
  const linkedRef = useRef(false)
  const mountedRef = useRef(true)
  const targetRef = useRef<CloudTarget | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  targetRef.current = vaultPath && config ? { path: vaultPath, ...config } : null

  const run = useCallback(async () => {
    const target = targetRef.current
    if (!target || !linkedRef.current || runningRef.current) return
    runningRef.current = true
    setState((atual) => ({ ...atual, syncing: true }))
    try {
      const report = await depsRef.current.syncNow(target)
      if (!mountedRef.current) return
      setState((atual) => ({
        ...atual,
        syncing: false,
        report,
        lastError: null,
        lastSyncedAt: new Date().toISOString(),
      }))
    } catch (problema) {
      // Silencioso de propósito: sem rede, sem sessão renovada ou servidor fora,
      // o ciclo simplesmente não aconteceu. A tela de Nuvem mostra o motivo
      // quando o usuário pede explicitamente.
      if (!mountedRef.current) return
      setState((atual) => ({
        ...atual,
        syncing: false,
        lastError: String(problema),
      }))
    } finally {
      runningRef.current = false
    }
  }, [])

  /** Pede um ciclo — cedo ou tarde ele acontece, uma vez só. */
  const requestSync = useCallback(() => {
    if (!enabled || !linkedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void run()
    }, debounceMs)
  }, [debounceMs, enabled, run])

  /** Ciclo imediato (botão, ou abertura do vault). */
  const runNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    return run()
  }, [run])

  // Descobre se este vault está ligado — e, se estiver, sincroniza ao abrir.
  useEffect(() => {
    if (!enabled || !vaultPath || !config) {
      linkedRef.current = false
      setState((atual) => (atual.linked ? { ...atual, linked: false } : atual))
      return
    }

    let cancelado = false
    const target: CloudTarget = { path: vaultPath, ...config }
    void (async () => {
      let status: CloudStatus | null = null
      try {
        status = await depsRef.current.readCloudStatus(target)
      } catch {
        status = null
      }
      if (cancelado || !mountedRef.current) return
      // Resposta em forma inesperada (build sem servidor, IPC de teste) conta como
      // "não ligado": nada de sincronizar no escuro.
      const ligado = Boolean(status && status.linked && status.signedIn)
      linkedRef.current = ligado
      setState((atual) => ({
        ...atual,
        linked: ligado,
        lastSyncedAt: status?.lastSyncedAt ?? atual.lastSyncedAt,
      }))
      if (ligado) {
        await run()
      }
    })()

    return () => {
      cancelado = true
    }
  }, [config, enabled, run, vaultPath])

  return { ...state, requestSync, runNow }
}
