import { useEffect, useRef, useState } from 'react'
import {
  checkOllamaReviewStatus,
  configureGeminiApiKey,
  getReviewAiConfiguration,
  removeGeminiApiKey,
  reviewAiErrorMessage,
} from './ai'
import type { OllamaStatus, ReviewAiConfiguration, ReviewAiProvider } from './ai'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import './review-ai.css'

export function ReviewAiSettings() {
  const { provider, setProvider, geminiConsent, setGeminiConsent } = useReviewAiSettings()
  const [configuration, setConfiguration] = useState<ReviewAiConfiguration | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const configurationGenerationRef = useRef(0)

  useEffect(() => {
    let active = true
    const generation = configurationGenerationRef.current + 1
    configurationGenerationRef.current = generation
    void getReviewAiConfiguration()
      .then((next) => {
        if (active && configurationGenerationRef.current === generation) setConfiguration(next)
      })
      .catch((cause) => {
        if (active && configurationGenerationRef.current === generation) setError(reviewAiErrorMessage(cause))
      })
    return () => { active = false }
  }, [])

  async function saveKey() {
    configurationGenerationRef.current += 1
    setBusy(true)
    setError('')
    try {
      setConfiguration(await configureGeminiApiKey(apiKey))
      setApiKey('')
    } catch (cause) {
      setError(reviewAiErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function removeKey() {
    configurationGenerationRef.current += 1
    setBusy(true)
    setError('')
    try {
      setConfiguration(await removeGeminiApiKey())
      setApiKey('')
    } catch (cause) {
      setError(reviewAiErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function checkOllama() {
    setBusy(true)
    setError('')
    try {
      setOllamaStatus(await checkOllamaReviewStatus())
    } catch (cause) {
      setOllamaStatus(null)
      setError(reviewAiErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-section review-ai-settings" aria-labelledby="review-ai-settings-title">
      <p className="card-kicker" id="review-ai-settings-title">Revisao com IA</p>
      <label className="settings-toggle">
        <span>
          <strong>Provedor da revisao</strong>
          <small>A sessao usa somente o provedor escolhido. Nao existe troca automatica.</small>
        </span>
        <select
          className="settings-select"
          value={provider}
          onChange={(event) => setProvider(event.target.value as ReviewAiProvider)}
          aria-label="Provedor da revisao"
        >
          <option value="ollama">Ollama local</option>
          <option value="gemini">Gemini</option>
        </select>
      </label>

      {provider === 'gemini' ? (
        <div className="review-ai-provider-panel">
          <p>
            O Gemini recebe apenas o Markdown da nota selecionada e os dados necessarios da sessao atual.
            O restante do Vault permanece local.
          </p>
          <label className="review-ai-consent">
            <input
              type="checkbox"
              checked={geminiConsent}
              onChange={(event) => setGeminiConsent(event.target.checked)}
            />
            <span>Autorizo o envio desses dados ao Gemini.</span>
          </label>
          <label className="review-ai-key-field" htmlFor="gemini-api-key">
            <span>Chave da API Gemini</span>
            <input
              id="gemini-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              placeholder={configuration?.geminiConfigured ? 'Chave armazenada com seguranca' : 'Cole a chave da API'}
            />
            <small>A chave fica no cofre nativo do sistema e nunca no Vault.</small>
          </label>
          <div className="review-ai-inline-actions">
            {configuration?.geminiConfigured ? (
              <button type="button" className="secondary-button danger-button" onClick={() => void removeKey()} disabled={busy}>
                Remover chave
              </button>
            ) : null}
            <button type="button" onClick={() => void saveKey()} disabled={busy || !apiKey.trim()}>
              Salvar chave
            </button>
          </div>
          <small>Modelo gerenciado pelo MirrorMind: {configuration?.geminiModel ?? 'carregando...'}</small>
        </div>
      ) : (
        <div className="review-ai-provider-panel">
          <p>O processamento usa somente o Ollama instalado neste computador.</p>
          <dl>
            <div><dt>Endereco</dt><dd>{configuration?.ollamaEndpoint ?? 'http://127.0.0.1:11434/v1'}</dd></div>
            <div><dt>Modelo</dt><dd>{configuration?.ollamaModel ?? 'qwen2.5:7b'}</dd></div>
          </dl>
          <div className="review-ai-inline-actions">
            <button type="button" className="secondary-button" onClick={() => void checkOllama()} disabled={busy}>
              Verificar Ollama
            </button>
            {ollamaStatus ? (
              <span role="status">
                {ollamaStatus.reachable && ollamaStatus.modelInstalled
                  ? 'Pronto para revisar'
                  : ollamaStatus.reachable
                    ? <span>Modelo não encontrado. Execute <code>ollama pull qwen2.5:7b</code> no terminal.</span>
                    : 'O Ollama local não respondeu. Inicie o serviço e tente novamente.'}
              </span>
            ) : null}
          </div>
        </div>
      )}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  )
}
