import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewAiSettings } from './ReviewAiSettings'
import { ReviewAiSettingsProvider } from './ReviewAiSettingsContext'

const mocks = vi.hoisted(() => ({
  checkOllama: vi.fn(),
  configureGemini: vi.fn(),
  getConfiguration: vi.fn(),
  removeGemini: vi.fn(),
  setGeminiConsent: vi.fn(),
}))

vi.mock('./ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai')>()
  return {
    ...original,
    checkOllamaReviewStatus: mocks.checkOllama,
    configureGeminiApiKey: mocks.configureGemini,
    getReviewAiConfiguration: mocks.getConfiguration,
    removeGeminiApiKey: mocks.removeGemini,
    setGeminiDataConsent: mocks.setGeminiConsent,
  }
})

const configuration = {
  geminiConfigured: false,
  geminiModel: 'gemini-3.5-flash',
  ollamaEndpoint: 'http://127.0.0.1:11434/v1' as const,
  ollamaModel: 'qwen2.5:7b' as const,
}

function renderSettings() {
  return render(
    <ReviewAiSettingsProvider>
      <ReviewAiSettings />
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
    mocks.setGeminiConsent.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('offers only provider switching and verifies the fixed local Ollama configuration', async () => {
    const user = userEvent.setup()
    renderSettings()

    const selector = screen.getByRole('combobox', { name: 'Provedor da revisao' })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('http://127.0.0.1:11434/v1')).toBeInTheDocument()
    expect(screen.getByText('qwen2.5:7b')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Verificar Ollama' }))
    expect(await screen.findByText('Pronto para revisar')).toBeInTheDocument()
    expect(selector).toHaveValue('ollama')
  })

  it('records consent and stores the Gemini key through the native command', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provedor da revisao' }), 'gemini')
    await user.click(screen.getByRole('checkbox', { name: 'Autorizo o envio desses dados ao Gemini.' }))
    await user.type(screen.getByLabelText(/Chave da API Gemini/), 'valid-gemini-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar chave' }))

    expect(mocks.configureGemini).toHaveBeenCalledWith('valid-gemini-key-123')
    expect(window.localStorage.getItem('mirrormind.review.gemini-consent.v1')).toBe('accepted')
    expect(screen.getByLabelText(/Chave da API Gemini/)).toHaveValue('')
  })

  it('shows the exact pull command when the fixed Ollama model is missing', async () => {
    const user = userEvent.setup()
    mocks.checkOllama.mockResolvedValue({ reachable: true, modelInstalled: false })
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Verificar Ollama' }))

    expect(await screen.findByText('ollama pull qwen2.5:7b')).toBeInTheDocument()
  })

  it('does not let a stale initial configuration overwrite a newly saved key', async () => {
    const user = userEvent.setup()
    let resolveInitial!: (value: typeof configuration) => void
    mocks.getConfiguration.mockReturnValue(new Promise((resolve) => { resolveInitial = resolve }))
    renderSettings()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provedor da revisao' }), 'gemini')
    await user.type(screen.getByLabelText(/Chave da API Gemini/), 'valid-gemini-key-123')
    await user.click(screen.getByRole('button', { name: 'Salvar chave' }))
    expect(await screen.findByRole('button', { name: 'Remover chave' })).toBeInTheDocument()

    resolveInitial(configuration)
    await Promise.resolve()
    expect(screen.getByRole('button', { name: 'Remover chave' })).toBeInTheDocument()
  })})
