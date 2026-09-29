import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
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
        <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setReloadToken((current) => current + 1)}>
          Tentar carregar novamente
        </Button>
      ) : null}

      {form ? (
        <>
          <div className="vault-review-policy-presets" aria-label="Ritmos padrão do Vault">
            {Object.values(PRESETS).map((preset) => (
              <Button
                type="button"
                key={preset.label}
                className="ui-button ui-button--secondary ui-button--sm"
                disabled={busy}
                onClick={() => {
                  if (!form) return
                  // Ritmos definem esforço; o metodo padrao e escolha separada
                  // e sobrevive a troca de ritmo.
                  updateForm({ ...preset.defaults, preferredMode: form.preferredMode })
                }}
              >
                <strong>{preset.label}</strong>
                <small>{preset.description}</small>
              </Button>
            ))}
          </div>

          <fieldset className="vault-review-policy-modes">
            <legend>Método de Revisão</legend>
            <p className="vault-review-policy-modes-hint">Método padrão das sessões de notas novas. Tags e a própria nota podem sobrescrever.</p>
            <div>
              <label><input type="radio" name="vault-default-review-mode" checked={form.preferredMode === 'exam'} onChange={() => setPreferredMode('exam')} /> <span><strong>Prova</strong><small>Perguntas independentes.</small></span></label>
              <label><input type="radio" name="vault-default-review-mode" checked={form.preferredMode === 'conversation'} onChange={() => setPreferredMode('conversation')} /> <span><strong>Conversa</strong><small>Exploração progressiva.</small></span></label>
            </div>
          </fieldset>

          <details className="vault-review-policy-advanced">
            <summary>Opções avançadas</summary>
            <div>
              <label>Primeira revisão (dias)<input type="number" min="1" max="3650" value={form.firstReviewIntervalDays} onChange={(event) => setNumber('firstReviewIntervalDays', Number(event.target.value))} /></label>
              <label>Retenção desejada (%)<input type="number" min="50" max="99" value={Math.round(form.targetRetention * 100)} onChange={(event) => setNumber('targetRetention', Number(event.target.value) / 100)} /></label>
              <label>Peso de prioridade<input type="number" min="0.1" max="100" step="0.1" value={form.priorityWeight} onChange={(event) => setNumber('priorityWeight', Number(event.target.value))} /></label>
              <label>Intervalo mínimo (dias)<input type="number" min="1" max="3650" value={form.minIntervalDays} onChange={(event) => setNumber('minIntervalDays', Number(event.target.value))} /></label>
              <label>Intervalo máximo (dias)<input type="number" min="1" max="36500" value={form.maxIntervalDays} onChange={(event) => setNumber('maxIntervalDays', Number(event.target.value))} /></label>
            </div>
            {form.maxIntervalDays < form.minIntervalDays ? <p className="field-error" role="alert">O intervalo máximo deve ser igual ou maior que o mínimo.</p> : null}
          </details>

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
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button>
                <button type="button" disabled={busy} onClick={() => void applyDefaults(preview.defaults)}>{busy ? 'Aplicando…' : 'Confirmar alteração'}</button>
              </div>
            </div>
          ) : (
            <div className="review-ai-inline-actions">
              <button type="button" disabled={busy || !validation?.success} onClick={() => void requestSave()}>{busy ? 'Calculando impacto…' : 'Salvar padrão'}</button>
            </div>
          )}
        </>
      ) : null}



      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {success ? <p className="vault-review-policy-success" role="status">{success}</p> : null}
    </SettingsSection>
  )
}