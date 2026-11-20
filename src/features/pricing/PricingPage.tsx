import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { supabaseConfigFromEnv } from '../../lib/supabaseSession'
import {
  hasCloudPlan,
  readCloudStatus,
  startCheckout,
  type CheckoutKind,
  type CloudStatus,
} from '../../lib/cloudSync'
import { buildPricingCards, currentPlanLabel, type PricingCard } from '../../lib/pricing'
import { errorMessage } from '../../lib/tauri'
import './pricing.css'

const DEPS_PADRAO = { readCloudStatus, startCheckout }

/** Página de planos: o que a pessoa pode assinar hoje, sem preço inventado.
 *
 * O desenho segue a referência que o Paulo mandou (cartões lado a lado, um em
 * destaque, CTA dentro do cartão) com a linguagem visual do app: fundo de painel,
 * borda fina, tipografia do tema e nada de cor fora dos tokens.
 *
 * O que a página **não** faz é fingir: o cartão de IA gerenciada não tem preço
 * definido e diz isso; e o botão de comprar só aparece quando há checkout real do
 * outro lado. */
export function PricingPage({
  vaultPath,
  config,
  deps = DEPS_PADRAO,
  onOpenAccount,
  onBack,
}: {
  vaultPath: string
  config?: { url: string; apiKey: string } | null
  deps?: {
    readCloudStatus: typeof readCloudStatus
    startCheckout: typeof startCheckout
  }
  /** Sem sessão, comprar exige entrar: a página manda para a conta. */
  onOpenAccount?: () => void
  /** Volta para onde a pessoa estava (notas). */
  onBack?: () => void
}) {
  const envConfig = useMemo(() => supabaseConfigFromEnv(), [])
  const resolvedConfig = config === undefined ? envConfig : config

  const depsRef = useRef(deps)
  depsRef.current = deps

  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [comprando, setComprando] = useState<CheckoutKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!resolvedConfig) return
    try {
      setStatus(
        await depsRef.current.readCloudStatus({ path: vaultPath, ...resolvedConfig }),
      )
    } catch {
      // Sem estado da nuvem a página continua útil: mostra os planos e trata
      // como "sem sessão" em vez de tela vazia.
      setStatus(null)
    }
  }, [resolvedConfig, vaultPath])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function comprar(kind: CheckoutKind) {
    if (!resolvedConfig) return
    setComprando(kind)
    setError(null)
    try {
      await depsRef.current.startCheckout(kind, { path: vaultPath, ...resolvedConfig })
    } catch (problema) {
      setError(errorMessage(problema, 'Não foi possível abrir o checkout.'))
    } finally {
      setComprando(null)
    }
  }

  const signedIn = Boolean(status?.signedIn)
  const cloudActive = status ? hasCloudPlan(status) : false
  const cartoes = buildPricingCards({ signedIn, cloudActive })

  /** Um botão por estado — e um estado desabilitado nunca finge ser comprável. */
  function acaoDoCartao(cartao: PricingCard) {
    const cta = cartao.cta
    const variante = cartao.highlight ? 'primary' : 'secondary'

    if (cta.kind === 'buy') {
      const abrindo = comprando === cta.cloud
      return (
        <Button
          type="button"
          variant={variante}
          size="md"
          disabled={comprando !== null}
          onClick={() => void comprar(cta.cloud)}
        >
          {abrindo ? 'Abrindo…' : cta.label}
        </Button>
      )
    }

    if (cta.kind === 'signin') {
      return (
        <Button
          type="button"
          variant={variante}
          size="md"
          onClick={onOpenAccount}
          disabled={!onOpenAccount}
        >
          {cta.label}
        </Button>
      )
    }

    return (
      <Button type="button" variant="secondary" size="md" disabled>
        {cta.label}
      </Button>
    )
  }

  return (
    <section className="workspace-page pricing-page" data-builder-name="pricing-page">
      <header className="pricing-header">
        <p className="card-kicker">Planos</p>
        <h2>Faça upgrade do seu plano</h2>
        <p className="pricing-lead">
          O app funciona inteiro de graça, no seu computador. A nuvem e a IA
          gerenciada são complementos: você assina só o que usar.
        </p>
        <p className="pricing-current" role="status">
          <Sparkles size={14} strokeWidth={1.6} aria-hidden="true" />
          Seu plano hoje: <strong>{currentPlanLabel({ cloudActive })}</strong>
          {cloudActive && status?.planPeriodEnd ? (
            <> — válido até {formatDate(status.planPeriodEnd)}</>
          ) : null}
        </p>
      </header>

      <div className="pricing-grid">
        {cartoes.map((cartao) => (
          <article
            key={cartao.id}
            className="pricing-card"
            data-highlight={cartao.highlight ? 'true' : undefined}
            aria-labelledby={`plano-${cartao.id}`}
          >
            <div className="pricing-card-top">
              <h3 id={`plano-${cartao.id}`}>{cartao.name}</h3>
              {cartao.badge ? <span className="pricing-badge">{cartao.badge}</span> : null}
            </div>
            <p className="pricing-headline">{cartao.headline}</p>
            <p className="pricing-description">{cartao.description}</p>

            <div className="pricing-cta">{acaoDoCartao(cartao)}</div>

            <p className="pricing-price">
              <span className="pricing-price-value">{cartao.price}</span>
              <span className="pricing-price-note">{cartao.priceNote}</span>
            </p>

            <ul className="pricing-features">
              {cartao.features.map((recurso) => (
                <li key={recurso}>
                  <Check size={15} strokeWidth={2} aria-hidden="true" />
                  <span>{recurso}</span>
                </li>
              ))}
            </ul>

            {cartao.footnote ? <p className="pricing-footnote">{cartao.footnote}</p> : null}
          </article>
        ))}
      </div>

      {error ? (
        <p className="pricing-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="pricing-footer">
        <p className="pricing-hint">
          Pagamento pelo Stripe, no seu navegador. O add-on de nuvem aparece ativo
          aqui em alguns segundos depois da confirmação.
        </p>
        {onBack ? (
          <Button type="button" variant="bare" size="md" onClick={onBack}>
            Voltar para as notas
          </Button>
        ) : null}
      </footer>
    </section>
  )
}

function formatDate(iso: string): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return iso
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
