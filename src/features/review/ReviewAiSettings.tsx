import { useEffect, useRef, useState } from 'react'
import {
  checkOllamaReviewStatus,
  getReviewAiConfiguration,
  getReviewUsageStatus,
  reviewAiErrorMessage,
  runProviderComparability,
} from './ai'
import { reviewProvider } from './reviewProvider'
import type { DivergenceReport, OllamaStatus, ReviewAiConfiguration, ReviewAiProvider, UsageStatus } from './ai'
import { estimateManagedCallCostUsd } from './managedProvider'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import { SettingsSection } from '../../components/SettingsSection'
import './review-ai.css'

/** Contagem de caracteres do prompt estimado para a chamada gerenciada. */
function estimatedManagedInputChars(): number {
  // Prompt estruturado tipico de uma avaliacao de revisao (instrucoes + nota
  // de tamanho medio + resposta). O servico usara a medicao real por conta.
  return 8_000
}

export function ReviewAiSettings({ vaultPath }: { vaultPath?: string }) {
  const { provider, setProvider, geminiConsent, setGeminiConsent, openAiConsent, setOpenAiConsent, managedStatus, canUseManaged, managedUnavailableMessage } = useReviewAiSettings()
  const [configuration, setConfiguration] = useState<ReviewAiConfiguration | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState('')
  const [openAiModel, setOpenAiModel] = useState('')
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [comparison, setComparison] = useState<DivergenceReport | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [comparisonError, setComparisonError] = useState('')
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
      setConfiguration(await reviewProvider.configure({ kind: 'gemini', apiKey }))
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
      setConfiguration(await reviewProvider.remove('gemini'))
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
    const confirmed = await reviewProvider.confirmDataConsent('gemini')
    if (confirmed) setGeminiConsent(true)
  }

  async function toggleOpenAiConsent(checked: boolean) {
    if (!checked) {
      setOpenAiConsent(false)
      return
    }
    const confirmed = await reviewProvider.confirmDataConsent('openAiCompatible')
    if (confirmed) setOpenAiConsent(true)
  }

  async function saveOpenAiCompatible() {
    configurationGenerationRef.current += 1
    setBusy(true)
    setError('')
    try {
      setConfiguration(await reviewProvider.configure({
        kind: 'openAiCompatible',
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
      setConfiguration(await reviewProvider.remove('openAiCompatible'))
    } catch (cause) {
      setError(reviewAiErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function runComparison() {
    setComparisonLoading(true)
    setComparisonError('')
    try {
      setComparison(await runProviderComparability())
    } catch (cause) {
      setComparison(null)
      setComparisonError(reviewAiErrorMessage(cause))
    } finally {
      setComparisonLoading(false)
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
    <SettingsSection
      id="review-ai-settings-title"
      kicker="Revisão"
      title="Revisão com IA"
      className="review-ai-settings"
    >
      <label className="settings-toggle">
        <span>
          <strong>Provedor da revisão</strong>
          <small>A sessão usa somente o provedor escolhido. Não existe troca automática.</small>
        </span>
        <select
          className="settings-select"
          value={provider}
          onChange={(event) => setProvider(event.target.value as ReviewAiProvider)}
          aria-label="Provedor da revisão"
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
            O Gemini recebe apenas o Markdown da nota selecionada e os dados necessarios da sessão atual.
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
              placeholder={configuration?.geminiConfigured ? 'Chave armazenada com segurança' : 'Cole a chave da API'}
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
              <div><dt>Custo estimado no mês</dt><dd>US$ {managedStatus.usedCostUsdMonth.toFixed(2)} de US$ {managedStatus.includedCostUsdPerMonth.toFixed(2)}</dd></div>
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
          <p className="field-hint" style={{ color: 'var(--text-muted, #6b6b6b)', marginTop: 6 }}>
            <strong>LGPD Art.33 — Transferência internacional:</strong> o conteúdo da nota selecionada
            e os dados da sessão sairão do seu computador para o endereço configurado acima e serão
            tratados segundo a política do provedor. Use <code>https</code> para servidores remotos
            (<code>http</code> só para <code>127.0.0.1/localhost</code>). Não envie notas com dados
            sensíveis (Art.11) sem necessidade.
          </p>
          <label className="review-ai-consent">
            <input
              type="checkbox"
              checked={openAiConsent}
              onChange={(event) => void toggleOpenAiConsent(event.target.checked)}
            />
            <span>Autorizo o envio desses dados ao servidor OpenAI-compatible.</span>
          </label>
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
              placeholder={configuration?.openAiCompatibleConfigured ? 'Chave armazenada com segurança' : 'Cole a chave da API'}
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
      <section className="review-ai-comparability" aria-labelledby="comparability-title">
        <h3 id="comparability-title">Comparabilidade de provedores</h3>
        <p className="review-ai-comparability-hint">
          Mesma nota e perguntas no Ollama local e no provedor remoto;
          falha em um lado não derruba o relatório.
        </p>
        <div className="review-ai-inline-actions">
          <button type="button" className="secondary-button" onClick={() => void runComparison()} disabled={busy || comparisonLoading}>
            {comparisonLoading ? 'Comparando…' : 'Comparar provedores'}
          </button>
        </div>
        {comparisonError ? <p className="field-error" role="alert">{comparisonError}</p> : null}
        {comparison ? (
          <div className="review-ai-comparison-report" role="region" aria-label="Relatorio de divergencia">
            <dl>
              <div><dt>Cenario</dt><dd>{comparison.noteWords} palavras · {comparison.questionCount} perguntas · respostas fixas</dd></div>
              {comparison.scoreDelta !== null ? (
                <div><dt>Diferença da nota ({comparison.providers[1]} - {comparison.providers[0]})</dt><dd>{comparison.scoreDelta}</dd></div>
              ) : (
                <div><dt>Diferença da nota</dt><dd>indisponível (algum lado sem nota válida)</dd></div>
              )}
              <div><dt>Lacunas compartilhadas</dt><dd>{comparison.sharedGapQuotes.length}</dd></div>
              <div><dt>Só {comparison.providers[0]}</dt><dd>{comparison.ollamaOnlyGapQuotes.length}</dd></div>
              <div><dt>Só {comparison.providers[1]}</dt><dd>{comparison.geminiOnlyGapQuotes.length}</dd></div>
            </dl>
            {[comparison.ollama, comparison.gemini].map((outcome) => (
              <article key={outcome.provider} className="review-ai-comparison-provider">
                <h4>{outcome.provider}</h4>
                {outcome.failure ? (
                  <p className="field-error">Avaliação inválida: {outcome.failure}</p>
                ) : (
                  <>
                    <dl>
                      <div><dt>Nota geral</dt><dd>{outcome.overallScore ?? '-'}</dd></div>
                      <div><dt>Lacunas</dt><dd>{outcome.gapCount}</dd></div>
                      <div><dt>Inconclusivas</dt><dd>{outcome.inconclusiveCount}</dd></div>
                    </dl>
                    {outcome.gapQuotes.length > 0 ? (
                      <ul className="review-ai-comparison-quotes">
                        {outcome.gapQuotes.map((quote) => <li key={quote}>{quote}</li>)}
                      </ul>
                    ) : null}
                  </>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </section>
      {usage ? (
        <dl className="review-ai-usage">
          <div><dt>Chamadas de IA hoje</dt><dd>{usage.totalCalls} de {usage.maxCallsPerDay}{usage.exceeded ? ' (orçamento atingido)' : ''}</dd></div>
          <div><dt>Nos ultimos 60s</dt><dd>{usage.callsInMinute} de {usage.maxCallsPerMinute}</dd></div>
          <div><dt>Custo estimado hoje</dt><dd>US$ {usage.estimatedCostUsd.toFixed(2)}</dd></div>
          <div><dt>Descricoes de imagem hoje</dt><dd>{usage.visionCalls} (visao — contadas no orcamento antes do envio)</dd></div>
          <div><dt>Custo estimado no mês</dt><dd>US$ {usage.estimatedCostUsdMonth.toFixed(2)} de US$ {usage.maxCostPerMonthUsd.toFixed(2)}{usage.monthlyExceeded ? ' (orçamento mensal atingido)' : ''}</dd></div>
          {usage.providerCalls.map((entry) => (
            <div key={entry.provider}><dt>Provedor {entry.provider}</dt><dd>{entry.calls}</dd></div>
          ))}
        </dl>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </SettingsSection>
  )
}
