import { useEffect, useRef, useState } from 'react'
import { BookOpen, Check, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/ErrorState'
import { Modal, ModalHeader } from '../../components/Modal'
import { PageHeader, PageRefreshButton } from '../../components/PageHeader'
import { useReviewAiSettings } from '../review/ReviewAiSettingsContext'
import {
  createGoal,
  createStepNote,
  deleteGoal,
  goalErrorMessage,
  listGoals,
  updateGoalStep,
  type Goal,
  type GoalProvider,
  type GoalStepStatus,
} from './goals'
import './goals.css'

type GoalsPageProps = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
}

const STATUS_LABELS: Record<GoalStepStatus, string> = {
  planned: 'Planejado',
  in_progress: 'Estudando',
  done: 'Concluído',
}

const STATUS_ORDER: GoalStepStatus[] = ['planned', 'in_progress', 'done']

function goalProgress(goal: Goal): { done: number; total: number; percent: number } {
  const total = goal.steps.length
  const done = goal.steps.filter((step) => step.status === 'done').length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export function GoalsPage({ vaultPath, onOpenNote }: GoalsPageProps) {
  const { provider: reviewProvider } = useReviewAiSettings()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [useAi, setUseAi] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdMessage, setCreatedMessage] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyStep, setBusyStep] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    void listGoals(vaultPath)
      .then((next) => {
        if (requestId !== requestIdRef.current) return
        setGoals(next)
        setSelectedId((current) => current ?? next[0]?.id ?? null)
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Não foi possível carregar as metas.')
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [vaultPath, reloadRequest])

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
      })
      setGoals((current) => [goal, ...current])
      setSelectedId(goal.id)
      setCreatedMessage(`Meta “${goal.title}” criada com ${goal.steps.length} notas propostas.`)
      setTitle('')
      setObjective('')
      setSourceText('')
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
      setSelectedId((current) => (current === id ? null : current))
    } catch (cause) {
      setActionError(goalErrorMessage(cause))
    }
  }

  async function handleCreateAndOpenNote(goal: Goal, order: number) {
    const step = goal.steps.find((item) => item.order === order)
    if (!step || busyStep) return
    // Se a nota já existe/vinculada, só abre na página de notas.
    if (step.noteRelativePath) {
      onOpenNote(step.noteRelativePath)
      return
    }
    const key = `${goal.id}:${order}`
    setBusyStep(key)
    setActionError(null)
    try {
      const relativePath = step.suggestedRelativePath
      await createStepNote({
        vaultPath,
        relativePath,
        title: step.title,
        summary: step.summary,
        goalTitle: goal.title,
        order: step.order,
      })
      const updated = await updateGoalStep({
        vaultPath,
        id: goal.id,
        order: step.order,
        noteRelativePath: relativePath,
      })
      setGoals((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      // Abre na página de notas com o título já pronto.
      onOpenNote(relativePath)
    } catch (cause) {
      setActionError(goalErrorMessage(cause))
    } finally {
      setBusyStep(null)
    }
  }

  async function handleStepStatus(goal: Goal, order: number, status: GoalStepStatus) {
    const key = `${goal.id}:${order}:status`
    if (busyStep) return
    setBusyStep(key)
    setActionError(null)
    try {
      const updated = await updateGoalStep({ vaultPath, id: goal.id, order, status })
      setGoals((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (cause) {
      setActionError(goalErrorMessage(cause))
    } finally {
      setBusyStep(null)
    }
  }

  return (
    <section className="workspace-page goals-page" aria-labelledby="goals-title">
      <PageHeader
        kicker="Aprendizado"
        title="Metas"
        titleId="goals-title"
        description="Defina o que quer aprender ou cole um texto — o app monta o card da meta com as notas em ordem lógica de estudo."
      >
        <div className="goals-header-actions">
          <button type="button" className="goals-new-button" onClick={openModal}>
            <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> Nova meta
          </button>
          <PageRefreshButton onRefresh={() => setReloadRequest((request) => request + 1)} disabled={loading} />
        </div>
      </PageHeader>

      {goals.length > 0 && !loading ? (
        <dl className="goals-summary" aria-label="Resumo das metas">
          <div>
            <dt>Metas</dt>
            <dd>{goals.length}</dd>
          </div>
          <div>
            <dt>Passos concluídos</dt>
            <dd>
              {totals.done}/{totals.steps}
            </dd>
          </div>
          <div>
            <dt>Progresso geral</dt>
            <dd>{totalPercent}%</dd>
          </div>
        </dl>
      ) : null}

      {createdMessage ? <p role="status" className="goals-success">{createdMessage}</p> : null}

      {loading ? (
        <LoadingState message="Carregando metas..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadRequest((request) => request + 1)} />
      ) : goals.length === 0 ? (
        <div className="goals-status">
          <BookOpen size={22} strokeWidth={1.4} aria-hidden="true" />
          <strong>Nenhuma meta ainda.</strong>
          <p>Crie a primeira pelo botão “Nova meta” — o card aparece aqui com as notas propostas.</p>
        </div>
      ) : (
        <ul className="goals-list" aria-label="Metas criadas">
          {goals.map((goal) => {
            const progress = goalProgress(goal)
            const isSelected = goal.id === selectedId
            const isConfirmingDelete = confirmDeleteId === goal.id
            return (
              <li key={goal.id} className={`goal-card${isSelected ? ' is-selected' : ''}`}>
                <div className="goal-card-header">
                  <div>
                    <h3>{goal.title}</h3>
                    <p className="goal-card-objective">{goal.objective}</p>
                  </div>
                  <div className="goal-card-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setSelectedId(isSelected ? null : goal.id)}
                      aria-expanded={isSelected}
                    >
                      {isSelected ? 'Recolher' : 'Ver plano'}
                    </button>
                    {isConfirmingDelete ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button goal-delete-confirm"
                          onClick={() => void handleDelete(goal.id)}
                          aria-label={`Confirmar exclusão da meta ${goal.title}`}
                        >
                          Confirmar exclusão
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleDelete(goal.id)}
                        aria-label={`Excluir meta ${goal.title}`}
                        title="Excluir meta"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="goal-card-meta">
                  <span>{goal.steps.length} notas propostas em ordem</span>
                  <span>{goal.aiGenerated ? 'Plano gerado por IA' : 'Plano local (determinístico)'}</span>
                </div>
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
                    {progress.done}/{progress.total} concluídos · {progress.percent}%
                  </span>
                </div>
                {isSelected ? (
                  <ol className="goal-steps" aria-label={`Plano da meta ${goal.title}`}>
                    {goal.steps.map((step) => {
                      const key = `${goal.id}:${step.order}`
                      const busy = busyStep === key || busyStep === `${key}:status`
                      const hasNote = Boolean(step.noteRelativePath)
                      const isDone = step.status === 'done'
                      return (
                        <li key={step.order} className={isDone ? 'is-done' : ''}>
                          <span className="goal-step-order" aria-hidden="true">
                            {isDone ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : step.order}
                          </span>
                          <div className="goal-step-copy">
                            <div className="goal-step-title-row">
                              <strong>{step.title}</strong>
                              <button
                                type="button"
                                className="goal-step-add"
                                onClick={() => void handleCreateAndOpenNote(goal, step.order)}
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
                              </button>
                            </div>
                            {step.summary ? <p>{step.summary}</p> : null}
                            <code>{step.noteRelativePath ?? step.suggestedRelativePath}</code>
                          </div>
                          <div
                            className="goal-step-status"
                            role="group"
                            aria-label={`Status do passo ${step.order}: ${step.title}`}
                          >
                            {STATUS_ORDER.map((status) => (
                              <button
                                key={status}
                                type="button"
                                className={`goal-status-option${step.status === status ? ' is-active' : ''}`}
                                aria-pressed={step.status === status}
                                onClick={() => void handleStepStatus(goal, step.order, status)}
                                disabled={busy || step.status === status}
                              >
                                {STATUS_LABELS[status]}
                              </button>
                            ))}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {actionError ? (
        <p role="alert" className="goals-error">
          {actionError}
        </p>
      ) : null}

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
          <div className="goals-dialog-actions">
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>
              Cancelar
            </button>
            <button
              type="submit"
              className="goals-submit-button"
              disabled={!canSubmit}
              aria-busy={creating}
              title={!canSubmit && !creating ? 'Preencha o título e o objetivo para criar a meta' : undefined}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" /> {creating ? 'Gerando plano…' : 'Criar meta e gerar plano'}
            </button>
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
