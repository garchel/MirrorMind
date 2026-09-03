// oxlint-disable react/only-export-components -- provider and its guarded hook form one public boundary.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { reviewProvider } from './reviewProvider'
import { canUseManagedProvider, MANAGED_PROVIDER_UNAVAILABLE_MESSAGE, SCAFFOLD_MANAGED_STATUS, type ManagedProviderStatus } from './managedProvider'
import type { ReactNode } from 'react'
import type { ReviewAiProvider } from './ai'

const PROVIDER_KEY = 'mirrormind.review.provider.v1'
const GEMINI_CONSENT_KEY = 'mirrormind.review.gemini-consent.v1'
const OPENAI_CONSENT_KEY = 'mirrormind.review.openai-consent.v1'

type ReviewAiSettingsValue = {
  provider: ReviewAiProvider
  setProvider: (provider: ReviewAiProvider) => void
  geminiConsent: boolean
  setGeminiConsent: (consent: boolean) => void
  openAiConsent: boolean
  setOpenAiConsent: (consent: boolean) => void
  /** Status da conta gerenciada pela assinatura (scaffolding pre-venda). */
  managedStatus: ManagedProviderStatus
  canUseManaged: (estimatedCostUsd: number) => boolean
  managedUnavailableMessage: string
}

const ReviewAiSettingsContext = createContext<ReviewAiSettingsValue | null>(null)

const STORED_PROVIDERS: readonly ReviewAiProvider[] = ['gemini', 'openAiCompatible']

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

  const value = useMemo(() => ({
    provider,
    setProvider,
    geminiConsent,
    setGeminiConsent,
    openAiConsent,
    setOpenAiConsent,
    managedStatus: SCAFFOLD_MANAGED_STATUS,
    canUseManaged: (estimatedCostUsd: number) =>
      canUseManagedProvider(SCAFFOLD_MANAGED_STATUS, estimatedCostUsd),
    managedUnavailableMessage: MANAGED_PROVIDER_UNAVAILABLE_MESSAGE,
  }), [geminiConsent, openAiConsent, provider])

  return <ReviewAiSettingsContext value={value}>{children}</ReviewAiSettingsContext>
}

export function useReviewAiSettings(): ReviewAiSettingsValue {
  const value = useContext(ReviewAiSettingsContext)
  if (!value) throw new Error('ReviewAiSettingsProvider is missing.')
  return value
}
