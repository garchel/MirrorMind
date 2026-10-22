// Estima se recalibrar a confianca fecharia o gate do ECE.
//
//   node scripts/recalibration-check.mjs [relatorio.json] [saida.md]
//
// O experimento e **offline**: usa os casos ja gravados em
// `docs/jev-eval-report.json`. Nao ha chamada de modelo e nao ha dado novo.
// Por isso ele **estima**, nao valida: com 23 casos, cada metodo carrega
// incerteza grande, e o numero aqui e um indicio para decidir se vale
// investir, nao a prova de que o gate passaria em producao.
//
// Dois metodos, ambos com validacao leave-one-out (LOO):
//
// - **temperatura**: divide os logits por T, um parametro so. Preserva a
//   ordem das classes (logo, nao muda o rotulo) e corrige o exagero/recuo da
//   confianca. E o metodo conservador.
// - **isotonica**: ajusta uma funcao monotonica confianca -> acerto. Tem mais
//   liberdade e, com 23 pontos, mais chance de decorar. Serve de teto.
//
// LOO significa: para cada caso, ajusta no resto e avalia no caso que ficou
// de fora. Sem isso, o ajuste seria medido no mesmo dado em que foi feito —
// e todo metodo pareceria bom.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const inputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(here, '..', 'docs', 'jev-eval-report.json')
const outputPath = process.argv[3] ? resolve(process.argv[3]) : null

const report = JSON.parse(readFileSync(inputPath, 'utf8'))
const rawCases = report.candidate?.cases ?? []

const EPS = 1e-9
const BIN_COUNT = 10

const cases = rawCases
  .filter((entry) => entry.prediction && entry.prediction.confidence != null)
  .map((entry) => {
    const prediction = entry.prediction
    const distribution = prediction.distribution ?? {}
    const labels = Object.keys(distribution)
    const total = labels.reduce((sum, label) => sum + Number(distribution[label] ?? 0), 0)
    const probabilities = {}
    for (const label of labels) {
      probabilities[label] = total > 0 ? Number(distribution[label]) / total : 1 / labels.length
    }
    return {
      id: entry.id,
      expected: entry.expected,
      correct: prediction.label === entry.expected,
      confidence: Number(prediction.confidence),
      probabilities,
      labels,
    }
  })

const ece = (points) => {
  if (!points.length) return null
  const counts = new Array(BIN_COUNT).fill(0)
  const correct = new Array(BIN_COUNT).fill(0)
  const confidence = new Array(BIN_COUNT).fill(0)
  for (const point of points) {
    const index = Math.min(Math.floor(point.confidence * BIN_COUNT), BIN_COUNT - 1)
    counts[index] += 1
    confidence[index] += point.confidence
    if (point.correct) correct[index] += 1
  }
  let error = 0
  for (let index = 0; index < BIN_COUNT; index += 1) {
    if (!counts[index]) continue
    const accuracy = correct[index] / counts[index]
    const mean = confidence[index] / counts[index]
    error += (counts[index] / points.length) * Math.abs(accuracy - mean)
  }
  return error
}

// ---------------------------------------------------------------- temperatura

const softmax = (logits) => {
  const max = Math.max(...logits)
  const weights = logits.map((value) => Math.exp(value - max))
  const sum = weights.reduce((total, value) => total + value, 0)
  return weights.map((value) => value / sum)
}

const nll = (train, temperature) => {
  let total = 0
  for (const point of train) {
    const labels = point.labels.length ? point.labels : [point.expected]
    const logits = labels.map((label) => Math.log(Math.max(point.probabilities[label] ?? 0, EPS)))
    const scaled = softmax(logits.map((value) => value / temperature))
    const index = Math.max(labels.indexOf(point.expected), 0)
    total -= Math.log(Math.max(scaled[index], EPS))
  }
  return total
}

const fitTemperature = (train) => {
  let best = 1
  let bestLoss = Infinity
  for (let temperature = 0.1; temperature <= 5.0001; temperature += 0.01) {
    const loss = nll(train, temperature)
    if (loss < bestLoss) {
      bestLoss = loss
      best = temperature
    }
  }
  return best
}

const calibratedPoint = (point, temperature) => {
  const labels = point.labels.length ? point.labels : [point.expected]
  const logits = labels.map((label) => Math.log(Math.max(point.probabilities[label] ?? 0, EPS)))
  const scaled = softmax(logits.map((value) => value / temperature))
  const index = scaled.indexOf(Math.max(...scaled))
  return {
    confidence: scaled[index],
    correct: labels[index] === point.expected,
  }
}

// ------------------------------------------------------------------ isotonica

// Pool Adjacent Violators: ajusta o acerto medio monotonico na confianca.
const fitIsotonic = (train) => {
  const sorted = [...train].sort((a, b) => a.confidence - b.confidence)
  const blocks = sorted.map((point) => ({
    low: point.confidence,
    high: point.confidence,
    weight: 1,
    correct: point.correct ? 1 : 0,
  }))
  let index = 0
  while (index < blocks.length - 1) {
    const left = blocks[index]
    const right = blocks[index + 1]
    if (left.correct / left.weight <= right.correct / right.weight) {
      index += 1
      continue
    }
    blocks.splice(index, 2, {
      low: left.low,
      high: right.high,
      weight: left.weight + right.weight,
      correct: left.correct + right.correct,
    })
    if (index > 0) index -= 1
  }
  return blocks.map((block) => ({
    low: block.low,
    high: block.high,
    value: block.correct / block.weight,
  }))
}

const applyIsotonic = (blocks, confidence) => {
  for (const block of blocks) {
    if (confidence <= block.high) {
      if (confidence < block.low) return block.value
      return block.value
    }
  }
  return blocks.length ? blocks[blocks.length - 1].value : confidence
}

// ------------------------------------------------------------------ LOO

const loo = (predict) => {
  const points = []
  for (let held = 0; held < cases.length; held += 1) {
    const train = cases.filter((_, index) => index !== held)
    const model = predict.fit(train)
    points.push(predict.apply(model, cases[held]))
  }
  return points
}

const baseline = cases.map((point) => ({ confidence: point.confidence, correct: point.correct }))
const temperaturePoints = loo({
  fit: (train) => fitTemperature(train),
  apply: (temperature, point) => calibratedPoint(point, temperature),
})
const isotonicPoints = loo({
  fit: (train) => fitIsotonic(train),
  apply: (blocks, point) => ({
    confidence: Math.min(Math.max(applyIsotonic(blocks, point.confidence), 0), 1),
    correct: point.correct,
  }),
})

const num = (value) => (value == null ? '-' : value.toFixed(3))

const rows = [
  ['Nenhuma (baseline)', ece(baseline), baseline],
  ['Temperatura (LOO)', ece(temperaturePoints), temperaturePoints],
  ['Isotonica (LOO)', ece(isotonicPoints), isotonicPoints],
]

const thresholdRows = [0.0, 0.55, 0.7, 0.85].map((threshold) => {
  const answered = baseline.filter((point) => point.confidence >= threshold)
  const hits = answered.filter((point) => point.correct).length
  return [
    threshold.toFixed(2),
    `${answered.length} de ${baseline.length}`,
    answered.length ? `${((hits / answered.length) * 100).toFixed(1)}%` : '-',
  ]
})

const lines = [
  '# Recalibracao da confianca (estimativa offline)',
  '',
  `Fonte: \`${inputPath}\`. Casos: ${cases.length}.`,
  '',
  '> **Este numero estima, nao valida.** O ajuste e feito nos mesmos 23 casos,',
  '> com validacao leave-one-out. O intervalo de confianca e largo; o resultado',
  '> serve para decidir se vale investir em recalibracao, nao para afirmar que o',
  '> gate passaria em producao.',
  '',
  '| Metodo | ECE (LOO) |',
  '| --- | ---: |',
  ...rows.map(([name, error]) => `| ${name} | ${num(error)} |`),
  '',
  '## Ponto de operacao sem recalibrar (massa decide)',
  '',
  '| Limiar de massa | Respondidos | Acerto entre os respondidos |',
  '| ---: | ---: | ---: |',
  ...thresholdRows.map((row) => `| ${row.join(' | ')} |`),
  '',
]

const output = lines.join('\n')
if (outputPath) {
  writeFileSync(outputPath, output)
  console.log(`relatorio em ${outputPath}`)
} else {
  console.log(output)
}
