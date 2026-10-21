// Importa a revisao do ground truth de "melhorar a nota".
//
//   node scripts/golden-improvement-import.mjs respostas.json
//
// ## O que e gravado
//
// Cada caso revisado ganha `expectedDefinitions`: a lista de termos que, se
// definidos, melhorariam a nota.
//
// A proveniencia e separada da de prontidao, que e de **outra** pergunta:
// `readiness.provenance` continua `human` (ou `construction`) conforme a
// revisao de prontidao, e `expectedDefinitionsProvenance` registra a
// revisao **desta** feature.
//
// ## Por que a lista pode estar incompleta
//
// Um revisor pode deixar passar um termo. Por isso a lista nao e usada para
// calcular **precisao** — seria injusto. O que ela mede e **recall**: das
// definicoes que o revisor disse que melhorariam a nota, quantas o pipeline
// encontrou? Essa pergunta tem resposta certa com lista incompleta.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const goldenPath = join(
  root,
  'src-tauri',
  'tests',
  'fixtures',
  'jev-golden',
  'golden.json',
)

const input = process.argv[2]
if (!input || !existsSync(input)) {
  console.error('uso: node scripts/golden-improvement-import.mjs <respostas.json>')
  process.exit(1)
}

const raw = readFileSync(input, 'utf8').replace(/^\uFEFF/, '').trim()
let parsed
try {
  parsed = JSON.parse(raw)
} catch (error) {
  console.error(`nao consegui ler ${input} como JSON: ${error.message}`)
  console.error('Se o arquivo foi salvo com BOM, salve como UTF-8 sem BOM.')
  process.exit(1)
}

const entries = Array.isArray(parsed)
  ? parsed
  : Object.entries(parsed).map(([caseId, value]) => ({ caseId, ...value }))

const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

let applied = 0
const problems = []

for (const entry of entries) {
  const caseId = entry.caseId ?? entry.id
  if (!caseId) {
    problems.push('um bloco sem `caseId`')
    continue
  }
  const target = golden.cases.find((item) => item.id === caseId)
  if (!target) {
    problems.push(`${caseId}: caso inexistente no golden set`)
    continue
  }
  const terms = entry.terms ?? []
  if (!Array.isArray(terms)) {
    problems.push(`${caseId}: "terms" precisa ser uma lista`)
    continue
  }
  const cleaned = []
  for (const term of terms) {
    const value = typeof term === 'string' ? term : term?.term
    const quote = typeof term === 'string' ? undefined : term?.sourceQuote
    if (typeof value !== 'string' || !value.trim()) {
      problems.push(`${caseId}: um termo sem texto`)
      continue
    }
    cleaned.push({
      term: value.trim(),
      ...(quote ? { sourceQuote: quote.trim() } : {}),
    })
  }
  target.expectedDefinitions = cleaned
  target.expectedDefinitionsProvenance = 'human'
  applied += 1
}

writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')

const comGroundTruth = golden.cases.filter((entry) => entry.expectedDefinitions).length
console.log(`aplicados: ${applied} | casos com ground truth: ${comGroundTruth} de ${golden.cases.length}`)
for (const problem of problems) console.log(`  - ${problem}`)
console.log('\nrode a medicao de recall com o harness.')
