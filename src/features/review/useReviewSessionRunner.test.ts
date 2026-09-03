import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReviewSessionRunner } from './useReviewSessionRunner'

const mocks = vi.hoisted(() => ({
  previewPlan: vi.fn(),
  start: vi.fn(),
  continueConversation: vi.fn(),
  complete: vi.fn(),
}))

vi.mock('./reviewSession', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reviewSession')>()
  return {
    ...original,
    previewReviewSessionPlan: mocks.previewPlan,
    startReviewSession: mocks.start,
    continueReviewConversation: mocks.continueConversation,
    completeReviewSession: mocks.complete,
  }
})

const PROMPT_A = { id: 'p1', text: 'Pergunta 1', isClarification: false }
const PROMPT_B = { id: 'p2', text: 'Pergunta 2', isClarification: false }
const DRAFT = {
  mode: 'exam',
  prompts: [PROMPT_A, PROMPT_B],
  minimumAnswers: 1,
  maximumAnswers: 5,
}

const OPTIONS = {
  vaultPath: 'C:\\Vault',
  relativePath: 'nota.md',
  mode: 'exam' as const,
  provider: 'ollama' as const,
  canUseProvider: true,
  onCompleted: vi.fn(),
}

describe('useReviewSessionRunner', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    OPTIONS.onCompleted.mockReset()
    mocks.previewPlan.mockResolvedValue({ estimatedMinutes: 5 })
    mocks.complete.mockResolvedValue({ outcome: 'valid', report: { markdown: '# ok' } })
  })

  it('estima o plano na preparacao e inicia a sessao no primeiro prompt', async () => {
    mocks.start.mockResolvedValue({ outcome: 'valid', draft: DRAFT })
    const { result } = renderHook(() => useReviewSessionRunner(OPTIONS))

    await waitFor(() => expect(mocks.previewPlan).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'nota.md',
      mode: 'exam',
    }))

    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.draft).toEqual(DRAFT)
    expect(result.current.prompt).toEqual(PROMPT_A)
    expect(result.current.busy).toBe(false)
  })

  it('avanca os prompts da prova e encerra no ultimo', async () => {
    mocks.start.mockResolvedValue({ outcome: 'valid', draft: DRAFT })
    const { result } = renderHook(() => useReviewSessionRunner(OPTIONS))
    await act(async () => {
      await result.current.begin()
    })

    await act(async () => {
      await result.current.answerCurrent('resposta 1', false)
    })
    expect(result.current.prompt).toEqual(PROMPT_B)
    expect(result.current.exchanges).toHaveLength(1)

    await act(async () => {
      await result.current.answerCurrent('resposta 2', true)
    })
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(OPTIONS.onCompleted).toHaveBeenCalledTimes(1)
    expect(result.current.report).toEqual({ markdown: '# ok' })
  })

  it('registra diagnostico quando o inicio e invalido', async () => {
    mocks.start.mockResolvedValue({ outcome: 'invalid', message: 'sem cobertura', rawResponse: null, validationErrors: [] })
    const { result } = renderHook(() => useReviewSessionRunner(OPTIONS))

    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.diagnostic?.message).toBe('sem cobertura')
    expect(result.current.draft).toBeNull()
  })

  it('nao inicia sem provedor utilizavel', async () => {
    const { result } = renderHook(() => useReviewSessionRunner({ ...OPTIONS, canUseProvider: false }))

    await act(async () => {
      await result.current.begin()
    })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
