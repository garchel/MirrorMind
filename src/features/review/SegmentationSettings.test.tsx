import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SegmentationSettings } from './SegmentationSettings'

const { getConfigMock, setSegmentationMock, listenMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  setSegmentationMock: vi.fn(),
  listenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

vi.mock('./vaultReviewPolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('./vaultReviewPolicy')>()
  return {
    ...original,
    getVaultReviewPolicyConfig: getConfigMock,
    setVaultSegmentation: setSegmentationMock,
  }
})

const config = {
  revision: 3,
  defaults: {
    firstReviewIntervalDays: 2,
    targetRetention: 0.8,
    priorityWeight: 1,
    minIntervalDays: 1,
    maxIntervalDays: 365,
  },
  tagRules: [] as Record<string, unknown>[],
  segmentation: { maxWholeNoteWords: 800 },
  updatedAtUnixMs: null,
  affectedNoteCount: 0,
}

let progressListener: ((event: { payload: unknown }) => void) | undefined

describe('SegmentationSettings', () => {
  beforeEach(() => {
    getConfigMock.mockReset().mockResolvedValue(config)
    setSegmentationMock.mockReset().mockResolvedValue({
      ...config,
      revision: 4,
      segmentation: { maxWholeNoteWords: 500 },
      affectedNoteCount: 3,
    })
    progressListener = undefined
    listenMock.mockReset().mockImplementation(async (_eventName: string, listener: (event: { payload: unknown }) => void) => {
      progressListener = listener
      return () => undefined
    })
  })

  afterEach(cleanup)

  it('loads the persisted segmentation limit into the field', async () => {
    render(<SegmentationSettings vaultPath={'C:\\Vault'} />)

    const input = await screen.findByRole('spinbutton', { name: 'Máximo de palavras por nota inteira' })
    expect(input).toHaveValue(800)
    expect(screen.getByText(/revisão 3/)).toBeInTheDocument()
  })

  it('requires a valid integer between the accepted bounds', async () => {
    const user = userEvent.setup()
    render(<SegmentationSettings vaultPath={'C:\\Vault'} />)

    const input = await screen.findByRole('spinbutton', { name: 'Máximo de palavras por nota inteira' })
    await user.clear(input)
    await user.type(input, '20')

    expect(screen.getByRole('alert')).toHaveTextContent(/entre 50 e 10000/i)
    expect(screen.getByRole('button', { name: 'Recalcular notas' })).toBeDisabled()
  })

  it('recalculates notes and shows a live progress toast followed by a success toast', async () => {
    const user = userEvent.setup()
    let resolveSegmentation: ((value: typeof config) => void) | undefined
    setSegmentationMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveSegmentation = resolve
    }))
    render(<SegmentationSettings vaultPath={'C:\\Vault'} />)

    const input = await screen.findByRole('spinbutton', { name: 'Máximo de palavras por nota inteira' })
    await user.clear(input)
    await user.type(input, '500')
    await user.click(screen.getByRole('button', { name: 'Recalcular notas' }))

    expect(setSegmentationMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      expectedRevision: 3,
      maxWholeNoteWords: 500,
    })

    await waitFor(() => expect(progressListener).toBeDefined())
    await waitFor(() => {
      progressListener?.({ payload: { processed: 1, total: 3, changed: 1 } })
      expect(screen.getByRole('status')).toHaveTextContent(/1 de 3 avaliadas/i)
    })

    resolveSegmentation?.({
      ...config,
      revision: 4,
      segmentation: { maxWholeNoteWords: 500 },
      affectedNoteCount: 3,
    })

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/3 notas recalculadas com sucesso/i)
    })
    expect(input).toHaveValue(500)
  })

  it('shows an error toast when the recalculation fails', async () => {
    const user = userEvent.setup()
    setSegmentationMock.mockRejectedValueOnce(new Error('Limite de revisão ultrapassado.'))
    render(<SegmentationSettings vaultPath={'C:\\Vault'} />)

    const input = await screen.findByRole('spinbutton', { name: 'Máximo de palavras por nota inteira' })
    await user.clear(input)
    await user.type(input, '500')
    await user.click(screen.getByRole('button', { name: 'Recalcular notas' }))

    await waitFor(() => {
      expect(screen.getByText(/Não foi possível recalcular/i)).toBeInTheDocument()
    })
    const toast = screen.getByText(/Não foi possível recalcular/i).closest('.segmentation-toast')
    expect(toast).toHaveTextContent(/Limite de revisão ultrapassado/i)
  })

  it('refreshes the saved limit after a stale-revision error', async () => {
    const user = userEvent.setup()
    getConfigMock
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({
        ...config,
        revision: 5,
        segmentation: { maxWholeNoteWords: 600 },
      })
    setSegmentationMock.mockRejectedValueOnce(new Error('A configuracao de revisao foi alterada por outra operacao.'))
    render(<SegmentationSettings vaultPath={'C:\\Vault'} />)

    const input = await screen.findByRole('spinbutton', { name: 'Máximo de palavras por nota inteira' })
    await user.clear(input)
    await user.type(input, '500')
    await user.click(screen.getByRole('button', { name: 'Recalcular notas' }))

    await waitFor(() => expect(getConfigMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(input).toHaveValue(600))
    expect(screen.getByText(/revisão 5/)).toBeInTheDocument()
  })

  it('reports when no existing note needed recalculation', async () => {
    const user = userEvent.setup()
    setSegmentationMock.mockResolvedValueOnce({
      ...config,
      revision: 4,
      segmentation: { maxWholeNoteWords: 500 },
      affectedNoteCount: 0,
    })
    render(<SegmentationSettings vaultPath={'C:\\Vault'} />)

    const input = await screen.findByRole('spinbutton', { name: 'Máximo de palavras por nota inteira' })
    await user.clear(input)
    await user.type(input, '500')
    await user.click(screen.getByRole('button', { name: 'Recalcular notas' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Nenhuma nota precisou ser recalculada/i)
    })
  })
})
