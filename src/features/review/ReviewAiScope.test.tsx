import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewAiSettingsProvider, useReviewAiSettings } from './ReviewAiSettingsContext'
import { EntitlementProvider, type EntitlementStore } from '../../lib/entitlement'

// O escopo vem do Rust (`ai_scope`): é o mesmo que separa os segredos no cofre.
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

vi.mock('./reviewProvider', () => ({
  reviewProvider: {
    configure: vi.fn(),
    configureLocal: vi.fn(),
    confirmDataConsent: vi.fn(async () => true),
    remove: vi.fn(),
    setDataConsent: vi.fn(async () => undefined),
  },
}))

// O provedor de IA gerenciada depende do plano; aqui só o escopo importa.
const semPlano: EntitlementStore = {
  load: async () => null,
  save: async () => undefined,
}

function Sonda() {
  const { provider } = useReviewAiSettings()
  return <p>provedor: {provider}</p>
}

function montarCom(escopo: string | null) {
  mocks.invoke.mockImplementation(async (comando: string) => {
    if (comando === 'ai_scope') return escopo
    return null
  })
  return render(
    <EntitlementProvider store={semPlano}>
      <ReviewAiSettingsProvider>
        <Sonda />
      </ReviewAiSettingsProvider>
    </EntitlementProvider>,
  )
}

describe('preferência de IA por pessoa', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.invoke.mockReset()
  })
  afterEach(cleanup)

  it('conta assinante e conta gratuita não compartilham provedor', async () => {
    localStorage.setItem('mirrormind.review.provider.v1:conta:abc', 'gemini')
    montarCom('conta:abc')

    await waitFor(() => expect(screen.getByText('provedor: gemini')).toBeInTheDocument())
  })

  it('outra conta na mesma máquina começa no padrão, sem herdar a escolha', async () => {
    localStorage.setItem('mirrormind.review.provider.v1:conta:abc', 'gemini')
    montarCom('conta:def')

    await waitFor(() => expect(screen.getByText('provedor: ollama')).toBeInTheDocument())
  })

  it('sem conta nem identidade, vale a preferência da máquina', async () => {
    localStorage.setItem('mirrormind.review.provider.v1', 'openAiCompatible')
    montarCom('')

    await waitFor(() =>
      expect(screen.getByText('provedor: openAiCompatible')).toBeInTheDocument(),
    )
  })

  it('sem Rust respondendo, cai na preferência da máquina em vez de travar', async () => {
    localStorage.setItem('mirrormind.review.provider.v1', 'gemini')
    mocks.invoke.mockRejectedValue(new Error('sem IPC'))
    render(
      <EntitlementProvider store={semPlano}>
        <ReviewAiSettingsProvider>
          <Sonda />
        </ReviewAiSettingsProvider>
      </EntitlementProvider>,
    )

    await waitFor(() => expect(screen.getByText('provedor: gemini')).toBeInTheDocument())
  })
})
