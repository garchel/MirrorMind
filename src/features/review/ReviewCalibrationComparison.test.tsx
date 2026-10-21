import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewCalibrationComparison } from './ReviewCalibrationComparison'

const getComparisonMock = vi.hoisted(() => vi.fn())

vi.mock('./calibrationComparison', async (importOriginal) => {
  const original = await importOriginal<typeof import('./calibrationComparison')>()
  return { ...original, getCalibrationComparison: getComparisonMock }
})

afterEach(() => {
  cleanup()
  getComparisonMock.mockReset()
})

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    total: 0,
    divergences: 0,
    divergenceRate: null,
    recent: [],
    collecting: false,
    ...overrides,
  }
}

describe('ReviewCalibrationComparison', () => {
  it('explica por que está vazia quando o modo dual não está ligado', async () => {
    // Uma lista vazia sem explicação parece bug. O painel precisa dizer que a
    // comparação só acontece no modo `Dual`.
    getComparisonMock.mockResolvedValue(comparison())
    render(<ReviewCalibrationComparison vaultPath={'C:\\Vault'} />)

    await waitFor(() =>
      expect(screen.getByText(/só acontece no modo/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/Comparar \(dual\)/)).toBeInTheDocument()
  })

  it('diz quando ainda não houve avaliação com coleta ligada', async () => {
    getComparisonMock.mockResolvedValue(comparison({ collecting: true }))
    render(<ReviewCalibrationComparison vaultPath={'C:\\Vault'} />)

    await waitFor(() =>
      expect(screen.getByText(/Nenhuma avaliação comparada ainda/i)).toBeInTheDocument(),
    )
  })

  it('mostra a taxa de divergência e as divergências', async () => {
    getComparisonMock.mockResolvedValue(
      comparison({
        collecting: true,
        total: 8,
        divergences: 3,
        divergenceRate: 0.375,
        recent: [
          {
            atUnixMs: 1_700_000_000_000,
            relativePath: 'nota.md',
            dimension: 'readiness',
            primaryEngine: 'jev',
            primaryLabel: 'ambiguous',
            secondaryEngine: 'legacy',
            secondaryLabel: 'ready',
            primaryConfidence: 0.62,
            primaryDistribution: { ready: 0.38, ambiguous: 0.6, insufficient: 0.02 },
          },
        ],
      }),
    )
    render(<ReviewCalibrationComparison vaultPath={'C:\\Vault'} />)

    // O numero esta quebrado em varios elementos pelos <strong>, entao a
    // verificacao vai no trecho de texto corrido: a porcentagem.
    await waitFor(() => expect(screen.getByText(/\(38%\)/)).toBeInTheDocument())
    expect(screen.getByText('nota.md')).toBeInTheDocument()
    expect(screen.getByText(/jev: ambiguous \(62%\)/)).toBeInTheDocument()
    expect(screen.getByText(/legacy: ready/)).toBeInTheDocument()
    // A distribuicao explica por que o motor decidiu diferente.
    expect(screen.getByText(/ambiguous 60%/)).toBeInTheDocument()
  })

  it('diz quando os dois motores concordaram em tudo', async () => {
    getComparisonMock.mockResolvedValue(
      comparison({ collecting: true, total: 12, divergences: 0, divergenceRate: 0 }),
    )
    render(<ReviewCalibrationComparison vaultPath={'C:\\Vault'} />)

    await waitFor(() =>
      expect(screen.getByText(/concordaram em todas as/i)).toBeInTheDocument(),
    )
  })

  it('não faz nada sem Vault', () => {
    render(<ReviewCalibrationComparison />)
    expect(getComparisonMock).not.toHaveBeenCalled()
  })

  it('mostra o erro quando a leitura falha', async () => {
    getComparisonMock.mockRejectedValue(new Error('o sidecar nao pode ser lido'))
    render(<ReviewCalibrationComparison vaultPath={'C:\\Vault'} />)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/sidecar nao pode ser lido/),
    )
  })
})
