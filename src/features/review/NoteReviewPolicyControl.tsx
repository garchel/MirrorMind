import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Settings2, Wrench, X } from 'lucide-react'
import {
  getNoteReviewPolicy,
  noteReviewPolicyInputSchema,
  setNoteReviewPolicy,
} from './reviewPolicy'
import type { NoteReviewPolicy, NoteReviewPolicyInput } from './reviewPolicy'
import { PolicyWorkloadEstimate } from './PolicyWorkloadEstimate'
import { Modal } from '../../components/Modal'
import './review-policy.css'
import { errorMessage } from '../../lib/tauri'

type Props = {
  vaultPath: string
  relativePath: string
  sourceRevision: string
  isDirty: boolean
  disabled?: boolean
}

const PRESETS = {
  intensive: {
    label: 'Intensiva',
    description: 'Alta retenção e intervalos curtos.',
    values: { firstReviewIntervalDays: 1, targetRetention: 0.9, priorityWeight: 3, minIntervalDays: 1, maxIntervalDays: 90 },
  },
  balanced: {
    label: 'Equilibrada',
    description: 'Bom equilíbrio entre retenção e carga.',
    values: { firstReviewIntervalDays: 2, targetRetention: 0.8, priorityWeight: 2, minIntervalDays: 1, maxIntervalDays: 365 },
  },
  light: {
    label: 'Leve',
    description: 'Manutenção ocasional com menor prioridade.',
    values: { firstReviewIntervalDays: 7, targetRetention: 0.7, priorityWeight: 1, minIntervalDays: 3, maxIntervalDays: 730 },
  },
} as const

const POLICY_FIELDS = [
  'firstReviewIntervalDays',
  'targetRetention',
  'priorityWeight',
  'minIntervalDays',
  'maxIntervalDays',
] as const

const ORIGIN_FIELD_ROWS = [
  {
    key: 'firstReviewIntervalDays',
    label: 'Primeira revisão',
    format: (value: number) => `${value} dia${value === 1 ? '' : 's'}`,
  },
  {
    key: 'targetRetention',
    label: 'Retenção',
    format: (value: number) => `${Math.round(value * 100)}%`,
  },
  {
    key: 'priorityWeight',
    label: 'Prioridade',
    format: (value: number) => String(value),
  },
  {
    key: 'minIntervalDays',
    label: 'Intervalo mínimo',
    format: (value: number) => `${value} dia${value === 1 ? '' : 's'}`,
  },
  {
    key: 'maxIntervalDays',
    label: 'Intervalo máximo',
    format: (value: number) => `${value} dia${value === 1 ? '' : 's'}`,
  },
] as const

type PolicySource = NoteReviewPolicy['sources'][keyof NoteReviewPolicy['sources']]

function originLabel(source: PolicySource): string {
  if (!source) return 'Sem origem'
  switch (source.kind) {
    case 'note': return 'Configuração da nota'
    case 'activeDeadlineTag': return `Prazo ativo · #${source.sourceId}`
    case 'tag': return `Tag · #${source.sourceId}`
    case 'expiredDeadlineTag': return `Prazo encerrado · #${source.sourceId}`
    default: return 'Padrão do Vault'
  }
}

function formFromPolicy(policy: NoteReviewPolicy): NoteReviewPolicyInput {
  return {
    firstReviewIntervalDays: policy.firstReviewIntervalDays,
    targetRetention: policy.targetRetention,
    priorityWeight: policy.priorityWeight,
    minIntervalDays: policy.minIntervalDays,
    maxIntervalDays: policy.maxIntervalDays,
    preferredMode: policy.preferredMode,
    overrideFields: [],
    inheritFields: [],
  }
}

function sourceLabel(policy: NoteReviewPolicy) {
  const kinds = new Set(
    Object.values(policy.sources).filter((source) => source !== null).map((source) => source.kind),
  )
  if (kinds.size > 1) return 'Origens combinadas'
  switch ([...kinds][0]) {
    case 'note': return 'Configuração da nota'
    case 'activeDeadlineTag': return 'Tag com prazo ativo'
    case 'tag': return 'Tag'
    case 'expiredDeadlineTag': return 'Tag com prazo encerrado'
    default: return 'Padrão do Vault'
  }
}

/** Preset cujo ritmo equivale aos valores (para resumo e destaque). */
function matchPreset(values: {
  firstReviewIntervalDays: number
  targetRetention: number
  priorityWeight: number
  minIntervalDays: number
  maxIntervalDays: number
}): keyof typeof PRESETS | null {
  const match = (Object.entries(PRESETS) as Array<[keyof typeof PRESETS, (typeof PRESETS)[keyof typeof PRESETS]]>)
    .find(([, preset]) => POLICY_FIELDS.every((field) => preset.values[field] === values[field]))
  return match ? match[0] : null
}

/** Resumo do ritmo para o gatilho ("Equilibrada · 80%"): casa os 5 campos
 * numericos com um preset; sem match, "Personalizada". Nome acessivel do
 * botao preservado via aria-label. */
function presetSummary(policy: NoteReviewPolicy): string {
  const matched = matchPreset({
    firstReviewIntervalDays: policy.firstReviewIntervalDays,
    targetRetention: policy.targetRetention,
    priorityWeight: policy.priorityWeight,
    minIntervalDays: policy.minIntervalDays,
    maxIntervalDays: policy.maxIntervalDays,
  })
  const label = matched ? PRESETS[matched].label : 'Personalizada'
  return `${label} · ${Math.round(policy.targetRetention * 100)}%`
}

function formatDeadline(policy: NoteReviewPolicy) {
  if (policy.deadlineAtUnixMs === null) return null
  const label = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(policy.deadlineAtUnixMs))
  const isExpired = policy.deadlineAtUnixMs <= Date.now()
  const isActive = policy.sources.activeDeadline !== null
  return isActive
    ? `Prazo de estudo: ${label} (ativo)`
    : isExpired
      ? `Prazo de estudo encerrado: ${label}`
      : `Prazo de estudo: ${label}`
}

function formatNextReview(timestamp: number | null) {
  if (timestamp === null) return 'Será calculada quando a nota entrar na revisão.'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(timestamp))
}

export function NoteReviewPolicyControl({
  vaultPath,
  relativePath,
  sourceRevision,
  isDirty,
  disabled = false,
}: Props) {
  const [policy, setPolicy] = useState<NoteReviewPolicy | null>(null)
  const [form, setForm] = useState<NoteReviewPolicyInput | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setPolicy(null)
    setForm(null)
    setOpen(false)
    setError('')
    setLoadFailed(false)
    setSaved(false)
    setSaving(false)
    if (isDirty) return
    setLoading(true)
    void getNoteReviewPolicy({ vaultPath, relativePath })
      .then((nextPolicy) => {
        if (generationRef.current !== generation || nextPolicy === null) return
        setPolicy(nextPolicy)
        setForm(formFromPolicy(nextPolicy))
      })
      .catch((reason) => {
        if (generationRef.current === generation) {
          setError(errorMessage(reason, String(reason)))
          setLoadFailed(true)
        }
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false)
      })
  }, [isDirty, relativePath, reloadToken, sourceRevision, vaultPath])

  if (isDirty || (!loading && policy === null && !loadFailed)) return null

  if (loadFailed && policy === null) {
    return (
      <button
        type="button"
        className="secondary-button note-review-policy-trigger note-review-policy-trigger-error"
        aria-label="Falha ao carregar a política de revisão. Tentar novamente"
        title={`Falha ao carregar a política de revisão: ${error}`}
        disabled={disabled || loading}
        onClick={() => setReloadToken((current) => current + 1)}
      >
        <AlertTriangle size={15} strokeWidth={1.5} aria-hidden="true" />
      </button>
    )
  }

  const validation = form ? noteReviewPolicyInputSchema.safeParse(form) : null
  const matchedPresetKey = form ? matchPreset({
    firstReviewIntervalDays: form.firstReviewIntervalDays,
    targetRetention: form.targetRetention,
    priorityWeight: form.priorityWeight,
    minIntervalDays: form.minIntervalDays,
    maxIntervalDays: form.maxIntervalDays,
  }) : null

  // Blocos partilhados pelos layouts (abas e padrão/lista): consts de
  // elementos, sem duplicar JSX nos ramos.
  const estimateBlock = form ? (
    <PolicyWorkloadEstimate
      firstReviewIntervalDays={form.firstReviewIntervalDays}
      targetRetention={form.targetRetention}
      minIntervalDays={form.minIntervalDays}
      maxIntervalDays={form.maxIntervalDays}
      valid={validation?.success === true}
    />
  ) : null

  const scheduleBlock = policy ? (
    <div className="review-policy-schedule">
      <span className="review-policy-schedule-icon" aria-hidden="true">
        <CalendarDays size={16} strokeWidth={1.6} />
      </span>
      <div className="review-policy-schedule-copy">
        <span>Próxima revisão</span>
        <strong>{formatNextReview(policy.nextReviewAtUnixMs)}</strong>
        {policy.completedReviewCount > 0 ? <small>A alteração recalcula a data preservando o histórico de memória.</small> : <small>Antes da primeira sessão, a data parte de quando a nota ficou pronta.</small>}
      </div>
      {formatDeadline(policy) ? <p className="review-policy-deadline" role="status">{formatDeadline(policy)}</p> : null}
    </div>
  ) : null

  const feedbackBlock = (
    <>
      {error ? <p className="review-policy-error" role="alert">{error}</p> : null}
      {saved ? <p className="review-policy-success" role="status">Política salva. Configuração da nota aplicada.</p> : null}
    </>
  )

  function closeDialog() {
    if (saving) return
    setOpen(false)
    if (policy) setForm(formFromPolicy(policy))
    setError('')
    setSaved(false)
  }

  function applyPreset(key: keyof typeof PRESETS) {
    setForm((current) => current ? {
      ...current,
      ...PRESETS[key].values,
      overrideFields: [...POLICY_FIELDS],
      inheritFields: [],
    } : current)
    setSaved(false)
    setError('')
  }

  function setPreferredMode(preferredMode: NoteReviewPolicyInput['preferredMode']) {
    setForm((current) => current ? { ...current, preferredMode } : current)
    setSaved(false)
    setError('')
  }

  async function persist(nextPolicy: NoteReviewPolicyInput) {
    const generation = generationRef.current
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const updated = await setNoteReviewPolicy({ vaultPath, relativePath, policy: nextPolicy })
      if (generationRef.current !== generation) return
      setPolicy(updated)
      setForm(formFromPolicy(updated))
      setSaved(true)
    } catch (reason) {
      if (generationRef.current === generation) {
        setError(errorMessage(reason, String(reason)))
      }
    } finally {
      if (generationRef.current === generation) setSaving(false)
    }
  }

  async function save() {
    if (!validation?.success) return
    await persist(validation.data)
  }

  async function inheritVaultDefaults() {
    if (!form || !policy) return
    const inherited = noteReviewPolicyInputSchema.safeParse({
      ...formFromPolicy(policy),
      preferredMode: form.preferredMode,
      overrideFields: [],
      inheritFields: [...POLICY_FIELDS],
    })
    if (!inherited.success) return
    await persist(inherited.data)
  }

  return (
    <>
      <button
        type="button"
        className="secondary-button note-review-policy-trigger"
        aria-label="Configurar revisão da nota"
        title="Configurar revisão da nota"
        disabled={disabled || loading}
        onClick={() => setOpen(true)}
      >
        <span className="note-review-icon-stack" aria-hidden="true">
          <Settings2 size={15} strokeWidth={1.5} />
          <Wrench size={9} strokeWidth={2.25} className="note-review-icon-corner" />
        </span>
        <span className="note-review-policy-label">
          <span>Política de revisão</span>
          {policy && form ? <small>{presetSummary(policy)}</small> : null}
        </span>
      </button>

      {open && policy && form ? (
        <Modal
          open
          onClose={() => {
            if (!saving) closeDialog()
          }}
          labelledBy="review-policy-title"
          className="review-policy-dialog"
        >
          <section>
            <div className="modal-header">
              <div>
                <p className="card-kicker">{sourceLabel(policy)}</p>
                <h3 id="review-policy-title">Política de revisão</h3>
              </div>
              <button type="button" className="modal-close" aria-label="Fechar política de revisão" disabled={saving} onClick={closeDialog}>
                <X size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>

            <div className="review-policy-body">
                <p className="review-policy-intro">Comece por um ritmo e ajuste se precisar — o que for salvo aqui vale só para esta nota.</p>

                <fieldset className="review-policy-presets">
                  <legend>Ritmo</legend>
                  {Object.entries(PRESETS).map(([key, preset]) => {
                    const presetKey = key as keyof typeof PRESETS
                    const isCurrent = matchedPresetKey === presetKey
                    return (
                      <button
                        type="button"
                        key={key}
                        className={isCurrent ? 'is-active' : ''}
                        aria-pressed={isCurrent}
                        onClick={() => applyPreset(presetKey)}
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.description}</span>
                      </button>
                    )
                  })}
                </fieldset>

                <fieldset className="review-policy-modes">
                  <legend>Método de Revisão</legend>
                  <label><input type="radio" name="preferred-review-mode" checked={form.preferredMode === 'exam'} onChange={() => setPreferredMode('exam')} /> <span><strong>Prova</strong><small>Perguntas independentes.</small></span></label>
                  <label><input type="radio" name="preferred-review-mode" checked={form.preferredMode === 'conversation'} onChange={() => setPreferredMode('conversation')} /> <span><strong>Conversa</strong><small>Exploração progressiva.</small></span></label>
                  {!policy.modeManual ? (
                    <p className="review-policy-mode-inherited" role="status">
                      Método herdado; salvar fixa nesta nota.
                    </p>
                  ) : null}
                </fieldset>

                <section className="review-policy-origins" aria-labelledby="review-policy-origins-title">
                  <h3 id="review-policy-origins-title">Origem de cada campo</h3>
                  <dl>
                    {ORIGIN_FIELD_ROWS.map(({ key, label, format }) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>
                          <strong>{format(policy[key])}</strong>
                          <small>{originLabel(policy.sources[key])}</small>
                        </dd>
                      </div>
                    ))}
                    <div>
                      <dt>Prazo de estudo</dt>
                      <dd>
                        <strong>{policy.deadlineAtUnixMs === null
                          ? 'Sem prazo'
                          : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(policy.deadlineAtUnixMs))}</strong>
                        <small>{originLabel(policy.sources.deadlineAtUnixMs)}</small>
                      </dd>
                    </div>
                  </dl>
                </section>

                {estimateBlock}
                {scheduleBlock}
                {feedbackBlock}
              </div>

            <footer>
              <button type="button" className="secondary-button" disabled={saving} onClick={() => void inheritVaultDefaults()}>Usar padrão do Vault</button>
              <button type="button" className="secondary-button" disabled={saving} onClick={closeDialog}>Cancelar</button>
              <button type="button" className="primary-button" disabled={saving || !validation?.success} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar política'}</button>
            </footer>
          </section>
        </Modal>
      ) : null}
    </>
  )
}
