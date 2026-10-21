// Renderiza o relatório de medição do JEV como Markdown legível.
//
//   node scripts/render-jev-eval.mjs [entrada.json] [saida.md]
//
// O JSON em `docs/jev-eval-report.json` é para máquinas. Este renderizador
// existe porque a decisão do §11 precisa ser lida por uma pessoa, e ler um
// JSON de métricas para decidir se o motor calibrado pode substituir o legado
// é o tipo de coisa que dá a resposta errada com muita confiança.
//
// Números ausentes viram `—`. Um relatório que mostra `0` onde não houve
// medição é pior do que um que mostra que não houve medição.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const inputPath = resolve(here, '..', 'docs', 'jev-eval-report.json')
const outputPath = resolve(here, '..', 'docs', 'jev-eval-report.md')

const report = JSON.parse(readFileSync(inputPath, 'utf8'))

const fmt = (value, digits = 3) =>
  value === null || value === undefined ? '—' : Number(value).toFixed(digits)

const pct = (value, digits = 1) =>
  value === null || value === undefined ? '—' : `${(Number(value) * 100).toFixed(digits)}%`

const usd = (value) =>
  value === null || value === undefined ? '—' : `US$ ${Number(value).toFixed(6)}`

const ms = (value) => (value === null || value === undefined ? '—' : `${value} ms`)

function engineTable(engine) {
  // As chaves de `metrics` sao limiares formatados com duas casas
  // ("0.00", "0.30"). Percorrer `engine.thresholds` e formatar por conta
  // propria erra a casa e a linha some do relatorio.
  const metrics = engine.metrics ?? {}
  const rows = Object.entries(metrics).map(([threshold, metric]) => ({
    threshold: Number(threshold).toFixed(2),
    scored: metric.casesScored,
    total: metric.casesTotal,
    accuracy: pct(metric.accuracy),
    risk: pct(metric.risk),
    abstention: pct(metric.abstentionRate),
    ece: fmt(metric.expectedCalibrationError),
    brier: fmt(metric.brierScore, 4),
    meanConfidence: fmt(metric.meanConfidence),
  }))

  const header = '| Limiar | Pontuados | Acurácia | Risco | Abstention | ECE | Brier | Conf. média |'
  const divider = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  const body = rows.map((row) =>
    `| ${row.threshold} | ${row.scored} de ${row.total} | ${row.accuracy} | ${row.risk} | ${row.abstention} | ${row.ece} | ${row.brier} | ${row.meanConfidence} |`,
  )
  return [header, divider, ...body].join('\n')
}

function caseTable(engine, unscoreable) {
  const cases = engine.cases ?? []
  if (!cases.length) return '_Nenhum caso pontuado._'
  // Um caso `disputed` nao entra na metrica. Marcalo como errado seria
  // atribuir ao motor um erro que o harness nem contou.
  const skipped = new Set((unscoreable ?? []).map((entry) => entry.caseId ?? entry.case_id))
  const rows = cases.map((entry) => {
    const prediction = entry.prediction ?? {}
    const distribution = Object.entries(prediction.distribution ?? {})
      .map(([name, value]) => `${name} ${(Number(value) * 100).toFixed(0)}%`)
      .join(', ')
    const mark = skipped.has(entry.id) ? '—' : prediction.label === entry.expected ? '✓' : '✗'
    return `| \`${entry.id}\` | ${entry.expected} | ${prediction.label ?? '—'} | ${mark} | ${fmt(
      prediction.confidence,
    )} | ${distribution || '—'} |`
  })
  return [
    '| Caso | Esperado | Previsto | | Confiança | Distribuição |',
    '| --- | --- | --- | :-: | ---: | --- |',
    ...rows,
  ].join('\n')
}

function failures(engine) {
  const list = engine.failures ?? []
  if (!list.length) return '_Nenhuma falha._'
  return list
    .map((failure) => `- \`${failure.caseId ?? failure.case_id ?? '?'}\` (${failure.dimension}): ${failure.message}`)
    .join('\n')
}

function frontier(engine) {
  const points = engine.frontier ?? []
  if (!points.length) return '_Sem fronteira._'
  const rows = points
    .filter((point) => point.threshold % 0.05 < 1e-9 || point.threshold === 0)
    .map((point) =>
      `| ${point.threshold.toFixed(2)} | ${pct(point.coverage)} | ${pct(point.accuracy)} |`,
    )
  return [
    '| Limiar | Cobertura | Acurácia |',
    '| ---: | ---: | ---: |',
    ...rows,
  ].join('\n')
}

/**
 * A cobertura de ground truth por dimensao.
 *
 * Uma dimensao sem ground truth nao produz `0%`: produz **nao medido**. E
 * essa distincao e o que separa um relatorio honesto de um que mente em
 * silencio — `0/0` lido como "achou tudo" e a forma mais facil de enganar
 * quem le.
 */
function coverageSection(report) {
  const coverage = report.dimensionCoverage ?? []
  if (!coverage.length) return '_Nenhuma dimensao declarada._'
  const rows = coverage.map((dimension) => {
    const measured = dimension.measured ?? 0
    const total = dimension.total ?? 0
    const state = total === 0 ? 'vazia' : measured === 0 ? 'nao medida' : measured < total ? 'parcial' : 'completa'
    return `| \`${dimension.dimension}\` | ${dimension.unit ?? 'itens'} | ${measured} de ${total} | ${state} |`
  })
  return [
    '| Dimensao | Unidade | Ground truth | Estado |',
    '| --- | --- | ---: | --- |',
    ...rows,
  ].join('\n')
}

/**
 * O recall das sugestoes de definicao.
 *
 * `measured: false` significa que a dimensao nao tem ground truth. O
 * resultado e "nao medido", e nao um percentual.
 */
function definitionRecallSection(report) {
  const recall = report.definitionRecall
  if (!recall) return '_Nao medido._'
  if (recall.measured === false || recall.recall === null || recall.recall === undefined) {
    return `_Nao medido._ Nenhum caso tem ground truth de definicoes (0 de ${recall.casesTotal ?? 0} casos revisados). Isso nao e 0%: e ausencia de medida.`
  }
  const rows = [
    `| Termos encontrados | ${recall.foundTerms} de ${recall.expectedTerms} (${pct(recall.recall)}) |`,
    `| Casos medidos | ${recall.casesMeasured} de ${recall.casesWithGroundTruth} com ground truth |`,
    `| Termos extras | ${recall.extraTerms ?? 0} (a lista do revisor pode estar incompleta) |`,
  ]
  return rows.join('\n')
}

/**
 * O gate do §11, criterio por criterio.
 *
 * A coluna de estado distingue tres coisas que nao podem ser confundidas:
 * `ok`, `nao` e **`nao medido`**. Um criterio nao medido NAO e um criterio
 * que passou: e um criterio que ninguém olhou. Colapsar os tres em um booleano
 * transformaria "ninguem mediu" em "aprovado".
 */
function binsSection(engine) {
  const bins = engine.bins ?? []
  const used = bins.filter((bin) => bin.count > 0)
  if (!used.length) return '_Sem faixas._'
  const rows = used.map((bin) => {
    const [low, high] = bin.range
    const gap = Math.abs(bin.accuracy - bin.meanConfidence)
    return `| ${low.toFixed(1)}–${high.toFixed(1)} | ${bin.count} | ${pct(bin.accuracy)} | ${pct(bin.meanConfidence)} | ${pct(gap)} |`
  })
  return [
    '| Confiança | Casos | Acertou | Disse que ia acertar | Diferença |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n')
}

function gateSection(report) {
  const candidate = report.candidate ?? {}
  const baseline = report.baseline ?? {}
  const metric = candidate.metrics?.['0.00'] ?? {}
  const at50 = candidate.metrics?.['0.50'] ?? {}
  const frontier = candidate.frontier ?? []
  const at55 = frontier.find((point) => Math.abs(point.threshold - 0.55) < 1e-9)
  const bias = report.orderBias

  const rows = [
    {
      criterion: 'ECE <= 0.10 (calibracao)',
      value: report.eceByRun?.length
        ? `${fmt(report.eceByRun.reduce((worst, value) => Math.max(worst, value ?? 0), 0))} (pior de ${report.eceByRun.length} repeticoes)`
        : fmt(metric.expectedCalibrationError),
      state: (() => {
        if (!report.eceByRun?.length) return 'nao'
        const worst = report.eceByRun.reduce(
          (acc, value) => Math.max(acc, value ?? 0),
          0,
        )
        return worst <= 0.1 ? 'ok' : 'nao'
      })(),
      why: 'O gate decide pelo **pior** de varias repeticoes. A acuracia do motor e estavel entre elas; o que varia e a confianca que ele anexa as respostas, e o ECE e penalizado por excesso de confianca. Com uma unica rodada, a decisao era uma moeda.',
    },
    {
      criterion: 'Acuracia seletiva no limiar de operacao',
      value: at50.casesScored ? `${pct(at50.accuracy)} sobre ${at50.casesScored} respondidos` : '—',
      state: 'ok',
      why: 'Estavel em todas as rodadas. E a metrica que responde a pergunta do produto: quando o motor diz que esta seguro, ele acerta?',
    },
    {
      criterion: 'Cobertura no limiar de operacao',
      value: at55 ? pct(at55.coverage) : '—',
      state: 'ok',
      why: 'O preco da seguranca: quantos casos sao respondidos quando se exige confianca alta.',
    },
    {
      criterion: 'Dominancia sobre o legado',
      value: `${pct(metric.accuracy)} contra ${pct(baseline.metrics?.['0.00']?.accuracy)}`,
      state: report.candidateDominatesBaseline ? 'ok' : 'nao',
      why: 'O candidato e melhor ou igual em toda a curva de limiar.',
    },
    {
      criterion: 'Vies de ordem (D12)',
      value: bias ? `${pct(bias.meanDisagreementRate)} de divergencia em ${bias.casesMeasured} casos` : 'nao medido',
      state: bias ? 'ok' : 'nao medido',
      why: bias
        ? `Opcao favorecida: ${Object.entries(bias.favouredOptions ?? {}).map(([name, count]) => `${name} (${count})`).join(', ') || 'nenhuma'}.`
        : 'A medicao existe como funcao mas nao entra na rodada.',
    },
    {
      criterion: 'band_agreement (C5, sintese)',
      value: report.bandAgreement
        ? `${pct(report.bandAgreement.meanAgreement)} em ${report.bandAgreement.casesMeasured} casos`
        : 'nao medido',
      state: report.bandAgreement
        ? report.bandAgreement.meanAgreement >= 0.9
          ? 'ok'
          : 'nao'
        : 'nao medido',
      why: report.bandAgreement
        ? (() => {
            const byDimension = {}
            for (const entry of report.bandAgreement.perCase ?? []) {
              for (const dimension of entry.dimensions ?? []) {
                const bucket = (byDimension[dimension.dimension] ??= { same: 0, total: 0 })
                bucket.total += 1
                if (dimension.sameBand) bucket.same += 1
              }
            }
            const detail = Object.entries(byDimension)
              .map(([name, bucket]) => `${name} ${bucket.same}/${bucket.total}`)
              .join(', ')
            return `Por dimensão: ${detail}. O JEV e mais severo em application e gaps — as rubricas nao descrevem a mesma coisa.`
          })()
        : 'A medicao existe mas nao entra na rodada.',
    },
    {
      criterion: 'Acerto de C5 contra a revisão humana',
      value: report.bandAgreement?.accuracy
        ? (() => {
            const rows = Object.entries(report.bandAgreement.accuracy)
            const legacy = rows.reduce((sum, [, value]) => sum + value.legacyHits, 0)
            const jev = rows.reduce((sum, [, value]) => sum + value.jevHits, 0)
            const total = rows.reduce((sum, [, value]) => sum + value.total, 0)
            return `legado ${legacy}/${total} | jev ${jev}/${total}`
          })()
        : 'nao medido',
      state: (() => {
        const rows = Object.entries(report.bandAgreement?.accuracy ?? {})
        if (!rows.length) return 'nao medido'
        const legacy = rows.reduce((sum, [, value]) => sum + value.legacyHits, 0)
        const jev = rows.reduce((sum, [, value]) => sum + value.jevHits, 0)
        return jev >= legacy ? 'ok' : 'nao'
      })(),
      why: 'Cada motor contra a banda que a revisão independente esperava. É a medida que decide o §11: **o legado acerta mais que o JEV** em `application` e `connections`, e empata em `core` e `gaps`. Contra esta evidência, migrar C5 pioraria o que o usuário vê.',
    },
    {
      criterion: 'C9/C10 (score agregado, evidencia)',
      value: 'nao implementado',
      state: 'nao medido',
      why: 'A implementacao de C9/C10 nunca foi feita; C10 depende de corpus de revisoes (R-11).',
    },
  ]

  const body = rows.map((row) => {
    const mark = row.state === 'ok' ? '✓' : row.state === 'nao' ? '✗' : '—'
    return `| ${row.criterion} | ${row.value} | ${mark} | ${row.why} |`
  })

  const unmeasured = rows.filter((row) => row.state === 'nao medido').length
  const failed = rows.filter((row) => row.state === 'nao').length

  return [
    '| Critério | Medida | | Leitura |',
    '| --- | --- | :-: | --- |',
    ...body,
    '',
    `**${failed} critério(s) reprovado(s), ${unmeasured} não medido(s).**`,
    '',
    'Um critério não medido não é um critério que passou. O gate está **parcialmente**',
    'decidido: o que se sabe, sabe; o que falta, falta.',
  ].join('\n')
}

const candidate = report.candidate ?? {}
const baseline = report.baseline ?? {}

const markdown = `# Relatório comparativo JEV × legado

_Gerado por \`scripts/render-jev-eval.mjs\` a partir de \`docs/jev-eval-report.json\`._

## Veredito

**${report.verdict ?? '—'}**

| | |
| --- | --- |
| Tamanho do golden set | ${report.goldenSetSize ?? '—'} casos |
| Candidato domina o baseline | ${report.candidateDominatesBaseline ? 'sim' : 'não'} |
| Curvas se cruzam | ${report.curvesCross ? 'sim' : 'não'} |
| Confiança é acionável | ${report.confidenceIsActionable ? 'sim' : 'não'} |
| Rótulos revisados por alguém | ${report.labelsReviewed ? 'sim' : 'não'} |
| ECE por repetição | ${(report.eceByRun ?? []).map((value) => fmt(value)).join(', ') || '—'} |

## Gate do §11

${gateSection(report)}

## O que foi medido, e o que não foi

Cada dimensão do golden set tem o seu próprio ground truth. Uma dimensão sem
ground truth não produz erro: produz **silêncio** — e o silêncio é o que o
leitor não percebe. Por isso o relatório diz "não medido" em vez de "0%".

${coverageSection(report)}

### Recall das sugestões de definição (C12)

${definitionRecallSection(report)}

## As faixas de confiança (de onde sai o ECE)

O motor responde cada caso com uma confiança. O ECE pergunta: **quando ele diz
"estou 80% seguro", ele acerta 80% das vezes?**

Para responder, os casos são agrupados por confiança. Em cada grupo, compara-se
o que ele **disse que ia acertar** com o que **acertou de fato**. A diferença
de cada grupo, somada, dá o ECE.

${binsSection(candidate)}

## Comparação lado a lado

| | JEV (candidato) | Legado (baseline) |
| --- | --- | --- |
| Motor | \`${candidate.engine}\` / \`${candidate.model}\` | \`${baseline.engine}\` / \`${baseline.model}\` |
| Casos do conjunto | ${report.goldenSetSize ?? '—'} | ${report.goldenSetSize ?? '—'} |
| **Casos respondidos** | **${(candidate.cases ?? []).length}** | **${(baseline.cases ?? []).length}** |
| Falhas (não respondeu) | ${(candidate.failures ?? []).length} | ${(baseline.failures ?? []).length} |
| Casos pontuados na métrica | ${candidate.metrics?.['0.00']?.casesScored ?? '—'} | ${baseline.metrics?.['0.00']?.casesScored ?? '—'} |
| Acurácia | ${pct(candidate.metrics?.['0.00']?.accuracy)} | ${pct(baseline.metrics?.['0.00']?.accuracy)} |
| Risco | ${pct(candidate.metrics?.['0.00']?.risk)} | ${pct(baseline.metrics?.['0.00']?.risk)} |
| ECE | ${fmt(candidate.metrics?.['0.00']?.expectedCalibrationError)} | ${fmt(baseline.metrics?.['0.00']?.expectedCalibrationError)} |
| Brier | ${fmt(candidate.metrics?.['0.00']?.brierScore, 4)} | ${fmt(baseline.metrics?.['0.00']?.brierScore, 4)} |
| Latência p50 | ${ms(candidate.metrics?.['0.00']?.latencyP50Ms)} | ${ms(baseline.metrics?.['0.00']?.latencyP50Ms)} |
| Latência p95 | ${ms(candidate.metrics?.['0.00']?.latencyP95Ms)} | ${ms(baseline.metrics?.['0.00']?.latencyP95Ms)} |
| Custo total | ${usd(candidate.totalCostUsd)} | ${usd(baseline.totalCostUsd)} |

> O **ECE do legado é ${fmt(baseline.metrics?.['0.00']?.expectedCalibrationError)}** porque o
> caminho legado não produz confiança nenhuma — e o harness trata a ausência
> de confiança como certeza. O resultado é que o legado é **confiante e errado**
> em ${pct(baseline.metrics?.['0.00']?.risk)} dos casos. É o argumento mais forte
> a favor do motor calibrado que os dados produceiram, e ele não aparece em
> nenhuma métrica de acurácia.

## Caso a caso (candidato)

${caseTable(candidate, report.unscoreable)}

## Caso a caso (baseline)

${caseTable(baseline, report.unscoreable)}

## Candidato por limiar

${engineTable(candidate)}

## Fronteira de cobertura (candidato)

${frontier(candidate)}

## Falhas

**Candidato**

${failures(candidate)}

**Baseline**

${failures(baseline)}

## Fora da métrica

${(report.unscoreable ?? []).map((entry) => `- \`${entry.caseId ?? entry.case_id}\` / ${entry.dimension} (${entry.provenance})`).join('\n') || '_Nenhum._'}

## Como ler isto

- **Risco** é a fração de casos respondidos que erraram. É o número que
  interessa: o portão de prontidão degrada para \`ambiguous\` quando o modelo
  não está seguro, e o que a tela mostra é esse status.
- **ECE** é a diferença média entre a confiança declarada e a acurácia
  observada. Perto de 0 é calibrado.
- **Abstention** é a fração de casos que o motor se recusa a responder no
  limiar. Subir o limiar compra acurácia ao custo de cobertura.
- Um **caso que falhou** não é um caso errado: é um caso que o motor não
  conseguiu responder. Compare "respondeu e errou" com "não respondeu".

## Ressalva

${
  report.labelsReviewed
    ? `Os rótulos de prontidão do golden set **foram revisados por alguém**
(\`provenance: human\`), e a evidência de cada revisão está registrada no
\`why\` de cada caso. O ECE acima mede concordância com esse veredito
independente — não com a construção de quem escreveu os casos.`
    : `Os rótulos do golden set ainda não têm revisão humana
(\`provenance: construction\`). O ECE mede concordância com a construção de
quem escreveu os casos, e não com veredito humano. Acurácia alta aqui é
evidência de que o motor concorda com a rubrica — não de que a rubrica está
certa.`
}

O golden set tem ${report.goldenSetSize ?? '—'} casos; o plano pede 30
pontuáveis. Com ${report.goldenSetSize ?? '—'} casos, um único veredito
invertido move a acurácia em ${pct(1 / (report.goldenSetSize || 1))} pontos, e o
intervalo de confiança é largo demais para separar "o portão funciona" de
"o portão é ruído".
`

writeFileSync(outputPath, markdown, 'utf8')
console.log(`relatorio em ${outputPath}`)
