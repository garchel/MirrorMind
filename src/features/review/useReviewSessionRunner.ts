import { useEffect, useState } from 'react'
import type { ReviewAiProvider } from './ai'
import {
  completeReviewSession,
  continueReviewConversation,
  previewReviewSessionPlan,
  startReviewSession,
  type ReviewCompletionReport,
  type ReviewExchange,
  type ReviewMode,
  type ReviewPrompt,
  type ReviewSessionDraft,
  type ReviewSessionPlan,
} from './reviewSession'

// Dono do ciclo de vida da sessao de revisao: plano -> prompts -> trocas ->
// relatorio. A pagina mantem o estado de entrada/render (texto da resposta,
// sintese, modais, menus); aqui mora a ORDEM das transicoes — antes inline
// na pagina, sem dono e sem teste direto.

export type SessionDiagnostic = {
  message: string
  rawResponse: string | null
  validationErrors: string[]
}

export type UseReviewSessionRunnerOptions = {
  vaultPath: string
  relativePath: string
  mode: ReviewMode
  provider: ReviewAiProvider
  canUseProvider: boolean
  onCompleted: () => void
}

export function useReviewSessionRunner(options: UseReviewSessionRunnerOptions) {
  const { vaultPath, relativePath, mode, provider, canUseProvider, onCompleted } = options
  const [draft, setDraft] = useState<ReviewSessionDraft | null>(null)
  const [sessionProvider, setSessionProvider] = useState(provider)
  const [prompt, setPrompt] = useState<ReviewPrompt | null>(null)
  const [promptIndex, setPromptIndex] = useState(0)
  const [exchanges, setExchanges] = useState<ReviewExchange[]>([])
  const [busy, setBusy] = useState(false)
  const [diagnostic, setDiagnostic] = useState<SessionDiagnostic | null>(null)
  const [report, setReport] = useState<ReviewCompletionReport | null>(null)
  const [plan, setPlan] = useState<ReviewSessionPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)

  // Plano estimado na preparacao, recalculado quando o modo muda. Falha
  // silenciosa: a sessao continua iniciando normalmente.
  useEffect(() => {
    if (draft) return
    let cancelled = false
    setPlanError(null)
    previewReviewSessionPlan({ vaultPath, relativePath, mode })
      .then((nextPlan) => {
        if (!cancelled) setPlan(nextPlan)
      })
      .catch(() => {
        if (!cancelled) {
          setPlan(null)
          setPlanError('Não foi possível estimar a sessão.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [vaultPath, relativePath, mode, draft])

  async function begin(allowCalibrationContinuation = false) {
    if (!canUseProvider) return
    setBusy(true)
    setDiagnostic(null)
    try {
      const attempt = await startReviewSession({
        vaultPath,
        relativePath,
        provider,
        mode,
        allowCalibrationContinuation,
      })
      if (attempt.outcome === 'invalid') {
        setDiagnostic(attempt)
        return
      }
      setSessionProvider(provider)
      setDraft(attempt.draft)
      setPrompt(attempt.draft.prompts[0])
    } catch {
      setDiagnostic({ message: 'Não foi possível iniciar a revisão.', rawResponse: null, validationErrors: [] })
    } finally {
      setBusy(false)
    }
  }

  async function finish(nextExchanges: ReviewExchange[]) {
    if (!draft) return
    setBusy(true)
    setDiagnostic(null)
    try {
      const attempt = await completeReviewSession({ vaultPath, draft, provider: sessionProvider, exchanges: nextExchanges })
      if (attempt.outcome === 'invalid') {
        setDiagnostic(attempt)
        return
      }
      // Uma sessao inteira inconclusiva tambem encerra: nada foi persistido, a
      // nota permanece vencida e o relatorio oferece refazer (nao e contestacao).
      setReport(attempt.report)
      onCompleted()
    } catch {
      setDiagnostic({ message: 'Não foi possível gerar o relatório final.', rawResponse: null, validationErrors: [] })
    } finally {
      setBusy(false)
    }
  }

  async function requestConversationTurn(nextExchanges: ReviewExchange[]) {
    if (!draft) return
    setBusy(true)
    setDiagnostic(null)
    try {
      const attempt = await continueReviewConversation({ vaultPath, draft, provider: sessionProvider, exchanges: nextExchanges })
      if (attempt.outcome === 'invalid') {
        setDiagnostic(attempt)
      } else if (attempt.shouldFinish) {
        if (nextExchanges.length >= draft.minimumAnswers) await finish(nextExchanges)
        else setDiagnostic({ message: 'A conversa terminou antes do mínimo de respostas.', rawResponse: null, validationErrors: [] })
      } else {
        setPrompt(attempt.prompt)
        setPromptIndex(nextExchanges.length)
      }
    } catch {
      setDiagnostic({ message: 'Não foi possível continuar a conversa.', rawResponse: null, validationErrors: [] })
    } finally {
      setBusy(false)
    }
  }

  /** Registra a resposta ao prompt atual e avanca: proximo prompt (prova),
   * relatorio (fim) ou turno de conversa. Recebe o texto ja montado pela
   * pagina (letra da alternativa, "Nao sei" ou resposta curta). */
  async function answerCurrent(answerText: string, assistanceUsed: boolean) {
    if (!draft || !prompt || !answerText) return
    const nextExchanges = [
      ...exchanges,
      {
        promptId: prompt.id,
        prompt: prompt.text,
        answer: answerText,
        assistanceUsed,
        // O flag de esclarecimento acompanha a resposta: o backend valida
        // contra o prompt emitido e limita a no maximo dois por conversa.
        isClarification: prompt.isClarification,
      },
    ]
    setExchanges(nextExchanges)

    if (draft.mode === 'exam') {
      const nextIndex = promptIndex + 1
      if (nextIndex >= draft.prompts.length) await finish(nextExchanges)
      else {
        setPromptIndex(nextIndex)
        setPrompt(draft.prompts[nextIndex])
      }
      return
    }

    if (nextExchanges.length >= draft.maximumAnswers) {
      await finish(nextExchanges)
      return
    }

    await requestConversationTurn(nextExchanges)
  }

  /** Escreve no relatorio a partir de fluxos satelite (ex.: reclassificacao
   * ajusta a proxima data). O ciclo (begin/finish) continua dono do resto. */
  function updateReport(updater: (previous: ReviewCompletionReport | null) => ReviewCompletionReport | null) {
    setReport(updater)
  }

  /** Calibracao de notas longas / "Refazer revisao agora" de sessao
   * inconclusiva: zera o ciclo e recomeca com continuacao permitida. A
   * pagina zera em paralelo o que e dela (texto, selecao, ajuda). */
  async function continueCalibration() {
    if (busy) return
    setReport(null)
    setDraft(null)
    setPrompt(null)
    setPromptIndex(0)
    setExchanges([])
    setDiagnostic(null)
    await begin(true)
  }

  return {
    draft,
    sessionProvider,
    prompt,
    promptIndex,
    exchanges,
    busy,
    diagnostic,
    report,
    plan,
    planError,
    begin,
    answerCurrent,
    finish,
    requestConversationTurn,
    continueCalibration,
    updateReport,
    // Flag compartilhado com fluxos satelite (sintese bloqueia a forma pelo
    // mesmo busy); a sequencia das transicoes continua exclusiva do ciclo.
    setBusy,
  }
}

export type ReviewSessionRunner = ReturnType<typeof useReviewSessionRunner>
