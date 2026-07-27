import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, SlidersHorizontal, X } from 'lucide-react'
import {
  getNoteReviewPolicy,
  noteReviewPolicyInputSchema,
  setNoteReviewPolicy,
} from './reviewPolicy'
import type { NoteReviewPolicy, NoteReviewPolicyInput } from './reviewPolicy'
import './review-policy.css'

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
  const kinds = new Set(Object.values(policy.sources).map((source) => source.kind))
  if (kinds.size > 1) return 'Origens combinadas'
  switch ([...kinds][0]) {
    case 'note': return 'Configuração da nota'
    case 'activeDeadlineTag': return 'Tag com prazo ativo'
    case 'tag': return 'Tag'
    case 'expiredDeadlineTag': return 'Tag com prazo encerrado'
    default: return 'Padrão do Vault'
  }
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
          setError(reason instanceof Error ? reason.message : String(reason))
          setLoadFailed(true)
        }
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false)
      })
  }, [isDirty, relativePath, reloadToken, sourceRevision, vaultPath])

  useEffect(() => {
    if (!open) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) {
        setOpen(false)
        if (policy) setForm(formFromPolicy(policy))
        setError('')
        setSaved(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, policy, saving])

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
  const intervalOrderInvalid = form !== null && form.maxIntervalDays < form.minIntervalDays

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

  function setNumber(field: keyof Pick<NoteReviewPolicyInput,
    'firstReviewIntervalDays' | 'targetRetention' | 'priorityWeight' | 'minIntervalDays' | 'maxIntervalDays'>,
  value: number) {
    setForm((current) => current ? {
      ...current,
      [field]: value,
      overrideFields: current.overrideFields.includes(field)
        ? current.overrideFields
        : [...current.overrideFields, field],
      inheritFields: current.inheritFields.filter((inheritedField) => inheritedField !== field),
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
        setError(reason instanceof Error ? reason.message : String(reason))
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
        <SlidersHorizontal size={15} strokeWidth={1.5} aria-hidden="true" />
      </button>

      {open && policy && form ? (
        <div className="review-policy-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}>
          <section className="review-policy-dialog" role="dialog" aria-modal="true" aria-labelledby="review-policy-title">
            <header>
              <div>
                <span>{sourceLabel(policy)}</span>
                <h2 id="review-policy-title">Política de revisão</h2>
              </div>
              <button type="button" className="secondary-button" aria-label="Fechar política de revisão" disabled={saving} onClick={closeDialog}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <p className="review-policy-intro">Defina quanto esforço esta nota merece sem misturar prioridade com risco de esquecimento.</p>

            <fieldset className="review-policy-presets">
              <legend>Ritmo</legend>
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button type="button" key={key} onClick={() => applyPreset(key as keyof typeof PRESETS)}>
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                </button>
              ))}
            </fieldset>

            <fieldset className="review-policy-modes">
              <legend>Modo preferido</legend>
              <label><input type="radio" name="preferred-review-mode" checked={form.preferredMode === 'exam'} onChange={() => setPreferredMode('exam')} /> <span><strong>Prova</strong><small>Perguntas independentes.</small></span></label>
              <label><input type="radio" name="preferred-review-mode" checked={form.preferredMode === 'conversation'} onChange={() => setPreferredMode('conversation')} /> <span><strong>Conversa</strong><small>Exploração progressiva.</small></span></label>
            </fieldset>

            <details className="review-policy-advanced">
              <summary>Opções avançadas</summary>
              <div>
                <label>Primeira revisão (dias)<input type="number" min="1" max="3650" value={form.firstReviewIntervalDays} onChange={(event) => setNumber('firstReviewIntervalDays', Number(event.target.value))} /></label>
                <label>Retenção desejada (%)<input type="number" min="50" max="99" value={Math.round(form.targetRetention * 100)} onChange={(event) => setNumber('targetRetention', Number(event.target.value) / 100)} /></label>
                <label>Peso de prioridade<input type="number" min="0.1" max="100" step="0.1" value={form.priorityWeight} onChange={(event) => setNumber('priorityWeight', Number(event.target.value))} /></label>
                <label>Intervalo mínimo (dias)<input type="number" min="1" max="3650" value={form.minIntervalDays} onChange={(event) => setNumber('minIntervalDays', Number(event.target.value))} /></label>
                <label>Intervalo máximo (dias)<input type="number" min="1" max="36500" value={form.maxIntervalDays} onChange={(event) => setNumber('maxIntervalDays', Number(event.target.value))} /></label>
              </div>
              {intervalOrderInvalid ? <p role="alert">O intervalo máximo deve ser igual ou maior que o mínimo.</p> : null}
            </details>

            <div className="review-policy-schedule">
              <span>Próxima revisão</span>
              <strong>{formatNextReview(policy.nextReviewAtUnixMs)}</strong>
              {policy.completedReviewCount > 0 ? <small>A alteração recalcula a data preservando o histórico de memória.</small> : <small>Antes da primeira sessão, a data parte de quando a nota ficou pronta.</small>}
            </div>

            {error ? <p className="review-policy-error" role="alert">{error}</p> : null}
            {saved ? <p className="review-policy-success" role="status">Política salva. Configuração da nota aplicada.</p> : null}

            <footer>
              <button type="button" className="secondary-button" disabled={saving} onClick={() => void inheritVaultDefaults()}>Usar padrão do Vault</button>
              <button type="button" className="secondary-button" disabled={saving} onClick={closeDialog}>Cancelar</button>
              <button type="button" className="primary-button" disabled={saving || !validation?.success} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar política'}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
