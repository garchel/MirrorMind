import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloudAutoSync } from './useCloudAutoSync'
import type { CloudReport, CloudStatus } from './cloudSync'

const CONFIG = { url: 'https://projeto.supabase.co', apiKey: 'chave' }

function status(over: Partial<CloudStatus> = {}): CloudStatus {
  return {
    signedIn: true,
    linked: true,
    vaultName: 'Estudo',
    localFiles: 3,
    remoteFiles: 3,
    accountVaults: [],
    needsChoice: false,
    lastSyncedAt: null,
    cloudPlan: 'nenhum',
    planStatus: 'active',
    planPeriodEnd: null,
    ...over,
  }
}

function relatorio(over: Partial<CloudReport> = {}): CloudReport {
  return {
    uploaded: [],
    downloaded: [],
    conflicts: [],
    deleted: [],
    skipped: [],
    failed: [],
    bytesUp: 0,
    bytesDown: 0,
    ...over,
  }
}

/** Deixa o efeito e as promessas pendentes rodarem com timers falsos.
 * `waitFor` não serve aqui: ele espera em tempo real e nunca avança o relógio. */
async function avancar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function deps(over: Partial<{ readCloudStatus: unknown; syncNow: unknown }> = {}) {
  return {
    readCloudStatus: vi.fn(async () => status()),
    syncNow: vi.fn(async () => relatorio()),
    ...over,
  } as unknown as Parameters<typeof useCloudAutoSync>[0]['deps'] & {
    readCloudStatus: ReturnType<typeof vi.fn>
    syncNow: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('sincronização automática', () => {
  it('sincroniza uma vez ao abrir um vault já ligado', async () => {
    const d = deps()
    const { result } = renderHook(() =>
      useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }),
    )

    await avancar()
    expect(d.syncNow).toHaveBeenCalledTimes(1)
    expect(result.current.linked).toBe(true)
    expect(result.current.lastSyncedAt).not.toBeNull()
  })

  it('não sincroniza vault que não está ligado', async () => {
    const d = deps({
      readCloudStatus: vi.fn(async () => status({ linked: false })),
    })
    renderHook(() => useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }))
    await avancar()
    expect(d.syncNow).not.toHaveBeenCalled()
  })

  it('não sincroniza sem sessão, mesmo com o vault ligado no disco', async () => {
    const d = deps({
      readCloudStatus: vi.fn(async () => status({ signedIn: false })),
    })
    renderHook(() => useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }))
    await avancar()
    expect(d.syncNow).not.toHaveBeenCalled()
  })

  it('vários pedidos seguidos viram um ciclo só, depois da espera', async () => {
    const d = deps()
    const { result } = renderHook(() =>
      useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }),
    )
    await avancar()
    expect(d.syncNow).toHaveBeenCalledTimes(1) // o da abertura

    // escrever uma frase gera vários salvamentos
    act(() => {
      result.current.requestSync()
      result.current.requestSync()
      result.current.requestSync()
    })
    // antes da espera, nada aconteceu
    await avancar(4_000)
    expect(d.syncNow).toHaveBeenCalledTimes(1)

    await avancar(4_100)
    expect(d.syncNow).toHaveBeenCalledTimes(2)
  })

  it('pedido durante um ciclo em andamento não empilha outro', async () => {
    let liberar: (valor: CloudReport) => void = () => {}
    const d = deps({
      syncNow: vi.fn(
        () =>
          new Promise<CloudReport>((resolve) => {
            liberar = resolve
          }),
      ),
    })
    const { result } = renderHook(() =>
      useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }),
    )
    await avancar()
    expect(result.current.syncing).toBe(true)

    act(() => {
      result.current.requestSync()
    })
    await avancar(9_000)
    // o ciclo em andamento ainda bloqueia
    expect(d.syncNow).toHaveBeenCalledTimes(1)

    await act(async () => {
      liberar(relatorio())
    })
    await avancar()
    expect(result.current.syncing).toBe(false)
  })

  it('falha não vira exceção: guarda o motivo e segue', async () => {
    const d = deps({
      syncNow: vi.fn(async () => {
        throw 'Sem conexão com a nuvem.'
      }),
    })
    const { result } = renderHook(() =>
      useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }),
    )
    await avancar()
    expect(result.current.lastError).toContain('Sem conexão')
    expect(result.current.syncing).toBe(false)
  })

  it('resposta em forma inesperada não liga a sincronização', async () => {
    const d = deps({ readCloudStatus: vi.fn(async () => undefined) })
    const { result } = renderHook(() =>
      useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }),
    )
    await avancar()
    expect(result.current.linked).toBe(false)
    expect(d.syncNow).not.toHaveBeenCalled()
  })

  it('desligado por configuração, não faz nada', async () => {
    const d = deps()
    renderHook(() =>
      useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, enabled: false, deps: d }),
    )
    await avancar(20_000)
    expect(d.readCloudStatus).not.toHaveBeenCalled()
    expect(d.syncNow).not.toHaveBeenCalled()
  })
})

describe('estabilidade das dependências do hook', () => {
  it('ler o estado uma vez só, mesmo com deps novas a cada render', async () => {
    const primeira = deps()
    const { rerender } = renderHook(
      ({ d }) => useCloudAutoSync({ vaultPath: 'C:/vault', config: CONFIG, deps: d }),
      { initialProps: { d: primeira } },
    )
    await avancar()
    expect(primeira.readCloudStatus).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 3; i += 1) {
      const outra = deps()
      rerender({ d: outra })
      await avancar()
      expect(outra.readCloudStatus).not.toHaveBeenCalled()
      expect(outra.syncNow).not.toHaveBeenCalled()
    }
  })
})
