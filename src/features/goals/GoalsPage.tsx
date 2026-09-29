import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Check, ChevronDown, ExternalLink, Info, Plus, Target, Trash2, X } from 'lucide-react'
import { EmptyState, ErrorState } from '../../components/ErrorState'
import { GoalsSkeleton } from '../../components/PageSkeleton'
import { Modal, ModalHeader } from '../../components/Modal'
import { useEscapeToClose } from '../../lib/escapeStack'
import { PageHeader, PageRefreshButton } from '../../components/PageHeader'
import { useReviewAiSettings } from '../review/ReviewAiSettingsContext'
import {
  createGoal,
  createGoalStepNote,
  deleteGoal,
  ensureGoalIndexNote,
  goalErrorMessage,
  isStepDone,
  listGoals,
  reconcileGoalNotes,
  setGoalNoteContentMode,
  type Goal,
  type GoalProvider,
  type NoteContentMode,
} from './goals'
import './goals.css'

type GoalsPageProps = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
}

function goalProgress(goal: Goal): { done: number; total: number; percent: number } {
  const total = goal.steps.length
  const done = goal.steps.filter(isStepDone).length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

const CONTENT_MODE_OPTIONS: ReadonlyArray<{ value: NoteContentMode; label: string }> = [
  { value: 'blank', label: 'Em branco' },
  { value: 'ai', label: 'Esqueleto com IA' },
]

/** Dropdown customizado (botão + listbox) no visual do app: o `<select>`
 * nativo abre o menu do SO, com cantos quadrados que destoam. Teclado total
 * (setas/Enter/Escape/Tab) e fechamento no clique fora. */
function ContentModeSelect({ labelledBy, value, onChange, disabled }: {
  labelledBy: string
  value: NoteContentMode
  onChange: (mode: NoteContentMode) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const selectedLabel = value === 'ai' ? 'Esqueleto com IA' : 'Em branco'

  // Escape fecha SÓ o menu (pilha global: registrado depois do modal, logo no
  // topo) e devolve o foco ao botão; outro Escape fecha o modal.
  useEscapeToClose(open, () => {
    setOpen(false)
    triggerRef.current?.focus()
  })

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus()
  }, [open])

  function focusOption(direction: 1 | -1) {
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    if (options.length === 0) return
    const index = options.indexOf(document.activeElement as HTMLElement)
    const next = options[(index + direction + options.length) % options.length] ?? options[0]
    next.focus()
  }

  function choose(next: NoteContentMode) {
    setOpen(false)
    if (next !== value) onChange(next)
    triggerRef.current?.focus()
  }

  return (
    <div
      className="goals-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (!open && event.target === triggerRef.current && event.key === 'ArrowDown') {
          event.preventDefault()
          setOpen(true)
        } else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          focusOption(event.key === 'ArrowDown' ? 1 : -1)
        }
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        className="ui-button goals-combobox-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        onClick={() => setOpen((isOpen) => !isOpen)}
        disabled={disabled}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
      </Button>
      {open ? (
        <ul ref={menuRef} className="goals-combobox-menu" role="listbox" aria-labelledby={labelledBy}>
          {CONTENT_MODE_OPTIONS.map((option) => (
            <li
              key={option.value}
              role="option"
              tabIndex={option.value === value ? 0 : -1}
              aria-selected={option.value === value}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  choose(option.value)
                }
              }}
            >
              <span className="goals-combobox-check" aria-hidden="true">
                {option.value === value ? <Check size={13} strokeWidth={2.5} /> : null}
              </span>
              <span>{option.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Ícone com tooltip explicando as opções de conteúdo das notas novas. */
function ContentModeTip({ tipId }: { tipId: string }) {
  return (
    <span className="goals-tip">
      <Button type="button" className="ui-button goals-tip-button" aria-label="Como funcionam as opções" aria-describedby={tipId}>
        <Info size={13} strokeWidth={2} aria-hidden="true" />
      </Button>
      <span className="goals-tip-text" role="tooltip" id={tipId}>
        <strong>Em branco:</strong> a nota nasce só com título, resumo do plano e seções vazias para preencher.{' '}
        <strong>Esqueleto com IA:</strong> a IA monta estrutura, perguntas-guia e tags a partir do objetivo e do texto da meta, sem inventar fatos; usa o provedor atual e consome orçamento — se falhar, a nota nasce em branco.
      </span>
    </span>
  )
}

export function GoalsPage({ vaultPath, onOpenNote }: GoalsPageProps) {
  const { provider: reviewProvider } = useReviewAiSettings()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [useAi, setUseAi] = useState(true)
  const [contentMode, setContentMode] = useState<NoteContentMode>('blank')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdMessage, setCreatedMessage] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyStep, setBusyStep] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  const [modeBusy, setModeBusy] = useState(false)
  const requestIdRef = useRef(0)
  const reconcileRequestIdRef = useRef(0)
  const toastTimerRef = useRef<number | undefined>(undefined)

  // Toast de erro some sozinho (8s) e no desmonte; um erro novo reinicia o timer.
  useEffect(() => {
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = undefined
    }
    if (actionError === null) return
    toastTimerRef.current = window.setTimeout(() => {
      setActionError(null)
      toastTimerRef.current = undefined
    }, 8_000)
    return () => {
      if (toastTimerRef.current !== undefined) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = undefined
      }
    }
  }, [actionError])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    void listGoals(vaultPath)
      .then((next) => {
        if (requestId !== requestIdRef.current) return
        setGoals(next)
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Não foi possível carregar as metas.')
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [vaultPath, reloadRequest])

  // Ao abrir o modal de detalhes, confere no disco as notas vinculadas:
  // apagadas desvinculam (o passo volta ao + e perde o check verde), movidas
  // têm o caminho atualizado (o botão de abrir mira a nova posição). Se algo
  // mudou, regrava a indexadora, cujos links usam esses caminhos.
  useEffect(() => {
    if (detailId === null) return
    const requestId = ++reconcileRequestIdRef.current
    void reconcileGoalNotes({ vaultPath, id: detailId })
      .then((result) => {
        if (requestId !== reconcileRequestIdRef.current) return
        setGoals((current) => current.map((item) => (item.id === result.goal.id ? result.goal : item)))
        if (result.changed) {
          void ensureGoalIndexNote(vaultPath, result.goal).catch(() => {})
        }
      })
      .catch(() => {
        // Vault ilegível ou meta removida: mantém o último estado conhecido.
      })
  }, [detailId, vaultPath])

  function openModal(): void {
    setCreateError(null)
    setModalOpen(true)
  }

  const canSubmit = title.trim().length > 0 && objective.trim().length > 0 && !creating

  const totals = goals.reduce(
    (acc, goal) => {
      const progress = goalProgress(goal)
      return { steps: acc.steps + progress.total, done: acc.done + progress.done }
    },
    { steps: 0, done: 0 },
  )
  const totalPercent = totals.steps === 0 ? 0 : Math.round((totals.done / totals.steps) * 100)
  const detailGoal = goals.find((goal) => goal.id === detailId) ?? null
  const detailProgress = detailGoal ? goalProgress(detailGoal) : null

  function aiProviderForRequest(): GoalProvider | null {
    if (!useAi) return null
    if (reviewProvider === 'gemini' || reviewProvider === 'ollama' || reviewProvider === 'openAiCompatible') {
      return reviewProvider
    }
    return 'ollama'
  }

  async function handleCreate() {
    if (creating || !title.trim() || !objective.trim()) return
    setCreating(true)
    setCreateError(null)
    setCreatedMessage(null)
    try {
      const goal = await createGoal({
        vaultPath,
        title: title.trim(),
        objective: objective.trim(),
        sourceText,
        provider: aiProviderForRequest(),
        noteContentMode: contentMode,
      })
      setGoals((current) => [goal, ...current])
      setDetailId(goal.id)
      setCreatedMessage(`Meta “${goal.title}” criada com ${goal.steps.length} notas propostas.`)
      setTitle('')
      setObjective('')
      setSourceText('')
      setContentMode('blank')
      setModalOpen(false)
    } catch (cause) {
      setCreateError(goalErrorMessage(cause))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      // Confirmação em duas etapas — evita o `confirm()` nativo, que bloqueia
      // a janela e não segue o visual do app.
      setConfirmDeleteId(id)
      return
    }
    setConfirmDeleteId(null)
    try {
      await deleteGoal(vaultPath, id)
      setGoals((current) => current.filter((goal) => goal.id !== id))
      setDetailId((current) => (current === id ? null : current))
    } catch (cause) {
      setActionError(goalErrorMessage(cause))
    }
  }

  async function handleCreateAndOpenNote(goal: Goal, order: number) {
    const step = goal.steps.find((item) => item.order === order)
    if (!step || busyStep) return
    // Se a nota já existe/vinculada, só abre na página de notas.
    if (isStepDone(step)) {
      onOpenNote(step.noteRelativePath as string)
      return
    }
    const key = `${goal.id}:${order}`
    setBusyStep(key)
    setActionError(null)
    setDraftNotice(null)
    try {
      // Cria a nota do passo (em branco ou esqueleto com IA), garante a
      // indexadora da meta e vincula tudo; depois abre a nota na página de
      // notas com o título já pronto.
      const created = await createGoalStepNote({
        vaultPath,
        goal,
        order,
        contentMode: goal.noteContentMode ?? 'blank',
        provider: aiProviderForRequest(),
      })
      setGoals((current) => current.map((item) => (item.id === created.goal.id ? created.goal : item)))
      if (created.draftError) {
        setDraftNotice(`A nota foi criada em branco: ${created.draftError}`)
      }
      onOpenNote(created.notePath)
    } catch (cause) {
      setActionError(goalErrorMessage(cause))
    } finally {
      setBusyStep(null)
    }
  }

  async function handleContentModeChange(goal: Goal, mode: NoteContentMode) {
    if (modeBusy || (goal.noteContentMode ?? 'blank') === mode) return
    setModeBusy(true)
    setActionError(null)
    try {
      const updated = await setGoalNoteContentMode({ vaultPath, id: goal.id, noteContentMode: mode })
      setGoals((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (cause) {
      setActionError(goalErrorMessage(cause))
    } finally {
      setModeBusy(false)
    }
  }

  return (
    <section className="workspace-page goals-page" aria-labelledby="goals-title">
      <PageHeader
        kicker="Acompanhamento"
        title="Metas"
        titleId="goals-title"
        description="Defina o que quer aprender ou cole um texto — o app monta o card da meta com as notas em ordem lógica de estudo."
      >
        <div className="goals-header-actions">
          <Button type="button" className="ui-button goals-new-button" onClick={openModal}>
            <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> Nova meta
          </Button>
          <PageRefreshButton onRefresh={() => setReloadRequest((request) => request + 1)} disabled={loading} />
        </div>
      </PageHeader>

      {goals.length > 0 && !loading ? (
        <p className="goals-headline-stats" aria-label="Resumo das metas">
          <strong>{goals.length} {goals.length === 1 ? 'meta' : 'metas'}</strong>
          <span aria-hidden="true"> · </span>
          <strong>{totalPercent}%</strong> concluído no geral
        </p>
      ) : null}

      {createdMessage ? <p role="status" className="goals-success">{createdMessage}</p> : null}

      {loading ? (
        <GoalsSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadRequest((request) => request + 1)} />
      ) : goals.length === 0 ? (
        <EmptyState
          icon={<Target size={24} strokeWidth={1.6} aria-hidden="true" />}
          title="Nenhuma meta ainda."
          description="Metas viram planos de estudo: o app quebra seu objetivo em notas ordenadas e acompanha o progresso de cada uma."
          steps={[
            'Clique em “Nova meta” e descreva o que quer aprender',
            'Receba o plano em ordem lógica de estudo',
            'Crie cada nota com o + e veja o progresso andar',
          ]}
          action={(
            <Button type="button" className="ui-button goals-new-button" onClick={openModal}>
              <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> Criar primeira meta
            </Button>
          )}
        />
      ) : (
        <ul className="goals-list" aria-label="Metas criadas">
          {goals.map((goal) => {
            const progress = goalProgress(goal)
            return (
              <li key={goal.id} className="goal-card">
                <Button
                  type="button"
                  className="ui-button goal-card-hit"
                  onClick={() => setDetailId(goal.id)}
                  aria-label={`Abrir detalhes da meta ${goal.title}`}
                />
                <div className="goal-card-body">
                  <h3>{goal.title}</h3>
                  <p className="goal-card-objective">{goal.objective}</p>
                  <div className="goal-progress-row">
                    <div
                      className="goal-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress.percent}
                      aria-label={`Progresso da meta ${goal.title}: ${progress.done} de ${progress.total} passos concluídos`}
                    >
                      <span className="goal-progress-fill" style={{ width: `${progress.percent}%` }} />
                    </div>
                    <span className="goal-progress-text">
                      {progress.done}/{progress.total} · {progress.percent}%
                    </span>
                  </div>
                  <div className="goal-card-meta">
                    <span>{goal.steps.length} {goal.steps.length === 1 ? 'nota proposta' : 'notas propostas'}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <Modal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        labelledBy="goals-detail-title"
        className="goals-dialog goals-detail-dialog"
      >
        {detailGoal && detailProgress ? (
          <div className="goals-detail-body">
            <ModalHeader
              title={detailGoal.title}
              titleId="goals-detail-title"
              closeLabel={`Fechar detalhes da meta ${detailGoal.title}`}
              kicker="Meta"
              onClose={() => setDetailId(null)}
            />
            <p className="goal-card-objective">{detailGoal.objective}</p>
            <div className="goal-card-meta">
              <span>{detailGoal.steps.length} {detailGoal.steps.length === 1 ? 'nota proposta em ordem' : 'notas propostas em ordem'}</span>
            </div>
            <div className="goal-detail-field goals-field-row">
              <span className="goals-field-title">
                <span id="goals-content-mode-label">Conteúdo das notas novas</span>
                <ContentModeTip tipId="goals-content-mode-tip" />
              </span>
              <ContentModeSelect
                labelledBy="goals-content-mode-label"
                value={detailGoal.noteContentMode ?? 'blank'}
                onChange={(mode) => void handleContentModeChange(detailGoal, mode)}
                disabled={modeBusy}
              />
            </div>
            {draftNotice ? <p role="status" className="goals-hint">{draftNotice}</p> : null}
            <div className="goal-detail-progress">
              <div className="goal-detail-progress-head">
                <strong>Passos concluídos</strong>
                <span>{detailProgress.done}/{detailProgress.total} · {detailProgress.percent}%</span>
              </div>
              <div
                className="goal-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={detailProgress.percent}
                aria-label={`Progresso da meta ${detailGoal.title}: ${detailProgress.done} de ${detailProgress.total} passos concluídos`}
              >
                <span className="goal-progress-fill" style={{ width: `${detailProgress.percent}%` }} />
              </div>
            </div>
            <ol className="goal-steps" aria-label={`Plano da meta ${detailGoal.title}`}>
              {detailGoal.steps.map((step) => {
                const key = `${detailGoal.id}:${step.order}`
                const busy = busyStep === key
                const hasNote = isStepDone(step)
                const isDone = hasNote
                return (
                  <li key={step.order} className={isDone ? 'is-done' : ''}>
                    <span className="goal-step-order" aria-hidden="true">
                      {isDone ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : step.order}
                    </span>
                    <div className="goal-step-copy">
                      <strong>{step.title}</strong>
                      {step.summary ? <p>{step.summary}</p> : null}
                      <code>{step.noteRelativePath ?? step.suggestedRelativePath}</code>
                    </div>
                    <div className="goal-step-side">
                      <Button
                        type="button"
                        className="ui-button goal-step-add"
                        onClick={() => void handleCreateAndOpenNote(detailGoal, step.order)}
                        disabled={busy}
                        aria-busy={busy}
                        aria-label={hasNote ? `Abrir nota ${step.title}` : `Criar e abrir nota ${step.title}`}
                        title={hasNote ? `Abrir nota ${step.title}` : `Criar e abrir nota ${step.title}`}
                      >
                        {hasNote ? (
                          <ExternalLink size={14} strokeWidth={2.2} aria-hidden="true" />
                        ) : (
                          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ol>
            <div className="goals-detail-footer">
              {confirmDeleteId === detailGoal.id ? (
                <>
                  <Button
                    type="button"
                    className="ui-button ui-button--secondary ui-button--sm goal-delete-confirm"
                    onClick={() => void handleDelete(detailGoal.id)}
                    aria-label={`Confirmar exclusão da meta ${detailGoal.title}`}
                  >
                    Confirmar exclusão
                  </Button>
                  <Button
                    type="button"
                    className="ui-button ui-button--secondary ui-button--sm"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm"
                  onClick={() => void handleDelete(detailGoal.id)}
                  aria-label={`Excluir meta ${detailGoal.title}`}
                  title="Excluir meta"
                >
                  <Trash2 size={14} aria-hidden="true" /> Excluir meta
                </Button>
              )}
            </div>
            {actionError ? (
              <div className="goals-toast-stack">
                <div className="goals-toast is-error" role="alert">
                  <span>{actionError}</span>
                  <Button
                    type="button"
                    className="ui-button goals-toast-close"
                    onClick={() => setActionError(null)}
                    aria-label="Fechar aviso de erro"
                  >
                    <X size={14} strokeWidth={2.2} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        labelledBy="goals-dialog-title"
        className="goals-dialog"
      >
        <form
          className="goals-dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreate()
          }}
        >
          <ModalHeader
            title="Nova meta"
            titleId="goals-dialog-title"
            closeLabel="Fechar criação de meta"
            kicker="Plano de estudo"
            onClose={() => setModalOpen(false)}
          />
          <label htmlFor="goals-title-input">
            <span>Título da meta</span>
            <input
              id="goals-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Aprender fotossíntese"
              maxLength={200}
              aria-describedby="goals-title-count"
              autoFocus
            />
            <small id="goals-title-count">{title.length}/200</small>
          </label>
          <label htmlFor="goals-objective-input">
            <span>Objetivo — o que você quer ser capaz de fazer</span>
            <textarea
              id="goals-objective-input"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Ex.: Explicar a fotossíntese sem consultar e resolver 5 exercícios."
              maxLength={4000}
              aria-describedby="goals-objective-count"
            />
            <small id="goals-objective-count">{objective.length}/4000</small>
          </label>
          <label htmlFor="goals-source-input">
            <span>Texto com os conteúdos (opcional — cole apostila, resumo, tópicos)</span>
            <textarea
              id="goals-source-input"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="# Capítulo 1&#10;...&#10;&#10;# Capítulo 2&#10;... (títulos viram passos em ordem)"
            />
            <small>Com títulos `# ...`, cada um vira uma nota na mesma ordem. Sem títulos, o app fatia o texto em partes.</small>
          </label>
          <label className="goals-dialog-check" htmlFor="goals-use-ai">
            <input
              id="goals-use-ai"
              type="checkbox"
              checked={useAi}
              onChange={(event) => setUseAi(event.target.checked)}
            />
            <span>Usar IA do provedor atual para ordenar o plano ({reviewProvider})</span>
          </label>
          <div className="goal-detail-field goals-field-row">
            <span className="goals-field-title">
              <span id="goals-new-content-mode-label">Conteúdo das notas novas</span>
              <ContentModeTip tipId="goals-new-content-mode-tip" />
            </span>
            <ContentModeSelect
              labelledBy="goals-new-content-mode-label"
              value={contentMode}
              onChange={setContentMode}
            />
          </div>
          <div className="goals-dialog-actions">
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="ui-button goals-submit-button"
              disabled={!canSubmit}
              aria-busy={creating}
              title={!canSubmit && !creating ? 'Preencha o título e o objetivo para criar a meta' : undefined}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" /> {creating ? 'Gerando plano…' : 'Criar meta e gerar plano'}
            </Button>
          </div>
          {createError ? (
            <p role="alert" className="goals-error">
              {createError}
            </p>
          ) : null}
        </form>
      </Modal>
    </section>
  )
}
