import { useEffect, useRef, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import {
  assessNoteReadiness,
  discardUnrecoverableLearningDocument,
  exportUnrecoverableLearningDocument,
  getNoteReviewState,
  getUnrecoverableLearningDocuments,
  resetNoteLearning,
  reviewAiErrorMessage,
  setNoteReviewEnrollment,
  type NoteReviewState,
  type ReadinessAttempt,
  type ReviewAiProvider,
  type UnrecoverableLearningDocument,
} from './ai'
import { getVaultReviewPolicyConfig } from './vaultReviewPolicy'
import { useReviewAiSettings } from './ReviewAiSettingsContext'

/** Dados minimos para construir um item de revisao imediata ("Fazer revisão agora"). */
export type ReviewStartInfo = {
  noteId: string
  preferredMode: 'exam' | 'conversation'
  nextReviewAtUnixMs: number | null
  firstReviewAtUnixMs: number | null
}

type AssessmentIdentity = {
  provider: ReviewAiProvider
  sourceHash: string
}

const NO_TAGS: string[] = []

export type UseNoteReadinessOptions = {
  vaultPath: string
  relativePath: string
  sourceRevision: string
  isDirty: boolean
  noteTags?: string[]
  onApplyTag?: (tag: string) => void
  onStatusChange?: (readiness: NoteReviewState['readiness'] | null) => void
  onStartReview?: (info: ReviewStartInfo | null) => void
  onReportOpenChange?: (open: boolean) => void
  onSaveFirst?: () => Promise<boolean>
}

/** Ciclo de vida da prontidao de uma nota para revisao (carregar, avaliar,
 *  inscrever, resetar, recuperar, relatorio). O componente fica com o render;
 *  o foco de retorno usa `triggerButtonRef` (anexado ao trigger no JSX). */
export function useNoteReadiness({
  vaultPath,
  relativePath,
  sourceRevision,
  isDirty,
  noteTags = NO_TAGS,
  onApplyTag,
  onStatusChange,
  onStartReview,
  onReportOpenChange,
  onSaveFirst,
}: UseNoteReadinessOptions) {
  const { provider, geminiConsent } = useReviewAiSettings()
  const [attempt, setAttempt] = useState<ReadinessAttempt | null>(null)
  const [assessmentIdentity, setAssessmentIdentity] = useState<AssessmentIdentity | null>(null)
  const [reviewState, setReviewState] = useState<NoteReviewState | null>(null)
  const [stateLoading, setStateLoading] = useState(true)
  const [enrollmentBusy, setEnrollmentBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState('')
  const [unrecoverableDoc, setUnrecoverableDoc] = useState<UnrecoverableLearningDocument | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [suggestedProfiles, setSuggestedProfiles] = useState<string[]>([])
  const requestGenerationRef = useRef(0)
  const stateGenerationRef = useRef(0)
  /** Nota a que pertence o `reviewState` carregado (para preservar o status
   *  durante alterações não salvas sem vazar estado de outra nota). */
  const loadedPathRef = useRef<string | null>(null)
  const triggerButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    requestGenerationRef.current += 1
    const generation = stateGenerationRef.current + 1
    stateGenerationRef.current = generation
    setAttempt(null)
    setAssessmentIdentity(null)
    setBusy(false)
    setEnrollmentBusy(false)
    setError('')
    setResetConfirmOpen(false)
    setResetBusy(false)
    setResetError('')
    onReportOpenChange?.(false)
    if (isDirty) {
      // Rascunho com alteracoes nao salvas: a avaliacao carregada continua
      // valida para a versao salva da nota — preserva o estado (o indicador
      // externo nao fica cinza) e apenas avisa que ha alteracoes pendentes.
      // A prontidao e revalidada ao salvar (o conteudo em disco muda).
      if (loadedPathRef.current !== relativePath) {
        setReviewState(null)
        setUnrecoverableDoc(null)
      }
      setStateLoading(false)
      return
    }
    loadedPathRef.current = relativePath
    setReviewState(null)
    setUnrecoverableDoc(null)
    setRecoveryError('')
    setStateLoading(true)
    void getNoteReviewState({ vaultPath, relativePath })
      .then((state) => {
        if (stateGenerationRef.current === generation) {
          setReviewState(state)
          // Estado carregou normalmente: nenhuma recuperacao pendente.
          setUnrecoverableDoc(null)
          setRecoveryError('')
        }
      })
      .catch((cause) => {
        if (stateGenerationRef.current === generation) {
          setError(reviewAiErrorMessage(cause))
          // O carregamento falhou: a nota pode ter um documento de aprendizado
          // irrecuperavel (principal corrompido e nenhum backup valido).
          void (async () => {
            try {
              const documents = await getUnrecoverableLearningDocuments(vaultPath)
              if (stateGenerationRef.current !== generation) return
              const match = documents.find((document) => document.relativePath === relativePath)
              // So oferece recuperacao quando ha vinculo claro com a nota
              // aberta (ou um unico candidato no vault); nunca adivinha.
              const target = match ?? (documents.length === 1 ? documents[0] : null)
              if (target) {
                setUnrecoverableDoc(target)
                setError('')
              }
            } catch {
              // O erro do carregamento ja foi exibido; a deteccao e detalhe.
            }
          })()
        }
      })
      .finally(() => {
        if (stateGenerationRef.current === generation) setStateLoading(false)
      })
  }, [isDirty, onReportOpenChange, relativePath, sourceRevision, vaultPath])

  useEffect(() => () => {
    requestGenerationRef.current += 1
    stateGenerationRef.current += 1
  }, [])

  /** Perfis padrao de revisao (`#revisao/prova`, `#revisao/manter`,
   *  `#revisao/leve`): quando a nota esta pronta e nenhuma tag de revisao foi
   *  aplicada ainda, o menu sugere adotar um perfil para ativar a revisao com
   *  uma politica adequada, em vez de deixar a nota sem adesao. */
  useEffect(() => {
    let active = true
    // So sugere na primeira avaliacao, com a nota pronta e limpa, quando o
    // usuario ainda nao aplicou nenhuma tag de revisao configurada.
    if (isDirty || !reviewState || reviewState.readiness !== 'ready' || !onApplyTag) {
      setSuggestedProfiles([])
      return
    }
    const appliedReviewTags = new Set(noteTags)
    const alreadyHasReviewTag = (rules: { tag: string }[]) => rules.some((rule) => appliedReviewTags.has(rule.tag))
    void getVaultReviewPolicyConfig(vaultPath)
      .then((config) => {
        if (!active) return
        const reviewTags = config.tagRules.map((rule) => rule.tag)
        if (alreadyHasReviewTag(config.tagRules)) {
          setSuggestedProfiles([])
          return
        }
        // Sugere os perfis padrao que ainda nao estao na nota.
        const profiles = ['revisao/prova', 'revisao/manter', 'revisao/leve'].filter(
          (tag) => reviewTags.includes(tag) && !appliedReviewTags.has(tag),
        )
        setSuggestedProfiles(profiles)
      })
      .catch(() => {
        if (active) setSuggestedProfiles([])
      })
    return () => {
      active = false
    }
  }, [isDirty, noteTags, onApplyTag, reviewState, vaultPath])

  /** Exporta o arquivo irrecuperavel (principal + backups) para um destino
   *  escolhido pelo usuario antes de descartar o aprendizado. */
  async function performRecoveryExport() {
    if (!unrecoverableDoc) return
    const generation = stateGenerationRef.current
    setRecoveryBusy(true)
    setRecoveryError('')
    try {
      const segments = (unrecoverableDoc.relativePath ?? 'aprendizado')
        .replace(/\\/g, '/')
        .split('/')
      const lastSegment = segments[segments.length - 1] ?? 'aprendizado'
      const baseName = lastSegment.replace(/\.md$/i, '')
      const destination = await save({
        title: 'Exportar arquivo de aprendizado',
        defaultPath: `${baseName}.learning.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (destination === null) return
      await exportUnrecoverableLearningDocument({
        vaultPath,
        storageKey: unrecoverableDoc.storageKey,
        destinationPath: destination,
      })
    } catch (cause) {
      if (stateGenerationRef.current === generation) setRecoveryError(reviewAiErrorMessage(cause))
    } finally {
      if (stateGenerationRef.current === generation) setRecoveryBusy(false)
    }
  }

  /** Descarta (quarentena) o documento irrecuperavel para a nota recomecar. */
  async function performRecoveryDiscard() {
    if (!unrecoverableDoc) return
    const generation = stateGenerationRef.current
    setRecoveryBusy(true)
    setRecoveryError('')
    try {
      await discardUnrecoverableLearningDocument({
        vaultPath,
        storageKey: unrecoverableDoc.storageKey,
      })
      if (stateGenerationRef.current !== generation) return
      setUnrecoverableDoc(null)
      setDiscardConfirmOpen(false)
      // Recarrega o estado: a nota volta a nao avaliada e pode recomecar.
      const state = await getNoteReviewState({ vaultPath, relativePath })
      if (stateGenerationRef.current === generation) setReviewState(state)
      triggerButtonRef.current?.focus()
    } catch (cause) {
      if (stateGenerationRef.current === generation) setRecoveryError(reviewAiErrorMessage(cause))
    } finally {
      if (stateGenerationRef.current === generation) setRecoveryBusy(false)
    }
  }

  function closeDiscardConfirm() {
    if (recoveryBusy) return
    setDiscardConfirmOpen(false)
    setRecoveryError('')
  }

  useEffect(() => {
    onStatusChange?.(reviewState?.readiness ?? null)
  }, [onStatusChange, reviewState])

  const consentMissing = provider === 'gemini' && !geminiConsent
  // Com `onSaveFirst`, avaliar/revisar salva o rascunho antes de prosseguir,
  // entao rascunho sujo nao bloqueia. Sem o handler (isolado/testes), mantem
  // o pedido de salvar primeiro.
  const unavailableReason = consentMissing
    ? 'Autorize o envio ao Gemini nas configurações de revisão.'
    : isDirty && !onSaveFirst
      ? 'Salve a nota antes de solicitar a avaliação.'
      : undefined

  async function runAssessment(retry = false) {
    const selectedProvider = retry && assessmentIdentity ? assessmentIdentity.provider : provider
    const expectedSourceHash = retry && assessmentIdentity ? assessmentIdentity.sourceHash : undefined
    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    setBusy(true)
    setError('')
    // Rascunho sujo: a avaliacao le o arquivo no disco — salva antes (a nota
    // nova com conteudo colado nao precisa de Ctrl+S manual).
    if (isDirty && onSaveFirst) {
      const saved = await onSaveFirst()
      if (requestGenerationRef.current !== generation) return
      if (!saved) {
        setBusy(false)
        return
      }
    }
    try {
      const nextAttempt = await assessNoteReadiness({
        vaultPath,
        relativePath,
        provider: selectedProvider,
        expectedSourceHash,
      })
      if (requestGenerationRef.current !== generation) return
      setAttempt(nextAttempt)
      setAssessmentIdentity({ provider: selectedProvider, sourceHash: nextAttempt.sourceHash })
      onReportOpenChange?.(true)
      if (nextAttempt.outcome === 'valid') {
        const persistedState = await getNoteReviewState({ vaultPath, relativePath })
        if (requestGenerationRef.current !== generation) return
        setReviewState(persistedState)
      }
    } catch (cause) {
      if (requestGenerationRef.current === generation) setError(reviewAiErrorMessage(cause))
    } finally {
      if (requestGenerationRef.current === generation) setBusy(false)
    }
  }

  /** Abre uma revisao imediata; se a nota estiver pronta mas nao inscrita,
   *  ativa a inscricao automaticamente antes de iniciar a sessao. */
  async function startReviewNow() {
    if (!reviewState || reviewState.readiness !== 'ready') return
    // A sessao le o arquivo salvo: rascunho sujo precisa salvar antes.
    if (isDirty && onSaveFirst) {
      const saved = await onSaveFirst()
      if (!saved) return
    }
    const generation = stateGenerationRef.current
    let startInfo: ReviewStartInfo = {
      noteId: reviewState.noteId,
      preferredMode: reviewState.preferredMode,
      nextReviewAtUnixMs: reviewState.nextReviewAtUnixMs,
      firstReviewAtUnixMs: reviewState.firstReviewAtUnixMs,
    }
    if (!reviewState.enrolled) {
      setEnrollmentBusy(true)
      setError('')
      try {
        const state = await setNoteReviewEnrollment({ vaultPath, relativePath, enabled: true })
        if (stateGenerationRef.current !== generation) return
        setReviewState(state)
        startInfo = {
          noteId: state.noteId,
          preferredMode: state.preferredMode,
          nextReviewAtUnixMs: state.nextReviewAtUnixMs,
          firstReviewAtUnixMs: state.firstReviewAtUnixMs,
        }
      } catch (cause) {
        if (stateGenerationRef.current === generation) setError(reviewAiErrorMessage(cause))
        return
      } finally {
        if (stateGenerationRef.current === generation) setEnrollmentBusy(false)
      }
    }
    // Se a nota mudou durante a inscricao, nao inicia a sessao com dados antigos.
    if (stateGenerationRef.current !== generation) return
    onStartReview?.(startInfo)
  }

  async function performReset() {
    const generation = stateGenerationRef.current
    setResetBusy(true)
    setResetError('')
    try {
      const state = await resetNoteLearning({ vaultPath, relativePath })
      if (stateGenerationRef.current !== generation) return
      setReviewState(state)
      setResetConfirmOpen(false)
      triggerButtonRef.current?.focus()
    } catch (cause) {
      if (stateGenerationRef.current === generation) setResetError(reviewAiErrorMessage(cause))
    } finally {
      if (stateGenerationRef.current === generation) setResetBusy(false)
    }
  }

  function closeResetConfirm() {
    if (resetBusy) return
    setResetConfirmOpen(false)
    setResetError('')
    triggerButtonRef.current?.focus()
  }

  function openPersistedReport() {
    if (!reviewState?.report) return
    setAttempt({
      outcome: 'valid',
      sourceHash: reviewState.contentHash,
      report: reviewState.report,
    })
    setAssessmentIdentity(null)
    setError('')
    onReportOpenChange?.(true)
  }

  function closeReport() {
    requestGenerationRef.current += 1
    setAttempt(null)
    setAssessmentIdentity(null)
    setBusy(false)
    setError('')
    onReportOpenChange?.(false)
    // O menu sai do DOM enquanto o relatorio esta aberto; o trigger so
    // remonta apos o commit do React. Devolve o foco no proximo frame.
    window.setTimeout(() => triggerButtonRef.current?.focus(), 0)
  }

  function openResetConfirm() {
    setError('')
    setResetConfirmOpen(true)
  }

  function openDiscardConfirm() {
    setRecoveryError('')
    setDiscardConfirmOpen(true)
  }

  return {
    attempt,
    reviewState,
    stateLoading,
    enrollmentBusy,
    busy,
    error,
    resetConfirmOpen,
    resetBusy,
    resetError,
    unrecoverableDoc,
    recoveryBusy,
    recoveryError,
    discardConfirmOpen,
    suggestedProfiles,
    consentMissing,
    unavailableReason,
    triggerButtonRef,
    runAssessment,
    startReviewNow,
    performReset,
    closeResetConfirm,
    openResetConfirm,
    openPersistedReport,
    closeReport,
    performRecoveryExport,
    performRecoveryDiscard,
    closeDiscardConfirm,
    openDiscardConfirm,
  }
}