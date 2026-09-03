import { useCallback, useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  UPDATE_IDLE,
  type UpdateCheckStatus,
} from './updater'

export type AppUpdaterController = {
  status: UpdateCheckStatus
  /** Verifica atualizacoes agora (botao manual nas configuracoes). */
  checkNow: () => Promise<void>
  /** Baixa e instala a atualizacao disponivel (banner). */
  install: () => Promise<void>
  /** Descarta o banner da versao disponivel nesta sessao. */
  dismiss: () => void
}

import { readPref, writePref, parseBoolean, serializeBoolean } from './prefs'

/** Rastreia a disponibilidade de atualizacoes do app.
 *
 * No mount faz uma verificacao automatica silenciosa (so a versao disponivel
 * vira banner; 'upToDate'/'failed' nao mudam nada) e expoe `checkNow` para a
 * verificacao manual, que reporta todos os estados. A referencia nativa do
 * plugin (`Update`) fica num ref — nunca no estado React — e so o payload de
 * exibicao entra em `status`. */
const AUTO_UPDATE_KEY = 'mirrormind.auto-update'

export function isAutoUpdateEnabled(): boolean {
  // 'undefined' (nunca configurado) e qualquer valor corrompido contam como
  // habilitado — mesmo contrato da leitura anterior ao prefs.ts.
  return readPref(AUTO_UPDATE_KEY, true, parseBoolean)
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  writePref(AUTO_UPDATE_KEY, enabled, serializeBoolean)
}

export function useAppUpdater(): AppUpdaterController {
  const [status, setStatus] = useState<UpdateCheckStatus>(UPDATE_IDLE)
  const updateRef = useRef<Update | null>(null)
  const installInFlight = useRef(false)

  const checkNow = useCallback(async () => {
    if (updateRef.current) updateRef.current = null
    setStatus({ kind: 'checking' })
    const { status: next, update } = await checkForAppUpdate()
    updateRef.current = update
    setStatus(next)
  }, [])

  const install = useCallback(async () => {
    const update = updateRef.current
    if (!update || installInFlight.current) return
    installInFlight.current = true
    setStatus({ kind: 'downloading', progress: 0 })
    const result = await downloadAndInstallAppUpdate(update, (progress) => {
      setStatus({ kind: 'downloading', progress })
    })
    // No Windows 'installing' e terminal (o app encerra). Chegar aqui com
    // 'installing' so acontece fora do Windows; 'failed' reexibe o banner.
    if (result.kind === 'failed') setStatus(result)
    installInFlight.current = false
  }, [])

  const dismiss = useCallback(() => {
    updateRef.current = null
    setStatus(UPDATE_IDLE)
  }, [])

  useEffect(() => {
    if (!isAutoUpdateEnabled()) return
    let cancelled = false
    void (async () => {
      const { status: next, update } = await checkForAppUpdate()
      if (cancelled) return
      if (next.kind === 'available') {
        updateRef.current = update
        setStatus(next)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { status, checkNow, install, dismiss }
}
