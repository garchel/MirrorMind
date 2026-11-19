import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewAiSettings } from './ReviewAiSettings'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'
import { EntitlementProvider, type EntitlementStore } from '../../lib/entitlement'
import type { Entitlement } from '../../lib/billing'

const mocks = vi.hoisted(() => ({
  checkOllama: vi.fn(),
  getConfiguration: vi.fn(),
  getUsage: vi.fn(),
  providerConfigureLocal: vi.fn(),
  providerConfigure: vi.fn(),
  providerConfirm: vi.fn(),
  providerRemove: vi.fn(),
  providerSetConsent: vi.fn(),
}))

vi.mock('./ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai')>()
  return {
    ...original,
    checkOllamaReviewStatus: mocks.checkOllama,
    getReviewAiConfiguration: mocks.getConfiguration,
    getReviewUsageStatus: mocks.getUsage,
  }
})

vi.mock('./reviewProvider', () => ({
  reviewProvider: {
    configure: mocks.providerConfigure,
    configureLocal: mocks.providerConfigureLocal,
    confirmDataConsent: mocks.providerConfirm,
    remove: mocks.providerRemove,
    setDataConsent: mocks.providerSetConsent,
  },
}))

const configuration = {
  geminiConfigured: false,
  geminiModel: 'gemini-3.5-flash',
  ollamaEndpoint: 'http://127.0.0.1:11434/v1',
  ollamaModel: 'qwen2.5:7b',
  openAiCompatibleConfigured: false,
  openAiCompatibleBaseUrl: null,
  openAiCompatibleModel: null,
}

/** Cache de direitos em memoria (o provedor le de forma assincrona). */
let cached: Entitlement | null = null
const entitlementStore: EntitlementStore = {
  load: async () => cached,
  save: async (next) => {
    cached = next
  },
}

function renderSettings(vaultPath?: string) {
  return render(
    <EntitlementProvider store={entitlementStore}>
      <ReviewAiSettingsProvider>
        <ReviewAiSettings vaultPath={vaultPath} />
      </ReviewAiSettingsProvider>
    </EntitlementProvider>,
  )
}

describe('ReviewAiSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.getConfiguration.mockResolvedValue(configuration)
    mocks.providerConfigure.mockResolvedValue({ ...configuration, geminiConfigured: true })
    mocks.checkOllama.mockResolvedValue({ reachable: true, modelInstalled: true })
    mocks.providerConfirm.mockResolvedValue(true)
    mocks.providerSetConsent.mockResolvedValue(undefined)
    mocks.getUsage.mockResolvedValue({
      day: 20_000,
      providerCalls: [{ provider: 'gemini', calls: 3 }],
      totalCalls: 3,
      maxCallsPerDay: 300,
      callsInMinute: 1,
      maxCallsPerMinute: 20,
      exceeded: false,
      estimatedCostUsd: 0.05,
      estimatedCostUsdMonth: 0.5,
      maxCostPerMonthUsd: 20,
      monthlyExceeded: false,
      visionCalls: 2,
    })
  })

  afterEach(cleanup)

  it('permite editar endereco e modelo do Ollama local e verifica a conexao', async () => {
    const user = userEvent.setup()
    renderSettings()

    const grupo = screen.getByRole('radiogroup', { name: 'Provedor da revisão' })
    expect(within(grupo).getAllByRole('radio')).toHaveLength(4)
    // Cada provedor e um radio; "MirrorMind" so existe com assinatura.
    expect(within(grupo).getByRole('radio', { name: /MirrorMind/ })).toBeDisabled()

    // A configuracao chega de forma assincrona: os campos nascem preenchidos
    // com o que esta salvo.
    // O rotulo agora carrega a ajuda contextual ao lado, entao o nome acessivel
    // do campo e procurado por prefixo.
    const endereco = screen.getByRole('textbox', { name: /^Endereço do Ollama/ })
    const modelo = screen.getByRole('textbox', { name: /^Modelo instalado/ })
    await waitFor(() => expect(endereco).toHaveValue('http://127.0.0.1:11434/v1'))
    expect(modelo).toHaveValue('qwen2.5:7b')
    expect(screen.getByRole('button', { name: 'Salvar servidor local' })).toBeDisabled()

    await user.clear(modelo)
    await user.type(modelo, 'llama3.2:3b')
    const salvar = screen.getByRole('button', { name: 'Salvar servidor local' })
    expect(salvar).toBeEnabled()

    mocks.providerConfigureLocal.mockResolvedValue({ ...configuration, ollamaModel: 'llama3.2:3b' })
    await user.click(salvar)
    expect(mocks.providerConfigureLocal).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2:3b',
    })

    await user.click(screen.getByRole('button', { name: 'Verificar Ollama' }))
    // O estado vive no selo do titulo ("Não verificado" -> "Pronto"), nao dentro
    // do painel: dentro dele so aparece o que deu errado.
    expect(await screen.findByText('Pronto')).toBeInTheDocument()
    expect(within(grupo).getByRole('radio', { name: 'Ollama local' })).toHaveAttribute('aria-checked', 'true')
  })

  it('records consent through the native dialog and stores the Gemini key', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('radio', { name: 'Gemini' }))
    await user.click(screen.getByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' }))
    expect(mocks.providerConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.providerConfirm).toHaveBeenCalledWith('gemini')
    expect(await screen.findByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' })).toBeChecked()
    expect(window.localStorage.getItem('mirrormind.review.gemini-consent.v1')).toBe('accepted')

    await user.type(screen.getByLabelText(/Chave da API do Gemini/), 'valid-gemini-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar chave' }))

    expect(mocks.providerConfigure).toHaveBeenCalledWith({ kind: 'gemini', apiKey: 'valid-gemini-key-123' })
    expect(screen.getByLabelText(/Chave da API do Gemini/)).toHaveValue('')
  })

  it('keeps consent unchecked when the native dialog is cancelled', async () => {
    const user = userEvent.setup()
    mocks.providerConfirm.mockResolvedValue(false)
    renderSettings()
    mocks.providerSetConsent.mockClear()

    await user.click(screen.getByRole('radio', { name: 'Gemini' }))
    await user.click(screen.getByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' }))

    expect(await screen.findByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' })).not.toBeChecked()
    expect(window.localStorage.getItem('mirrormind.review.gemini-consent.v1')).toBeNull()
    expect(mocks.providerSetConsent).not.toHaveBeenCalled()
  })

  it('revokes consent directly without a dialog when unchecked', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('mirrormind.review.gemini-consent.v1', 'accepted')
    renderSettings()
    mocks.providerSetConsent.mockClear()

    await user.click(screen.getByRole('radio', { name: 'Gemini' }))
    await user.click(screen.getByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' }))

    expect(mocks.providerConfirm).not.toHaveBeenCalled()
    expect(mocks.providerSetConsent).toHaveBeenCalledWith('gemini', false)
    expect(await screen.findByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' })).not.toBeChecked()
    expect(window.localStorage.getItem('mirrormind.review.gemini-consent.v1')).toBeNull()
  })

  it('shows the exact pull command when the fixed Ollama model is missing', async () => {
    const user = userEvent.setup()
    mocks.checkOllama.mockResolvedValue({ reachable: true, modelInstalled: false })
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Verificar Ollama' }))

    expect(await screen.findByText('ollama pull qwen2.5:7b')).toBeInTheDocument()
  })

  it('configures and removes an OpenAI-compatible server', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('radio', { name: 'OpenAI-compatible' }))
    await user.type(screen.getByLabelText('URL base do servidor'), 'https://api.openai.com/v1')
    await user.type(screen.getByLabelText('Nome do modelo'), 'gpt-4o-mini')
    await user.type(screen.getByLabelText(/Chave da API/), 'sk-secret-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar servidor' }))

    expect(mocks.providerConfigure).toHaveBeenCalledWith({
      kind: 'openAiCompatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-secret-key-123',
    })
  })

  it('shows the AI usage budget when a vault is selected', async () => {
    renderSettings('C:\\Vault')

    expect(mocks.getUsage).toHaveBeenCalledWith('C:\\Vault')
    expect(await screen.findByText('3 de 300')).toBeInTheDocument()
    expect(screen.getByText('1 de 20')).toBeInTheDocument()
    expect(screen.getByText('Provedor gemini')).toBeInTheDocument()
    expect(screen.getByText('2 (visao — contadas no orcamento antes do envio)')).toBeInTheDocument()
  })

  it('hides the usage budget when no vault is available', () => {
    renderSettings()

    expect(mocks.getUsage).not.toHaveBeenCalled()
    expect(screen.queryByText('Chamadas de IA hoje')).not.toBeInTheDocument()
  })

  it('does not let a stale initial configuration overwrite a newly saved key', async () => {
    const user = userEvent.setup()
    let resolveInitial!: (value: typeof configuration) => void
    mocks.getConfiguration.mockReturnValue(new Promise((resolve) => { resolveInitial = resolve }))
    renderSettings()

    await user.click(screen.getByRole('radio', { name: 'Gemini' }))
    await user.type(screen.getByLabelText(/Chave da API do Gemini/), 'valid-gemini-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar chave' }))
    expect(await screen.findByRole('button', { name: 'Remover chave' })).toBeInTheDocument()

    resolveInitial(configuration)
    await Promise.resolve()
    expect(screen.getByRole('button', { name: 'Remover chave' })).toBeInTheDocument()
  })
})
