// Scaffolding pre-comercializacao do provedor de IA gerenciado pela
// assinatura (MirrorMind). Nenhuma chamada real existe ainda: o modelo de
// negocio ainda nao foi definido e as credenciais dos provedores permanecerao
// no backend do servico, nunca no cliente.
//
// Este modulo define a superficie local do provedor gerenciado:
// 1. A selecao `managed` no seletor de provedores (bloqueada com explicação).
// 2. A estimativa local de custo por chamada, reutilizando a mesma heuristica
//    de tokens do backend (`usage.rs`) — para que a interface ja mostre o
//    custo antes de qualquer assinatura existir.
// 3. O contrato de status da conta gerenciada (quota, plano), que o servico
//    futuro devera expor sem telemetria de conteudo.
//
// Tudo aqui e tipado contra contratos futuros: quando o servico existir, o
// `invoke` real substitui as constantes locais sem mudar a superficie.

/** Estado futuro de uma conta gerenciada pela assinatura. */
export type ManagedProviderPlan = 'free' | 'pro'

export type ManagedProviderStatus = {
  /** `true` quando o usuario possui uma assinatura ativa do MirrorMind. */
  subscribed: boolean
  plan: ManagedProviderPlan
  /** Quota mensal de custo estimado incluida no plano (USD). */
  includedCostUsdPerMonth: number
  /** Custo estimado consumido no mes atual, medido no backend do servico. */
  usedCostUsdMonth: number
}

/** Estado de scaffolding: sem servico, sem assinatura, sem custo. */
export const SCAFFOLD_MANAGED_STATUS: ManagedProviderStatus = {
  subscribed: false,
  plan: 'free',
  includedCostUsdPerMonth: 0,
  usedCostUsdMonth: 0,
}

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

/** Mensagem exibida no seletor quando o provedor gerenciado ainda nao existe. */
export const MANAGED_PROVIDER_UNAVAILABLE_MESSAGE =
  'O provedor gerenciado pela assinatura ainda não está disponível. Use o Ollama local ou configure sua própria chave.'

/** Valida se a conta gerenciada pode realizar uma chamada (quota mensal).
 * Scaffolding: sem servico, sempre retorna `false` ate a assinatura existir. */
export function canUseManagedProvider(status: ManagedProviderStatus, estimatedCostUsd: number): boolean {
  if (!status.subscribed) return false
  return status.usedCostUsdMonth + estimatedCostUsd <= status.includedCostUsdPerMonth
}
