import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  getVaultReviewPolicyConfig,
  parseSegmentationRecalcProgress,
  setVaultSegmentation,
} from './vaultReviewPolicy'
import type {
  SegmentationRecalcProgress,
  VaultReviewPolicyConfig,
} from './vaultReviewPolicy'
import { SettingsSection } from '../../components/SettingsSection'
import './segmentation-settings.css'

type Props = {
  vaultPath: string
}

type Toast =
  | { kind: 'progress'; progress: SegmentationRecalcProgress }
  | { kind: 'success'; changed: number }
  | { kind: 'error'; message: string }

const WORD_LIMIT_MIN = 50
const WORD_LIMIT_MAX = 10_000

export function SegmentationSettings({ vaultPath }: Props) {
  const [config, setConfig] = useState<VaultReviewPolicyConfig | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const generationRef = useRef(0)
  const toastTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoading(true)
    setBusy(false)
    setConfig(null)
    setDraft('')
    setError('')
    setToast(null)
    void getVaultReviewPolicyConfig(vaultPath)
      .then((next) => {
        if (generationRef.current !== generation) return
        setConfig(next)
        setDraft(String(next.segmentation.maxWholeNoteWords))
      })
      .catch((cause) => {
        if (generationRef.current === generation) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false)
      })
  }, [reloadToken, vaultPath])

  useEffect(() => {
    if (!busy) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen<unknown>('segmentation-recalc-progress', (event) => {
      let progress: SegmentationRecalcProgress
      try {
        progress = parseSegmentationRecalcProgress(event.payload)
      } catch {
        return
      }
      setToast({ kind: 'progress', progress })
    }).then((stop) => {
      if (cancelled) {
        stop()
        return
      }
      unlisten = stop
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [busy])

  useEffect(() => () => {
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current)
  }, [])

  function showTransient(toast: Toast, durationMs = 6_000) {
    setToast(toast)
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current)
    if (toast.kind !== 'progress') {
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null)
        toastTimerRef.current = undefined
      }, durationMs)
    }
  }

  const parsedDraft = Number(draft)
  const draftValid = Number.isInteger(parsedDraft)
    && parsedDraft >= WORD_LIMIT_MIN
    && parsedDraft <= WORD_LIMIT_MAX

  async function requestRecalculate() {
    if (!config || !draftValid || busy) return
    const generation = generationRef.current
    const maxWholeNoteWords = parsedDraft
    setBusy(true)
    setError('')
    setToast(null)
    try {
      const updated = await setVaultSegmentation({
        vaultPath,
        expectedRevision: config.revision,
        maxWholeNoteWords,
      })
      if (generationRef.current !== generation) return
      setConfig(updated)
      setDraft(String(updated.segmentation.maxWholeNoteWords))
      showTransient({
        kind: 'success',
        changed: updated.affectedNoteCount,
      })
    } catch (cause) {
      if (generationRef.current !== generation) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      showTransient({ kind: 'error', message }, 8_000)
      // Revisão obsoleta (outra operação salvou o config): recarrega para sincronizar.
      if (/alterada por outra operacao|revisao foi alterada/i.test(message)) {
        void getVaultReviewPolicyConfig(vaultPath)
          .then((next) => {
            if (generationRef.current !== generation) return
            setConfig(next)
            setDraft(String(next.segmentation.maxWholeNoteWords))
          })
          .catch(() => undefined)
      }
    } finally {
      if (generationRef.current === generation) setBusy(false)
    }
  }

  return (
    <SettingsSection
      id="segmentation-settings-title"
      kicker="Revisão"
      title="Segmentação de unidades"
      description="Controla a partir de quantas palavras uma nota deixa de ser tratada como uma unidade única e passa a ser dividida em seções (notas com títulos) ou parágrafos (notas sem títulos), com identidade determinística."
      aside={config ? <span>revisão {config.revision}</span> : null}
      className="segmentation-settings"
    >

      {loading ? <p role="status">Carregando segmentação do Vault…</p> : null}
      {!loading && !config ? (
        <button type="button" className="secondary-button" onClick={() => setReloadToken((current) => current + 1)}>
          Tentar carregar novamente
        </button>
      ) : null}

      {config ? (
        <>
          <label className="segmentation-field">
            <span>
              <strong>Máximo de palavras por nota inteira</strong>
              <small>Até este tamanho, a nota é uma única unidade; acima, cada parágrafo vira uma.</small>
            </span>
            <input
              type="number"
              min={WORD_LIMIT_MIN}
              max={WORD_LIMIT_MAX}
              step={50}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Máximo de palavras por nota inteira"
              aria-invalid={!draftValid}
            />
          </label>
          {!draftValid ? (
            <p className="field-error" role="alert">
              O limite deve ser um número inteiro entre {WORD_LIMIT_MIN} e {WORD_LIMIT_MAX}.
            </p>
          ) : null}
          <div className="review-ai-inline-actions">
            <button
              type="button"
              disabled={busy || !draftValid}
              onClick={() => void requestRecalculate()}
            >
              {busy ? 'Recalculando…' : 'Recalcular notas'}
            </button>
            <span className="segmentation-hint">Recalcular percorre todas as notas e atualiza as que se encaixarem no novo padrão.</span>
          </div>
        </>
      ) : null}

      {error ? <p className="field-error" role="alert">{error}</p> : null}

      {toast ? (
        <div
          className={`segmentation-toast is-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          {toast.kind === 'progress' ? (
            <>
              <div className="segmentation-toast-heading">
                <strong>Recalculando notas…</strong>
                <span>{toast.progress.processed} de {toast.progress.total} avaliadas</span>
              </div>
              <div
                className="segmentation-toast-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={toast.progress.total}
                aria-valuenow={toast.progress.processed}
              >
                <span
                  className="segmentation-toast-fill"
                  style={{ width: toast.progress.total === 0
                    ? '0%'
                    : `${Math.round((toast.progress.processed / toast.progress.total) * 100)}%` }}
                />
              </div>
              {toast.progress.changed > 0 ? (
                <small>{toast.progress.changed} alteradas até agora</small>
              ) : null}
            </>
          ) : null}
          {toast.kind === 'success' ? (
            <>
              <strong>Recálculo concluído</strong>
              <span>
                {toast.changed === 0
                  ? 'Nenhuma nota precisou ser recalculada com o novo limite.'
                  : `${toast.changed} nota${toast.changed === 1 ? '' : 's'} recalculada${toast.changed === 1 ? '' : 's'} com sucesso.`}
              </span>
            </>
          ) : null}
          {toast.kind === 'error' ? (
            <>
              <strong>Não foi possível recalcular</strong>
              <span>{toast.message}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </SettingsSection>
  )
}
