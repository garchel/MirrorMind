import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useNoteReadiness } from './useNoteReadiness'
import type { NoteReviewState, ReadinessAttempt } from './ai'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'

const { getNoteReviewStateMock, assessNoteReadinessMock } = vi.hoisted(() => ({
  getNoteReviewStateMock: vi.fn(),
  assessNoteReadinessMock: vi.fn(),
}))

vi.mock('./ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai')>()
  return {
    ...original,
    getNoteReviewState: getNoteReviewStateMock,
    assessNoteReadiness: assessNoteReadinessMock,
  }
})

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <ReviewAiSettingsProvider>{children}</ReviewAiSettingsProvider>
}

const BASE = {
  vaultPath: 'C:\\Vault',
  relativePath: 'biologia.md',
  sourceRevision: '# Biologia',
  isDirty: false,
}

const VALID_ATTEMPT: ReadinessAttempt = {
  outcome: 'valid',
  sourceHash: `sha256:${'b'.repeat(64)}`,
  report: {
    status: 'ready',
    explanation: 'OK',
    centralIdea: null,
    evaluablePoints: [],
    issues: [],
  },
}

describe('useNoteReadiness', () => {
  it('carrega o estado da nota ao montar', async () => {
    const state: NoteReviewState = {
      noteId: 'n1',
      relativePath: 'biologia.md',
      contentHash: 'h',
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      nextReviewAtUnixMs: null,
      firstReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
      report: null,
    }
    getNoteReviewStateMock.mockResolvedValue(state)
    const { result } = renderHook(() => useNoteReadiness(BASE), { wrapper })
    await waitFor(() => expect(result.current.stateLoading).toBe(false))
    expect(getNoteReviewStateMock).toHaveBeenCalledWith({
      vaultPath: BASE.vaultPath,
      relativePath: BASE.relativePath,
    })
    expect(result.current.reviewState?.readiness).toBe('ready')
  })

  it('runAssessment guarda a tentativa e notifica abertura do relatorio', async () => {
    getNoteReviewStateMock.mockResolvedValue(null)
    assessNoteReadinessMock.mockResolvedValue(VALID_ATTEMPT)
    const onReportOpenChange = vi.fn()
    const { result } = renderHook(
      () => useNoteReadiness({ ...BASE, onReportOpenChange }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.stateLoading).toBe(false))
    await act(async () => {
      await result.current.runAssessment()
    })
    expect(result.current.attempt?.outcome).toBe('valid')
    expect(onReportOpenChange).toHaveBeenCalledWith(true)
  })

  it('descarta resultado tardio quando a nota muda (geracoes)', async () => {
    getNoteReviewStateMock.mockResolvedValue(null)
    let resolveAssessment!: (value: ReadinessAttempt) => void
    assessNoteReadinessMock.mockReturnValue(
      new Promise<ReadinessAttempt>((resolve) => { resolveAssessment = resolve }),
    )
    const { result, rerender } = renderHook(
      ({ relativePath }: { relativePath: string }) =>
        useNoteReadiness({ ...BASE, relativePath }),
      { wrapper, initialProps: { relativePath: 'biologia.md' } },
    )
    await waitFor(() => expect(result.current.stateLoading).toBe(false))
    let task!: Promise<void>
    act(() => { task = result.current.runAssessment() })
    rerender({ relativePath: 'fisica.md' })
    await act(async () => {
      resolveAssessment(VALID_ATTEMPT)
      await task
    })
    expect(result.current.attempt).toBeNull()
  })
})
