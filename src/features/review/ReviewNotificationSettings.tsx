import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import {
  getReviewNotificationSettings,
  sendReviewTestNotification,
  setReviewNotificationSettings,
  type ReviewNotificationCheck,
  type ReviewNotificationSettings,
} from './reviewNotifications'
import './review-notification-settings.css'

type Props = {
  /** Resultado da ultima checagem periodica, exibido como status. */
  lastCheck: ReviewNotificationCheck | null
  /** Dispara uma checagem imediata (ex.: apos mudar a hora). */
  onRequestCheck: () => void
}

function toTimeInput(settings: Pick<ReviewNotificationSettings, 'hour' | 'minute'>) {
  return `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`
}

function fromTimeInput(value: string): Pick<ReviewNotificationSettings, 'hour' | 'minute'> | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function ReviewNotificationSettings({ lastCheck, onRequestCheck }: Props) {
  const [settings, setSettings] = useState<ReviewNotificationSettings | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [testStatus, setTestStatus] = useState('')
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    void getReviewNotificationSettings()
      .then((next) => {
        if (generationRef.current === generation) setSettings(next)
      })
      .catch((cause) => {
        if (generationRef.current === generation) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => { generationRef.current += 1 }
  }, [])

  async function update(patch: Partial<ReviewNotificationSettings>) {
    if (!settings || busy) return
    const generation = generationRef.current
    setBusy(true)
    setError('')
    try {
      const next = await setReviewNotificationSettings({ ...settings, ...patch })
      if (generationRef.current !== generation) return
      setSettings(next)
      // Habilitar ou silenciar muda se a notificacao pode sair: re-checa agora.
      if (patch.enabled !== undefined || patch.muted !== undefined) onRequestCheck()
    } catch (cause) {
      if (generationRef.current === generation) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (generationRef.current === generation) setBusy(false)
    }
  }

  async function sendTest() {
    if (busy) return
    setBusy(true)
    setError('')
    setTestStatus('')
    try {
      await sendReviewTestNotification()
      setTestStatus('Notificacao de teste enviada.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return (
      <div className="settings-section review-notification-settings" aria-labelledby="review-notification-settings-title">
        <p className="card-kicker" id="review-notification-settings-title">Notificacoes de revisao</p>
        <p role="status">Carregando preferencias de notificacao...</p>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="settings-section review-notification-settings" aria-labelledby="review-notification-settings-title">
      <div className="review-notification-heading">
        <div>
          <p className="card-kicker" id="review-notification-settings-title">Notificacoes de revisao</p>
          <small>Um unico resumo diario com o total de revisoes vencidas, em vez de uma notificacao por nota.</small>
        </div>
        <Bell size={16} strokeWidth={1.6} aria-hidden="true" />
      </div>

      <label className="settings-toggle">
        <span>
          <strong>Resumo diario</strong>
          <small>Notifica uma vez por dia, na hora escolhida, quando houver revisoes vencidas no vault aberto.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) => void update({ enabled: event.target.checked })}
          aria-label="Resumo diario de revisoes vencidas"
        />
      </label>

      {settings.enabled ? (
        <>
          <label className="settings-toggle">
            <span>
              <strong>Hora do resumo</strong>
              <small>O resumo e enviado a partir deste horario, enquanto o aplicativo estiver aberto.</small>
            </span>
            <input
              className="review-notification-time"
              type="time"
              value={toTimeInput(settings)}
              disabled={busy}
              onChange={(event) => {
                const parsed = fromTimeInput(event.target.value)
                if (parsed) void update(parsed)
              }}
              aria-label="Hora do resumo diario"
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Silenciar</strong>
              <small>Mantem a configuracao, mas nao envia notificacoes ate reativar.</small>
            </span>
            <span className="review-notification-mute-icon" aria-hidden="true">
              <BellOff size={15} strokeWidth={1.6} />
            </span>
            <input
              type="checkbox"
              checked={settings.muted}
              disabled={busy}
              onChange={(event) => void update({ muted: event.target.checked })}
              aria-label="Silenciar notificacoes de revisao"
            />
          </label>
          <div className="review-ai-inline-actions">
            <button type="button" className="secondary-button" onClick={() => void sendTest()} disabled={busy || settings.muted}>
              Enviar notificacao de teste
            </button>
            {testStatus ? <span role="status">{testStatus}</span> : null}
          </div>
        </>
      ) : null}

      {lastCheck ? (
        <p className="review-notification-status" role="status">
          {lastCheck.sent
            ? `Resumo enviado: ${lastCheck.dueCount} ${lastCheck.dueCount === 1 ? 'revisao vencida' : 'revisoes vencidas'}.`
            : `Ultima checagem: ${lastCheck.dueCount} ${lastCheck.dueCount === 1 ? 'revisao vencida' : 'revisoes vencidas'}${lastCheck.skippedReason ? ` — ${lastCheck.skippedReason}` : ''}.`}
        </p>
      ) : null}

      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  )
}
