import { invoke } from '../../lib/tauri'
import { parseReviewAiConfiguration, type ReviewAiConfiguration } from './ai'

// Seam unico dos provedores configuraveis de IA da revisao.
//
// Antes, cada provedor (gemini x openAiCompatible) tinha seu trio de funcoes
// (configure/remove + set/confirm consent) — mesma regra, nomes dobrados.
// Aqui a regra e UMA, parametrizada por kind; os nomes de comando IPC ficam
// nas tabelas abaixo (byte-identicos aos de antes).
//
// O transporte e injetavel: Tauri em producao, in-memory em testes. Teste de
// settings bate nesta interface sem mock de `invoke` por funcao.

export type ConfigurableReviewProvider = 'gemini' | 'openAiCompatible'

const SET_CONSENT_COMMAND: Record<ConfigurableReviewProvider, string> = {
  gemini: 'set_gemini_data_consent',
  openAiCompatible: 'set_openai_compatible_data_consent',
}

const CONFIRM_CONSENT_COMMAND: Record<ConfigurableReviewProvider, string> = {
  gemini: 'confirm_gemini_data_consent',
  openAiCompatible: 'confirm_openai_compatible_data_consent',
}

const CONFIGURE_COMMAND: Record<ConfigurableReviewProvider, string> = {
  gemini: 'configure_gemini_api_key',
  openAiCompatible: 'configure_openai_compatible_provider',
}

const REMOVE_COMMAND: Record<ConfigurableReviewProvider, string> = {
  gemini: 'remove_gemini_api_key',
  openAiCompatible: 'remove_openai_compatible_provider',
}

export type ReviewProviderTransport = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

const tauriTransport: ReviewProviderTransport = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(command, args)

export type ConfigureProviderInput =
  | { kind: 'gemini'; apiKey: string }
  | { kind: 'openAiCompatible'; baseUrl: string; model: string; apiKey: string }

export function createReviewProvider(transport: ReviewProviderTransport = tauriTransport) {
  return {
    setDataConsent(kind: ConfigurableReviewProvider, consent: boolean): Promise<void> {
      return transport<void>(SET_CONSENT_COMMAND[kind], { consent })
    },

    /** Pede a confirmacao nativa do SO (fora do renderer) para autorizar o
     * envio ao provedor. Retorna true somente quando o usuario confirma no
     * dialogo do sistema operacional — uma interface comprometida nao
     * consegue falsifica-lo. */
    confirmDataConsent(kind: ConfigurableReviewProvider): Promise<boolean> {
      return transport<boolean>(CONFIRM_CONSENT_COMMAND[kind])
    },

    /** Configura o provedor. A chave fica no cofre nativo do sistema e nunca
     * no Vault (vale para gemini e openAiCompatible). */
    async configure(input: ConfigureProviderInput): Promise<ReviewAiConfiguration> {
      const payload = input.kind === 'gemini'
        ? await transport(CONFIGURE_COMMAND.gemini, { apiKey: input.apiKey })
        : await transport(CONFIGURE_COMMAND.openAiCompatible, {
          baseUrl: input.baseUrl,
          model: input.model,
          apiKey: input.apiKey,
        })
      return parseReviewAiConfiguration(payload)
    },

    async remove(kind: ConfigurableReviewProvider): Promise<ReviewAiConfiguration> {
      return parseReviewAiConfiguration(await transport(REMOVE_COMMAND[kind]))
    },
  }
}

export type ReviewProvider = ReturnType<typeof createReviewProvider>

/** Instancia compartilhada (transporte Tauri). */
export const reviewProvider = createReviewProvider()

/** Transporte in-memory para testes: registra chamadas e devolve o payload
 * configurado nas leituras que retornam configuracao. */
export function createInMemoryTransport(cannedConfiguration: unknown) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const transport: ReviewProviderTransport = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args })
    if (command === 'confirm_gemini_data_consent' || command === 'confirm_openai_compatible_data_consent') {
      return true as T
    }
    if (command.startsWith('set_')) return undefined as T
    return structuredClone(cannedConfiguration) as T
  }
  return { transport, calls }
}
