// oxlint-disable react/only-export-components -- provider and its guarded hook form one public boundary.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { reviewProvider } from './reviewProvider'
import { managedAiGate, type ManagedAiGate } from './managedProvider'
import { useEntitlement } from '../../lib/entitlement'
import type { ReactNode } from 'react'
import type { ReviewAiProvider } from './ai'

const PROVIDER_KEY = 'mirrormind.review.provider.v1'
const GEMINI_CONSENT_KEY = 'mirrormind.review.gemini-consent.v1'
const OPENAI_CONSENT_KEY = 'mirrormind.review.openai-consent.v1'

/**
 * Preferência de IA é de **quem está usando**, não da máquina.
 *
 * Duas contas na mesma máquina podem ter planos diferentes: uma usa a IA
 * gerenciada pela assinatura, a outra só a chave própria. O escopo vem do Rust
 * (`ai_scope`), o mesmo que já separa os segredos no cofre do sistema — assim a
 * preferência e a chave nunca apontam para pessoas diferentes.
 */
function scopedKey(base: string, scope: string): string {
  return scope ? `${base}:${scope}` : base
}

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

function storedProvider(scope: string): ReviewAiProvider {
  const stored = window.localStorage.getItem(
    scopedKey(PROVIDER_KEY, scope),
  ) as ReviewAiProvider | null
  return stored && STORED_PROVIDERS.includes(stored) ? stored : 'ollama'
}

function storedConsent(key: string, scope: string): boolean {
  return window.localStorage.getItem(scopedKey(key, scope)) === 'accepted'
}

export function ReviewAiSettingsProvider({ children }: { children: ReactNode }) {
  /** `null` enquanto o Rust não responde; `''` = sem conta/identidade (máquina). */
  const [scope, setScope] = useState<string | null>(null)
  // Nascimento com o que está gravado **sem escopo**: se o Rust responder `''`
  // (convidado sem identidade), é exatamente esse o valor — nada pisca na tela
  // antes de o escopo chegar.
  const [provider, setProvider] = useState<ReviewAiProvider>(() => storedProvider(''))
  const [geminiConsent, setGeminiConsent] = useState(() => storedConsent(GEMINI_CONSENT_KEY, ''))
  const [openAiConsent, setOpenAiConsent] = useState(() => storedConsent(OPENAI_CONSENT_KEY, ''))

  // O escopo muda quando alguém entra ou sai; o fluxo de login devolve o foco à
  // janela, e é aí que a preferência da nova pessoa é lida.
  useEffect(() => {
    let vivo = true
    const carregar = () => {
      void invoke<string | null>('ai_scope')
        .then((valor) => {
          if (vivo) setScope(valor ?? '')
        })
        .catch(() => {
          if (vivo) setScope('')
        })
    }
    carregar()
    window.addEventListener('focus', carregar)
    return () => {
      vivo = false
      window.removeEventListener('focus', carregar)
    }
  }, [])

  // Troca de pessoa: relê provedor e consentimentos daquele escopo.
  useEffect(() => {
    if (scope === null) return
    setProvider(storedProvider(scope))
    setGeminiConsent(storedConsent(GEMINI_CONSENT_KEY, scope))
    setOpenAiConsent(storedConsent(OPENAI_CONSENT_KEY, scope))
  }, [scope])
  const { entitlement } = useEntitlement()
  const managedGate = useMemo(() => managedAiGate(entitlement, Date.now()), [entitlement])

  useEffect(() => {
    if (scope === null) return
    window.localStorage.setItem(scopedKey(PROVIDER_KEY, scope), provider)
  }, [provider, scope])
  // Só age quando o consentimento **muda**: aplicar o escopo não pode reescrever
  // consentimento que já estava igual (era o que fazia o app avisar o cofre sem
  // ninguém ter mexido em nada).
  useEffect(() => {
    if (scope === null) return
    const chave = scopedKey(GEMINI_CONSENT_KEY, scope)
    const Gravado = window.localStorage.getItem(chave) === 'accepted'
    if (Gravado === geminiConsent) return
    if (geminiConsent) window.localStorage.setItem(chave, 'accepted')
    else window.localStorage.removeItem(chave)
    void reviewProvider.setDataConsent('gemini', geminiConsent).catch(() => {
      if (geminiConsent) setGeminiConsent(false)
    })
  }, [geminiConsent, scope])
  useEffect(() => {
    if (scope === null) return
    const chave = scopedKey(OPENAI_CONSENT_KEY, scope)
    const gravado = window.localStorage.getItem(chave) === 'accepted'
    if (gravado === openAiConsent) return
    if (openAiConsent) window.localStorage.setItem(chave, 'accepted')
    else window.localStorage.removeItem(chave)
    void reviewProvider.setDataConsent('openAiCompatible', openAiConsent).catch(() => {
      if (openAiConsent) setOpenAiConsent(false)
    })
  }, [openAiConsent, scope])
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
