import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCalibration } from './useCalibration'
import { createCalibrationEngine } from './calibrationEngine'
import {
  isStrategyAvailable,
  parseCalibrationConfiguration,
  type CalibrationConfiguration,
} from './ai'

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

function configuration(
  overrides: Partial<CalibrationConfiguration> = {},
): CalibrationConfiguration {
  return {
    strategy: 'off',
    typesafeConfigured: false,
    typesafeConsent: false,
    calibrationValidated: false,
    typesafeEndpoint: ENDPOINT,
    ...overrides,
  }
}

/** Engine em memória que registra chamadas e devolve o payload configurado. */
function engine(initial: CalibrationConfiguration, overrides: {
  setStrategy?: (strategy: string) => Promise<CalibrationConfiguration>
  confirmConsent?: () => Promise<boolean>
} = {}) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  let current = initial
  const transport = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args })
    if (command === 'get_calibration_configuration') return current as T
    if (command === 'set_calibration_strategy_for_vault') {
      const strategy = args?.strategy as string
      current = overrides.setStrategy
        ? await overrides.setStrategy(strategy)
        : configuration({ ...current, strategy: strategy as CalibrationConfiguration['strategy'] })
      return current as T
    }
    if (command === 'remove_typesafe_api_key') {
      current = configuration({ ...current, strategy: 'off', typesafeConfigured: false })
      return current as T
    }
    if (command === 'set_typesafe_data_consent') {
      current = configuration({ ...current, typesafeConsent: false, strategy: 'off' })
      return current as T
    }
    if (command === 'configure_typesafe_api_key') {
      current = configuration({ ...current, typesafeConfigured: true })
      return current as T
    }
    if (command === 'confirm_typesafe_data_consent') {
      const granted = overrides.confirmConsent ? await overrides.confirmConsent() : true
      if (granted) current = configuration({ ...current, typesafeConsent: true })
      return granted as T
    }
    throw new Error(`comando inesperado: ${command}`)
  }
  return { api: createCalibrationEngine(transport), calls }
}

/** Estado executável: chave e consentimento presentes. */
const READY = { typesafeConfigured: true, typesafeConsent: true } as const

describe('useCalibration', () => {
  it('carrega a configuracao do Vault aberto', async () => {
    const { api } = engine(configuration({ typesafeConfigured: true }))
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))

    await waitFor(() => expect(result.current.configuration).not.toBeNull())
    expect(result.current.configuration?.typesafeConfigured).toBe(true)
    expect(result.current.error).toBe('')
  })

  it('nao carrega nada sem Vault', async () => {
    const { api, calls } = engine(configuration())
    const { result } = renderHook(() => useCalibration(undefined, api))

    await waitFor(() => expect(result.current.configuration).toBeNull())
    expect(calls).toHaveLength(0)
  })

  it('trocar de Vault recarrega a estrategia daquele Vault', async () => {
    // Sem isto, abrir o Vault B mostraria a estrategia do Vault A — e o
    // usuario acreditaria estar avaliando com o motor errado.
    const { api, calls } = engine(configuration({ ...READY, strategy: 'jev' }))
    const { result, rerender } = renderHook(
      ({ vaultPath }: { vaultPath: string | undefined }) => useCalibration(vaultPath, api),
      { initialProps: { vaultPath: 'C:\\A' as string | undefined } },
    )
    await waitFor(() => expect(result.current.configuration?.strategy).toBe('jev'))

    rerender({ vaultPath: 'C:\\B' })
    await waitFor(() => expect(
      calls.filter((call) => call.command === 'get_calibration_configuration').length,
    ).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(result.current.configuration?.strategy).toBe('jev'))
  })

  it('nao repete a leitura quando o Vault nao muda', async () => {
    const { api, calls } = engine(configuration(READY))
    const { result, rerender } = renderHook(() => useCalibration('C:\\Vault', api))

    await waitFor(() => expect(result.current.configuration).not.toBeNull())
    const readsBefore = calls.filter((call) => call.command === 'get_calibration_configuration').length

    await act(async () => {
      await result.current.selectStrategy('jev')
    })
    expect(result.current.configuration?.strategy).toBe('jev')

    rerender()
    expect(
      calls.filter((call) => call.command === 'get_calibration_configuration'),
    ).toHaveLength(readsBefore)
  })

  it('nao cai para off em silencio quando o backend recusa a estrategia', async () => {
    // O modo de falha caro: o usuario acredita que o motor calibrado esta
    // ligado quando a escolha foi recusada.
    const { api } = engine(configuration(), {
      setStrategy: async () => {
        throw new Error('Configure a chave da TypeSafe AI antes de ativar o motor calibrado.')
      },
    })
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    await waitFor(() => expect(result.current.configuration).not.toBeNull())

    await act(async () => {
      await result.current.selectStrategy('jev')
    })

    expect(result.current.error).toContain('chave da TypeSafe')
    expect(result.current.busy).toBe(false)
  })

  it('recarrega o estado real depois de uma recusa', async () => {
    // O backend pode ter reconciliado a estrategia ao recusar. Mostrar o
    // estado real vale mais que manter o que a tela supunha.
    let reads = 0
    const { api } = engine(configuration(), {
      setStrategy: async () => {
        throw new Error('Configure a chave da TypeSafe AI antes de ativar o motor calibrado.')
      },
    })
    const original = api.configuration
    const spy = vi.fn(async (vaultPath: string) => {
      reads += 1
      return original(vaultPath)
    })
    const { result } = renderHook(() => useCalibration('C:\\Vault', {
      ...api,
      configuration: spy,
      setStrategy: api.setStrategy,
    } as typeof api))
    await waitFor(() => expect(result.current.configuration).not.toBeNull())

    await act(async () => {
      await result.current.selectStrategy('jev')
    })
    expect(reads).toBeGreaterThanOrEqual(2)
  })

  it('revogar o consentimento devolve o estado reconciliado', async () => {
    const { api } = engine(
      configuration({ strategy: 'jev', typesafeConfigured: true, typesafeConsent: true }),
    )
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    await waitFor(() => expect(result.current.configuration?.strategy).toBe('jev'))

    await act(async () => {
      await result.current.revokeConsent()
    })

    expect(result.current.configuration?.typesafeConsent).toBe(false)
    expect(
      result.current.configuration?.strategy,
      'sem consentimento, `jev` deixa de ser um estado executavel',
    ).toBe('off')
  })

  it('remover a chave devolve o estado reconciliado', async () => {
    const { api } = engine(
      configuration({ strategy: 'dual', typesafeConfigured: true, typesafeConsent: true }),
    )
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    await waitFor(() => expect(result.current.configuration?.strategy).toBe('dual'))

    await act(async () => {
      await result.current.removeApiKey()
    })

    expect(result.current.configuration?.typesafeConfigured).toBe(false)
    expect(result.current.configuration?.strategy).toBe('off')
  })

  it('nao concede consentimento quando o usuario cancela o dialogo nativo', async () => {
    const { api, calls } = engine(configuration(), {
      confirmConsent: async () => false,
    })
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    await waitFor(() => expect(result.current.configuration).not.toBeNull())

    let granted: boolean | undefined
    await act(async () => {
      granted = await result.current.grantConsent()
    })

    expect(granted).toBe(false)
    expect(result.current.configuration?.typesafeConsent).toBe(false)
    expect(
      calls.some((call) => call.command === 'confirm_typesafe_data_consent'),
      'a confirmacao tem de passar pelo dialogo do sistema operacional',
    ).toBe(true)
  })

  it('concede consentimento pelo dialogo nativo e relê a configuracao', async () => {
    const { api, calls } = engine(configuration())
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    await waitFor(() => expect(result.current.configuration).not.toBeNull())

    await act(async () => {
      await result.current.grantConsent()
    })

    expect(result.current.configuration?.typesafeConsent).toBe(true)
    // Nenhum comando de concessao direto pelo renderer.
    expect(
      calls.some((call) => call.command === 'set_typesafe_data_consent' && call.args?.consent === true),
    ).toBe(false)
  })

  it('oferece so `off` enquanto nao ha chave nem consentimento', async () => {
    const { api } = engine(configuration())
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    await waitFor(() => expect(result.current.configuration).not.toBeNull())

    expect(result.current.available('off')).toBe(true)
    expect(result.current.available('jev')).toBe(false)
    expect(result.current.available('dual')).toBe(false)
  })

  it('oferece os tres modos quando chave e consentimento existem', async () => {
    const { api } = engine(
      configuration({ typesafeConfigured: true, typesafeConsent: true }),
    )
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    await waitFor(() => expect(result.current.configuration).not.toBeNull())

    expect(result.current.available('off')).toBe(true)
    expect(result.current.available('jev')).toBe(true)
    expect(result.current.available('dual')).toBe(true)
  })

  it('nao trata configuracao inexistente como strategies disponiveis', async () => {
    const { api } = engine(configuration())
    const { result } = renderHook(() => useCalibration('C:\\Vault', api))
    // Antes da carga, nada e executavel — inclusive `off` nao precisa de
    // credencial, mas a UI ainda nao sabe o estado do Vault.
    expect(result.current.available('jev')).toBe(false)
  })
})

describe('isStrategyAvailable', () => {
  it('`off` nunca exige credencial', () => {
    expect(isStrategyAvailable({ typesafeConfigured: false, typesafeConsent: false }, 'off')).toBe(true)
  })

  it('`jev` exige chave e consentimento', () => {
    expect(isStrategyAvailable({ typesafeConfigured: true, typesafeConsent: false }, 'jev')).toBe(false)
    expect(isStrategyAvailable({ typesafeConfigured: false, typesafeConsent: true }, 'jev')).toBe(false)
    expect(isStrategyAvailable({ typesafeConfigured: true, typesafeConsent: true }, 'jev')).toBe(true)
  })

  it('`dual` tem os mesmos requisitos de `jev`', () => {
    expect(isStrategyAvailable({ typesafeConfigured: true, typesafeConsent: true }, 'dual')).toBe(true)
    expect(isStrategyAvailable({ typesafeConfigured: true, typesafeConsent: false }, 'dual')).toBe(false)
  })
})

describe('parseCalibrationConfiguration', () => {
  it('aceita o payload completo', () => {
    const parsed = parseCalibrationConfiguration({
      strategy: 'dual',
      typesafeConfigured: true,
      typesafeConsent: true,
      calibrationValidated: false,
      typesafeEndpoint: ENDPOINT,
    })
    expect(parsed.strategy).toBe('dual')
  })

  it('rejeita uma estrategia calibrada sem chave', () => {
    // Estado impossivel: o backend nao deveria gravar isso, e se gravar a UI
    // precisa dizer em vez de oferecer um toggle morto.
    expect(() => parseCalibrationConfiguration({
      strategy: 'jev',
      typesafeConfigured: false,
      typesafeConsent: true,
      calibrationValidated: false,
      typesafeEndpoint: ENDPOINT,
    })).toThrow(/API key/)
  })

  it('rejeita uma estrategia calibrada sem consentimento', () => {
    expect(() => parseCalibrationConfiguration({
      strategy: 'jev',
      typesafeConfigured: true,
      typesafeConsent: false,
      calibrationValidated: false,
      typesafeEndpoint: ENDPOINT,
    })).toThrow(/consent/)
  })

  it('aceita `off` sem chave nem consentimento', () => {
    expect(() => parseCalibrationConfiguration({
      strategy: 'off',
      typesafeConfigured: false,
      typesafeConsent: false,
      calibrationValidated: false,
      typesafeEndpoint: ENDPOINT,
    })).not.toThrow()
  })

  it('rejeita chave desconhecida', () => {
    expect(() => parseCalibrationConfiguration({
      strategy: 'off',
      typesafeConfigured: false,
      typesafeConsent: false,
      calibrationValidated: false,
      typesafeEndpoint: ENDPOINT,
      surprise: true,
    })).toThrow()
  })

  it('rejeita uma estrategia desconhecida', () => {
    expect(() => parseCalibrationConfiguration({
      strategy: 'always',
      typesafeConfigured: true,
      typesafeConsent: true,
      calibrationValidated: false,
      typesafeEndpoint: ENDPOINT,
    })).toThrow()
  })
})