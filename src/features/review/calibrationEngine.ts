import { invoke } from '../../lib/tauri'
import {
  parseCalibrationConfiguration,
  type CalibrationConfiguration,
} from './ai'

// Seam único do motor calibrado (JEV / System One).
//
// O transporte é injetável como o de `reviewProvider.ts`, pelo mesmo motivo:
// os testes de configurações batem nesta interface em vez de fazer mock de
// `invoke` função por função.
//
// **A estratégia é por Vault, não por máquina.** Ela não vai para
// `localStorage`. O motivo está em §5.3 do plano e é o mais importante deste
// arquivo: um toggle global misturaria notas avaliadas por máquinas diferentes
// no mesmo histórico de espaçamento, e o FSRS pressupõe que as avaliações de
// uma unidade venham de um critério estável. Remover a chave ou revogar o
// consentimento também não pode deixar a configuração num estado impossível —
// por isso os dois comandos de escrita devolvem a configuração já reconciliada.

export type CalibrationTransport = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>

const tauriTransport: CalibrationTransport = <T>(
  command: string,
  args?: Record<string, unknown>,
) => invoke<T>(command, args)

export function createCalibrationEngine(transport: CalibrationTransport = tauriTransport) {
  return {
    /** Lê o estado do motor calibrado do Vault aberto. */
    async configuration(vaultPath: string): Promise<CalibrationConfiguration> {
      const payload = await transport('get_calibration_configuration', { vaultRoot: vaultPath })
      return parseCalibrationConfiguration(payload)
    },

    /**
     * Troca a estratégia.
     *
     * O backend recusa `jev`/`dual` sem chave ou sem consentimento, com
     * mensagem legível — por isso o erro sobe cru, sem fallback silencioso:
     * cair para `off` sem avisar deixaria o usuário achando que o motor
     * calibrado está ligado.
     */
    async setStrategy(
      vaultPath: string,
      strategy: CalibrationConfiguration['strategy'],
    ): Promise<CalibrationConfiguration> {
      const payload = await transport('set_calibration_strategy_for_vault', {
        vaultRoot: vaultPath,
        strategy,
      })
      return parseCalibrationConfiguration(payload)
    },

    /** Grava a chave no cofre nativo. Nunca no Vault. */
    async configureApiKey(
      vaultPath: string,
      apiKey: string,
    ): Promise<CalibrationConfiguration> {
      const payload = await transport('configure_typesafe_api_key', {
        vaultRoot: vaultPath,
        apiKey,
      })
      return parseCalibrationConfiguration(payload)
    },

    /**
     * Remove a chave.
     *
     * Tem efeito colateral deliberado: o backend derruba a estratégia para
     * `off`, porque `jev` e `dual` sem chave são escolhas inválidas.
     */
    async removeApiKey(vaultPath: string): Promise<CalibrationConfiguration> {
      const payload = await transport('remove_typesafe_api_key', { vaultRoot: vaultPath })
      return parseCalibrationConfiguration(payload)
    },

    /**
     * Revoga o consentimento de envio.
     *
     * `true` é **no-op**: o consentimento só é concedido pelo diálogo nativo
     * do sistema operacional, nunca pelo renderer. Uma interface comprometida
     * chamando isto com `true` não consegue autorizar o egresso. Para conceder,
     * use `confirmConsent`.
     */
    async revokeConsent(vaultPath: string): Promise<CalibrationConfiguration> {
      const payload = await transport('set_typesafe_data_consent', {
        vaultRoot: vaultPath,
        consent: false,
      })
      return parseCalibrationConfiguration(payload)
    },

    /** Pede a confirmação no diálogo do SO. `true` só quando o usuário confirma
     * fora do renderer. */
    confirmConsent(): Promise<boolean> {
      return transport<boolean>('confirm_typesafe_data_consent')
    },
  }
}

export type CalibrationEngineApi = ReturnType<typeof createCalibrationEngine>

export const calibrationEngine = createCalibrationEngine()