import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewAiSettings } from './ReviewAiSettings'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'

const mocks = vi.hoisted(() => ({
  checkOllama: vi.fn(),
  configureGemini: vi.fn(),
  configureOpenAi: vi.fn(),
  confirmGeminiConsent: vi.fn(),
  getConfiguration: vi.fn(),
  getUsage: vi.fn(),
  removeGemini: vi.fn(),
  removeOpenAi: vi.fn(),
  runComparability: vi.fn(),
  setGeminiConsent: vi.fn(),
}))

vi.mock('./ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai')>()
  return {
    ...original,
    checkOllamaReviewStatus: mocks.checkOllama,
    configureGeminiApiKey: mocks.configureGemini,
    configureOpenAiCompatibleProvider: mocks.configureOpenAi,
    confirmGeminiDataConsent: mocks.confirmGeminiConsent,
    getReviewAiConfiguration: mocks.getConfiguration,
    getReviewUsageStatus: mocks.getUsage,
    removeGeminiApiKey: mocks.removeGemini,
    removeOpenAiCompatibleProvider: mocks.removeOpenAi,
    runProviderComparability: mocks.runComparability,
    setGeminiDataConsent: mocks.setGeminiConsent,
  }
})

const configuration = {
  geminiConfigured: false,
  geminiModel: 'gemini-3.5-flash',
  ollamaEndpoint: 'http://127.0.0.1:11434/v1' as const,
  ollamaModel: 'qwen2.5:7b' as const,
  openAiCompatibleConfigured: false,
  openAiCompatibleBaseUrl: null,
  openAiCompatibleModel: null,
}

function renderSettings(vaultPath?: string) {
  return render(
    <ReviewAiSettingsProvider>
      <ReviewAiSettings vaultPath={vaultPath} />
    </ReviewAiSettingsProvider>,
  )
}

describe('ReviewAiSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.getConfiguration.mockResolvedValue(configuration)
    mocks.configureGemini.mockResolvedValue({ ...configuration, geminiConfigured: true })
    mocks.checkOllama.mockResolvedValue({ reachable: true, modelInstalled: true })
    mocks.confirmGeminiConsent.mockResolvedValue(true)
    mocks.setGeminiConsent.mockResolvedValue(undefined)
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

  it('offers only provider switching and verifies the fixed local Ollama configuration', async () => {
    const user = userEvent.setup()
    renderSettings()

    const selector = screen.getByRole('combobox', { name: 'Provedor da revisão' })
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(screen.getByText('http://127.0.0.1:11434/v1')).toBeInTheDocument()
    expect(screen.getByText('qwen2.5:7b')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Verificar Ollama' }))
    expect(await screen.findByText('Pronto para revisar')).toBeInTheDocument()
    expect(selector).toHaveValue('ollama')
  })

  it('records consent through the native dialog and stores the Gemini key', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provedor da revisão' }), 'gemini')
    await user.click(screen.getByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' }))
    expect(mocks.confirmGeminiConsent).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' })).toBeChecked()
    expect(window.localStorage.getItem('mirrormind.review.gemini-consent.v1')).toBe('accepted')

    await user.type(screen.getByLabelText(/Chave da API Gemini/), 'valid-gemini-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar chave' }))

    expect(mocks.configureGemini).toHaveBeenCalledWith('valid-gemini-key-123')
    expect(screen.getByLabelText(/Chave da API Gemini/)).toHaveValue('')
  })

  it('keeps consent unchecked when the native dialog is cancelled', async () => {
    const user = userEvent.setup()
    mocks.confirmGeminiConsent.mockResolvedValue(false)
    renderSettings()
    mocks.setGeminiConsent.mockClear()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provedor da revisão' }), 'gemini')
    await user.click(screen.getByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' }))

    expect(await screen.findByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' })).not.toBeChecked()
    expect(window.localStorage.getItem('mirrormind.review.gemini-consent.v1')).toBeNull()
    expect(mocks.setGeminiConsent).not.toHaveBeenCalled()
  })

  it('revokes consent directly without a dialog when unchecked', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('mirrormind.review.gemini-consent.v1', 'accepted')
    renderSettings()
    mocks.setGeminiConsent.mockClear()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provedor da revisão' }), 'gemini')
    await user.click(screen.getByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' }))

    expect(mocks.confirmGeminiConsent).not.toHaveBeenCalled()
    expect(mocks.setGeminiConsent).toHaveBeenCalledWith(false)
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

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provedor da revisão' }), 'openAiCompatible')
    await user.type(screen.getByLabelText(/Endereco do servidor/), 'https://api.openai.com/v1')
    await user.type(screen.getByLabelText(/^Modelo$/), 'gpt-4o-mini')
    await user.type(screen.getByLabelText(/Chave da API/), 'sk-secret-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar servidor' }))

    expect(mocks.configureOpenAi).toHaveBeenCalledWith({
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

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provedor da revisão' }), 'gemini')
    await user.type(screen.getByLabelText(/Chave da API Gemini/), 'valid-gemini-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar chave' }))
    expect(await screen.findByRole('button', { name: 'Remover chave' })).toBeInTheDocument()

    resolveInitial(configuration)
    await Promise.resolve()
    expect(screen.getByRole('button', { name: 'Remover chave' })).toBeInTheDocument()
  })

  it('runs the provider comparison and renders the divergence report', async () => {
    const user = userEvent.setup()
    mocks.runComparability.mockResolvedValue({
      noteWords: 5,
      questionCount: 6,
      providers: ['ollama-qwen2.5:7b', 'gemini-3.5-flash'],
      scoreDelta: 5,
      sharedGapQuotes: ['a clorofila absorve luz'],
      ollamaOnlyGapQuotes: ['nas bandas verde'],
      geminiOnlyGapQuotes: ['principal produto'],
      ollama: {
        provider: 'ollama-qwen2.5:7b',
        failure: null,
        gapBasedScore: 70,
        assertionScores: [70, 80],
        overallScore: 70,
        summaryPresent: true,
        gapCount: 2,
        gapQuotes: ['a clorofila absorve luz', 'nas bandas verde'],
        inconclusiveCount: 0,
      },
      gemini: {
        provider: 'gemini-3.5-flash',
        failure: null,
        gapBasedScore: 75,
        assertionScores: [75],
        overallScore: 75,
        summaryPresent: true,
        gapCount: 1,
        gapQuotes: ['a clorofila absorve luz'],
        inconclusiveCount: 0,
      },
    })
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Comparar provedores' }))

    expect(mocks.runComparability).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Diferença da nota (gemini-3.5-flash - ollama-qwen2.5:7b)')).toBeInTheDocument()
    expect(screen.getByText('5 palavras · 6 perguntas · respostas fixas')).toBeInTheDocument()
    expect(screen.getAllByText('a clorofila absorve luz').length).toBeGreaterThan(0)
    expect(screen.getAllByText('nas bandas verde').length).toBeGreaterThan(0)
    expect(screen.getByText('Só ollama-qwen2.5:7b')).toBeInTheDocument()
    expect(screen.getByText('Só gemini-3.5-flash')).toBeInTheDocument()
  })

  it('renders a readable failure when the comparison has no valid side', async () => {
    const user = userEvent.setup()
    mocks.runComparability.mockResolvedValue({
      noteWords: 5,
      questionCount: 6,
      providers: ['ollama-qwen2.5:7b', 'gemini-3.5-flash'],
      scoreDelta: null,
      sharedGapQuotes: [],
      ollamaOnlyGapQuotes: [],
      geminiOnlyGapQuotes: [],
      ollama: {
        provider: 'ollama-qwen2.5:7b',
        failure: 'Ollama indisponivel',
        gapBasedScore: null,
        assertionScores: [],
        overallScore: null,
        summaryPresent: false,
        gapCount: 0,
        gapQuotes: [],
        inconclusiveCount: 0,
      },
      gemini: {
        provider: 'gemini-3.5-flash',
        failure: null,
        gapBasedScore: 75,
        assertionScores: [75],
        overallScore: 75,
        summaryPresent: true,
        gapCount: 1,
        gapQuotes: ['a clorofila absorve luz'],
        inconclusiveCount: 0,
      },
    })
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Comparar provedores' }))

    expect(await screen.findByText('indisponível (algum lado sem nota válida)')).toBeInTheDocument()
    expect(screen.getByText('Avaliação inválida: Ollama indisponivel')).toBeInTheDocument()
  })})
