#!/usr/bin/env node
/**
 * Aplica a revisao humana dos termos ausentes ao golden set.
 *
 * So `nao_precisa` muda o gabarito: o termo sai de `expectedDefinitions`,
 * porque o revisor julgou que a nota nao precisava defini-lo. `precisa` deixa
 * como esta (o motor errou) e `variante` tambem (quem resolve variacao de nome
 * e a metrica, nao o gabarito).
 *
 * O script recusa aplicar quando um termo do JSON nao existe no caso: isso
 * significa que o gabarito mudou depois da revisao, e aplicar em cima de um
 * conjunto diferente seria adivinhar.
 *
 * Uso:
 *   node scripts/apply-missed-review.mjs <review.json> [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const reviewPath = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
if (!reviewPath) {
  console.error('uso: node scripts/apply-missed-review.mjs <review.json> [--dry-run]')
  process.exit(1)
}

const goldenPath = resolve('src-tauri/tests/fixtures/jev-golden/golden.json')
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const byId = new Map(golden.cases.map((entry) => [entry.id, entry]))

function fold(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const removed = []
const missing = []

for (const decision of JSON.parse(readFileSync(resolve(reviewPath), 'utf8')).decisions ?? []) {
  if (decision.verdict !== 'nao_precisa') continue
  const entry = byId.get(decision.caseId)
  if (!entry) {
    missing.push(`${decision.caseId}: caso ausente do golden set`)
    continue
  }
  const terms = entry.expectedDefinitions ?? []
  const index = terms.findIndex((item) => fold(item.term) === fold(decision.term))
  if (index < 0) {
    missing.push(`${decision.caseId}: "${decision.term}" nao esta no gabarito`)
    continue
  }
  removed.push({ caseId: decision.caseId, term: terms[index].term })
  entry.expectedDefinitions = terms.filter((_, position) => position !== index)
}

for (const item of removed) console.log(`- ${item.caseId} :: ${item.term}`)
for (const line of missing) console.log(`! ${line}`)

if (missing.length > 0) {
  console.error('nada foi gravado: ha termos que nao existem mais no gabarito')
  process.exit(1)
}
if (dryRun) {
  console.log(`\ndry-run: ${removed.length} termo(s) sairiam, nada gravado`)
  process.exit(0)
}
if (removed.length === 0) {
  console.log('\nnada a mudar')
  process.exit(0)
}

writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')
const total = golden.cases.reduce((sum, entry) => sum + (entry.expectedDefinitions ?? []).length, 0)
console.log(`\n${removed.length} termo(s) removidos; o gabarito tem ${total} termos`)
