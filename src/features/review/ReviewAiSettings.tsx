import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import {
  checkOllamaReviewStatus,
  getReviewAiConfiguration,
  getReviewUsageStatus,
  reviewAiErrorMessage,
} from './ai'
import { reviewProvider } from './reviewProvider'
import type { OllamaStatus, ReviewAiConfiguration, ReviewAiProvider, UsageStatus } from './ai'
import { estimateManagedCallCostUsd } from './managedProvider'
import { invoke } from '../../lib/tauri'
import { useReviewAiSettings } from './ReviewAiSettingsContext'
import { SettingsSection } from '../../components/SettingsSection'
import './review-ai.css'
import { Field } from '../../components/ui/Field'
import { InfoTip } from '../../components/ui/InfoTip'

/** Rotulos da pilula. O rotulo curto e o que cabe; o longo vira nome acessivel. */
const PROVIDER_OPTIONS: ReadonlyArray<{
  value: ReviewAiProvider
  label: string
  short: string
}> = [
  { value: 'ollama', label: 'Ollama local', short: 'Ollama local' },
  { value: 'gemini', label: 'Gemini', short: 'Gemini' },
  { value: 'openAiCompatible', label: 'OpenAI-compatible', short: 'Compatível' },
  { value: 'managed', label: 'MirrorMind', short: 'MirrorMind' },
]

/** Contagem de caracteres do prompt estimado para a chamada gerenciada. */
function estimatedManagedInputChars(): number {
  // Prompt estruturado tipico de uma avaliacao de revisao (instrucoes + nota
  // de tamanho medio + resposta). O servico usara a medicao real por conta.
  return 8_000
}

export function ReviewAiSettings({ vaultPath }: { vaultPath?: string }) {
  const { provider, selectProvider, geminiConsent, setGeminiConsent, openAiConsent, setOpenAiConsent, managedGate } = useReviewAiSettings()
  /**
   * Uso da IA incluída, vindo do servidor.
   *
   * Só é buscado quando a opção gerenciada está liberada: para quem usa Ollama ou
   * chave própria, isso seria uma chamada de rede sem uso — e o número não diria
   * nada sobre o gasto dela.
   */
  const [usoGerenciado, setUsoGerenciado] = useState<{ usado: number; limite: number | null } | null>(null)
  useEffect(() => {
    if (!managedGate.allowed) return
    let vivo = true
    void invoke<{ used?: { lifetime?: number; month?: number }; limits?: { lifetime?: number | null; monthly?: number | null } }>('managed_ai_status')
      .then((estado) => {
        if (!vivo || !estado) return
        const limite = estado.limits?.monthly ?? estado.limits?.lifetime ?? null
        const usado = estado.limits?.monthly != null
          ? (estado.used?.month ?? 0)
          : (estado.used?.lifetime ?? 0)
        setUsoGerenciado({ usado, limite })
      })
      .catch(() => {
        if (vivo) setUsoGerenciado(null)
      })
    return () => {
      vivo = false
    }
  }, [managedGate.allowed])
  const [configuration, setConfiguration] = useState<ReviewAiConfiguration | null>(null)
  const [apiKey, setApiKey] = useState('')
  /** Endereco e modelo do Ollama local: editar e salvar, como no servidor
   * OpenAI-compatible (antes eram dois valores somente-leitura). */
  const [ollamaEndpoint, setOllamaEndpoint] = useState('')
  const [ollamaModel, setOllamaModel] = useState('')
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
        if (active && configurationGenerationRef.current === generation) {
          setConfiguration(next)
          setOllamaEndpoint(next.ollamaEndpoint)
          setOllamaModel(next.ollamaModel)
        }
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

  async function saveOllamaLocal() {
    configurationGenerationRef.current += 1
    setBusy(true)
    setError('')
    try {
      const next = await reviewProvider.configureLocal({ endpoint: ollamaEndpoint, model: ollamaModel })
      setConfiguration(next)
      setOllamaStatus(null)
    } catch (cause) {
      setError(reviewAiErrorMessage(cause))
    } finally {
      setBusy(false)
    }
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

  /** Estado do provedor escolhido, resumido no titulo da secao. */
  const providerStatus: { tone: 'ok' | 'idle' | 'warn'; label: string } = (() => {
    if (provider === 'ollama') {
      if (!ollamaStatus) return { tone: 'idle', label: 'Não verificado' }
      return ollamaStatus.reachable && ollamaStatus.modelInstalled
        ? { tone: 'ok', label: 'Pronto' }
        : { tone: 'warn', label: 'Revisar conexão' }
    }
    if (provider === 'gemini') {
      return configuration?.geminiConfigured
        ? { tone: 'ok', label: 'Chave salva' }
        : { tone: 'idle', label: 'Não configurado' }
    }
    if (provider === 'openAiCompatible') {
      return configuration?.openAiCompatibleConfigured
        ? { tone: 'ok', label: 'Configurado' }
        : { tone: 'idle', label: 'Não configurado' }
    }
    return managedGate.allowed
      ? { tone: 'ok', label: 'Disponível' }
      : { tone: 'idle', label: 'Indisponível' }
  })()

  return (
    <SettingsSection
      headingLevel={4}
      id="review-ai-settings-title"
      title="Revisão com IA"
      className="review-ai-settings"
      aside={(
        <span className={`review-ai-status is-${providerStatus.tone}`} role="status">
          <span className="review-ai-status-dot" aria-hidden="true" />
          {providerStatus.label}
        </span>
      )}
    >
      {/* Versao A: pilula de provedor + selo de estado no titulo da secao. */}
      <div className="review-ai-provider-picker">
        <div className="settings-segmented" role="radiogroup" aria-label="Provedor da revisão">
          {PROVIDER_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="bare"
              size="sm"
              role="radio"
              aria-checked={provider === option.value}
              aria-label={option.value === 'managed' ? managedGate.label : option.label}
              title={option.value === 'managed' ? managedGate.label : option.label}
              className={provider === option.value ? 'is-active' : ''}
              disabled={option.value === 'managed' && !managedGate.allowed}
              onClick={() => selectProvider(option.value)}
            >
              {option.short}
            </Button>
          ))}
        </div>
        <InfoTip label="Provedor da revisão">
          <p>
            A sessão usa somente o provedor escolhido — não existe troca automática no meio de uma
            revisão. Trocar aqui vale para a próxima sessão; o histórico já avaliado não é refeito.
          </p>
        </InfoTip>
      </div>

      {provider === 'gemini' ? (
        <div className="review-ai-provider-panel">
          <label className="review-ai-consent">
            <input
              type="checkbox"
              checked={geminiConsent}
              onChange={(event) => void toggleConsent(event.target.checked)}
            />
            <span>
              Autorizo o envio desses dados ao Gemini.
              <InfoTip label="O que vai para o Gemini">
                <p>
                  Vai o texto da nota selecionada e o necessário da sessão atual. O restante da pasta
                  fica no computador. A autorização pode ser revogada aqui a qualquer momento.
                </p>
              </InfoTip>
            </span>
          </label>
          <label className="review-ai-key-field" htmlFor="gemini-api-key">
            <span>Chave da API do Gemini</span>
            <Field
              size="xs"
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
              <Button type="button" variant="secondary" size="md" onClick={() => void removeKey()} disabled={busy}>
                Remover chave
              </Button>
            ) : null}
            <Button type="button" variant="primary" size="sm" onClick={() => void saveKey()} disabled={busy || !apiKey.trim()}>
              Salvar chave
            </Button>
          </div>
          <small>Modelo gerenciado pelo MirrorMind: {configuration?.geminiModel ?? 'carregando...'}</small>
        </div>
      ) : provider === 'managed' ? (
        <div className="review-ai-provider-panel">
          <p>{managedGate.message}</p>
          {usoGerenciado ? (
            <p className="review-ai-managed-scaffold">
              {usoGerenciado.limite === null
                ? `${usoGerenciado.usado} chamadas neste mês.`
                : `${usoGerenciado.usado} de ${usoGerenciado.limite} chamadas usadas.`}
            </p>
          ) : null}
          <p className="review-ai-managed-scaffold">
            Custo estimado por chamada gerenciada: US$ {estimateManagedCallCostUsd(estimatedManagedInputChars()).toFixed(2)}
          </p>
        </div>
      ) : provider === 'openAiCompatible' ? (
        <div className="review-ai-provider-panel">
          <p className="review-ai-legal">
            Envio internacional de dados: o texto da nota sai deste computador.
            <InfoTip label="Transferência internacional (LGPD Art. 33)">
              <p>
                O conteúdo da nota selecionada e os dados da sessão vão para o endereço configurado
                acima e seguem a política do provedor. Use <code>https</code> para servidores remotos
                (<code>http</code> só em <code>127.0.0.1</code> ou <code>localhost</code>). Evite notas
                com dados sensíveis (Art. 11) sem necessidade.
              </p>
            </InfoTip>
          </p>
          <label className="review-ai-consent">
            <input
              type="checkbox"
              checked={openAiConsent}
              onChange={(event) => void toggleOpenAiConsent(event.target.checked)}
            />
            <span>Autorizo o envio desses dados ao servidor OpenAI-compatible.</span>
          </label>
          <InfoTip label="Quais servidores este campo aceita">
            <p>
              Qualquer servidor com a API de chat completions OpenAI-compatible: OpenAI, OpenRouter,
              LM Studio, vLLM. A chave fica no cofre nativo do sistema, nunca no Vault.
            </p>
          </InfoTip>
          {configuration?.openAiCompatibleConfigured ? (
            <dl>
              <div><dt>Endereco</dt><dd>{configuration.openAiCompatibleBaseUrl}</dd></div>
              <div><dt>Modelo</dt><dd>{configuration.openAiCompatibleModel}</dd></div>
            </dl>
          ) : null}
          <label className="review-ai-key-field" htmlFor="openai-compatible-base-url">
            <span>URL base do servidor</span>
            <Field
              size="xs"
              id="openai-compatible-base-url"
              type="text"
              value={openAiBaseUrl}
              onChange={(event) => setOpenAiBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <small className="review-ai-hint">
            Termina em <code>/v1</code> na maioria dos servidores — ex.: <code>https://api.openai.com/v1</code>.
          </small>
          <label className="review-ai-key-field" htmlFor="openai-compatible-model">
            <span>Nome do modelo</span>
            <Field
              size="xs"
              id="openai-compatible-model"
              type="text"
              value={openAiModel}
              onChange={(event) => setOpenAiModel(event.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
          <small className="review-ai-hint">
            O nome exato do modelo no provedor — ex.: <code>gpt-4o-mini</code>, <code>llama-3.1-70b</code>.
          </small>
          <label className="review-ai-key-field" htmlFor="openai-compatible-api-key">
            <span>Chave da API do servidor</span>
            <Field
              size="xs"
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
              <Button type="button" variant="secondary" size="md" onClick={() => void removeOpenAiCompatible()} disabled={busy}>
                Remover servidor
              </Button>
            ) : null}
            <Button type="button" variant="primary" size="sm" onClick={() => void saveOpenAiCompatible()} disabled={busy || !openAiBaseUrl.trim() || !openAiModel.trim() || !openAiApiKey.trim()}>
              Salvar servidor
            </Button>
          </div>
        </div>
      ) : (
        <div className="review-ai-provider-panel">
          <label className="review-ai-key-field" htmlFor="ollama-endpoint">
            <span>
              Endereço do Ollama
              <InfoTip label="Endereço do Ollama">
                <p>
                  Onde o serviço escuta. <code>http</code> só é aceito para localhost ou rede privada;
                  qualquer host fora da máquina precisa de <code>https</code>.
                </p>
              </InfoTip>
            </span>
            <Field
              size="xs"
              id="ollama-endpoint"
              type="text"
              value={ollamaEndpoint}
              onChange={(event) => setOllamaEndpoint(event.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
            />
          </label>
          <label className="review-ai-key-field" htmlFor="ollama-model">
            <span>Modelo instalado</span>
            <Field
              size="xs"
              id="ollama-model"
              type="text"
              value={ollamaModel}
              onChange={(event) => setOllamaModel(event.target.value)}
              placeholder="qwen2.5:7b"
            />
          </label>
          <small className="review-ai-hint">
            Precisa existir no servidor — confira com <code>ollama list</code>.
          </small>
          <div className="review-ai-inline-actions">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void saveOllamaLocal()}
              disabled={busy
                || !ollamaEndpoint.trim()
                || !ollamaModel.trim()
                || (ollamaEndpoint.trim() === (configuration?.ollamaEndpoint ?? '')
                  && ollamaModel.trim() === (configuration?.ollamaModel ?? ''))}
            >
              Salvar servidor local
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={() => void checkOllama()} disabled={busy}>
              Verificar Ollama
            </Button>
            {ollamaStatus && !(ollamaStatus.reachable && ollamaStatus.modelInstalled) ? (
              <span className="field-error" role="alert">
                {ollamaStatus.reachable
                  ? <>Modelo não encontrado. Execute <code>ollama pull {ollamaModel || 'qwen2.5:7b'}</code> no terminal.</>
                  : 'O Ollama local não respondeu. Inicie o serviço e tente novamente.'}
              </span>
            ) : null}
          </div>
        </div>
      )}
      {usage ? (
        <dl className="review-ai-usage">
          <div><dt>Chamadas de IA hoje</dt><dd>{usage.totalCalls} de {usage.maxCallsPerDay}{usage.exceeded ? ' (orçamento atingido)' : ''}</dd></div>
          <div><dt>Nos últimos 60s</dt><dd>{usage.callsInMinute} de {usage.maxCallsPerMinute}</dd></div>
          <div><dt>Custo estimado hoje</dt><dd>US$ {usage.estimatedCostUsd.toFixed(2)}</dd></div>
          <div><dt>Descrições de imagem hoje</dt><dd>{usage.visionCalls} (visao — contadas no orcamento antes do envio)</dd></div>
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
