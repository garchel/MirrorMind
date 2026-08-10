import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, Info, Lightbulb, MessageCircle, RotateCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { renderWikiLinksAsMarkdown } from '../../lib/markdown'
import type { DueReviewItem } from './reviewQueue'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import { annotateReviewMarkdown } from './reportMarkdown'
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

const REVIEW_REPORT_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    mark: ['dataGap'],
    span: ['className', 'title', 'dataScore', 'dataOutcome', 'dataEvaluated', 'dataInconclusive'],
  },
}

/**
 * Renderiza Markdown + LaTeX (KaTeX) com a mesma base do relatorio da nota.
 * Em modo `inline` os paragrafos viram <span> para poderem viver dentro de
 * um titulo (h2) sem quebrar o HTML — usado na pergunta do modo prova.
 */
function ReviewRichMarkdown({ content, inline = false }: { content: string; inline?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, REVIEW_REPORT_SANITIZE_SCHEMA], rehypeKatex]}
      components={{
        a: ({ href, children }) => (
          href?.startsWith('https://mirrormind.local/')
            ? <span>{children}</span>
            : <a href={href}>{children}</a>
        ),
        ...(inline ? { p: ({ children }: { children?: ReactNode }) => <span>{children}</span> } : null),
      }}
    >
      {renderWikiLinksAsMarkdown(content)}
    </ReactMarkdown>
  )
}

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
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  // Opcao explicita `Nao sei` da prova objetiva: o usuario admite nao saber em
  // vez de chutar. Nunca acerta (erro claro de esquecimento) e o resumo a
  // diferencia de um chute errado.
  const [dontKnow, setDontKnow] = useState(false)
  const [exchanges, setExchanges] = useState<ReviewExchange[]>([])
  const [assistanceVisible, setAssistanceVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [report, setReport] = useState<ReviewCompletionReport | null>(null)

  const canUseProvider = provider !== 'gemini' || geminiConsent

  useEffect(() => {
    setSelectedOption(null)
    setDontKnow(false)
  }, [prompt?.id])

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

  async function begin(allowCalibrationContinuation = false) {
    if (!canUseProvider) return
    setBusy(true)
    setDiagnostic(null)
    try {
      const attempt = await startReviewSession({
        vaultPath,
        relativePath: item.relativePath,
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
  async function submitAnswer() {
    if (!draft || !prompt) return
    // A prova mista tem dois tipos de pergunta: multipla escolha (envia a
    // letra e o texto da alternativa escolhida) e resposta curta (envia o
    // texto digitado). `Nao sei` vale para ambos e nunca acerta.
    const answerText = draft.mode === 'exam'
      ? dontKnow
        ? 'Não sei'
        : prompt.kind === 'shortAnswer'
          ? answer.trim()
          : (selectedOption === null || selectedOption >= prompt.options.length
              ? ''
              : `${String.fromCharCode(65 + selectedOption)}) ${prompt.options[selectedOption]}`)
      : answer.trim()
    if (!answerText) return
    // A dica/contexto estava visível no momento da resposta: a recuperação foi
    // assistida e o agendamento usa evidência mais fraca para esta pergunta.
    const assistanceUsed = assistanceVisible
    const nextExchanges = [...exchanges, { promptId: prompt.id, prompt: prompt.text, answer: answerText, assistanceUsed }]
    setExchanges(nextExchanges)
    setAnswer('')
    setSelectedOption(null)
    setDontKnow(false)
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

  // Calibracao inicial de notas longas: apos concluir uma etapa com unidades
  // ainda nao observadas, o usuario pode continuar imediatamente (a proxima
  // etapa tambem voltaria no dia seguinte pela fila). Tambem e o handler do
  // "Refazer revisao agora" de uma sessao inteira inconclusiva: nao confundir
  // com contestacao, e `begin(true)` (allowCalibrationContinuation) e seguro
  // tanto para uma nota vencida (que continua vencida apos a sessao
  // inconclusiva) quanto para uma nota em calibracao agendada.
  async function continueCalibration() {
    if (busy) return
    setReport(null)
    setDraft(null)
    setPrompt(null)
    setPromptIndex(0)
    setExchanges([])
    setAnswer('')
    setSelectedOption(null)
    setAssistanceVisible(false)
    setDiagnostic(null)
    await begin(true)
  }

  const annotatedReportMarkdown = useMemo(
    () => annotateReviewMarkdown(report?.markdown ?? '', report?.gaps ?? [], report?.units ?? []),
    [report],
  )

  if (report) {
    const hasUnits = report.units.length > 0
    return (
      <section className="workspace-page review-session-page review-report-page" aria-labelledby="review-result-title">
        <header className="review-session-topbar">
          <button type="button" className="secondary-button" onClick={onExit}><ArrowLeft size={15} /> Voltar à fila</button>
          <span>{report.inconclusive ? 'Relatório inconclusivo' : 'Relatório concluído'}</span>
        </header>
        <header className="review-report-header">
          <div className="review-report-header-main">
            <p className="review-session-kicker">{report.inconclusive ? 'Sessão inconclusiva' : 'Resultado'}</p>
            <h2 id="review-result-title">{item.title}</h2>
            <p className="review-report-summary">{report.summary}</p>
          </div>
          {!report.inconclusive ? (
            <div className="review-report-header-side">
              <div className="review-score" aria-label={`Pontuação ${report.overallScore} de 100`}>
                <strong>{report.overallScore}</strong><span>/100</span>
              </div>
              {hasUnits ? (
                <ul className="review-unit-legend" aria-label="Faixas de pontuação por parágrafo">
                  <li className="is-forgotten">0–39 Esquecida</li>
                  <li className="is-partial">40–69 Difícil</li>
                  <li className="is-good">70–89 Boa</li>
                  <li className="is-complete">90–100 Completa</li>
                </ul>
              ) : null}
            </div>
          ) : null}
        </header>
        {report.inconclusive ? (
          <div className="review-report-inconclusive" role="alert">
            <p><strong>A cobertura válida desta sessão ficou abaixo do mínimo.</strong> Nenhuma avaliação foi persistida, sua memória não foi alterada e a nota continua vencida — refazer esta revisão não constitui contestação de um resultado.</p>
            <button type="button" className="primary-button" onClick={() => void continueCalibration()} disabled={busy}>
              <RotateCw size={15} aria-hidden="true" />
              Refazer revisão agora
            </button>
          </div>
        ) : null}
        <div className={`review-report-layout${hasUnits ? ' has-note' : ''}`}>
          <aside className="review-report-side" aria-label="Resumo da revisão" tabIndex={0}>
            {report.units.some((unit) => !unit.evaluated) ? (
              <>
                <p className="review-coverage-note">
                  Esta sessão cobriu <strong>{report.units.filter((unit) => unit.evaluated).length} de {report.units.length}</strong> parágrafos da nota. Os parágrafos restantes serão priorizados na próxima revisão — ou você pode continuar agora.
                </p>
                <button
                  type="button"
                  className="primary-button review-calibration-continue"
                  onClick={() => void continueCalibration()}
                  disabled={busy}
                >
                  <RotateCw size={15} aria-hidden="true" />
                  Revisar mais {report.units.filter((unit) => !unit.evaluated).length} {report.units.filter((unit) => !unit.evaluated).length === 1 ? 'parágrafo' : 'parágrafos'} agora
                </button>
              </>
            ) : null}
            {report.gaps.length > 0 ? (
              <section className="review-gaps" aria-labelledby="review-gaps-title">
                <h3 id="review-gaps-title">Pontos para revisar</h3>
                <ul>{report.gaps.map((gap, index) => (
                  <li key={`${gap.sourceStartUtf16}-${index}`} className={`is-${gap.classification}`}>
                    <span className="review-gap-label">{gap.classification === 'forgotten' ? 'Esquecido' : 'Confundido'}</span>
                    <div className="review-gap-quote"><ReviewRichMarkdown content={gap.sourceQuote} /></div>
                  </li>
                ))}</ul>
              </section>
            ) : <p className="review-perfect"><CheckCircle2 size={18} /> Nenhuma lacuna foi identificada na nota.</p>}
            {report.nextReviewAtUnixMs !== null ? (
              <p className="review-next-date">Próxima revisão: <strong>{nextReviewLabel(report.nextReviewAtUnixMs)}</strong></p>
            ) : null}
            {!report.inconclusive && (report.evidence === 'recognition' || report.evidence === 'assistedRecognition') ? (
              <p className="review-evidence-note" title="A nota exibida reflete a cobertura da nota; o agendamento considera a força da evidência.">
                <Info size={15} aria-hidden="true" />
                Esta foi uma prova objetiva: a nota reflete o acerto, mas reconhecer a alternativa correta é uma evidência mais fraca de recuperação espontânea — o agendamento (próxima revisão) usa um peso menor que uma resposta aberta equivalente.
                {report.evidence === 'assistedRecognition' ? ' Como pelo menos uma resposta foi dada com a dica exibida, o peso é ainda menor para os trechos assistidos.' : ''}
              </p>
            ) : null}
            {!report.inconclusive && report.evidence === 'assistedConversation' ? (
              <p className="review-evidence-note" title="A nota exibida reflete a cobertura da nota; o agendamento considera a força da evidência.">
                <Info size={15} aria-hidden="true" />
                Esta conversa recorreu ao contexto revelado: as respostas abertas vieram com ajuda e o agendamento (próxima revisão) usa um peso menor que uma conversa sem contexto.
              </p>
            ) : null}
          </aside>
          {hasUnits ? (
            <section className="review-report-note review-note-report" aria-labelledby="review-note-title" tabIndex={0}>
              <div className="review-note-report-heading">
                <h3 id="review-note-title">Nota avaliada</h3>
              </div>
              <div className="review-note-markdown">
                <ReviewRichMarkdown content={annotatedReportMarkdown} />
              </div>
            </section>
          ) : null}
        </div>
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
        <p className="review-session-kicker">{draft.mode === 'exam' ? 'Modo prova' : 'Modo conversa'}
          {draft.mode === 'conversation' && prompt?.isClarification ? (
            <span className="review-clarification-tag" title="Pergunta neutra para desambiguar sua resposta anterior, sem revelar o conteúdo esperado">Esclarecimento</span>
          ) : null}
        </p>
        <h2 id="review-question-title"><ReviewRichMarkdown content={prompt?.text ?? ''} inline /></h2>
        {prompt && prompt.options.length > 0 ? (
          <fieldset className="review-options" disabled={busy || diagnostic !== null}>
            <legend>Escolha a alternativa correta</legend>
            {prompt.options.map((option, index) => {
              const letter = String.fromCharCode(65 + index)
              return (
                <label key={index} className={selectedOption === index ? 'is-selected' : ''}>
                  <input type="radio" name="review-option" value={index} checked={selectedOption === index} onChange={() => { setSelectedOption(index); setDontKnow(false) }} />
                  <span className="review-option-letter" aria-hidden="true">{letter}</span>
                  <div className="review-option-text"><ReviewRichMarkdown content={option} /></div>
                </label>
              )
            })}
          </fieldset>
        ) : (
          <>
            <label htmlFor="review-answer">{prompt?.kind === 'shortAnswer' ? 'Escreva sua resposta' : 'Sua resposta'}</label>
            <textarea id="review-answer" value={answer} onChange={(event) => { setAnswer(event.target.value); setDontKnow(false) }} rows={8} autoFocus disabled={busy || diagnostic !== null} />
          </>
        )}
        {draft.mode === 'exam' ? (
          <button
            type="button"
            className={`review-option-dont-know${dontKnow ? ' is-selected' : ''}`}
            onClick={() => { setDontKnow((value) => !value); if (!dontKnow) setSelectedOption(null) }}
            disabled={busy || diagnostic !== null}
          >
            <span className="review-option-letter" aria-hidden="true">?</span>
            <span className="review-option-text">Não sei</span>
          </button>
        ) : null}
        <div className="review-answer-actions">
          <button type="button" className="secondary-button" onClick={() => setAssistanceVisible((visible) => !visible)}><Lightbulb size={15} /> {assistanceVisible ? 'Ocultar ajuda' : draft.mode === 'exam' ? 'Mostrar dica' : 'Mostrar contexto'}</button>
          <button type="button" className="primary-button" onClick={() => void submitAnswer()} disabled={busy || diagnostic !== null || (draft.mode === 'exam' ? (prompt?.kind === 'shortAnswer' ? (!answer.trim() && !dontKnow) : (selectedOption === null && !dontKnow)) : !answer.trim())}>{busy ? 'Processando…' : lastExamPrompt ? 'Concluir e avaliar' : 'Salvar resposta'}</button>
        </div>
        {assistanceVisible ? <aside className="review-assistance"><MessageCircle size={16} /><div className="review-assistance-text"><ReviewRichMarkdown content={prompt?.assistance ?? ''} /></div></aside> : null}
        {diagnostic ? <DiagnosticPanel diagnostic={diagnostic} retry={() => draft.mode === 'conversation' && exchanges.length < draft.maximumAnswers ? requestConversationTurn(exchanges) : finish(exchanges)} retryLabel={draft.mode === 'conversation' && exchanges.length < draft.maximumAnswers ? 'Tentar continuar conversa' : 'Gerar novo relatorio'} busy={busy} /> : null}
      </div>
    </section>
  )
}

function DiagnosticPanel({ diagnostic, retry, retryLabel, busy }: { diagnostic: Diagnostic; retry: () => void | Promise<void>; retryLabel: string; busy: boolean }) {
  return <section className="review-diagnostic" role="alert"><strong>{diagnostic.message}</strong>{diagnostic.validationErrors.length > 0 ? <ul>{diagnostic.validationErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}{diagnostic.rawResponse !== null ? <label>Resposta bruta da IA<textarea readOnly value={diagnostic.rawResponse} rows={7} /></label> : null}<button type="button" className="secondary-button" onClick={() => void retry()} disabled={busy}><RotateCw size={15} /> {retryLabel}</button></section>
}