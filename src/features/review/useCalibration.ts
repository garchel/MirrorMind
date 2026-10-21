import { useCallback, useEffect, useRef, useState } from 'react'
import { ZodError } from 'zod'
import {
  calibrationEngine,
  createCalibrationEngine,
  type CalibrationEngineApi,
} from './calibrationEngine'
import {
  isStrategyAvailable,
  type CalibrationConfiguration,
  type CalibrationStrategy,
} from './ai'

/**
 * Traduz uma falha de leitura para algo acionável.
 *
 * Um `ZodError` é endereço de desenvolvedor. Se ele vazar para a tela, o
 * usuário lê um caminho de campo e não sabe o que fazer — e o estado
 * impossível (motor calibrado sem chave ou sem autorização) chegaria a ser
 * tratado como se fosse um erro qualquer.
 */
function readableFailure(failure: unknown): string {
  // O estado impossivel chega como `ZodError` com uma issue por requisito
  // faltando. As mensagens das issues ja dizem o que falta; o que falta e
  // **como** o usuario repara — por isso a frase abaixo, e nao o JSON.
  if (failure instanceof ZodError) {
    const estadoImpossivel = failure.issues.some((issue) =>
      issue.path[0] === 'typesafeConfigured' || issue.path[0] === 'typesafeConsent')
    if (estadoImpossivel) {
      return 'A configuração do motor calibrado está inconsistente: ele está ativo sem chave ou sem autorização. Revise as credenciais abaixo ou volte para "Desligado".'
    }
  }
  const raw = failure instanceof Error ? failure.message : String(failure)
  if (/without egress consent|without an API key/.test(raw)) {
    return 'A configuração do motor calibrado está inconsistente: ele está ativo sem chave ou sem autorização. Revise as credenciais abaixo ou volte para "Desligado".'
  }
  return raw
}

/**
 * Estado do motor calibrado para o Vault aberto.
 *
 * Vive num hook e não no `ReviewAiSettingsContext` de propósito: a estratégia é
 * **por Vault** (§5.3). Um estado global permitiria trocar o motor com o Vault A
 * aberto e avaliar notas do Vault B com o motor errado — misturando notas
 * avaliadas por máquinas diferentes no mesmo histórico de espaçamento, que é
 * o que o FSRS pressupõe estável.
 *
 * A engine é injetável para os testes, como em `reviewProvider.ts`.
 */
export function useCalibration(
  vaultPath: string | undefined,
  engine: CalibrationEngineApi = calibrationEngine,
) {
  const [configuration, setConfiguration] = useState<CalibrationConfiguration | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Guarda o Vault da última carga. Trocar de Vault precisa recarregar, e sem
  // isso o painel mostraria a estratégia do Vault anterior.
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!vaultPath) {
      loadedFor.current = null
      setConfiguration(null)
      return
    }
    if (loadedFor.current === vaultPath && configuration) return
    loadedFor.current = vaultPath
    let cancelled = false
    void engine
      .configuration(vaultPath)
      .then((next) => {
        if (!cancelled) {
          setConfiguration(next)
          setError('')
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setConfiguration(null)
          setError(readableFailure(failure))
        }
      })
    return () => {
      cancelled = true
    }
    // `configuration` fora das dependencias de proposito: recarregar a cada
    // mudanca dele viraria laco. `loadedFor` e o guarda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, engine])

  const selectStrategy = useCallback(
    async (strategy: CalibrationStrategy) => {
      if (!vaultPath) return
      setBusy(true)
      setError('')
      try {
        const next = await engine.setStrategy(vaultPath, strategy)
        setConfiguration(next)
      } catch (failure: unknown) {
        // Sem fallback silencioso: cair para `off` sem avisar deixaria o
        // usuário achando que o motor calibrado está ligado. O erro do backend
        // é legível de propósito.
        setError(failure instanceof Error ? failure.message : String(failure))
        // Recarrega: o backend pode ter reconciliado a estratégia (é o que
        // acontece ao remover a chave), e mostrar o estado real vale mais que
        // manter o que a tela supunha.
        try {
          setConfiguration(await engine.configuration(vaultPath))
        } catch {
          // Sem estado conhecido é melhor do que estado inventado.
        }
      } finally {
        setBusy(false)
      }
    },
    [vaultPath, engine],
  )

  const saveApiKey = useCallback(
    async (apiKey: string) => {
      if (!vaultPath) return
      setBusy(true)
      setError('')
      try {
        setConfiguration(await engine.configureApiKey(vaultPath, apiKey))
      } catch (failure: unknown) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setBusy(false)
      }
    },
    [vaultPath, engine],
  )

  const removeApiKey = useCallback(async () => {
    if (!vaultPath) return
    setBusy(true)
    setError('')
    try {
      setConfiguration(await engine.removeApiKey(vaultPath))
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [vaultPath, engine])

  const grantConsent = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const granted = await engine.confirmConsent()
      if (granted && vaultPath) {
        setConfiguration(await engine.configuration(vaultPath))
      }
      return granted
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return false
    } finally {
      setBusy(false)
    }
  }, [vaultPath, engine])

  const revokeConsent = useCallback(async () => {
    if (!vaultPath) return
    setBusy(true)
    setError('')
    try {
      setConfiguration(await engine.revokeConsent(vaultPath))
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [vaultPath, engine])

  const available = configuration
    ? (strategy: CalibrationStrategy) => isStrategyAvailable(configuration, strategy)
    : () => false

  return {
    configuration,
    error,
    busy,
    available,
    selectStrategy,
    saveApiKey,
    removeApiKey,
    grantConsent,
    revokeConsent,
  }
}

export type UseCalibration = ReturnType<typeof useCalibration>

export { createCalibrationEngine }