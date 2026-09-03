import { AlertTriangle, CalendarCheck2, ChartColumnBig, Check, Download, NotebookPen, RotateCcw, Search, X } from 'lucide-react'
import type { NoteReviewState } from './ai'
import { useNoteReadiness, type ReviewStartInfo } from './useNoteReadiness'
import { NoteReadinessReport } from './NoteReadinessReport'
import { Modal } from '../../components/Modal'
import './review-ai.css'

export type { ReviewStartInfo } from './useNoteReadiness'

type NoteReadinessControlProps = {
  vaultPath: string
  relativePath: string
  sourceRevision: string
  isDirty: boolean
  disabled?: boolean
  /** Tags presentes no Markdown da nota aberta (para o onboarding de perfil). */
  noteTags?: string[]
  /** Aplica uma tag ao frontmatter da nota (onboarding de perfil de revisao). */
  onApplyTag?: (tag: string) => void
  /** Notifica o estado de prontidao mais recente (para indicadores externos). */
  onStatusChange?: (readiness: NoteReviewState['readiness'] | null) => void
  /** Informacoes necessarias para abrir uma sessao de revisao da nota. */
  onStartReview?: (info: ReviewStartInfo | null) => void
  /** Quando true, o relatorio e renderizado no lugar do menu do popover. */
  reportOpen?: boolean
  /** Notifica o pai quando o relatorio abre/fecha (para o pai ocultar o
   *  cabecalho e a politica enquanto o relatorio substitui o menu). */
  onReportOpenChange?: (open: boolean) => void
  /** Salva o rascunho ativo e devolve `true` quando gravou. Sem isso, notas
   *  com alteracoes nao salvas ficam com os botoes bloqueados; com o handler,
   *  avaliar/revisar salva primeiro e prossegue (notas novas nao precisam de
   *  Ctrl+S manual antes de avaliar). */
  onSaveFirst?: () => Promise<boolean>
}

const EMPTY_TAGS: string[] = []

/** Rotulos do badge unificado de status ("Status: ..."). */
const STATUS_BADGE_LABELS = {
  unassessed: 'Não avaliada',
  ready: 'Nota validada',
  ambiguous: 'Ambígua',
  insufficient: 'Insuficiente',
  modified: 'Alterada',
} as const

export function NoteReadinessControl({
  vaultPath,
  relativePath,
  sourceRevision,
  isDirty,
  disabled = false,
  noteTags = EMPTY_TAGS,
  onApplyTag,
  onStatusChange,
  onStartReview,
  reportOpen = false,
  onReportOpenChange,
  onSaveFirst,
}: NoteReadinessControlProps) {
  // Ciclo de vida da prontidao com dono proprio; aqui ficam so props de
  // entrada e render (menu + relatorio + dialogs).
  const {
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
  } = useNoteReadiness({
    vaultPath,
    relativePath,
    sourceRevision,
    isDirty,
    noteTags,
    onApplyTag,
    onStatusChange,
    onStartReview,
    onReportOpenChange,
    onSaveFirst,
  })

  return reportOpen && attempt ? (
    <NoteReadinessReport
      attempt={attempt}
      isStaleReport={reviewState?.readiness === 'modified'}
      error={error}
      busy={busy}
      onClose={closeReport}
      onRetry={() => void runAssessment(true)}
    />
  ) : (
    <>
      {/* Cartao de status (sempre presente no menu): estado da nota + proxima
          revisao, agrupados para o layout em bento do popover. */}
      <div className="note-readiness-status-card">
        {!stateLoading ? (
          reviewState ? (
            <span className={`note-readiness-state is-${reviewState.readiness}`} role="status">
              {reviewState.readiness === 'ready' ? (
                <span className="note-readiness-state-check" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
              ) : null}
              Status: {STATUS_BADGE_LABELS[reviewState.readiness]}
            </span>
          ) : (
            <span className="note-readiness-state is-unassessed" role="status">
              Status: {isDirty ? 'Alterações não salvas' : STATUS_BADGE_LABELS.unassessed}
            </span>
          )
        ) : null}
        {isDirty && reviewState ? (
          <span
            className="note-review-dirty-hint"
            role="status"
            title="A avaliação se refere à versão salva da nota; salve para revalidar as alterações."
          >
            Alterações não salvas
          </span>
        ) : null}
        {reviewState?.nextReviewAtUnixMs ? (
          <span className="note-review-next-date">
            Próxima revisão: {new Date(reviewState.nextReviewAtUnixMs).toLocaleDateString('pt-BR')}
          </span>
        ) : null}
        {reviewState?.deadlineRetentionAtRisk ? (
          <span className="note-review-risk-badge" role="status" title="Mesmo antecipando revisões, a meta de retenção na data da prova não é atingida.">
            Meta de retenção em risco
          </span>
        ) : null}
        {reviewState?.recoveredFromBackup ? (
          <span className="note-recovery-badge" role="status" title="Arquivo de aprendizado restaurado de um backup (possivelmente de versão anterior).">
            Aprendizado recuperado de backup
          </span>
        ) : null}
      </div>
      {reviewState?.report ? (
        <button
          type="button"
          className="secondary-button note-readiness-report-trigger"
          onClick={openPersistedReport}
          disabled={disabled || isDirty || busy}
          aria-label="Abrir último relatório de prontidão"
        >
          <span className="note-review-icon-stack" aria-hidden="true">
            <ChartColumnBig size={15} strokeWidth={1.5} />
            <Search size={9} strokeWidth={2.25} className="note-review-icon-corner" />
          </span>
          <span>Ver relatório</span>
        </button>
      ) : null}
      <button
        type="button"
        className="note-review-start-trigger"
        onClick={() => void startReviewNow()}
        disabled={disabled || busy || enrollmentBusy || (isDirty && !onSaveFirst) || !reviewState || reviewState.readiness !== 'ready'}
        title={isDirty && !onSaveFirst
          ? 'Salve a nota antes de iniciar a revisão.'
          : !reviewState || reviewState.readiness !== 'ready'
            ? 'Avalie a nota para liberar a revisão.'
            : 'Iniciar a revisão desta nota agora'}
        aria-label="Iniciar revisão agora"
      >
        <CalendarCheck2 size={15} strokeWidth={1.5} aria-hidden="true" />
        <span>{enrollmentBusy ? 'Preparando…' : 'Fazer revisão agora'}</span>
      </button>
      {suggestedProfiles.length > 0 ? (
        <div className="note-profile-onboarding" role="region" aria-label="Adotar perfil de revisão">
          <div className="note-profile-onboarding-heading">
            <strong>Adotar perfil de revisão?</strong>
            <small>Nota pronta sem tag de revisão. Escolha um perfil para ativar o agendamento.</small>
          </div>
          <div className="note-profile-onboarding-options">
            {suggestedProfiles.map((tag) => {
              const label = tag === 'revisao/prova' ? 'Intensiva' : tag === 'revisao/manter' ? 'Equilibrada' : 'Leve'
              const description = tag === 'revisao/prova'
                ? 'Para conteúdo de prova e alta prioridade.'
                : tag === 'revisao/manter'
                  ? 'Boa retenção sem concentrar revisões.'
                  : 'Para não esquecer completamente.'
              return (
                <button key={tag} type="button" className="secondary-button" onClick={() => onApplyTag?.(tag)}>
                  <strong>{label}</strong>
                  <small>#{tag} · {description}</small>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <button
        ref={triggerButtonRef}
        type="button"
        className="secondary-button note-readiness-trigger"
        onClick={() => void runAssessment()}
        disabled={disabled || busy || stateLoading || Boolean(unavailableReason)}
        title={unavailableReason ?? 'Avaliar se a nota está pronta para revisão'}
        aria-label="Avaliar prontidão da nota"
      >
        <span className="note-review-icon-stack" aria-hidden="true">
          <NotebookPen size={15} strokeWidth={1.5} />
          <RotateCcw size={9} strokeWidth={2.25} className="note-review-icon-corner" />
        </span>
        <span>{busy ? 'Avaliando...' : reviewState ? 'Reavaliar nota' : 'Avaliar nota'}</span>
      </button>
      {!stateLoading && reviewState ? (
        <button
          type="button"
          className="note-review-reset-trigger"
          onClick={openResetConfirm}
          disabled={disabled || busy || resetBusy}
          title="Remove pontuações, estado de memória e datas de revisão desta nota"
        >
          <RotateCcw size={13} strokeWidth={1.6} aria-hidden="true" />
          <span>Reiniciar aprendizado desta nota</span>
        </button>
      ) : null}
      {error && !attempt ? <p className="review-ai-toolbar-error" role="alert">{error}</p> : null}

      {unrecoverableDoc ? (
        <div className="note-recovery-banner" role="alert">
          <span className="note-recovery-banner-icon" aria-hidden="true">
            <AlertTriangle size={15} strokeWidth={1.6} />
          </span>
          <div className="note-recovery-banner-copy">
            <strong>Aprendizado irrecuperável</strong>
            <p>
              O arquivo de aprendizado desta nota está corrompido e nenhum backup válido foi
              encontrado. Exporte o arquivo para preservar o que houver e depois descarte para
              reavaliar a nota do zero.
            </p>
            {unrecoverableDoc.relativePath ? (
              <small>{unrecoverableDoc.relativePath}</small>
            ) : null}
            {recoveryError ? <p className="review-reset-error" role="alert">{recoveryError}</p> : null}
          </div>
          <div className="note-recovery-banner-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void performRecoveryExport()}
              disabled={recoveryBusy}
            >
              <Download size={13} strokeWidth={1.6} aria-hidden="true" />
              {recoveryBusy ? 'Exportando…' : 'Exportar arquivo'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={openDiscardConfirm}
              disabled={recoveryBusy}
            >
              Descartar e reavaliar
            </button>
          </div>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <Modal
          open
          onClose={() => {
            if (!recoveryBusy) closeDiscardConfirm()
          }}
          labelledBy="review-discard-title"
          className="review-ai-dialog review-reset-dialog"
        >
          <section aria-describedby="review-discard-description">
            <header>
              <div>
                <p className="card-kicker">Recuperação de aprendizado</p>
                <h2 id="review-discard-title">Descartar aprendizado irrecuperável?</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={closeDiscardConfirm}
                disabled={recoveryBusy}
                aria-label="Cancelar descarte"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="review-ai-report-body">
              <p id="review-discard-description">
                Arquivo ilegível. Descartar remove os dados corrompidos e zera
                pontuações, memória e agendamento — o Markdown fica intacto.
              </p>
              <p className="review-reset-hint">
                Recomendado: “Exportar arquivo” antes de descartar, para preservar o conteúdo original.
              </p>
              {recoveryError ? <p className="review-reset-error" role="alert">{recoveryError}</p> : null}
            </div>
            <div className="review-ai-dialog-actions">
              <button type="button" className="secondary-button" onClick={closeDiscardConfirm} disabled={recoveryBusy}>
                Cancelar
              </button>
              <button
                type="button"
                className="review-reset-confirm"
                onClick={() => void performRecoveryDiscard()}
                disabled={recoveryBusy}
                autoFocus
              >
                {recoveryBusy ? 'Descartando…' : 'Descartar e reavaliar'}
              </button>
            </div>
          </section>
        </Modal>
      ) : null}

      {resetConfirmOpen ? (
        <Modal
          open
          onClose={() => {
            if (!resetBusy) closeResetConfirm()
          }}
          labelledBy="review-reset-title"
          className="review-ai-dialog review-reset-dialog"
        >
          <section aria-describedby="review-reset-description">
            <header>
              <div>
                <p className="card-kicker">Aprendizado da nota</p>
                <h2 id="review-reset-title">Reiniciar aprendizado?</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={closeResetConfirm}
                disabled={resetBusy}
                aria-label="Cancelar reinício"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="review-ai-report-body">
              <p id="review-reset-description">
                Remove pontuações, memória (DSR/FSRS) e datas de revisão da nota.
                Markdown, tags e políticas ficam intactos.
              </p>
              {resetBusy ? (
                <p className="review-ai-stale-report" role="status">Reiniciando…</p>
              ) : (
                <p className="review-reset-hint">
                  O novo ciclo começa agora, usando o primeiro intervalo da política efetiva.
                </p>
              )}
              {resetError ? <p className="review-reset-error" role="alert">{resetError}</p> : null}
            </div>
            <div className="review-ai-dialog-actions">
              <button type="button" className="secondary-button" onClick={closeResetConfirm} disabled={resetBusy}>
                Cancelar
              </button>
              <button
                type="button"
                className="review-reset-confirm"
                onClick={() => void performReset()}
                disabled={resetBusy}
                autoFocus
              >
                {resetBusy ? 'Reiniciando…' : 'Reiniciar aprendizado'}
              </button>
            </div>
          </section>
        </Modal>
      ) : null}

    </>
  )
}
