import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PolicyWorkloadEstimate } from './PolicyWorkloadEstimate'

const { estimateMock } = vi.hoisted(() => ({ estimateMock: vi.fn() }))

vi.mock('./reviewWorkload', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reviewWorkload')>()
  return {
    ...original,
    estimateReviewWorkload: estimateMock,
  }
})

function renderIntensive() {
  return render(
    <PolicyWorkloadEstimate
      firstReviewIntervalDays={1}
      targetRetention={0.9}
      minIntervalDays={1}
      maxIntervalDays={90}
    />,
  )
}

describe('PolicyWorkloadEstimate', () => {
  afterEach(() => {
    cleanup()
    estimateMock.mockReset()
  })

  it('renderiza a estimativa calculada pelo backend', async () => {
    estimateMock.mockResolvedValue({
      reviewsFirst30Days: 3,
      reviewsFirstYear: 7,
      steadyIntervalDays: 90,
    })
    renderIntensive()
    expect(await screen.findByText(/≈ 3 revisões em 30 dias/)).toBeInTheDocument()
    expect(screen.getByText(/≈ 7 no primeiro ano/)).toBeInTheDocument()
    expect(screen.getByText(/estabiliza a cada cerca de 3 meses/)).toBeInTheDocument()
    expect(estimateMock).toHaveBeenCalledWith({
      firstReviewIntervalDays: 1,
      targetRetention: 0.9,
      minIntervalDays: 1,
      maxIntervalDays: 90,
    })
  })

  it('omite a estimativa enquanto a política é inválida', async () => {
    estimateMock.mockResolvedValue({
      reviewsFirst30Days: 1,
      reviewsFirstYear: 4,
      steadyIntervalDays: 249,
    })
    render(
      <PolicyWorkloadEstimate
        firstReviewIntervalDays={7}
        targetRetention={0.7}
        minIntervalDays={3}
        maxIntervalDays={730}
        valid={false}
      />,
    )
    expect(estimateMock).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Estimativa de carga da política')).not.toBeInTheDocument()
  })

  it('mostra falha sem quebrar o formulário', async () => {
    estimateMock.mockRejectedValue(new Error('offline'))
    renderIntensive()
    expect(await screen.findByText('Não foi possível estimar a carga.')).toBeInTheDocument()
  })
})
