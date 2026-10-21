import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { useCalibration } from './useCalibration'
import { ReviewCalibrationComparison } from './ReviewCalibrationComparison'
import { createCalibrationEngine } from './calibrationEngine'
import type { CalibrationConfiguration, CalibrationStrategy } from './ai'

/**
 * Painel do motor calibrado (JEV / System One).
 *
 * Fica **fora** do seletor de provedor de propósito. O provedor decide quem
 * *escreve o texto*; a estratégia de calibração decide quem **julga** o
 * resultado. São eixos ortogonais: dá para escrever com Gemini e julgar com o
 * JEV, e essa combinação é justamente o modo `dual` que o plano usa para
 * comparar. Amarrar os dois num seletor só impediria a comparação.
 *
 * A estratégia é por Vault e vive neste componente, não no
 * `ReviewAiSettingsContext` — ver `useCalibration`.
 */

const STRATEGIES: ReadonlyArray<{
  value: CalibrationStrategy
  label: string
  hint: string
}> = [
  {
    value: 'off',
    label: 'Desligado',
    hint: 'Comportamento atual: o modelo decide e o código valida.',
  },
  {
    value: 'jev',
    label: 'Só JEV',
    hint: 'Só o JEV julga. Falha explícita se o serviço cair — nunca cai para o modelo em silêncio.',
  },
  {
    value: 'dual',
    label: 'Comparar (dual)',
    hint: 'Executa os dois. Um lado alimenta o espaçamento; o outro vai para o registro de comparação.',
  },
]

export function ReviewCalibrationSettings({ vaultPath }: { vaultPath?: string }) {
  // A engine precisa ser **estavel**. Criada dentro do render, ela seria um
  // objeto novo a cada render; como o `useEffect` do hook depende de `[engine]`,
  // isso re-executava a busca a cada render, que reiniciava o estado, que
  // re-renderizava — um laco. O efeito visivel era o `select` controlado
  // voltando ao valor do backend sem parar, e o usuario vendo as opcoes sem
  // conseguir selecionar nenhuma.
  const engine = useMemo(() => createCalibrationEngine(), [])
  const {
    configuration,
    error,
    busy,
    available,
    selectStrategy,
    saveApiKey,
    removeApiKey,
    grantConsent,
    revokeConsent,
  } = useCalibration(vaultPath, engine)
  const [apiKey, setApiKey] = useState('')

  if (!vaultPath) {
    return (
      <section className="review-ai-provider-panel review-calibration-panel" aria-label="Motor calibrado">
        <p>Abra um Vault para configurar o motor calibrado.</p>
      </section>
    )
  }

  if (!configuration) {
    return (
      <section className="review-ai-provider-panel review-calibration-panel" aria-label="Motor calibrado">
        <p>Carregando estado do motor calibrado…</p>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <ReviewCalibrationComparison vaultPath={vaultPath} />
    </section>
  )
}

  const blocked = configuration.strategy !== 'off'
  // `jev` e `dual` exigem chave E autorizacao. A ordem da tela segue a ordem
  // dos requisitos: primeiro o que habilita, depois a escolha. Pedir a escolha
  // antes deixaria as opcoes desabilitadas sem explicar por que.
  const canUseJev = configuration.typesafeConfigured && configuration.typesafeConsent
  // O que falta, em uma frase por requisito. A opcao desabilitada diz *qual*
  // dos dois esta faltando — "indisponivel" nao ajuda ninguem a agir.
  const missing = !configuration.typesafeConfigured
    ? 'falta a chave da TypeSafe AI'
    : !configuration.typesafeConsent
      ? 'falta a autorização de envio'
      : null

  return (
    <section className="review-ai-provider-panel review-calibration-panel" aria-label="Motor calibrado">
      <h3 className="review-calibration-title">Motor de julgamento calibrado</h3>
      <p>
        O MirrorMind continua escrevendo o texto com o provedor escolhido acima. O motor
        calibrado é quem <strong>julga</strong> o resultado e diz o quanto ele está seguro.
      </p>

      <ul className="review-calibration-checklist" aria-label="Requisitos do motor calibrado">
        <li className={configuration.typesafeConfigured ? 'is-ready' : 'is-missing'}>
          <span aria-hidden="true">{configuration.typesafeConfigured ? '✓' : '○'}</span>
          <span>
            Chave da TypeSafe AI: {configuration.typesafeConfigured
              ? 'configurada'
              : 'ainda não configurada'}
          </span>
        </li>
        <li className={configuration.typesafeConsent ? 'is-ready' : 'is-missing'}>
          <span aria-hidden="true">{configuration.typesafeConsent ? '✓' : '○'}</span>
          <span>
            Autorização de envio: {configuration.typesafeConsent
              ? 'concedida'
              : 'ainda não concedida'}
          </span>
        </li>
      </ul>

      <label className="review-ai-key-field" htmlFor="typesafe-api-key">
        <span>Chave da TypeSafe AI</span>
        <input
          id="typesafe-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          placeholder={configuration.typesafeConfigured
            ? 'Chave armazenada com segurança'
            : 'Cole a chave da API'}
        />
        <small>A chave fica no cofre nativo do sistema e nunca no Vault.</small>
      </label>
      <div className="review-ai-inline-actions">
        {configuration.typesafeConfigured ? (
          <Button
            type="button"
            className="ui-button ui-button--secondary ui-button--sm"
            onClick={() => void removeApiKey()}
            disabled={busy}
          >
            Remover chave
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => void saveApiKey(apiKey.trim())}
          disabled={busy || !apiKey.trim()}
        >
          Salvar chave
        </button>
      </div>

      <label className="review-ai-consent">
        <input
          type="checkbox"
          checked={configuration.typesafeConsent}
          disabled={busy || configuration.typesafeConsent}
          onChange={(event) => {
            if (event.target.checked) void grantConsent()
            else void revokeConsent()
          }}
        />
        <span>Autorizo o envio do trecho da nota e dos dados da sessão à TypeSafe AI.</span>
      </label>
      <small>
        A autorização é concedida em um diálogo do sistema operacional, fora do app, e vale
        para este computador. O destino é <code>{configuration.typesafeEndpoint}</code> — os
        dados saem do seu Vault.
      </small>

      <label className="review-calibration-consent" htmlFor="calibration-strategy">
        <span>Como julgar</span>
        <select
          id="calibration-strategy"
          value={configuration.strategy}
          disabled={busy}
          onChange={(event) => void selectStrategy(event.target.value as CalibrationStrategy)}
        >
          {STRATEGIES.map((strategy) => (
            <option
              key={strategy.value}
              value={strategy.value}
              disabled={!available(strategy.value)}
            >
              {strategy.label}
              {available(strategy.value) ? '' : ` (${missing ?? 'requisito pendente'})`}
            </option>
          ))}
        </select>
      </label>
      <p className="review-calibration-hint">
        {STRATEGIES.find((strategy) => strategy.value === configuration.strategy)?.hint}
      </p>

      {!canUseJev ? (
        <p className="review-calibration-hint">
          Para usar <strong>Só JEV</strong> ou <strong>Comparar</strong>: {missing}. Sem os
          dois requisitos, o backend recusa a escolha — não há queda silenciosa para o
          outro caminho.
        </p>
      ) : null}

      {blocked ? (
        <p className="review-calibration-active" role="status">
          Ativo neste Vault: <strong>{STRATEGIES.find((s) => s.value === configuration.strategy)?.label}</strong>.
          A estratégia é salva por Vault — trocar aqui não afeta os outros.
        </p>
      ) : null}

      {!configuration.calibrationValidated ? (
        <p className="review-calibration-warning" role="status">
          A confiança exibida nos relatórios ainda <strong>não foi validada</strong> contra
          veredito humano. É o número que o motor informa sobre si mesmo, e não uma
          probabilidade medida. O número aparece assim mesmo de propósito — escondê-lo
          agora impediria de coletar os dados que precisam para validá-lo.
        </p>
      ) : null}

      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </section>
  )
}

export type ReviewCalibrationSettingsProps = {
  vaultPath?: string
}

export type { CalibrationConfiguration }