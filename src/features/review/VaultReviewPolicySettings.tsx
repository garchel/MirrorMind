import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { InfoTip } from '../../components/ui/InfoTip'
import { ReviewPriorityLevelPicker } from './ReviewPriorityLevelPicker'
import {
  getVaultReviewPolicyConfig,
  previewVaultReviewDefaults,
  setVaultReviewDefaults,
  vaultReviewDefaultsSchema,
} from './vaultReviewPolicy'
import type {
  VaultReviewDefaults,
  VaultReviewDefaultsPreview,
  VaultReviewPolicyConfig,
} from './vaultReviewPolicy'
import { PolicyWorkloadEstimate } from './PolicyWorkloadEstimate'
import { SettingsSection } from '../../components/SettingsSection'
import './vault-review-policy.css'
import { errorMessage } from '../../lib/tauri'

type Props = {
  vaultPath: string
}

/** Ordem dos ritmos na tela e a chave do que esta em uso. */
const PROFILE_ORDER = ['light', 'balanced', 'intensive'] as const
type PresetKey = keyof typeof PRESETS

function presetKeyFor(form: VaultReviewDefaults): PresetKey | null {
  for (const key of PROFILE_ORDER) {
    const values = PRESETS[key].defaults
    if (
      form.firstReviewIntervalDays === values.firstReviewIntervalDays
      && Math.abs(form.targetRetention - values.targetRetention) < 1e-9
      && form.minIntervalDays === values.minIntervalDays
      && form.maxIntervalDays === values.maxIntervalDays
    ) {
      return key
    }
  }
  return null
}

const PRESETS = {
  intensive: {
    label: 'Intensiva',
    description: '90% de retenção, prioridade alta e intervalos curtos.',
    defaults: {
      firstReviewIntervalDays: 1,
      targetRetention: 0.9,
      priorityWeight: 3,
      minIntervalDays: 1,
      maxIntervalDays: 90,
    },
  },
  balanced: {
    label: 'Equilibrada',
    description: '80% de retenção e carga moderada.',
    defaults: {
      firstReviewIntervalDays: 2,
      targetRetention: 0.8,
      priorityWeight: 2,
      minIntervalDays: 1,
      maxIntervalDays: 365,
    },
  },
  light: {
    label: 'Leve',
    description: '70% de retenção e revisões ocasionais.',
    defaults: {
      firstReviewIntervalDays: 7,
      targetRetention: 0.7,
      priorityWeight: 1,
      minIntervalDays: 3,
      maxIntervalDays: 730,
    },
  },
} as const

export function VaultReviewPolicySettings({ vaultPath }: Props) {
  const [config, setConfig] = useState<VaultReviewPolicyConfig | null>(null)
  const [form, setForm] = useState<VaultReviewDefaults | null>(null)
  const [preview, setPreview] = useState<{
    result: VaultReviewDefaultsPreview
    defaults: VaultReviewDefaults
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  /** "Personalizado" aberto: mostra os numeros do ritmo, como na pagina de Tags. */
  const [customProfile, setCustomProfile] = useState(false)
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoading(true)
    setBusy(false)
    setConfig(null)
    setForm(null)
    setPreview(null)
    setError('')
    setSuccess('')
    void getVaultReviewPolicyConfig(vaultPath)
      .then((next) => {
        if (generationRef.current !== generation) return
        setConfig(next)
        setForm(next.defaults)
      })
      .catch((cause) => {
        if (generationRef.current === generation) {
          setError(errorMessage(cause, String(cause)))
        }
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false)
      })
  }, [reloadToken, vaultPath])

  const validation = form ? vaultReviewDefaultsSchema.safeParse(form) : null

  function updateForm(next: VaultReviewDefaults) {
    setForm(next)
    setPreview(null)
    setError('')
    setSuccess('')
  }

  function setNumber(field: keyof VaultReviewDefaults, value: number) {
    if (!form) return
    updateForm({ ...form, [field]: value })
  }

  /** Metodo padrao das sessoes (ritmos nao mexem nele: esforço e metodo sao
   * ortogonais). */
  /** Ritmo pronto em uso (null quando os numeros sao personalizados). */
  const activePreset = form ? presetKeyFor(form) : null

  function setPreferredMode(preferredMode: VaultReviewDefaults['preferredMode']) {
    if (!form) return
    updateForm({ ...form, preferredMode })
  }

  async function requestSave() {
    if (!config || !validation?.success) return
    const generation = generationRef.current
    const defaults = validation.data
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const nextPreview = await previewVaultReviewDefaults(vaultPath, defaults)
      if (generationRef.current !== generation) return
      if (nextPreview.affectedNoteCount > 0) {
        setPreview({ result: nextPreview, defaults })
      } else {
        await applyDefaults(defaults, generation)
      }
    } catch (cause) {
      if (generationRef.current === generation) {
        setError(errorMessage(cause, String(cause)))
      }
    } finally {
      if (generationRef.current === generation) setBusy(false)
    }
  }

  async function applyDefaults(defaults: VaultReviewDefaults, generation = generationRef.current) {
    if (!config) return
    setBusy(true)
    setError('')
    try {
      const updated = await setVaultReviewDefaults({
        vaultPath,
        expectedRevision: config.revision,
        defaults,
      })
      if (generationRef.current !== generation) return
      setConfig(updated)
      setForm(updated.defaults)
      setPreview(null)
      setSuccess(updated.affectedNoteCount === 0
        ? 'Padrão do Vault salvo. Nenhuma nota existente precisou ser recalculada.'
        : `Padrão do Vault salvo. ${updated.affectedNoteCount} nota(s) recalculada(s).`)
    } catch (cause) {
      if (generationRef.current === generation) {
        setError(errorMessage(cause, String(cause)))
      }
    } finally {
      if (generationRef.current === generation) setBusy(false)
    }
  }

  return (
    <SettingsSection
      id="vault-review-policy-title"
      kicker="Revisão"
      title="Padrão de revisão do Vault"
      description="Usado por notas sem uma sobrescrita própria ou regra de tag."
      aside={config ? <span>revisão {config.revision}</span> : null}
      className="vault-review-policy-settings"
    >

      {loading ? <p role="status">Carregando política do Vault…</p> : null}
      {!loading && !form ? (
        <Button type="button" variant="secondary" size="md" onClick={() => setReloadToken((current) => current + 1)}>
          Tentar carregar novamente
        </Button>
      ) : null}

      {form ? (
        <>
          <div className="settings-segmented" role="radiogroup" aria-label="Ritmo padrão do vault">
            {PROFILE_ORDER.map((key) => {
              const preset = PRESETS[key]
              const ativo = !customProfile && activePreset === key
              return (
                <Button
                  key={key}
                  type="button"
                  variant="bare"
                  size="sm"
                  role="radio"
                  aria-checked={ativo}
                  className={ativo ? 'is-active' : ''}
                  disabled={busy}
                  onClick={() => {
                    if (!form) return
                    setCustomProfile(false)
                    // Ritmos definem esforço; o metodo padrao e escolha separada
                    // e sobrevive a troca de ritmo.
                    updateForm({ ...preset.defaults, preferredMode: form.preferredMode })
                  }}
                >
                  {preset.label}
                </Button>
              )
            })}
            <Button
              type="button"
              variant="bare"
              size="sm"
              role="radio"
              aria-checked={customProfile}
              className={customProfile ? 'is-active' : ''}
              disabled={busy}
              onClick={() => setCustomProfile(true)}
            >
              Personalizado
            </Button>
          </div>

          <p className="vault-review-policy-summary">
            {customProfile
              ? 'Ajuste os números do ritmo logo abaixo.'
              : `Primeira revisão em ${form.firstReviewIntervalDays} dia${form.firstReviewIntervalDays === 1 ? '' : 's'} · `
                + `retenção ${Math.round(form.targetRetention * 100)}% · `
                + `intervalos de ${form.minIntervalDays} a ${form.maxIntervalDays} dias · `
                + `prioridade ${form.priorityWeight === 3 ? 'alta' : form.priorityWeight === 2 ? 'normal' : 'baixa'}.`}
          </p>

          {customProfile ? (
            <fieldset className="vault-review-policy-fields">
              <legend>
                Ritmo de revisão
                <InfoTip label="Ritmo de revisão padrão do vault">
                  <p>
                    A <em>primeira revisão</em> é o prazo até a estreia; a <em>retenção</em> é
                    quanto você quer lembrar na hora de revisar; os <em>intervalos</em> limitam o
                    espaçamento.
                  </p>
                </InfoTip>
              </legend>
              <label><span>Primeira revisão</span><div><Field size="sm" type="number" min="1" max="3650" value={form.firstReviewIntervalDays} onChange={(event) => setNumber('firstReviewIntervalDays', Number(event.target.value))} aria-label="Primeira revisão em dias" /><small>dias</small></div></label>
              <label><span>Retenção desejada</span><div><Field size="sm" type="number" min="50" max="99" value={Math.round(form.targetRetention * 100)} onChange={(event) => setNumber('targetRetention', Number(event.target.value) / 100)} aria-label="Retenção desejada em porcentagem" /><small>%</small></div></label>
              <label><span>Intervalo mínimo</span><div><Field size="sm" type="number" min="1" max="3650" value={form.minIntervalDays} onChange={(event) => setNumber('minIntervalDays', Number(event.target.value))} aria-label="Intervalo mínimo em dias" /><small>dias</small></div></label>
              <label><span>Intervalo máximo</span><div><Field size="sm" type="number" min="1" max="36500" value={form.maxIntervalDays} onChange={(event) => setNumber('maxIntervalDays', Number(event.target.value))} aria-label="Intervalo máximo em dias" /><small>dias</small></div></label>
            </fieldset>
          ) : null}

          {customProfile ? (
            <div className="review-priority-field">
              <span className="review-priority-field-label">
                Prioridade na fila
                <InfoTip label="Prioridade padrão na fila">
                  <p>
                    Quem aparece primeiro na fila: <em>Normal</em> entra pelo atraso,
                    <em> Alta</em> passa na frente e <em>Urgente</em> vai para o topo.
                  </p>
                </InfoTip>
              </span>
              <ReviewPriorityLevelPicker
                value={form.priorityWeight}
                onChange={(weight) => setNumber('priorityWeight', weight)}
              />
            </div>
          ) : null}

          <fieldset className="vault-review-policy-modes">
            <legend>
              Método de avaliação
              <InfoTip label="Método de avaliação padrão">
                <p>
                  Formato das perguntas nas sessões de notas novas: <em>Prova</em> (independentes)
                  ou <em>Conversa</em> (exploração). Tags e a própria nota podem sobrescrever.
                </p>
              </InfoTip>
            </legend>
            <div className="settings-segmented" role="radiogroup" aria-label="Método de avaliação padrão">
              <Button
                type="button" variant="bare" size="sm" role="radio"
                aria-checked={form.preferredMode === 'exam'}
                className={form.preferredMode === 'exam' ? 'is-active' : ''}
                onClick={() => setPreferredMode('exam')}
              >
                Prova
              </Button>
              <Button
                type="button" variant="bare" size="sm" role="radio"
                aria-checked={form.preferredMode === 'conversation'}
                className={form.preferredMode === 'conversation' ? 'is-active' : ''}
                onClick={() => setPreferredMode('conversation')}
              >
                Conversa
              </Button>
            </div>
          </fieldset>

          {form.maxIntervalDays < form.minIntervalDays ? <p className="field-error" role="alert">O intervalo máximo deve ser igual ou maior que o mínimo.</p> : null}

          {form ? (
            <PolicyWorkloadEstimate
              firstReviewIntervalDays={form.firstReviewIntervalDays}
              targetRetention={form.targetRetention}
              minIntervalDays={form.minIntervalDays}
              maxIntervalDays={form.maxIntervalDays}
              valid={validation?.success === true}
            />
          ) : null}

          {preview ? (
            <div className="vault-review-policy-confirmation" role="alertdialog" aria-label="Confirmar alteração do padrão do Vault">
              <p><strong>{preview.result.affectedNoteCount} notas terão suas datas recalculadas.</strong> Sobrescritas próprias serão preservadas.</p>
              <div>
                <Button type="button" variant="secondary" size="md" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button>
                <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => void applyDefaults(preview.defaults)}>{busy ? 'Aplicando…' : 'Confirmar alteração'}</Button>
              </div>
            </div>
          ) : (
            <div className="review-ai-inline-actions">
              <Button type="button" variant="primary" size="sm" disabled={busy || !validation?.success} onClick={() => void requestSave()}>{busy ? 'Calculando impacto…' : 'Salvar padrão'}</Button>
            </div>
          )}
        </>
      ) : null}



      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {success ? <p className="vault-review-policy-success" role="status">{success}</p> : null}
    </SettingsSection>
  )
}