import { useState } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteReadinessControl } from './NoteReadinessControl'
import { prepareReportMarkdown } from './readinessReportMarkdown'
import type { NoteReviewState, ReadinessAttempt } from './ai'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'

const {
  assessNoteReadinessMock,
  getNoteReviewStateMock,
  resetNoteLearningMock,
  setNoteReviewEnrollmentMock,
  getUnrecoverableMock,
  exportUnrecoverableMock,
  discardUnrecoverableMock,
  saveDialogMock,
  getVaultReviewPolicyConfigMock,
} = vi.hoisted(() => ({
  assessNoteReadinessMock: vi.fn(),
  getNoteReviewStateMock: vi.fn(),
  resetNoteLearningMock: vi.fn(),
  setNoteReviewEnrollmentMock: vi.fn(),
  getUnrecoverableMock: vi.fn(),
  exportUnrecoverableMock: vi.fn(),
  discardUnrecoverableMock: vi.fn(),
  saveDialogMock: vi.fn(),
  getVaultReviewPolicyConfigMock: vi.fn(),
}))

vi.mock('./ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai')>()
  return {
    ...original,
    assessNoteReadiness: assessNoteReadinessMock,
    getNoteReviewState: getNoteReviewStateMock,
    resetNoteLearning: resetNoteLearningMock,
    setNoteReviewEnrollment: setNoteReviewEnrollmentMock,
    getUnrecoverableLearningDocuments: getUnrecoverableMock,
    exportUnrecoverableLearningDocument: exportUnrecoverableMock,
    discardUnrecoverableLearningDocument: discardUnrecoverableMock,
  }
})

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: saveDialogMock,
}))

vi.mock('./vaultReviewPolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('./vaultReviewPolicy')>()
  return {
    ...original,
    getVaultReviewPolicyConfig: getVaultReviewPolicyConfigMock,
  }
})

const validAttempt: ReadinessAttempt = {
  outcome: 'valid',
  sourceHash: `sha256:${'b'.repeat(64)}`,
  report: {
    status: 'ready',
    explanation: 'A nota tem material suficiente.',
    centralIdea: {
      sourceQuote: 'Ideia central.',
      sourceStartUtf16: 0,
      sourceEndUtf16: 13,
    },
    evaluablePoints: [
      { sourceQuote: 'Ponto um.', sourceStartUtf16: 14, sourceEndUtf16: 23 },
      { sourceQuote: 'Ponto dois.', sourceStartUtf16: 24, sourceEndUtf16: 34 },
      { sourceQuote: 'Ponto trÃƒÂªs.', sourceStartUtf16: 35, sourceEndUtf16: 46 },
    ],
    issues: [],
  },
}

// Harness com o estado do relatorio controlado pelo pai (como o App faz): o
// relatorio abre/fecha dentro do proprio popover quando o componente notifica.
function Harness(props?: Partial<React.ComponentProps<typeof NoteReadinessControl>>) {
  const [reportOpen, setReportOpen] = useState(false)
  return (
    <ReviewAiSettingsProvider>
      <NoteReadinessControl
        vaultPath={'C:\\Vault'}
        relativePath="biologia.md"
        sourceRevision="# Biologia"
        isDirty={false}
        reportOpen={reportOpen}
        onReportOpenChange={setReportOpen}
        {...props}
      />
    </ReviewAiSettingsProvider>
  )
}

function control(props?: Partial<React.ComponentProps<typeof NoteReadinessControl>>) {
  return <Harness {...props} />
}

describe('NoteReadinessControl', () => {
  beforeEach(() => {
    window.localStorage.clear()
    assessNoteReadinessMock.mockReset()
    getNoteReviewStateMock.mockReset().mockResolvedValue(null)
    resetNoteLearningMock.mockReset()
    setNoteReviewEnrollmentMock.mockReset()
    getUnrecoverableMock.mockReset().mockResolvedValue([])
    exportUnrecoverableMock.mockReset().mockResolvedValue(1)
    discardUnrecoverableMock.mockReset().mockResolvedValue(1)
    saveDialogMock.mockReset().mockResolvedValue('C:\\export\\biologia.learning.json')
    getVaultReviewPolicyConfigMock.mockReset().mockResolvedValue({
      revision: 1,
      defaults: {
        firstReviewIntervalDays: 1,
        targetRetention: 0.9,
        priorityWeight: 3,
        minIntervalDays: 1,
        maxIntervalDays: 90,
        preferredMode: 'exam',
      },
      tagRules: [
        { tag: 'revisao/prova', autoEnroll: true, firstReviewIntervalDays: 1, targetRetention: 0.9, priorityWeight: 3, minIntervalDays: 1, maxIntervalDays: 90, deadlineAtUnixMs: null },
        { tag: 'revisao/manter', autoEnroll: true, firstReviewIntervalDays: 2, targetRetention: 0.8, priorityWeight: 2, minIntervalDays: 1, maxIntervalDays: 365, deadlineAtUnixMs: null },
        { tag: 'revisao/leve', autoEnroll: true, firstReviewIntervalDays: 7, targetRetention: 0.7, priorityWeight: 1, minIntervalDays: 3, maxIntervalDays: 730, deadlineAtUnixMs: null },
      ],
      segmentation: { maxWholeNoteWords: 800 },
      updatedAtUnixMs: null,
      affectedNoteCount: 0,
    })
  })

  afterEach(cleanup)

  it('notifica o estado de prontidão mais recente via onStatusChange', async () => {
    const onStatusChange = vi.fn()
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-1',
      relativePath: 'biologia.md',
      contentHash: 'sha256:note',
      readiness: 'ready',
      assessedAtUnixMs: 1,
      report: null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    })

    render(control({ onStatusChange }))

    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('ready'))
  })

  it('exposes a rejected provider response safely and regenerates against the same source and provider', async () => {
    const user = userEvent.setup()
    const invalidAttempt: ReadinessAttempt = {
      outcome: 'invalid',
      sourceHash: `sha256:${'a'.repeat(64)}`,
      message: 'A resposta nÃƒÂ£o corresponde ao contrato.',
      rawResponse: '<img src=x onerror="window.hacked=true">',
      validationErrors: ['Campo status ausente.', 'Trecho citado nÃƒÂ£o existe na nota.'],
    }
    assessNoteReadinessMock.mockResolvedValueOnce(invalidAttempt).mockResolvedValueOnce(invalidAttempt)

    render(control())
    await user.click(screen.getByRole('button', { name: /Avaliar/ }))

    await screen.findByLabelText(/resposta da IA/i)
    expect(screen.getByTestId('review-ai-raw-response')).toHaveTextContent(invalidAttempt.rawResponse ?? '')
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('Campo status ausente.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Gerar novo/ }))
    await waitFor(() => expect(assessNoteReadinessMock).toHaveBeenCalledTimes(2))
    expect(assessNoteReadinessMock).toHaveBeenNthCalledWith(2, {
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
      provider: 'ollama',
      expectedSourceHash: invalidAttempt.sourceHash,
    })
  })

  it('discards a delayed result when the active note changes', async () => {
    const user = userEvent.setup()
    let resolveAttempt!: (attempt: ReadinessAttempt) => void
    assessNoteReadinessMock.mockReturnValue(new Promise<ReadinessAttempt>((resolve) => {
      resolveAttempt = resolve
    }))
    const view = render(control())

    await user.click(screen.getByRole('button', { name: /Avaliar/ }))
    view.rerender(control({ relativePath: 'quimica.md', sourceRevision: '# QuÃƒÂ­mica' }))
    resolveAttempt(validAttempt)

    await waitFor(() => expect(screen.getByRole('button', { name: /Avaliar/ })).toBeEnabled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not offer regeneration for a valid report and closes with Escape', async () => {
    const user = userEvent.setup()
    assessNoteReadinessMock.mockResolvedValue(validAttempt)
    render(control())
    const trigger = screen.getByRole('button', { name: /Avaliar/ })
    await user.click(trigger)

    expect(await screen.findByRole('heading', { name: /Pronta/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Ponto/)[2]).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar novo/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // O menu desmonta enquanto o relatorio substitui o popover: o foco volta
    // para o trigger remontado, entao a consulta e refeita apos o fechamento.
    await waitFor(() => expect(screen.getByRole('button', { name: /Avaliar/ })).toHaveFocus())
  })

  it('renders Markdown and KaTeX in evaluable points', async () => {
    const user = userEvent.setup()
    const formula = '$$6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2$$'
    assessNoteReadinessMock.mockResolvedValue({
      ...validAttempt,
      report: {
        ...validAttempt.report,
        evaluablePoints: [{ sourceQuote: formula, sourceStartUtf16: 0, sourceEndUtf16: formula.length }],
      },
    })
    render(control())

    await user.click(screen.getByRole('button', { name: /Avaliar/ }))

    const source = await screen.findByText('6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2', { selector: 'annotation' })
    expect(source.closest('.katex')).not.toBeNull()
  })
  describe('prepareReportMarkdown', () => {
    it('envolve equacao LaTeX citada sem delimitadores em $$...$$', () => {
      const equation = '6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2'
      expect(prepareReportMarkdown(equation)).toBe(`$$${equation}$$`)
    })
    it('nao envolve conteudo que ja tem cifroes ou markdown estruturado', () => {
      expect(prepareReportMarkdown('Glicose ($\\text{C}_6\\text{H}_{12}\\text{O}_6$).')).toBe('Glicose ($\\text{C}_6\\text{H}_{12}\\text{O}_6$).')
      expect(prepareReportMarkdown('| Etapa | Local |\n| :--- | :--- |')).toBe('| Etapa | Local |\n| :--- | :--- |')
    })
    it('remove negrito desbalanceado mas preserva o balanceado', () => {
      expect(prepareReportMarkdown('Local:** Tilacoides.')).toBe('Local: Tilacoides.')
      expect(prepareReportMarkdown('Ocorre no **cloroplasto**.')).toBe('Ocorre no **cloroplasto**.')
    })
  })

  it('renders KaTeX para equacao citada sem delimitadores no ponto avaliável', async () => {
    const user = userEvent.setup()
    const equation = '6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2'
    assessNoteReadinessMock.mockResolvedValue({
      ...validAttempt,
      report: {
        ...validAttempt.report,
        evaluablePoints: [{ sourceQuote: equation, sourceStartUtf16: 0, sourceEndUtf16: equation.length }],
      },
    })
    render(control())

    await user.click(screen.getByRole('button', { name: /Avaliar/ }))

    const source = await screen.findByText('6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2', { selector: 'annotation' })
    expect(source.closest('.katex')).not.toBeNull()
  })

  it('nao exibe asteriscos literais de negrito cortado no ponto avaliável', async () => {
    const user = userEvent.setup()
    const quote = 'Local:** Tilacoides.\n* **Dependência:** Requer luz direta.'
    assessNoteReadinessMock.mockResolvedValue({
      ...validAttempt,
      report: {
        ...validAttempt.report,
        evaluablePoints: [{ sourceQuote: quote, sourceStartUtf16: 0, sourceEndUtf16: quote.length }],
      },
    })
    render(control())

    await user.click(screen.getByRole('button', { name: /Avaliar/ }))

    expect(await screen.findByText(/Local: Tilacoides/)).toBeInTheDocument()
    expect(screen.queryByText(/Local:\*\*/)).not.toBeInTheDocument()
    expect(screen.getByText(/Dependência:/)).toBeInTheDocument()
  })

  it('requires the saved Markdown to match the visible note', () => {
    render(control({ isDirty: true }))
    const button = screen.getByRole('button', { name: /Avaliar/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('Salve a nota'))
  })

  it('salva o rascunho antes de avaliar quando a nota esta suja e ha onSaveFirst', async () => {
    const user = userEvent.setup()
    const onSaveFirst = vi.fn().mockResolvedValue(true)
    assessNoteReadinessMock.mockResolvedValue(validAttempt)
    render(control({ isDirty: true, onSaveFirst }))

    const button = screen.getByRole('button', { name: /Avaliar/ })
    expect(button).toBeEnabled()
    await user.click(button)

    expect(onSaveFirst).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(assessNoteReadinessMock).toHaveBeenCalledTimes(1))
  })

  it('nao avalia quando o salvamento do rascunho falha', async () => {
    const user = userEvent.setup()
    const onSaveFirst = vi.fn().mockResolvedValue(false)
    assessNoteReadinessMock.mockResolvedValue(validAttempt)
    render(control({ isDirty: true, onSaveFirst }))

    await user.click(screen.getByRole('button', { name: /Avaliar/ }))
    expect(onSaveFirst).toHaveBeenCalledTimes(1)
    expect(assessNoteReadinessMock).not.toHaveBeenCalled()
    // O botao volta a ficar disponivel para nova tentativa.
    expect(screen.getByRole('button', { name: /Avaliar/ })).toBeEnabled()
  })

  it('preserva o status de prontidão enquanto a nota tem alterações não salvas', async () => {
    // Cenario do onboarding de perfil: nota pronta, usuario adota a tag no
    // popover e o rascunho fica sujo (autosave desligado). A avaliacao nao
    // pode sumir — o status verde e o aviso de alteracoes pendentes ficam
    // visiveis, e o indicador externo continua informando `ready`.
    const onStatusChange = vi.fn()
    const readyState: NoteReviewState = {
      noteId: 'note-ready',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)
    const view = render(control({ onStatusChange }))

    expect(await screen.findByText(/Status: Nota validada/)).toBeInTheDocument()
    expect(onStatusChange).toHaveBeenLastCalledWith('ready')

    view.rerender(control({ isDirty: true, onStatusChange }))

    expect(screen.getByText('Alterações não salvas')).toBeInTheDocument()
    expect(screen.getByText(/Status: Nota validada/)).toBeInTheDocument()
    expect(onStatusChange).toHaveBeenLastCalledWith('ready')
    // As acoes continuam exigindo o conteudo salvo.
    expect(screen.getByRole('button', { name: /Avaliar/ })).toBeDisabled()
  })

  it('descarta o estado preservado quando a nota troca com rascunho sujo', async () => {
    const readyState: NoteReviewState = {
      noteId: 'note-1',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)
    const view = render(control())
    await screen.findByText(/Status: Nota validada/)

    // Outra nota com rascunho sujo: o estado da nota anterior e descartado.
    view.rerender(control({ relativePath: 'quimica.md', sourceRevision: '# Quimica', isDirty: true }))

    expect(screen.queryByText(/Status: Nota validada/)).not.toBeInTheDocument()
    expect(screen.getByText('Status: Alterações não salvas')).toBeInTheDocument()
  })

  it('requires explicit consent before Gemini can receive a note', () => {
    window.localStorage.setItem('mirrormind.review.provider.v1', 'gemini')
    render(control())
    const button = screen.getByRole('button', { name: /Avaliar/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('Autorize o envio ao Gemini'))
  })

  it('abre uma revisão imediata quando a nota está pronta e inscrita', async () => {
    const user = userEvent.setup()
    const onStartReview = vi.fn()
    const readyState: NoteReviewState = {
      noteId: 'note-ready',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)

    render(control({ onStartReview }))

    await user.click(await screen.findByRole('button', { name: 'Iniciar revisão agora' }))

    expect(setNoteReviewEnrollmentMock).not.toHaveBeenCalled()
    expect(onStartReview).toHaveBeenCalledWith({
      noteId: 'note-ready',
      preferredMode: 'exam',
      nextReviewAtUnixMs: 1_720_172_800_000,
      firstReviewAtUnixMs: 1_720_172_800_000,
    })
  })

  it('inscreve automaticamente e inicia a revisão quando a nota está pronta mas não inscrita', async () => {
    const user = userEvent.setup()
    const onStartReview = vi.fn()
    const readyState: NoteReviewState = {
      noteId: 'note-atp',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: false,
      preferredMode: 'conversation',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)
    setNoteReviewEnrollmentMock.mockResolvedValue({
      ...readyState,
      enrolled: true,
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    })

    render(control({ onStartReview }))

    await user.click(await screen.findByRole('button', { name: 'Iniciar revisão agora' }))

    expect(setNoteReviewEnrollmentMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
      enabled: true,
    })
    await waitFor(() => expect(onStartReview).toHaveBeenCalledWith({
      noteId: 'note-atp',
      preferredMode: 'conversation',
      nextReviewAtUnixMs: 1_720_172_800_000,
      firstReviewAtUnixMs: 1_720_172_800_000,
    }))
  })

  it('desabilita a revisão imediata para notas não avaliadas ou sujas', async () => {
    render(control())
    const button = screen.getByRole('button', { name: 'Iniciar revisão agora' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('Avalie a nota'))
    cleanup()

    render(control({ isDirty: true }))
    const dirtyButton = screen.getByRole('button', { name: 'Iniciar revisão agora' })
    expect(dirtyButton).toBeDisabled()
    expect(dirtyButton).toHaveAttribute('title', expect.stringContaining('Salve a nota'))
  })

  it('reopens the persisted report of an enrolled modified note', async () => {
    const user = userEvent.setup()
    const modifiedState: NoteReviewState = {
      noteId: 'note-modified',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'d'.repeat(64)}`,
      readiness: 'modified',
      assessedAtUnixMs: 1_720_000_000_000,
      report: validAttempt.outcome === 'valid' ? validAttempt.report : null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'paused',
      firstReviewAtUnixMs: 1_720_172_800_000,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    }
    getNoteReviewStateMock.mockResolvedValue(modifiedState)
    render(control())

    await user.click(await screen.findByRole('button', { name: /Abrir/ }))
    expect(screen.getByText('Este relatório pertence à versão anterior da nota.')).toBeInTheDocument()
  })
  it('reinicia o aprendizado somente após confirmação', async () => {
    const user = userEvent.setup()
    const readyState: NoteReviewState = {
      noteId: 'note-reset',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_000_000_000,
      nextReviewAtUnixMs: 1_720_000_000_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    }
    getNoteReviewStateMock.mockResolvedValue(readyState)
    resetNoteLearningMock.mockResolvedValue({
      ...readyState,
      firstReviewAtUnixMs: 1_730_000_000_000,
      nextReviewAtUnixMs: 1_730_000_000_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    })

    render(control())

    await user.click(await screen.findByRole('button', { name: /Reiniciar aprendizado desta nota/ }))
    expect(screen.getByRole('dialog', { name: /Reiniciar aprendizado/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reiniciar aprendizado' }))

    expect(resetNoteLearningMock).toHaveBeenCalledWith({
      vaultPath: 'C:\\Vault',
      relativePath: 'biologia.md',
    })
    // O estado retornado substitui o anterior: a proxima data passa a ser a nova.
    const expectedDate = new Date(1_730_000_000_000).toLocaleDateString('pt-BR')
    expect(await screen.findByText(`Próxima revisão: ${expectedDate}`)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Reiniciar aprendizado/ })).not.toBeInTheDocument()
  })

  it('flags a deadline with retention at risk', async () => {
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-risk',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'c'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: 1_720_172_800_000,
      deadlineRetentionAtRisk: true,
    })

    render(control())

    expect(await screen.findByText('Meta de retenção em risco')).toBeInTheDocument()
  })

  it('cancela o reinício sem chamar o backend', async () => {
    const user = userEvent.setup()
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-reset',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_000_000_000,
      nextReviewAtUnixMs: 1_720_000_000_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    })

    render(control())

    await user.click(await screen.findByRole('button', { name: /Reiniciar aprendizado desta nota/ }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(resetNoteLearningMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /Reiniciar aprendizado/ })).not.toBeInTheDocument()
  })

  it('não oferece reinício quando a nota nunca foi avaliada', async () => {
    render(control())
    expect(await screen.findByText(/Status: Não avaliada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reiniciar aprendizado/ })).not.toBeInTheDocument()
  })

  it('reopens the complete persisted readiness report', async () => {
    const persistedState: NoteReviewState = {
      noteId: 'note-report',
      relativePath: 'biologia.md',
      contentHash: validAttempt.sourceHash,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: validAttempt.outcome === 'valid' ? validAttempt.report : null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    }
    getNoteReviewStateMock.mockResolvedValue(persistedState)
    render(control())

    await userEvent.setup().click(await screen.findByRole('button', { name: /Abrir/ }))

    expect(await screen.findByText('A nota tem material suficiente.')).toBeInTheDocument()
    expect(screen.getByText('Ponto dois.')).toBeInTheDocument()
  })

  it('avisa quando o aprendizado foi recuperado de um backup', async () => {
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-backup',
      relativePath: 'biologia.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
      readiness: 'ready',
      assessedAtUnixMs: 1_720_000_000_000,
      report: null,
      enrolled: true,
      preferredMode: 'exam',
      schedulingStatus: 'scheduled',
      firstReviewAtUnixMs: 1_720_000_000_000,
      nextReviewAtUnixMs: 1_720_000_000_000,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: true,
    })
    render(control())

    const badge = await screen.findByText('Aprendizado recuperado de backup')
    expect(badge).toHaveAttribute('role', 'status')
    expect(badge.getAttribute('title')).toContain('restaurado de um backup')
  })

  it('oferece exportar e descartar quando o documento de aprendizado e irrecuperavel', async () => {
    const user = userEvent.setup()
    getNoteReviewStateMock.mockRejectedValue(new Error('O documento principal esta corrompido e nenhum backup valido foi encontrado.'))
    getUnrecoverableMock.mockResolvedValue([{
      storageKey: 'note-corrupt',
      relativePath: 'biologia.md',
    }])

    render(control())

    expect(await screen.findByText('Aprendizado irrecuperável')).toBeInTheDocument()
    expect(screen.getByText('biologia.md')).toBeInTheDocument()

    // Exporta para o destino escolhido no dialogo.
    await user.click(screen.getByRole('button', { name: /Exportar arquivo/ }))
    expect(saveDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Exportar arquivo de aprendizado',
    }))
    expect(exportUnrecoverableMock).toHaveBeenCalledWith({
      vaultPath: expect.stringContaining('Vault'),
      storageKey: 'note-corrupt',
      destinationPath: 'C:\\export\\biologia.learning.json',
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /Exportar arquivo/ })).not.toBeDisabled())

    // Descartar exige confirmacao e recarrega o estado apos quarentena.
    getNoteReviewStateMock.mockResolvedValue(null)
    await user.click(screen.getByRole('button', { name: /Descartar e reavaliar/ }))
    const dialog = await screen.findByRole('dialog', { name: /Descartar aprendizado irrecuperável/ })
    await user.click(within(dialog).getByRole('button', { name: 'Descartar e reavaliar' }))
    await waitFor(() => expect(discardUnrecoverableMock).toHaveBeenCalledWith({
      vaultPath: expect.stringContaining('Vault'),
      storageKey: 'note-corrupt',
    }))
    expect(await screen.findByText(/Status: Não avaliada/)).toBeInTheDocument()
  })

  it('nao oferece recuperacao quando o documento irrecuperavel nao pertence a nota aberta', async () => {
    getNoteReviewStateMock.mockRejectedValue(new Error('carregamento falhou'))
    getUnrecoverableMock.mockResolvedValue([
      { storageKey: 'note-other', relativePath: 'outra-nota.md' },
      { storageKey: 'note-other-2', relativePath: 'mais-uma.md' },
    ])
    render(control())

    await waitFor(() => expect(getUnrecoverableMock).toHaveBeenCalled())
    expect(screen.queryByText('Aprendizado irrecuperável')).not.toBeInTheDocument()
  })

  it('sugere adotar um perfil padrao quando a nota esta pronta sem tag de revisao', async () => {
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-1',
      relativePath: 'biologia.md',
      contentHash: 'sha256:content',
      readiness: 'ready',
      assessedAtUnixMs: 1_730_000_000_000,
      report: null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    })
    const onApplyTag = vi.fn()
    render(control({ noteTags: [], onApplyTag }))

    expect(await screen.findByText('Adotar perfil de revisão?')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /Intensiva/ }))
    expect(onApplyTag).toHaveBeenCalledWith('revisao/prova')
  })

  it('nao sugere perfil quando a nota ja tem uma tag de revisao aplicada', async () => {
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-1',
      relativePath: 'biologia.md',
      contentHash: 'sha256:content',
      readiness: 'ready',
      assessedAtUnixMs: 1_730_000_000_000,
      report: null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    })
    render(control({ noteTags: ['revisao/prova'], onApplyTag: vi.fn() }))

    await waitFor(() => expect(getVaultReviewPolicyConfigMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Adotar perfil de revisão?')).not.toBeInTheDocument()
  })

  it('nao sugere perfil sem callback de aplicacao', async () => {
    getNoteReviewStateMock.mockResolvedValue({
      noteId: 'note-1',
      relativePath: 'biologia.md',
      contentHash: 'sha256:content',
      readiness: 'ready',
      assessedAtUnixMs: 1_730_000_000_000,
      report: null,
      enrolled: false,
      preferredMode: 'exam',
      schedulingStatus: 'notScheduled',
      firstReviewAtUnixMs: null,
      nextReviewAtUnixMs: null,
      deadlineRetentionAtRisk: false,
      recoveredFromBackup: false,
    })
    render(control({ noteTags: [] }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Adotar perfil de revisão?')).not.toBeInTheDocument()
    expect(getVaultReviewPolicyConfigMock).not.toHaveBeenCalled()
  })
})
