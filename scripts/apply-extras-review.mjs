#!/usr/bin/env node
/**
 * Aplica a revisao humana dos extras ao golden set.
 *
 * So `legitimo` muda o gabarito: o termo entra em `expectedDefinitions` do
 * caso, com a linha da nota onde ele aparece como `sourceQuote`. `assunto` e
 * `erro` deixam o gabarito como esta (o termo continua sendo extra); `variante`
 * nao muda nada porque quem resolve variacao de nome e a metrica.
 *
 * A linha e extraida da propria nota, nao digitada: uma citacao que o revisor
 * escreveu a mao pode nao existir no texto, e o harness usa a citacao para
 * ancorar a definicao.
 *
 * Uso:
 *   node scripts/apply-extras-review.mjs <review.json> [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const reviewPath = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
if (!reviewPath) {
  console.error('uso: node scripts/apply-extras-review.mjs <review.json> [--dry-run]')
  process.exit(1)
}

const goldenPath = resolve('src-tauri/tests/fixtures/jev-golden/golden.json')
const notesDir = join(dirname(goldenPath), 'cases')

const review = JSON.parse(readFileSync(resolve(reviewPath), 'utf8'))
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const byId = new Map(golden.cases.map((entry) => [entry.id, entry]))

/** Minusculas sem acento, para casar termo e linha sem depender de digitacao. */
function fold(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A primeira linha da nota que contem o termo, ou `null`. */
function quoteFor(note, term) {
  const needle = fold(term)
  for (const line of note.split('\n')) {
    if (fold(line).includes(needle)) return line.trim()
  }
  return null
}

const additions = []
const skipped = []
const missing = []

for (const decision of review.decisions ?? []) {
  if (decision.verdict !== 'legitimo') continue
  const entry = byId.get(decision.caseId)
  if (!entry) {
    missing.push(`${decision.caseId}: caso ausente do golden set`)
    continue
  }
  const note = readFileSync(join(notesDir, entry.note), 'utf8')
  const quote = quoteFor(note, decision.term)
  if (!quote) {
    missing.push(`${decision.caseId}: "${decision.term}" nao aparece na nota`)
    continue
  }
  const already = (entry.expectedDefinitions ?? []).some(
    (item) => fold(item.term) === fold(decision.term),
  )
  if (already) {
    skipped.push(`${decision.caseId}: "${decision.term}" ja estava no gabarito`)
    continue
  }
  additions.push({ caseId: decision.caseId, term: decision.term, quote })
  entry.expectedDefinitions = [
    ...(entry.expectedDefinitions ?? []),
    { term: decision.term, sourceQuote: quote },
  ]
  // A revisao e humana; se o caso ainda nao tinha proveniencia declarada, ela
  // passa a ter.
  entry.expectedDefinitionsProvenance = entry.expectedDefinitionsProvenance ?? 'human'
}

for (const addition of additions) {
  console.log(`+ ${addition.caseId} :: ${addition.term}`)
  console.log(`  "${addition.quote}"`)
}
for (const line of skipped) console.log(`= ${line}`)
for (const line of missing) console.log(`! ${line}`)

if (missing.length > 0) {
  console.error('nada foi gravado: ha termos sem citacao na nota')
  process.exit(1)
}
if (dryRun) {
  console.log(`\ndry-run: ${additions.length} termo(s) entrariam, nada gravado`)
  process.exit(0)
}
if (additions.length === 0) {
  console.log('\nnada a mudar')
  process.exit(0)
}

writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')
const total = golden.cases.reduce((sum, entry) => sum + (entry.expectedDefinitions ?? []).length, 0)
console.log(`\n${additions.length} termo(s) aplicados; o gabarito tem ${total} termos`)
