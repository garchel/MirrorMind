import { isBillingEnabled, PLANS, resolveEntitlement, type Entitlement } from '../../lib/billing'

// Superficie local do provedor de IA gerenciado pela assinatura (MirrorMind).
// Nenhuma chamada real existe ainda: as credenciais dos provedores permanecerao
// no backend do servico, nunca no cliente.
//
// Este modulo define:
// 1. O gate de uso (`managedAiGate`), unico ponto que decide se a chamada
//    gerenciada pode acontecer — a Interface le o mesmo gate, entao a opcao
//    nunca aparece liberada para quem sera negado na execucao.
// 2. A estimativa local de custo por chamada, reutilizando a mesma heuristica
//    de tokens do backend (`usage.rs`).
//
// Ollama e chave propria (BYOK) nunca passam pelo gate: sao sempre livres.

/** Precos por milhao de tokens usados na estimativa local (USD), espelhando o
 * backend `usage.rs` (Gemini flash como referencia de nuvem). */
const INPUT_USD_PER_1M = 0.3
const OUTPUT_USD_PER_1M = 1.5
const ESTIMATED_OUTPUT_TOKENS = 2_000
const CHARS_PER_TOKEN = 4

/** Estima o custo em USD de uma chamada ao provedor gerenciado pelo tamanho do
 * prompt em caracteres. Mesma heuristica do backend — o servico usara a
 * medicao real por conta, sem armazenar conteudo de notas ou respostas. */
export function estimateManagedCallCostUsd(inputChars: number): number {
  const inputTokens = inputChars / CHARS_PER_TOKEN
  return inputTokens / 1_000_000 * INPUT_USD_PER_1M
    + ESTIMATED_OUTPUT_TOKENS / 1_000_000 * OUTPUT_USD_PER_1M
}

/** Mensagem exibida no seletor enquanto a cobranca esta desligada. */
export const MANAGED_PROVIDER_UNAVAILABLE_MESSAGE =
  'O provedor gerenciado pela assinatura ainda não está disponível. Use o Ollama local ou configure sua própria chave.'

const FREE_PLAN_MESSAGE =
  'A IA gerenciada faz parte dos planos pagos. Use o Ollama local ou configure sua própria chave: revisão, notas e exportação continuam grátis.'

const PAST_DUE_MESSAGE =
  'A assinatura está pendente de pagamento. Regularize no portal para voltar a usar a IA gerenciada; o Ollama local e a sua própria chave seguem disponíveis.'

export type ManagedAiGate = {
  /** Pode executar a chamada gerenciada agora? */
  allowed: boolean
  /** Rótulo da opção no seletor de provedor. */
  label: string
  /** Explicação mostrada no painel do provedor. */
  message: string
}

/** Data de renovacao no formato pt-BR (dia/mes/ano). */
export function formatManagedRenewal(periodEndUnixMs: number): string {
  return new Date(periodEndUnixMs).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Gate unico da IA gerenciada: mesma decisao para o seletor e para a execucao.
 * Cobra nada — apenas le os direitos cacheados (30 dias de graca offline) e
 * nega com mensagem clara quando o plano nao cobre. */
export function managedAiGate(entitlement: Entitlement | null, nowUnixMs: number): ManagedAiGate {
  if (!isBillingEnabled()) {
    return { allowed: false, label: 'MirrorMind (assinatura) — em breve', message: MANAGED_PROVIDER_UNAVAILABLE_MESSAGE }
  }
  const resolved = resolveEntitlement(entitlement, nowUnixMs)
  const plan = PLANS[resolved.plan]
  if (resolved.status === 'past_due') {
    return { allowed: false, label: 'MirrorMind (assinatura) — pendente', message: PAST_DUE_MESSAGE }
  }
  if (resolved.status === 'expired' || plan.quota.managedAiCallsPerCycle === null) {
    return { allowed: false, label: 'MirrorMind (assinatura) — exige plano', message: FREE_PLAN_MESSAGE }
  }
  const quota = plan.quota.managedAiCallsPerCycle
  const renewal = resolved.periodEndUnixMs === null || resolved.periodEndUnixMs <= nowUnixMs
    ? 'renovação ainda não definida'
    : `renovação em ${formatManagedRenewal(resolved.periodEndUnixMs)}`
  return {
    allowed: true,
    label: `MirrorMind (assinatura) — ${plan.name}`,
    message: `IA gerenciada incluída: ${quota} chamadas por ciclo (${renewal}).`,
  }
}
