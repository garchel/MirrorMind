// oxlint-disable react/only-export-components -- provider and its guarded hook form one public boundary.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { reviewProvider } from './reviewProvider'
import { managedAiGate, type ManagedAiGate } from './managedProvider'
import { useEntitlement } from '../../lib/entitlement'
import type { ReactNode } from 'react'
import type { ReviewAiProvider } from './ai'

const PROVIDER_KEY = 'mirrormind.review.provider.v1'
const GEMINI_CONSENT_KEY = 'mirrormind.review.gemini-consent.v1'
const OPENAI_CONSENT_KEY = 'mirrormind.review.openai-consent.v1'

type ReviewAiSettingsValue = {
  provider: ReviewAiProvider
  /** Troca de provedor respeitando o gate: `managed` negado cai em ollama. */
  selectProvider: (provider: ReviewAiProvider) => void
  geminiConsent: boolean
  setGeminiConsent: (consent: boolean) => void
  openAiConsent: boolean
  setOpenAiConsent: (consent: boolean) => void
  /** Gate da IA gerenciada: o mesmo que sera aplicado na execucao. */
  managedGate: ManagedAiGate
}

const ReviewAiSettingsContext = createContext<ReviewAiSettingsValue | null>(null)

const STORED_PROVIDERS: readonly ReviewAiProvider[] = ['gemini', 'openAiCompatible', 'managed']

function storedProvider(): ReviewAiProvider {
  const stored = window.localStorage.getItem(PROVIDER_KEY) as ReviewAiProvider | null
  return stored && STORED_PROVIDERS.includes(stored) ? stored : 'ollama'
}

export function ReviewAiSettingsProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ReviewAiProvider>(storedProvider)
  const [geminiConsent, setGeminiConsent] = useState(
    () => window.localStorage.getItem(GEMINI_CONSENT_KEY) === 'accepted',
  )
  const [openAiConsent, setOpenAiConsent] = useState(
    () => window.localStorage.getItem(OPENAI_CONSENT_KEY) === 'accepted',
  )
  const { entitlement } = useEntitlement()
  const managedGate = useMemo(() => managedAiGate(entitlement, Date.now()), [entitlement])

  useEffect(() => window.localStorage.setItem(PROVIDER_KEY, provider), [provider])
  useEffect(() => {
    if (geminiConsent) window.localStorage.setItem(GEMINI_CONSENT_KEY, 'accepted')
    else window.localStorage.removeItem(GEMINI_CONSENT_KEY)
    void reviewProvider.setDataConsent('gemini', geminiConsent).catch(() => {
      if (geminiConsent) setGeminiConsent(false)
    })
  }, [geminiConsent])
  useEffect(() => {
    if (openAiConsent) window.localStorage.setItem(OPENAI_CONSENT_KEY, 'accepted')
    else window.localStorage.removeItem(OPENAI_CONSENT_KEY)
    void reviewProvider.setDataConsent('openAiCompatible', openAiConsent).catch(() => {
      if (openAiConsent) setOpenAiConsent(false)
    })
  }, [openAiConsent])
  // Fail-closed no gasto: perder o plano devolve a revisao ao Ollama local.
  useEffect(() => {
    if (provider === 'managed' && !managedGate.allowed) setProvider('ollama')
  }, [managedGate.allowed, provider])

  const value = useMemo<ReviewAiSettingsValue>(() => ({
    provider,
    selectProvider: (next: ReviewAiProvider) => {
      if (next === 'managed' && !managedGate.allowed) return
      setProvider(next)
    },
    geminiConsent,
    setGeminiConsent,
    openAiConsent,
    setOpenAiConsent,
    managedGate,
  }), [geminiConsent, managedGate, openAiConsent, provider])

  return <ReviewAiSettingsContext value={value}>{children}</ReviewAiSettingsContext>
}

export function useReviewAiSettings(): ReviewAiSettingsValue {
  const value = useContext(ReviewAiSettingsContext)
  if (!value) throw new Error('ReviewAiSettingsProvider is missing.')
  return value
}
