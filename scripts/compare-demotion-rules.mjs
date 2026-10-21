// Compara as regras de rebaixamento sobre o relatorio real.
//
//   node scripts/compare-demotion-rules.mjs
//
// ## Por que isto existe
//
// O rebaixamento de "ready" para "ambiguous" tem um efeito **util**: a nota
// nao entra na revisao. O rebaixamento de "insufficient" para "ambiguous"
// **nao tem efeito nenhum** — os dois status pausam a nota do mesmo jeito.
// Trocar um pelo outro so distorce a metrica.
//
// A medicao diz se vale a pena.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const report = JSON.parse(
  readFileSync(resolve(here, '..', 'docs', 'jev-eval-report.json'), 'utf8'),
)

const MIN = 0.55

/** O ECE: media ponderada da diferenca entre a confianca e a acuracia, por faixa. */
function ece(entries) {
  if (!entries.length) return null
  const bins = new Map()
  for (const entry of entries) {
    const bucket = Math.min(0.99, Math.floor(entry.confidence * 10) / 10)
    const bin = bins.get(bucket) ?? { count: 0, correct: 0, confidence: 0 }
    bin.count += 1
    bin.correct += entry.correct ? 1 : 0
    bin.confidence += entry.confidence
    bins.set(bucket, bin)
  }
  let total = 0
  for (const bin of bins.values()) {
    total +=
      (bin.count / entries.length) * Math.abs(bin.correct / bin.count - bin.confidence / bin.count)
  }
  return total
}

/**
 * Simula uma regra de rebaixamento.
 *
 * `onlyReady` rebaixa para "ambiguous" apenas quando o motor disse "ready" —
 * que e a unica afirmacao com efeito pratico (enrola a nota na revisao).
 */
function simulate(onlyReady) {
  const entries = []
  for (const caseEntry of report.candidate.cases) {
    const distribution = Object.entries(caseEntry.prediction.distribution ?? {})
    if (!distribution.length) continue
    const top = distribution.sort((left, right) => right[1] - left[1])[0]
    const mass = top[1]
    let predicted = top[0]
    if (mass < MIN) {
      predicted = onlyReady && top[0] !== 'ready' ? top[0] : 'ambiguous'
    }
    entries.push({ confidence: mass, correct: predicted === caseEntry.expected })
  }
  return {
    accuracy: `${entries.filter((entry) => entry.correct).length}/${entries.length}`,
    ece: ece(entries),
  }
}

const current = simulate(false)
const proposed = simulate(true)

console.log('regra atual (rebaixa qualquer status):')
console.log(`  acuracia ${current.accuracy} | ECE ${current.ece.toFixed(3)}`)
console.log('regua proposta (rebaixa so "ready"):')
console.log(`  acuracia ${proposed.accuracy} | ECE ${proposed.ece.toFixed(3)}`)
console.log('')
console.log('O efeito pratico do rebaixamento so importa para "ready": os outros')
console.log('dois status pausam a nota do mesmo jeito.')
