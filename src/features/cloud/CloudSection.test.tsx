import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CloudSection } from './CloudSection'
import type {
  CloudReport,
  CloudStatus,
  CloudTarget,
  LinkStrategy,
  SweepReport,
} from '../../lib/cloudSync'

const CONFIG = { url: 'https://projeto.supabase.co', apiKey: 'chave-publica' }

function emptyReport(): CloudReport {
  return {
    uploaded: [],
    downloaded: [],
    conflicts: [],
    deleted: [],
    skipped: [],
    failed: [],
    bytesUp: 0,
    bytesDown: 0,
  }
}

function baseStatus(over: Partial<CloudStatus> = {}): CloudStatus {
  return {
    signedIn: true,
    linked: false,
    vaultName: 'Estudo',
    localFiles: 12,
    remoteFiles: null,
    accountVaults: [],
    needsChoice: false,
    lastSyncedAt: null,
    ...over,
  }
}

/** As dependências entram como mocks: o teste exercita a tela, não o IPC. */
type Deps = {
  readCloudStatus: Mock<(t: CloudTarget) => Promise<CloudStatus>>
  linkVault: Mock<(t: CloudTarget, strategy: LinkStrategy) => Promise<CloudStatus>>
  unlinkVault: Mock<(path: string) => Promise<CloudStatus>>
  syncNow: Mock<(t: CloudTarget) => Promise<CloudReport>>
  sweepOrphans: Mock<(t: CloudTarget, dryRun: boolean) => Promise<SweepReport>>
}

function emptySweep(over: Partial<SweepReport> = {}): SweepReport {
  return { scanned: 0, orphans: [], freedBytes: 0, dryRun: true, ...over }
}

function makeDeps(status: CloudStatus, over: Partial<Deps> = {}): Deps {
  return {
    readCloudStatus: vi.fn<(t: CloudTarget) => Promise<CloudStatus>>(async () => status),
    linkVault: vi.fn<(t: CloudTarget, strategy: LinkStrategy) => Promise<CloudStatus>>(
      async () => ({ ...status, linked: true, remoteFiles: 0 }),
    ),
    unlinkVault: vi.fn<(path: string) => Promise<CloudStatus>>(async () => ({
      ...status,
      linked: false,
    })),
    syncNow: vi.fn<(t: CloudTarget) => Promise<CloudReport>>(async () => emptyReport()),
    sweepOrphans: vi.fn<(t: CloudTarget, dryRun: boolean) => Promise<SweepReport>>(
      async () => emptySweep(),
    ),
    ...over,
  }
}

function renderSection(status: CloudStatus, over: Partial<Deps> = {}) {
  const deps = makeDeps(status, over)
  const view = render(<CloudSection vaultPath="C:/vault" config={CONFIG} deps={deps} />)
  return { ...view, deps }
}

afterEach(cleanup)

describe('CloudSection', () => {
  it('sem sessão, explica que a nuvem depende de conta e que o local continua', async () => {
    renderSection(baseStatus({ signedIn: false, localFiles: 3 }))
    expect(await screen.findByText(/entre na sua conta para ligar este vault/i)).toBeTruthy()
    expect(screen.getByText(/funcionando sem conta/i)).toBeTruthy()
  })

  it('liga direto quando não há dados dos dois lados', async () => {
    const { deps } = renderSection(baseStatus())
    const botao = await screen.findByRole('button', { name: /ligar este vault/i })
    await userEvent.click(botao)
    await waitFor(() => expect(deps.linkVault).toHaveBeenCalledTimes(1))
    expect(deps.linkVault).toHaveBeenCalledWith(
      { path: 'C:/vault', ...CONFIG },
      'merge',
    )
  })

  it('pergunta antes de ligar quando a conta já tem dados na nuvem', async () => {
    const { deps } = renderSection(
      baseStatus({
        needsChoice: true,
        accountVaults: [{ id: 'v1', name: 'Estudo antigo', files: 42 }],
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: /ligar este vault/i }))

    // não ligou nada: primeiro mostra a escolha
    expect(deps.linkVault).not.toHaveBeenCalled()
    expect(await screen.findByText(/como você quer começar/i)).toBeTruthy()
    expect(screen.getByText(/Estudo antigo/)).toBeTruthy()
    expect(screen.getByText(/42 arquivo/)).toBeTruthy()
  })

  it('"manter os dois" liga com estratégia separada e deixa claro que nada é misturado', async () => {
    const { deps } = renderSection(
      baseStatus({ needsChoice: true, accountVaults: [{ id: 'v1', name: 'Outro', files: 5 }] }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /ligar este vault/i }))

    // a explicação existe enquanto a decisão está aberta
    expect(screen.getByText(/nada é misturado/i)).toBeTruthy()

    await userEvent.click(await screen.findByRole('button', { name: /manter os dois/i }))
    await waitFor(() => expect(deps.linkVault).toHaveBeenCalledTimes(1))
    expect(deps.linkVault.mock.calls[0][1]).toBe('separate')

    // depois de ligado, a tela passa a mostrar o estado ligado (a escolha some)
    expect(await screen.findByRole('button', { name: /sincronizar agora/i })).toBeTruthy()
  })

  it('sincroniza, mostra o resumo e avisa que conflito virou cópia', async () => {
    const relatorio: CloudReport = {
      ...emptyReport(),
      uploaded: ['notas/a.md', 'notas/b.md'],
      conflicts: ['notas/c.md'],
      bytesUp: 2048,
    }
    const { deps } = renderSection(baseStatus({ linked: true, remoteFiles: 10 }), {
      syncNow: vi.fn<(t: CloudTarget) => Promise<CloudReport>>(async () => relatorio),
    })

    await userEvent.click(await screen.findByRole('button', { name: /sincronizar agora/i }))

    await waitFor(() => expect(deps.syncNow).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/2 enviado\(s\)/)).toBeTruthy()
    expect(screen.getByText(/1 conflito\(s\)/)).toBeTruthy()
    expect(screen.getByText(/nada foi sobrescrito/i)).toBeTruthy()
    expect(screen.getByText(/2 KB/)).toBeTruthy()
  })

  it('falha de rede vira mensagem, não tela vazia', async () => {
    renderSection(baseStatus({ linked: true, remoteFiles: 1 }), {
      syncNow: vi.fn<(t: CloudTarget) => Promise<CloudReport>>(async () => {
        throw 'Sem conexão com a nuvem.'
      }),
    })

    await userEvent.click(await screen.findByRole('button', { name: /sincronizar agora/i }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Sem conexão com a nuvem.',
    )
  })
})

describe('verificação de espaço', () => {
  it('confere primeiro e só apaga depois de um segundo clique', async () => {
    const conferencia = emptySweep({
      scanned: 12,
      orphans: [{ name: 'aaa', sizeBytes: 2 * 1024 * 1024 }],
      freedBytes: 2 * 1024 * 1024,
      dryRun: true,
    })
    const limpeza = { ...conferencia, orphanCount: undefined, freedBytes: 2 * 1024 * 1024, dryRun: false }
    const sweep = vi
      .fn<(t: CloudTarget, dryRun: boolean) => Promise<SweepReport>>()
      .mockResolvedValueOnce(conferencia)
      .mockResolvedValueOnce(limpeza)

    const { deps } = renderSection(baseStatus({ linked: true, remoteFiles: 12 }), {
      sweepOrphans: sweep,
    })

    await userEvent.click(await screen.findByRole('button', { name: /verificar espaço/i }))
    await waitFor(() => expect(sweep).toHaveBeenCalledTimes(1))
    // primeiro clique é conferência, nunca apagamento
    expect(sweep.mock.calls[0][1]).toBe(true)
    expect(await screen.findByText(/1 versão\(ões\) antiga\(s\)/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /remover 2\.0 MB/i }))
    await waitFor(() => expect(sweep).toHaveBeenCalledTimes(2))
    expect(sweep.mock.calls[1][1]).toBe(false)
    expect(await screen.findByText(/liberados/i)).toBeTruthy()
    expect(deps.sweepOrphans).toBe(sweep)
  })

  it('nada a limpar: diz que está tudo em uso, sem oferecer remoção', async () => {
    renderSection(baseStatus({ linked: true, remoteFiles: 3 }), {
      sweepOrphans: vi.fn(async () => emptySweep({ scanned: 3 })),
    })

    await userEvent.click(await screen.findByRole('button', { name: /verificar espaço/i }))
    expect(await screen.findByText(/todos em uso/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /remover/i })).toBeNull()
  })

  it('falha na verificação vira mensagem, não lista vazia', async () => {
    renderSection(baseStatus({ linked: true, remoteFiles: 3 }), {
      sweepOrphans: vi.fn(async () => {
        throw 'Sem conexão com a nuvem.'
      }),
    })

    await userEvent.click(await screen.findByRole('button', { name: /verificar espaço/i }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Sem conexão com a nuvem.',
    )
  })
})
