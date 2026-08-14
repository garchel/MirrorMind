import { useEffect, useRef, useState } from 'react'
import {
  checkOllamaReviewStatus,
  configureGeminiApiKey,
  configureOpenAiCompatibleProvider,
  confirmGeminiDataConsent,
  getReviewAiConfiguration,
  getReviewUsageStatus,
  removeGeminiApiKey,
  removeOpenAiCompatibleProvider,
  reviewAiErrorMessage,
} from './ai'
import type { OllamaStatus, ReviewAiConfiguration, ReviewAiProvider, UsageStatus } from './ai'
import { estimateManagedCallCostUsd } from './managedProvider'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import './review-ai.css'

/** Contagem de caracteres do prompt estimado para a chamada gerenciada. */
function estimatedManagedInputChars(): number {
  // Prompt estruturado tipico de uma avaliacao de revisao (instrucoes + nota
  // de tamanho medio + resposta). O servico usara a medicao real por conta.
  return 8_000
}

export function ReviewAiSettings({ vaultPath }: { vaultPath?: string }) {
  const { provider, setProvider, geminiConsent, setGeminiConsent, managedStatus, canUseManaged, managedUnavailableMessage } = useReviewAiSettings()
  const [configuration, setConfiguration] = useState<ReviewAiConfiguration | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState('')
  const [openAiModel, setOpenAiModel] = useState('')
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
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

  useEffect(() => {
    if (!vaultPath) return
    let active = true
    void getReviewUsageStatus(vaultPath)
      .then((next) => { if (active) setUsage(next) })
      .catch(() => { if (active) setUsage(null) })
    return () => { active = false }
  }, [vaultPath])

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

  async function toggleConsent(checked: boolean) {
    if (!checked) {
      setGeminiConsent(false)
      return
    }
    // O consentimento so e concedido pelo dialogo nativo do SO: o checkbox
    // apenas reflete a decisao confirmada fora do renderer. Cancelar mantem
    // o consentimento desmarcado e nada e persistido.
    const confirmed = await confirmGeminiDataConsent()
    if (confirmed) setGeminiConsent(true)
  }

  async function saveOpenAiCompatible() {
    configurationGenerationRef.current += 1
    setBusy(true)
    setError('')
    try {
      setConfiguration(await configureOpenAiCompatibleProvider({
        baseUrl: openAiBaseUrl,
        model: openAiModel,
        apiKey: openAiApiKey,
      }))
      setOpenAiBaseUrl('')
      setOpenAiModel('')
      setOpenAiApiKey('')
    } catch (cause) {
      setError(reviewAiErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function removeOpenAiCompatible() {
    configurationGenerationRef.current += 1
    setBusy(true)
    setError('')
    try {
      setConfiguration(await removeOpenAiCompatibleProvider())
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
          <option value="openAiCompatible">OpenAI-compatible</option>
          <option value="managed" disabled>MirrorMind (assinatura) — em breve</option>
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
              onChange={(event) => void toggleConsent(event.target.checked)}
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
      ) : provider === 'managed' ? (
        <div className="review-ai-provider-panel">
          <p>{managedUnavailableMessage}</p>
          {managedStatus.subscribed ? (
            <dl className="review-ai-usage">
              <div><dt>Plano</dt><dd>{managedStatus.plan}</dd></div>
              <div><dt>Custo estimado no mes</dt><dd>US$ {managedStatus.usedCostUsdMonth.toFixed(2)} de US$ {managedStatus.includedCostUsdPerMonth.toFixed(2)}</dd></div>
              <div><dt>Chamada estimada</dt><dd>US$ {estimateManagedCallCostUsd(estimatedManagedInputChars()).toFixed(2)}</dd></div>
            </dl>
          ) : (
            <p className="review-ai-managed-scaffold">
              Custo estimado por chamada gerenciada: US$ {estimateManagedCallCostUsd(estimatedManagedInputChars()).toFixed(2)} ·
              {' '}{canUseManaged(0.01) ? 'quota disponível' : 'aguardando o serviço de assinatura'}
            </p>
          )}
        </div>
      ) : provider === 'openAiCompatible' ? (
        <div className="review-ai-provider-panel">
          <p>
            Qualquer servidor com a API de chat completions OpenAI-compatible (OpenAI, OpenRouter,
            LM Studio, vLLM...). A chave fica no cofre nativo e nunca no Vault.
          </p>
          {configuration?.openAiCompatibleConfigured ? (
            <dl>
              <div><dt>Endereco</dt><dd>{configuration.openAiCompatibleBaseUrl}</dd></div>
              <div><dt>Modelo</dt><dd>{configuration.openAiCompatibleModel}</dd></div>
            </dl>
          ) : null}
          <label className="review-ai-key-field" htmlFor="openai-compatible-base-url">
            <span>Endereco do servidor</span>
            <input
              id="openai-compatible-base-url"
              type="text"
              value={openAiBaseUrl}
              onChange={(event) => setOpenAiBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label className="review-ai-key-field" htmlFor="openai-compatible-model">
            <span>Modelo</span>
            <input
              id="openai-compatible-model"
              type="text"
              value={openAiModel}
              onChange={(event) => setOpenAiModel(event.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
          <label className="review-ai-key-field" htmlFor="openai-compatible-api-key">
            <span>Chave da API</span>
            <input
              id="openai-compatible-api-key"
              type="password"
              value={openAiApiKey}
              onChange={(event) => setOpenAiApiKey(event.target.value)}
              autoComplete="off"
              placeholder={configuration?.openAiCompatibleConfigured ? 'Chave armazenada com seguranca' : 'Cole a chave da API'}
            />
          </label>
          <div className="review-ai-inline-actions">
            {configuration?.openAiCompatibleConfigured ? (
              <button type="button" className="secondary-button danger-button" onClick={() => void removeOpenAiCompatible()} disabled={busy}>
                Remover servidor
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void saveOpenAiCompatible()}
              disabled={busy || !openAiBaseUrl.trim() || !openAiModel.trim() || !openAiApiKey.trim()}
            >
              Salvar servidor
            </button>
          </div>
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
      {usage ? (
        <dl className="review-ai-usage">
          <div><dt>Chamadas de IA hoje</dt><dd>{usage.totalCalls} de {usage.maxCallsPerDay}{usage.exceeded ? ' (orçamento atingido)' : ''}</dd></div>
          <div><dt>Nos ultimos 60s</dt><dd>{usage.callsInMinute} de {usage.maxCallsPerMinute}</dd></div>
          <div><dt>Custo estimado hoje</dt><dd>US$ {usage.estimatedCostUsd.toFixed(2)}</dd></div>
          <div><dt>Custo estimado no mes</dt><dd>US$ {usage.estimatedCostUsdMonth.toFixed(2)} de US$ {usage.maxCostPerMonthUsd.toFixed(2)}{usage.monthlyExceeded ? ' (orçamento mensal atingido)' : ''}</dd></div>
          {usage.providerCalls.map((entry) => (
            <div key={entry.provider}><dt>Provedor {entry.provider}</dt><dd>{entry.calls}</dd></div>
          ))}
        </dl>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  )
}
