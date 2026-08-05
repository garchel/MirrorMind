// oxlint-disable react/only-export-components -- provider and its guarded hook form one public boundary.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { setGeminiDataConsent } from './ai'
import type { ReactNode } from 'react'
import type { ReviewAiProvider } from './ai'

const PROVIDER_KEY = 'mirrormind.review.provider.v1'
const GEMINI_CONSENT_KEY = 'mirrormind.review.gemini-consent.v1'

type ReviewAiSettingsValue = {
  provider: ReviewAiProvider
  setProvider: (provider: ReviewAiProvider) => void
  geminiConsent: boolean
  setGeminiConsent: (consent: boolean) => void
}

const ReviewAiSettingsContext = createContext<ReviewAiSettingsValue | null>(null)

function storedProvider(): ReviewAiProvider {
  return window.localStorage.getItem(PROVIDER_KEY) === 'gemini' ? 'gemini' : 'ollama'
}

export function ReviewAiSettingsProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ReviewAiProvider>(storedProvider)
  const [geminiConsent, setGeminiConsent] = useState(
    () => window.localStorage.getItem(GEMINI_CONSENT_KEY) === 'accepted',
  )

  useEffect(() => window.localStorage.setItem(PROVIDER_KEY, provider), [provider])
  useEffect(() => {
    if (geminiConsent) window.localStorage.setItem(GEMINI_CONSENT_KEY, 'accepted')
    else window.localStorage.removeItem(GEMINI_CONSENT_KEY)
    void setGeminiDataConsent(geminiConsent).catch(() => {
      if (geminiConsent) setGeminiConsent(false)
    })
  }, [geminiConsent])

  const value = useMemo(() => ({
    provider,
    setProvider,
    geminiConsent,
    setGeminiConsent,
  }), [geminiConsent, provider])

  return <ReviewAiSettingsContext value={value}>{children}</ReviewAiSettingsContext>
}

export function useReviewAiSettings(): ReviewAiSettingsValue {
  const value = useContext(ReviewAiSettingsContext)
  if (!value) throw new Error('ReviewAiSettingsProvider is missing.')
  return value
}
