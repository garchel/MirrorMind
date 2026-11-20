/** Catálogo do que está à venda, como a página de planos mostra.
 *
 * Regra que este arquivo respeita: **nada aqui inventa preço**. Os valores vêm
 * das decisões de produto já registradas (nuvem 10 GB a R$ 30/mês ou R$ 300/ano);
 * o plano de IA gerenciada ainda **não tem preço definido** nem preço no Stripe,
 * então ele aparece como "em breve" em vez de um número inventado. Quando o preço
 * existir, é uma linha aqui e outra no Stripe.
 *
 * Função pura de propósito: a página só desenha o que isto devolve, e o teste
 * cobre os estados (convidado, add-on ativo, sem add-on) sem tocar em IPC.
 */

export type CloudKind = 'cloud_month' | 'cloud_year'

export type PricingCta =
  | { kind: 'current'; label: string }
  | { kind: 'buy'; label: string; cloud: CloudKind }
  | { kind: 'active'; label: string }
  | { kind: 'signin'; label: string }
  | { kind: 'soon'; label: string }

export type PricingCard = {
  id: 'gratis' | 'nuvem_mensal' | 'nuvem_anual' | 'ia'
  name: string
  /** Uma linha que resume o plano (o "headline" do cartão). */
  headline: string
  description: string
  /** Preço já formatado ("R$ 30", "R$ 0", "—"). */
  price: string
  /** O complemento do preço ("/mês", "para sempre", "em definição"). */
  priceNote: string
  features: string[]
  /** Nota de rodapé do cartão. */
  footnote?: string
  badge?: string
  /** Cartão em destaque (borda e CTA primário). */
  highlight?: boolean
  cta: PricingCta
}

export const CLOUD_QUOTA = '10 GB'

export function buildPricingCards({
  signedIn,
  cloudActive,
}: {
  signedIn: boolean
  cloudActive: boolean
}): PricingCard[] {
  const nuvemCta = (cloud: CloudKind): PricingCta => {
    if (!signedIn) return { kind: 'signin', label: 'Entrar para assinar' }
    if (cloudActive) return { kind: 'active', label: 'Nuvem já ativa' }
    return { kind: 'buy', label: 'Comprar agora', cloud }
  }

  return [
    {
      id: 'gratis',
      name: 'Grátis',
      headline: 'Estudar, revisar e escrever',
      description: 'Tudo o que já funciona hoje, sem conta e sem prazo.',
      price: 'R$ 0',
      priceNote: 'para sempre',
      features: [
        'Notas em Markdown no seu computador',
        'Revisão espaçada (FSRS) com histórico',
        'Grafo, tags, busca e exportação',
        'IA com a sua chave, Gemini ou Ollama',
      ],
      footnote: 'Nada do que é local depende de login.',
      cta: { kind: 'current', label: 'Seu plano atual' },
    },
    {
      id: 'nuvem_mensal',
      name: 'Nuvem',
      headline: `${CLOUD_QUOTA} para o vault inteiro`,
      description: 'Suas notas em todos os computadores, sem perder histórico.',
      price: 'R$ 30',
      priceNote: '/mês',
      features: [
        'Sincronização incremental entre computadores',
        'Conflito vira cópia marcada — nada é sobrescrito',
        'Espaço para notas, anexos e PDFs',
        'Independente do plano de IA',
      ],
      footnote: 'Cancela quando quiser; os arquivos ficam no seu computador.',
      cta: nuvemCta('cloud_month'),
    },
    {
      id: 'nuvem_anual',
      name: 'Nuvem anual',
      headline: `${CLOUD_QUOTA} pagando o ano`,
      description: 'O mesmo add-on, com dois meses de desconto.',
      price: 'R$ 300',
      priceNote: '/ano · equivale a R$ 25/mês',
      badge: 'Recomendado',
      highlight: true,
      features: [
        'Tudo do plano mensal',
        'Dois meses grátis em relação ao mensal',
        'Um pagamento por ano, sem surpresa no cartão',
        'Sincronização e conflito com as mesmas garantias',
      ],
      footnote: 'Cobrado uma vez por ano. Reembolso pelos 7 dias de arrependimento.',
      cta: nuvemCta('cloud_year'),
    },
    {
      id: 'ia',
      name: 'IA gerenciada',
      headline: 'Sem chave, sem configuração',
      description: 'A IA da revisão rodando por nossa conta, com cota mensal.',
      price: '—',
      priceNote: 'preço em definição',
      features: [
        'Funciona sem chave de API',
        'Cota mensal de chamadas do plano',
        'Prompts de revisão calibrados no app',
        'Sua chave ou o Ollama continuam gratuitos',
      ],
      footnote: 'Ainda não está à venda: o preço está sendo definido.',
      cta: { kind: 'soon', label: 'Em breve' },
    },
  ]
}

/** Rótulo curto do que a pessoa tem hoje, para o cabeçalho da página. */
export function currentPlanLabel({
  cloudActive,
}: {
  cloudActive: boolean
}): string {
  return cloudActive ? 'Grátis + Nuvem' : 'Grátis'
}
