import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDueReviewCount } from './useDueReviewCount'

const { getVaultReviewDashboardMock } = vi.hoisted(() => ({
  getVaultReviewDashboardMock: vi.fn(),
}))

vi.mock('./reviewDashboard', () => ({
  getVaultReviewDashboard: getVaultReviewDashboardMock,
}))

describe('useDueReviewCount', () => {
  beforeEach(() => {
    getVaultReviewDashboardMock.mockReset()
  })
  afterEach(cleanup)

  it('usa o contador de notas vencidas do painel', async () => {
    getVaultReviewDashboardMock.mockResolvedValue({ dueNoteCount: 3 } as never)

    const { result } = renderHook(() => useDueReviewCount('C:\\Vault'))

    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe(3))
  })

  it('mede de novo quando o token de atualização muda', async () => {
    getVaultReviewDashboardMock.mockResolvedValue({ dueNoteCount: 1 } as never)

    const { result, rerender } = renderHook(
      ({ token }) => useDueReviewCount('C:\\Vault', token),
      { initialProps: { token: 0 } },
    )
    await waitFor(() => expect(result.current).toBe(1))

    getVaultReviewDashboardMock.mockResolvedValue({ dueNoteCount: 2 } as never)
    rerender({ token: 1 })
    await waitFor(() => expect(result.current).toBe(2))
  })

  it('não mede sem Vault', () => {
    const { result } = renderHook(() => useDueReviewCount(null))

    expect(result.current).toBeNull()
    expect(getVaultReviewDashboardMock).not.toHaveBeenCalled()
  })

  it('mantém null quando a leitura falha', async () => {
    getVaultReviewDashboardMock.mockRejectedValue(new Error('painel indisponível'))

    const { result } = renderHook(() => useDueReviewCount('C:\\Vault'))

    await waitFor(() => expect(getVaultReviewDashboardMock).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
