// Compara as duas regras de fusao de veredito sobre o mesmo relatorio.
//
//   node scripts/compare-fusion-rules.mjs
//
// ## A pergunta
//
// O JEV responde "esta nota esta pronta?" com uma distribuicao. A fusao
// (`adopt_status`) pode descartar essa resposta e devolver o status do
// legado. Isso e o que a regra de produto decide: o JEV manda, ou o legado
// manda quando o legado nao achou nenhum problema?
//
// ## O que este script mede
//
// As DUAS simulacoes, sobre o mesmo relatorio — sem chamar modelo nenhum:
// a regra em uso (o status ja fundido, que e o que o relatorio tem) e a
// regra alternativa (o argmax da distribuicao bruta do JEV, que e o que o
// JEV realmente respondeu).
//
// A comparacao e justa porque as duas leem a MESMA resposta do mesmo modelo.
// A diferenca entre elas e inteiramente da regra de fusao.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const reportPath = resolve(here, '..', 'docs', 'jev-eval-report.json')
const report = JSON.parse(readFileSync(reportPath, 'utf8'))

const cases = report.candidate?.cases ?? []
if (!cases.length) {
  console.error('o relatorio nao tem casos do candidato: rode a medicao antes')
  process.exit(1)
}

/**
 * O status que o JEV resolved, sem fusao.
 *
 * Nao e o argmax cru: `resolve_status` (em `calibrated/readiness.rs`) tem um
 * portao de 0,55 sobre a confianca E sobre a massa da opcao escolhida. Abaixo
 * do portao, o rotulo honesto e `ambiguous` — o modelo esta em duvida, e
 * `ambiguous` diz isso.
 *
 * Simular isso (e nao o argmax) e o que torna a comparacao justa: e a regra
 * que o produto usaria se o JEV decidisse o status.
 */
const READINESS_MIN_CONFIDENCE = 0.55

/**
 * O JEV esta em duvida?
 *
 * E o mesmo teste de `resolve_status`: confidence baixa **ou** massa baixa
 * na opcao escolhida. A distincao importa, porque `ambiguous` como rotulo
 * escolhido pelo JEV e `ambiguous` como portao de duvida sao coisas
 * diferentes — o primeiro e um veredito, o segundo e "nao sei".
 */
function jevIsDegraded(caseEntry) {
  const distribution = caseEntry.prediction?.distribution ?? {}
  const confidence = caseEntry.prediction?.confidence ?? 0
  const chosen = Math.max(0, ...Object.values(distribution))
  return confidence < READINESS_MIN_CONFIDENCE || chosen < READINESS_MIN_CONFIDENCE
}

function jevStatus(caseEntry) {
  const distribution = caseEntry.prediction?.distribution ?? {}
  const confidence = caseEntry.prediction?.confidence ?? 0
  let best = null
  for (const [label, probability] of Object.entries(distribution)) {
    if (best === null || probability > best.probability) {
      best = { label, probability }
    }
  }
  if (!best) return null
  const chosen = distribution[best.label] ?? 0
  if (confidence < READINESS_MIN_CONFIDENCE || chosen < READINESS_MIN_CONFIDENCE) {
    return 'ambiguous'
  }
  return best.label
}

/**
 * O ECE: a media da diferenca entre a confianca declarada e a acuracia
 * observada, pesada pelo tamanho da faixa.
 *
 * E a mesma conta de `eval/metrics.rs`. Fica aqui em JS para nao exigir
 * compilar o Rust so para comparar duas fusoes.
 */
function ece(entries) {
  if (!entries.length) return null
  const bins = new Map()
  for (const entry of entries) {
    const confidence = entry.confidence ?? 0
    const bucket = Math.min(0.99, Math.floor(confidence * 10) / 10)
    const bin = bins.get(bucket) ?? { count: 0, correct: 0, confidence: 0 }
    bin.count += 1
    bin.correct += entry.correct ? 1 : 0
    bin.confidence += confidence
    bins.set(bucket, bin)
  }
  let total = 0
  for (const bin of bins.values()) {
    const accuracy = bin.correct / bin.count
    const meanConfidence = bin.confidence / bin.count
    total += (bin.count / entries.length) * Math.abs(accuracy - meanConfidence)
  }
  return total
}

function evaluate(rule) {
  const entries = cases.map((entry) => {
    const predicted = rule(entry)
    return {
      id: entry.id,
      expected: entry.expected,
      predicted,
      confidence: entry.prediction?.confidence ?? 0,
      correct: predicted === entry.expected,
    }
  })
  const wrong = entries.filter((entry) => !entry.correct)
  return {
    entries,
    accuracy: entries.filter((entry) => entry.correct).length / entries.length,
    correct: entries.filter((entry) => entry.correct).length,
    total: entries.length,
    ece: ece(entries),
    wrong,
  }
}

const merged = evaluate((entry) => entry.prediction?.label)
const raw = evaluate((entry) => jevStatus(entry))
const gated = evaluate((entry) => {
  // O legado so vetaria quando o JEV esta **em duvida**. Quando o JEV tem
  // veredito (e nao esta no portao de 0,55), ele decide.
  return jevIsDegraded(entry) ? entry.prediction?.label : jevStatus(entry)
})

const fmt = (value) => (value === null || value === undefined ? '—' : Number(value).toFixed(3))
const pct = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`)

console.log(`casos: ${merged.total}`)
console.log('')
console.log('| regra de fusao | acertos | acuracia | ECE |')
console.log('| --- | ---: | ---: | ---: |')
console.log(`| em uso (status fundido) | ${merged.correct}/${merged.total} | ${pct(merged.accuracy)} | ${fmt(merged.ece)} |`)
console.log(`| JEV decide sempre | ${raw.correct}/${raw.total} | ${pct(raw.accuracy)} | ${fmt(raw.ece)} |`)
console.log(
  `| JEV decide, legado no veto | ${gated.correct}/${gated.total} | ${pct(gated.accuracy)} | ${fmt(gated.ece)} |`,
)
console.log('')

const fixed = raw.wrong.filter((entry) => !merged.wrong.some((wrong) => wrong.id === entry.id))
const broken = merged.wrong.filter((entry) => !raw.wrong.some((wrong) => wrong.id === entry.id))

console.log('A regra alternativa acerta o que a atual erra:')
for (const entry of fixed) {
  const was = merged.entries.find((candidate) => candidate.id === entry.id)
  console.log(
    `  ${entry.id}: fundido=${was.predicted} -> argmax=${entry.predicted} (esperado ${entry.expected}, conf ${entry.confidence})`,
  )
}
console.log('')
if (broken.length) {
  console.log('A regra alternativa erra o que a atual acerta:')
  for (const entry of broken) {
    const was = merged.entries.find((candidate) => candidate.id === entry.id)
    console.log(
      `  ${entry.id}: fundido=${was.predicted} -> argmax=${entry.predicted} (esperado ${entry.expected}, conf ${entry.confidence})`,
    )
  }
  console.log('')
}

const disagreement = merged.entries.filter((entry) => {
  const alternative = raw.entries.find((candidate) => candidate.id === entry.id)
  return alternative.predicted !== entry.predicted
})
console.log(`casos onde as duas regras discordam: ${disagreement.length} de ${merged.total}`)
for (const entry of disagreement) {
  const alternative = raw.entries.find((candidate) => candidate.id === entry.id)
  console.log(
    `  ${entry.id}: fundido=${entry.predicted} | argmax=${alternative.predicted} | esperado=${entry.expected} | conf=${entry.confidence}`,
  )
}
