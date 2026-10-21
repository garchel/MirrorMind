// Converte a resposta de um revisor externo no formato interno.
//
//   node scripts/golden-review-import.mjs respostas.json
//
// O revisor externo responde no formato do pacote (com `evidenceFor` e
// `evidenceAgainst`). Aqui isso vira o `golden-review-answers.json`, que o
// `apply-golden-review.mjs` consome.
//
// ## O que este script guarda, e por que
//
// As **evidências** não são descartadas. A `evidenceAgainst` é o registro de
// que o revisor procurou a falha antes de responder — é o que distingue uma
// revisão de "parece bom" de uma revisão. E a `noteEvidence` do `gapIsReal` é
// a citação da NOTA que deixa a lacuna em aberto, que é a única prova de que
// a lacuna existe.
//
// Guardá-las permite auditar a revisão depois, e reverter um caso se a
// evidência não sustentar a resposta.
//
// ## Formatos aceitos
//
// O arquivo pode ser:
//   - um objeto com casos no nivel de cima: { "ciclo-calvin": {...} }
//   - um array de blocos: [ { "caseId": "...", "dimensions": {...} } ]
//   - JSON Lines: um objeto por linha
//
// E cada caso pode vir no formato do pacote (`dimensions` com `evidenceFor`)
// ou no formato simples (`core: "yes"`).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const answersPath = join(here, 'golden-review-answers.json')

const input = process.argv[2]
if (!input) {
  console.error('uso: node scripts/golden-review-import.mjs <respostas.json>')
  process.exit(1)
}
if (!existsSync(input)) {
  console.error(`nao encontrei ${input}`)
  process.exit(1)
}

const raw = readFileSync(input, 'utf8')

function parseJson(text, file) {
  const clean = text.replace(/^\uFEFF/, '').trim()
  try {
    return JSON.parse(clean)
  } catch (error) {
    console.error(`nao consegui ler ${file} como JSON: ${error.message}`)
    console.error('Se o arquivo foi salvo com BOM, salve como UTF-8 sem BOM.')
    process.exit(1)
  }
}

function parsePayload(text) {
  const trimmed = text.trim()
  if (!trimmed) return []
  // JSON Lines
  if (trimmed.includes('\n') && !trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }
  const parsed = JSON.parse(trimmed)
  if (Array.isArray(parsed)) return parsed
  return Object.entries(parsed).map(([caseId, value]) => ({ caseId, ...value }))
}

const DIMENSIONS = ['core', 'connections', 'application', 'gaps']
const ANSWERS = { yes: 'yes', partial: 'partial', no: 'no' }

const cases = parsePayload(raw)
const imported = []
const problems = []

for (const entry of cases) {
  const caseId = entry.caseId ?? entry.id
  if (!caseId) {
    problems.push('um bloco sem `caseId`')
    continue
  }

  const answer = {}
  const evidence = {}

  // Formato do pacote: `dimensions: { core: { answer, evidenceFor, evidenceAgainst } }`
  if (entry.dimensions) {
    for (const dimension of DIMENSIONS) {
      const value = entry.dimensions[dimension]
      if (!value) {
        problems.push(`${caseId}: faltou a dimensão ${dimension}`)
        continue
      }
      const answerText = String(value.answer ?? '').trim().toLowerCase()
      if (answerText === 'y' || answerText === 'yes') answer[dimension] = 'yes'
      else if (answerText === 'p' || answerText === 'partial') answer[dimension] = 'partial'
      else if (answerText === 'n' || answerText === 'no') answer[dimension] = 'no'
      else {
        problems.push(`${caseId}/${dimension}: resposta invalida "${value.answer}"`)
        continue
      }
      evidence[dimension] = {
        for: value.evidenceFor ?? '',
        against: value.evidenceAgainst ?? '',
      }
    }
  } else {
    // Formato simples
    for (const dimension of DIMENSIONS) {
      const value = String(entry[dimension] ?? '').trim().toLowerCase()
      if (value === 'y' || value === 'yes') answer[dimension] = 'yes'
      else if (value === 'p' || value === 'partial') answer[dimension] = 'partial'
      else if (value === 'n' || value === 'no') answer[dimension] = 'no'
    }
  }

  if (DIMENSIONS.some((dimension) => !answer[dimension])) {
    problems.push(`${caseId}: review incompleto, descartado`)
    continue
  }

  const gap = entry.gapIsReal
  const gapValue =
    typeof gap === 'object' && gap !== null ? gap.answer : gap
  const gapText = String(gapValue ?? '').trim().toLowerCase()
  if (gapText === 'true' || gapText === 's' || gapText === 'yes') {
    answer.gapIsReal = true
  } else if (gapText === 'false' || gapText === 'n' || gapText === 'no') {
    answer.gapIsReal = false
  } else {
    problems.push(`${caseId}: gapIsReal invalido "${gapValue}"`)
    continue
  }

  answer.unsupportedClaims = Array.isArray(entry.unsupportedClaims)
    ? entry.unsupportedClaims.join('; ')
    : entry.unsupportedClaims ?? ''
  answer.notes = entry.notes ?? ''
  answer.evidence = evidence
  if (typeof gap === 'object' && gap !== null) {
    answer.gapNoteEvidence = gap.noteEvidence ?? ''
  }
  imported.push([caseId, answer])
}

const existing = existsSync(answersPath)
  ? JSON.parse(readFileSync(answersPath, 'utf8'))
  : {}

const merged = { ...existing }
for (const [caseId, answer] of imported) merged[caseId] = answer
writeFileSync(answersPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')

console.log(`importados: ${imported.length}`)
if (problems.length) {
  console.log('\ndescartados:')
  for (const problem of problems) console.log(`  - ${problem}`)
}
console.log('\nrode `node scripts/apply-golden-review.mjs` para aplicar ao golden set.')
