import { describe, expect, it } from 'vitest'
import { createInMemoryTransport, createReviewProvider } from './reviewProvider'

const CONFIGURATION = {
  geminiConfigured: true,
  geminiModel: 'gemini-3.5-flash',
  ollamaEndpoint: 'http://127.0.0.1:11434/v1',
  ollamaModel: 'qwen2.5:7b',
  openAiCompatibleConfigured: false,
  openAiCompatibleBaseUrl: null,
  openAiCompatibleModel: null,
}

describe('reviewProvider', () => {
  it('consentimento usa o comando de cada provedor (mesma regra)', async () => {
    const { transport, calls } = createInMemoryTransport(CONFIGURATION)
    const provider = createReviewProvider(transport)

    await provider.setDataConsent('gemini', true)
    await provider.setDataConsent('openAiCompatible', false)

    expect(calls).toEqual([
      { command: 'set_gemini_data_consent', args: { consent: true } },
      { command: 'set_openai_compatible_data_consent', args: { consent: false } },
    ])
  })

  it('confirmacao usa o dialogo nativo de cada provedor', async () => {
    const { transport, calls } = createInMemoryTransport(CONFIGURATION)
    const provider = createReviewProvider(transport)

    await expect(provider.confirmDataConsent('gemini')).resolves.toBe(true)
    await expect(provider.confirmDataConsent('openAiCompatible')).resolves.toBe(true)
    expect(calls.map((call) => call.command)).toEqual([
      'confirm_gemini_data_consent',
      'confirm_openai_compatible_data_consent',
    ])
  })

  it('configure/remove despacham por kind e validam a configuracao', async () => {
    const { transport, calls } = createInMemoryTransport(CONFIGURATION)
    const provider = createReviewProvider(transport)

    const configured = await provider.configure({ kind: 'gemini', apiKey: 'k' })
    expect(configured.geminiConfigured).toBe(true)
    const removed = await provider.remove('openAiCompatible')
    expect(removed.openAiCompatibleConfigured).toBe(false)
    expect(calls.map((call) => call.command)).toEqual([
      'configure_gemini_api_key',
      'remove_openai_compatible_provider',
    ])
    expect(calls[0].args).toEqual({ apiKey: 'k' })
  })

  it('rejeita configuracao invalida do backend', async () => {
    const { transport } = createInMemoryTransport({ geminiConfigured: 'sim' })
    const provider = createReviewProvider(transport)

    await expect(provider.configure({ kind: 'gemini', apiKey: 'k' })).rejects.toThrow()
  })
})
