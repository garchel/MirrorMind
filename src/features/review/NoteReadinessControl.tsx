import { AlertTriangle, CalendarCheck2, ChartColumnBig, Check, Download, RotateCcw, Search, Sparkles, X } from 'lucide-react'
import { HugeiconsIcon } from '@hugeicons/react'
import { StructureCheckIcon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
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
  /** Abre a pagina de avaliacao de estrutura ( auditoria deterministica,
   *  espelho da pagina de avaliacao da nota). */
  onAuditStructure?: () => void
  /** Politica de revisao (vinda do pai): ajustes, apos divisor. */
  adjustments?: ReactNode
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
  onAuditStructure,
  adjustments,
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

  const startActionBlocked = (isDirty && !onSaveFirst) || !reviewState || reviewState.readiness !== 'ready'
  const showStartHint = !disabled && !busy && !enrollmentBusy && startActionBlocked
  const startHintText = (isDirty && !onSaveFirst)
    ? 'Salve a nota para liberar a revisão.'
    : 'Avalie a nota para liberar a revisão.'

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
      {/* Cabecalho: titulo a esquerda, status a direita; o cartao reaproveita
          os estilos da pill e dos selos (proxima revisao, rascunho, riscos). */}
      <header className="note-review-menu-header note-review-menu-header-row">
        <div>
          <strong>Avaliação &amp; revisão</strong>
          <small>Avalie, revise e ajuste esta nota</small>
        </div>
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
      </header>
      <Button
        type="button"
        className="ui-button note-review-start-trigger"
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
      </Button>
      {/* Botao desabilitado que nao diz o porquê e beco sem saida: a dica
          aponta o proximo passo (mesma regra do title, em texto visivel). */}
      {showStartHint ? (
        <p className="note-review-hint">{startHintText}</p>
      ) : null}
      <Button
        ref={triggerButtonRef}
        type="button"
        className="ui-button ui-button--secondary ui-button--sm note-readiness-trigger"
        onClick={() => void runAssessment()}
        disabled={disabled || busy || stateLoading || Boolean(unavailableReason)}
        title={unavailableReason ?? 'Avaliar se a nota está pronta para revisão'}
        aria-label="Avaliar prontidão da nota"
      >
        <Sparkles size={15} strokeWidth={1.5} aria-hidden="true" />
        <span>{busy ? 'Avaliando...' : reviewState ? 'Reavaliar nota' : 'Avaliar nota'}</span>
      </Button>
      {reviewState?.report ? (
        <Button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm note-readiness-report-trigger"
          onClick={openPersistedReport}
          disabled={disabled || isDirty || busy}
          aria-label="Abrir último relatório de prontidão"
        >
          <span className="note-review-icon-stack" aria-hidden="true">
            <ChartColumnBig size={15} strokeWidth={1.5} />
            <Search size={9} strokeWidth={2.25} className="note-review-icon-corner" />
          </span>
          <span>Ver relatório</span>
        </Button>
      ) : null}
      {onAuditStructure ? (
        <Button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm note-structure-trigger"
          onClick={() => onAuditStructure()}
          disabled={disabled}
          title="Avaliar a estrutura da nota para a revisão (determinístico, sem IA)"
          aria-label="Avaliar estrutura da nota"
        >
          <span aria-hidden="true"><HugeiconsIcon icon={StructureCheckIcon} size={15} strokeWidth={1.5} /></span>
          <span>Avaliar estrutura</span>
        </Button>
      ) : null}
      {adjustments}
      {suggestedProfiles.length > 0 ? (
        <div className="note-profile-onboarding" role="region" aria-label="Adotar perfil de revisão">
          <div className="note-profile-onboarding-heading">
            <strong>Adotar perfil de revisão?</strong>
            <small>A tag define ritmo e método desta nota — escolha um perfil para ativar o agendamento.</small>
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
                <Button key={tag} type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => onApplyTag?.(tag)}>
                  <strong>{label}</strong>
                  <small>#{tag} · {description}</small>
                </Button>
              )
            })}
          </div>
          <details className="note-profile-why">
            <summary>Por que uma tag?</summary>
            <p>Cada tag de revisão carrega um ritmo e um método. Ao adotar, a nota passa a seguir a tag — a origem de cada valor aparece em Política de revisão.</p>
          </details>
        </div>
      ) : null}
      {!stateLoading && reviewState ? (
        <div className="note-review-danger-zone">
          <Button
            type="button"
            className="ui-button note-review-reset-trigger"
            onClick={openResetConfirm}
            disabled={disabled || busy || resetBusy}
            title="Remove pontuações, estado de memória e datas de revisão desta nota"
          >
            <RotateCcw size={13} strokeWidth={1.6} aria-hidden="true" />
            <span>Reiniciar aprendizado desta nota</span>
          </Button>
        </div>
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
            <Button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => void performRecoveryExport()}
              disabled={recoveryBusy}
            >
              <Download size={13} strokeWidth={1.6} aria-hidden="true" />
              {recoveryBusy ? 'Exportando…' : 'Exportar arquivo'}
            </Button>
            <Button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={openDiscardConfirm}
              disabled={recoveryBusy}
            >
              Descartar e reavaliar
            </Button>
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
            <div className="modal-header">
              <div>
                <p className="card-kicker">Recuperação de aprendizado</p>
                <h3 id="review-discard-title">Descartar aprendizado irrecuperável?</h3>
              </div>
              <Button
                type="button"
                className="ui-button modal-close"
                onClick={closeDiscardConfirm}
                disabled={recoveryBusy}
                aria-label="Cancelar descarte"
              >
                <X size={16} strokeWidth={2.2} aria-hidden="true" />
              </Button>
            </div>
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
              <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={closeDiscardConfirm} disabled={recoveryBusy}>
                Cancelar
              </Button>
              <Button
                type="button"
                className="ui-button review-reset-confirm"
                onClick={() => void performRecoveryDiscard()}
                disabled={recoveryBusy}
                autoFocus
              >
                {recoveryBusy ? 'Descartando…' : 'Descartar e reavaliar'}
              </Button>
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
            <header className="modal-header review-reset-header">
              <span className="review-reset-warning-icon" aria-hidden="true">
                <AlertTriangle size={20} strokeWidth={1.8} />
              </span>
              <div>
                <p className="card-kicker">Aprendizado da nota</p>
                <h3 id="review-reset-title">Reiniciar aprendizado?</h3>
              </div>
              <Button
                type="button"
                className="ui-button modal-close"
                onClick={closeResetConfirm}
                disabled={resetBusy}
                aria-label="Cancelar reinício"
              >
                <X size={16} strokeWidth={2.2} aria-hidden="true" />
              </Button>
            </header>
            <div className="review-ai-report-body">
              <p id="review-reset-description">
                Isso zera o progresso desta nota e começa um ciclo novo agora.
              </p>
              <ul className="review-reset-consequences">
                <li className="is-loss"><strong>Zera</strong> pontuações e memória</li>
                <li className="is-loss"><strong>Remove</strong> as datas de revisão</li>
                <li className="is-keep"><strong>Mantém</strong> Markdown, tags e política</li>
              </ul>
              {resetBusy ? (
                <p className="review-ai-stale-report" role="status">Reiniciando…</p>
              ) : (
                <p className="review-reset-hint">
                  O novo ciclo usa o primeiro intervalo da política efetiva.
                </p>
              )}
              {resetError ? <p className="review-reset-error" role="alert">{resetError}</p> : null}
            </div>
            <div className="review-ai-dialog-actions">
              <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={closeResetConfirm} disabled={resetBusy}>
                Cancelar
              </Button>
              <Button
                type="button"
                className="ui-button review-reset-confirm"
                onClick={() => void performReset()}
                disabled={resetBusy}
                autoFocus
              >
                {resetBusy ? 'Reiniciando…' : 'Reiniciar aprendizado'}
              </Button>
            </div>
          </section>
        </Modal>
      ) : null}

    </>
  )
}
