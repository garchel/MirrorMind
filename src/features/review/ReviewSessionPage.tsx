import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, Clock, Info, Lightbulb, MessageCircle, RotateCw } from 'lucide-react'
import { setNoteUnitClassification } from './ai'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { renderWikiLinksAsMarkdown } from '../../lib/markdown'
import type { DueReviewItem } from './reviewQueue'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import { annotateReviewMarkdown, type ReviewReportUnit } from './reportMarkdown'
import { dominantUnitKind, unitNoun, unitPluralNoun } from './unitLabels'
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
import './review-session.css'

const REVIEW_REPORT_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    mark: ['dataGap'],
    span: ['className', 'title', 'dataScore', 'dataOutcome', 'dataEvaluated', 'dataInconclusive', 'dataUnitId'],
  },
}

/** Faixas de classificacao manual, identicas as do backend (outcome_for_score). */
const CLASSIFICATION_BANDS = [
  { min: 0, max: 39, outcome: 'forgotten', label: 'Esquecida', hint: '0–39' },
  { min: 40, max: 69, outcome: 'partial', label: 'Difícil', hint: '40–69' },
  { min: 70, max: 89, outcome: 'good', label: 'Boa', hint: '70–89' },
  { min: 90, max: 100, outcome: 'complete', label: 'Completa', hint: '90–100' },
] as const satisfies ReadonlyArray<{ min: number; max: number; outcome: ReviewReportUnit['outcome']; label: string; hint: string }>

type UnitClassification = { score: number; outcome: ReviewReportUnit['outcome'] }

type ReclassifyTarget = { id: string; ordinal: number; score: number; outcome: ReviewReportUnit['outcome'] }

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
  // Plano estimado da sessao exibido na preparacao (duracao, cobertura e
  // sessoes para cobrir a nota). Derivado no backend sem IA — a mesma selecao
  // de cobertura que a sessao real executara.
  const [plan, setPlan] = useState<ReviewSessionPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  // Dialogo proprio de abandono (em vez de window.confirm): alem de seguir o
  // padrao visual do app, ele e automatizavel nos testes E2E do desktop.
  const [abandonOpen, setAbandonOpen] = useState(false)
  // Correcoes manuais de classificacao de unidades aplicadas nesta sessao de
  // relatorio: sobrescrevem o snapshot exibido e foram persistidas no backend.
  const [unitOverrides, setUnitOverrides] = useState<Record<string, UnitClassification>>({})
  const [reclassifyMenu, setReclassifyMenu] = useState<{ unit: ReclassifyTarget; x: number; y: number } | null>(null)
  const [reclassifyBusy, setReclassifyBusy] = useState(false)
  const [reclassifyError, setReclassifyError] = useState<string | null>(null)
  const reclassifyRef = useRef<HTMLDivElement | null>(null)

  const canUseProvider = provider !== 'gemini' || geminiConsent

  // Fecha o seletor ao clicar fora dele ou apertar Escape.
  useEffect(() => {
    if (!reclassifyMenu) return
    const onPointerDown = (event: PointerEvent) => {
      if (reclassifyRef.current && !reclassifyRef.current.contains(event.target as Node)) {
        setReclassifyMenu(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReclassifyMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [reclassifyMenu])

  useEffect(() => {
    setSelectedOption(null)
    setDontKnow(false)
  }, [prompt?.id])

  // Carrega o plano estimado da sessao na preparacao e recalcula quando o modo
  // muda. Falha silenciosa: a sessao continua iniciando normalmente.
  useEffect(() => {
    if (draft) return
    let cancelled = false
    setPlanError(null)
    previewReviewSessionPlan({ vaultPath, relativePath: item.relativePath, mode })
      .then((nextPlan) => {
        if (!cancelled) setPlan(nextPlan)
      })
      .catch(() => {
        if (!cancelled) {
          setPlan(null)
          setPlanError('Nao foi possivel estimar a sessao.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [vaultPath, item.relativePath, mode, draft])

  useEffect(() => {
    if (!draft) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!report) event.preventDefault()
    }
    const guardRailNavigation = (event: MouseEvent) => {
      // Navegacao pela barra de ferramentas OU troca de Vault no rodape do
      // explorador: os dois sao caminhos nativos de saida da sessao e exigem
      // confirmacao antes de descartar as respostas.
      const target = event.target instanceof Element
        ? event.target.closest('.workspace-rail button, .vault-switch-button')
        : null
      if (!target) return
      if (busy) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (report) {
        onExit()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setAbandonOpen(true)
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
    // O flag de esclarecimento acompanha a resposta: o backend valida contra o
    // prompt emitido e limita a no maximo dois esclarecimentos por conversa.
    const nextExchanges = [...exchanges, { promptId: prompt.id, prompt: prompt.text, answer: answerText, assistanceUsed, isClarification: prompt.isClarification }]
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

  function requestAbandon() {
    if (busy) return
    if (!draft || report) {
      onExit()
      return
    }
    setAbandonOpen(true)
  }

  function confirmAbandon() {
    setAbandonOpen(false)
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

  // Unidades com a classificacao corrigida pelo usuario (persistida no
  // backend) substituem o snapshot do relatorio na exibicao.
  const correctedUnits = useMemo(() => {
    if (!report) return []
    return report.units.map((unit) => {
      const override = unitOverrides[unit.id]
      return override ? { ...unit, score: override.score, outcome: override.outcome } : unit
    })
  }, [report, unitOverrides])

  const correctedOverallScore = useMemo(() => {
    if (!report) return null
    const scored = correctedUnits.filter((unit) => unit.evaluated && !unit.inconclusive)
    if (scored.length === 0) return null
    return Math.round(scored.reduce((sum, unit) => sum + unit.score, 0) / scored.length)
  }, [correctedUnits, report])

  const annotatedReportMarkdown = useMemo(
    () => annotateReviewMarkdown(report?.markdown ?? '', report?.gaps ?? [], correctedUnits),
    [correctedUnits, report],
  )

  function handleBadgeClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = (event.target as Element | null)?.closest('.review-unit-score[data-unit-id]')
    if (!target) return
    const unitId = target.getAttribute('data-unit-id')
    const unit = report?.units.find((candidate) => candidate.id === unitId)
    if (!unit || !unit.evaluated || !unit.id || unit.ordinal === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const rect = target.getBoundingClientRect()
    setReclassifyMenu({ unit: { id: unit.id, ordinal: unit.ordinal, score: unit.score, outcome: unit.outcome }, x: rect.left, y: rect.bottom + 6 })
  }

  async function applyClassification(unit: ReclassifyTarget, band: typeof CLASSIFICATION_BANDS[number]) {
    if (reclassifyBusy) return
    setReclassifyBusy(true)
    setReclassifyError(null)
    try {
      const state = await setNoteUnitClassification({
        vaultPath,
        relativePath: item.relativePath,
        unitId: unit.id,
        score: band.max,
      })
      setUnitOverrides((previous) => ({ ...previous, [unit.id]: { score: band.max, outcome: band.outcome } }))
      // A correcao reagendou a nota no backend; o relatorio passa a exibir a
      // nova data em vez da do snapshot original.
      setReport((previous) => previous ? { ...previous, nextReviewAtUnixMs: state.nextReviewAtUnixMs } : previous)
      setReclassifyMenu(null)
    } catch {
      setReclassifyError('Não foi possível corrigir a classificação. Tente novamente.')
    } finally {
      setReclassifyBusy(false)
    }
  }

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
              <div className="review-score" aria-label={`Pontuação ${correctedOverallScore ?? report.overallScore} de 100`}>
                <strong>{correctedOverallScore ?? report.overallScore}</strong><span>/100</span>
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
              (() => {
                const evaluatedCount = report.units.filter((unit) => unit.evaluated).length
                const remainingCount = report.units.length - evaluatedCount
                const kinds = report.units.map((unit) => unit.kind)
                const noun = unitNoun(dominantUnitKind(kinds))
                const plural = unitPluralNoun(dominantUnitKind(kinds))
                return (
                  <>
                    <p className="review-coverage-note">
                      Esta sessão cobriu <strong>{evaluatedCount} de {report.units.length}</strong> {plural} da nota. Os {plural} restantes serão priorizados na próxima revisão — ou você pode continuar agora.
                    </p>
                    <button
                      type="button"
                      className="primary-button review-calibration-continue"
                      onClick={() => void continueCalibration()}
                      disabled={busy}
                    >
                      <RotateCw size={15} aria-hidden="true" />
                      Revisar mais {remainingCount} {remainingCount === 1 ? noun : plural} agora
                    </button>
                  </>
                )
              })()
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
              <div className="review-note-markdown" onClick={handleBadgeClick}>
                <ReviewRichMarkdown content={annotatedReportMarkdown} />
              </div>
            </section>
          ) : null}
        </div>
        {reclassifyMenu ? (
          <div
            ref={reclassifyRef}
            className="review-reclassify-menu"
            role="menu"
            aria-label={`Corrigir classificação do parágrafo ${reclassifyMenu.unit.ordinal + 1}`}
            style={{ left: Math.min(reclassifyMenu.x, window.innerWidth - 240), top: reclassifyMenu.y }}
          >
            <p className="review-reclassify-title">Como você avalia este parágrafo agora?</p>
            {reclassifyError ? <p className="review-reclassify-error" role="alert">{reclassifyError}</p> : null}
            <div className="review-reclassify-options">
              {CLASSIFICATION_BANDS.map((band) => (
                <button
                  key={band.outcome}
                  type="button"
                  className={`review-reclassify-option is-${band.outcome}`}
                  role="menuitem"
                  onClick={() => void applyClassification(reclassifyMenu.unit, band)}
                  disabled={reclassifyBusy}
                >
                  <span className="review-reclassify-range">{band.hint}</span>
                  <span className="review-reclassify-label">{band.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
          {plan ? (
            <p className="review-setup-plan" role="status">
              <Clock size={14} aria-hidden="true" />
              <span>
                ≈ {plan.estimatedMinutes} min · cobre {plan.targetUnitCount} de {plan.totalUnitCount} {plan.targetUnitCount === 1 ? 'unidade' : 'unidades'} ({Math.round(plan.coverageFraction * 100)}%) ·
                {' '}{plan.expectedSessionsToCover === 1 ? 'uma sessão cobre' : `cerca de ${plan.expectedSessionsToCover} sessões para cobrir`} a nota
              </span>
            </p>
          ) : planError ? (
            <p className="review-setup-plan is-error">{planError}</p>
          ) : null}
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
      <header className="review-session-topbar"><button type="button" className="secondary-button" onClick={requestAbandon} disabled={busy}><ArrowLeft size={15} /> {busy ? 'Finalizando…' : 'Abandonar'}</button><span>{draft.mode === 'exam' ? `Questão ${promptIndex + 1} de ${draft.prompts.length}` : `Turno ${exchanges.length + 1}`}</span></header>
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
      {abandonOpen ? (
        <div className="review-abandon-backdrop" role="presentation">
          <section className="review-abandon-dialog" role="dialog" aria-modal="true" aria-labelledby="review-abandon-title">
            <p className="card-kicker">Abandonar sessão</p>
            <h3 id="review-abandon-title">Abandonar esta revisão?</h3>
            <p>As respostas desta sessão serão descartadas e nenhuma pontuação será registrada.</p>
            <div className="review-abandon-actions">
              <button type="button" className="secondary-button" onClick={() => setAbandonOpen(false)} autoFocus>Cancelar</button>
              <button type="button" className="review-abandon-confirm" aria-label="Confirmar abandono da sessao" onClick={confirmAbandon}>Abandonar</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}

function DiagnosticPanel({ diagnostic, retry, retryLabel, busy }: { diagnostic: Diagnostic; retry: () => void | Promise<void>; retryLabel: string; busy: boolean }) {
  return <section className="review-diagnostic" role="alert"><strong>{diagnostic.message}</strong>{diagnostic.validationErrors.length > 0 ? <ul>{diagnostic.validationErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}{diagnostic.rawResponse !== null ? <label>Resposta bruta da IA<textarea readOnly value={diagnostic.rawResponse} rows={7} /></label> : null}<button type="button" className="secondary-button" onClick={() => void retry()} disabled={busy}><RotateCw size={15} /> {retryLabel}</button></section>
}