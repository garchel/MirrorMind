import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteCalibrationDivergenceNote } from './NoteCalibrationDivergenceNote'

const getDivergenceMock = vi.hoisted(() => vi.fn())

vi.mock('./calibrationComparison', async (importOriginal) => {
  const original = await importOriginal<typeof import('./calibrationComparison')>()
  return { ...original, getNoteCalibrationDivergence: getDivergenceMock }
})

afterEach(() => {
  cleanup()
  getDivergenceMock.mockReset()
})

const divergence = {
  atUnixMs: 1_700_000_000_000,
  dimension: 'readiness',
  primaryEngine: 'jev',
  primaryLabel: 'ambiguous',
  secondaryEngine: 'legacy',
  secondaryLabel: 'ready',
  primaryConfidence: 0.62,
}

describe('NoteCalibrationDivergenceNote', () => {
  it('mostra a divergencia com os dois vereditos', async () => {
    getDivergenceMock.mockResolvedValue(divergence)
    render(
      <NoteCalibrationDivergenceNote vaultPath={'C:\\Vault'} relativePath="nota.md" />,
    )

    await waitFor(() =>
      expect(screen.getByText(/Os dois motores discordaram/)).toBeInTheDocument(),
    )
    expect(screen.getByText(/jev disse/)).toBeInTheDocument()
    expect(screen.getByText(/ambiguous/)).toBeInTheDocument()
    expect(screen.getByText(/62% de confiança/)).toBeInTheDocument()
    expect(screen.getByText(/legacy disse/)).toBeInTheDocument()
  })

  it('nao mostra nada quando os motores concordaram', async () => {
    // Registro de acordo nao e informacao, e poluir o relatorio esconde a
    // unica coisa que importa.
    getDivergenceMock.mockResolvedValue(null)
    const { container } = render(
      <NoteCalibrationDivergenceNote vaultPath={'C:\\Vault'} relativePath="nota.md" />,
    )

    await waitFor(() => expect(getDivergenceMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('nao mostra nada sem Vault', () => {
    render(<NoteCalibrationDivergenceNote relativePath="nota.md" />)
    expect(getDivergenceMock).not.toHaveBeenCalled()
  })

  it('nao quebra o relatorio quando a leitura falha', async () => {
    // A divergencia e um extra: a avaliacao da nota nao pode depender dela.
    getDivergenceMock.mockRejectedValue(new Error('sem permissao'))
    const { container } = render(
      <NoteCalibrationDivergenceNote vaultPath={'C:\\Vault'} relativePath="nota.md" />,
    )

    await waitFor(() => expect(getDivergenceMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
