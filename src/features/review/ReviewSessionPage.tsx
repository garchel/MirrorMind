import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Lightbulb, MessageCircle, RotateCw } from 'lucide-react'
import type { DueReviewItem } from './reviewQueue'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import {
  completeReviewSession,
  continueReviewConversation,
  startReviewSession,
  type ReviewCompletionReport,
  type ReviewExchange,
  type ReviewMode,
  type ReviewPrompt,
  type ReviewSessionDraft,
} from './reviewSession'
import './review-session.css'

type Props = {
  vaultPath: string
  item: DueReviewItem
  onExit: () => void
  onCompleted: () => void
}

type Diagnostic = { message: string; rawResponse: string | null; validationErrors: string[] }

function nextReviewLabel(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(timestamp))
}

export function ReviewSessionPage({ vaultPath, item, onExit, onCompleted }: Props) {
  const { provider, geminiConsent } = useReviewAiSettings()
  const [mode, setMode] = useState<ReviewMode>(item.preferredMode)
  const [draft, setDraft] = useState<ReviewSessionDraft | null>(null)
  const [sessionProvider, setSessionProvider] = useState(provider)
  const [prompt, setPrompt] = useState<ReviewPrompt | null>(null)
  const [promptIndex, setPromptIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [exchanges, setExchanges] = useState<ReviewExchange[]>([])
  const [assistanceVisible, setAssistanceVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [report, setReport] = useState<ReviewCompletionReport | null>(null)

  const canUseProvider = provider !== 'gemini' || geminiConsent

  useEffect(() => {
    if (!draft) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!report) event.preventDefault()
    }
    const guardRailNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('.workspace-rail button') : null
      if (!target) return
      if (busy) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (report || window.confirm('Abandonar esta revisão? As respostas desta sessão serão descartadas.')) {
        onExit()
      } else {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', guardRailNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', guardRailNavigation, true)
    }
  }, [busy, draft, onExit, report])

  async function begin() {
    if (!canUseProvider) return
    setBusy(true)
    setDiagnostic(null)
    try {
      const attempt = await startReviewSession({ vaultPath, relativePath: item.relativePath, provider, mode })
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
  async function submitAnswer() {
    if (!draft || !prompt || !answer.trim()) return
    const nextExchanges = [...exchanges, { promptId: prompt.id, prompt: prompt.text, answer: answer.trim() }]
    setExchanges(nextExchanges)
    setAnswer('')
    setAssistanceVisible(false)

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

  function exit() {
    if (busy) return
    if (draft && !report && !window.confirm('Abandonar esta revisão? As respostas desta sessão serão descartadas.')) return
    onExit()
  }

  if (report) {
    return (
      <section className="workspace-page review-session-page" aria-labelledby="review-result-title">
        <header className="review-session-topbar">
          <button type="button" className="secondary-button" onClick={onExit}><ArrowLeft size={15} /> Voltar à fila</button>
          <span>Relatório concluído</span>
        </header>
        <div className="review-result">
          <div className="review-score" aria-label={`Pontuação ${report.overallScore} de 100`}>
            <strong>{report.overallScore}</strong><span>/100</span>
          </div>
          <div><p className="review-session-kicker">Resultado</p><h2 id="review-result-title">{item.title}</h2><p>{report.summary}</p></div>
        </div>
        {report.gaps.length > 0 ? (
          <section className="review-gaps" aria-labelledby="review-gaps-title">
            <h3 id="review-gaps-title">Pontos para revisar</h3>
            <ul>{report.gaps.map((gap, index) => <li key={`${gap.sourceStartUtf16}-${index}`} className={`is-${gap.classification}`}><span>{gap.classification === 'forgotten' ? 'Esquecido' : 'Confundido'}</span><mark>{gap.sourceQuote}</mark></li>)}</ul>
          </section>
        ) : <p className="review-perfect"><CheckCircle2 size={18} /> Nenhuma lacuna foi identificada na nota.</p>}
        <p className="review-next-date">Próxima revisão: <strong>{nextReviewLabel(report.nextReviewAtUnixMs)}</strong></p>
      </section>
    )
  }

  if (!draft) {
    return (
      <section className="workspace-page review-session-page" aria-labelledby="review-setup-title">
        <header className="review-session-topbar"><button type="button" className="secondary-button" onClick={onExit}><ArrowLeft size={15} /> Voltar à fila</button><span>{item.relativePath}</span></header>
        <div className="review-setup">
          <p className="review-session-kicker">Preparar sessão</p>
          <h2 id="review-setup-title">{item.title}</h2>
          <p>O conteúdo da nota ficará oculto. A avaliação usará somente o Markdown salvo como fonte.</p>
          <fieldset><legend>Como você quer revisar?</legend>
            <label className={mode === 'exam' ? 'is-selected' : ''}><input type="radio" name="mode" checked={mode === 'exam'} onChange={() => setMode('exam')} /><strong>Modo prova</strong><span>Perguntas independentes e correção ao final.</span></label>
            <label className={mode === 'conversation' ? 'is-selected' : ''}><input type="radio" name="mode" checked={mode === 'conversation'} onChange={() => setMode('conversation')} /><strong>Modo conversa</strong><span>A IA explora seu entendimento progressivamente.</span></label>
          </fieldset>
          {!canUseProvider ? <p role="alert" className="review-consent-warning">Autorize o envio ao Gemini nas configurações antes de iniciar.</p> : null}
          <button type="button" className="primary-button review-start" onClick={() => void begin()} disabled={busy || !canUseProvider}>{busy ? 'Preparando…' : 'Iniciar revisao'}</button>
          {diagnostic ? <DiagnosticPanel diagnostic={diagnostic} retry={begin} retryLabel="Gerar novas perguntas" busy={busy} /> : null}
        </div>
      </section>
    )
  }

  const lastExamPrompt = draft.mode === 'exam' && promptIndex === draft.prompts.length - 1
  return (
    <section className="workspace-page review-session-page" aria-labelledby="review-question-title">
      <header className="review-session-topbar"><button type="button" className="secondary-button" onClick={exit} disabled={busy}><ArrowLeft size={15} /> {busy ? 'Finalizando…' : 'Abandonar'}</button><span>{draft.mode === 'exam' ? `Questão ${promptIndex + 1} de ${draft.prompts.length}` : `Turno ${exchanges.length + 1}`}</span></header>
      <div className="review-question">
        <p className="review-session-kicker">{draft.mode === 'exam' ? 'Modo prova' : 'Modo conversa'}</p>
        <h2 id="review-question-title">{prompt?.text}</h2>
        <label htmlFor="review-answer">Sua resposta</label>
        <textarea id="review-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={8} autoFocus disabled={busy || diagnostic !== null} />
        <div className="review-answer-actions">
          <button type="button" className="secondary-button" onClick={() => setAssistanceVisible((visible) => !visible)}><Lightbulb size={15} /> {assistanceVisible ? 'Ocultar ajuda' : draft.mode === 'exam' ? 'Mostrar dica' : 'Mostrar contexto'}</button>
          <button type="button" className="primary-button" onClick={() => void submitAnswer()} disabled={busy || diagnostic !== null || !answer.trim()}>{busy ? 'Processando…' : lastExamPrompt ? 'Concluir e avaliar' : 'Salvar resposta'}</button>
        </div>
        {assistanceVisible ? <aside className="review-assistance"><MessageCircle size={16} /><p>{prompt?.assistance}</p></aside> : null}
        {diagnostic ? <DiagnosticPanel diagnostic={diagnostic} retry={() => draft.mode === 'conversation' && exchanges.length < draft.maximumAnswers ? requestConversationTurn(exchanges) : finish(exchanges)} retryLabel={draft.mode === 'conversation' && exchanges.length < draft.maximumAnswers ? 'Tentar continuar conversa' : 'Gerar novo relatorio'} busy={busy} /> : null}
      </div>
    </section>
  )
}

function DiagnosticPanel({ diagnostic, retry, retryLabel, busy }: { diagnostic: Diagnostic; retry: () => void | Promise<void>; retryLabel: string; busy: boolean }) {
  return <section className="review-diagnostic" role="alert"><strong>{diagnostic.message}</strong>{diagnostic.validationErrors.length > 0 ? <ul>{diagnostic.validationErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}{diagnostic.rawResponse !== null ? <label>Resposta bruta da IA<textarea readOnly value={diagnostic.rawResponse} rows={7} /></label> : null}<button type="button" className="secondary-button" onClick={() => void retry()} disabled={busy}><RotateCw size={15} /> {retryLabel}</button></section>
}