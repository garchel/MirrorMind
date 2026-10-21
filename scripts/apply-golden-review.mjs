// Aplica a revisão humana ao golden set.
//
//   node scripts/apply-golden-review.mjs
//
// Lê `scripts/golden-review-answers.json` e grava, em cada caso revisado, as
// bandas esperadas por dimensão. A partir daí a medição deixa de ser
// "os dois motores concordam?" e passa a ser "cada motor acerta?", que é a
// pergunta que o §11 realmente faz.
//
// ## O que muda no golden set
//
// Cada caso revisado ganha um bloco `expectedBands`:
//
//   "expectedBands": { "core": "good", "connections": "good",
//                      "application": "partial", "gaps": "partial" }
//
// E a `provenance` do caso passa de `construction` para `human` — que é o que
// a suite de integridade verifica, e o que separa "construcao" de "alguem
// revisou" no resto do sistema.
//
// ## A banda esperada vem da resposta
//
//   yes    -> a dimensao esta plenamente presente  -> banda "complete"
//   partial-> esta parcialmente presente            -> banda "partial"
//   no     -> nao esta presente                     -> banda "forgotten"
//
// O mapeamento e o mesmo de `outcome_for_score`: 0-39 forgotten, 40-69 partial,
// 70-89 good, 90+ complete. `yes` vira "complete" porque o revisor disse que
// a dimensao esta demonstrada por inteiro.
//
// ## Casos não revisados
//
// Ficam como estão: sem `expectedBands`, com `provenance: construction`. A
// medição passa a reportar **quantos casos foram revisados** e a medir
// acurácia só sobre eles — em vez de fingir que os 21 pontos são ground truth.

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
const answersPath = join(here, 'golden-review-answers.json')

if (!existsSync(answersPath)) {
  console.error('faltam scripts/golden-review-answers.json')
  process.exit(1)
}

const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const answers = JSON.parse(readFileSync(answersPath, 'utf8'))

const BANDS = { yes: 'complete', partial: 'partial', no: 'forgotten' }
const DIMENSIONS = ['core', 'connections', 'application', 'gaps']

let applied = 0
let skipped = 0
const problems = []

for (const entry of golden.cases) {
  const answer = answers[entry.id]
  if (!answer || typeof answer !== 'object' || answer._como_usar) continue

  const missing = DIMENSIONS.filter(
    (dimension) => !BANDS[answer[dimension]],
  )
  if (missing.length > 0) {
    skipped += 1
    problems.push(
      `${entry.id}: faltou ${missing.join(', ')} (use yes | partial | no)`,
    )
    continue
  }
  // `gapIsReal: false` e uma resposta VALIDA: significa que a sintese admite
  // uma lacuna que a nota nao tem. Nao e um caso pulado — e um caso que
  // precisa de correcao, e o registro disso e o que diz qual.
  if (typeof answer.gapIsReal !== 'boolean') {
    skipped += 1
    problems.push(
      `${entry.id}: gapIsReal precisa ser true ou false (a lacuna admitida e real?)`,
    )
    continue
  }
  if (!answer.gapIsReal) {
    // A lacuna admitida nao existe na nota: a parte de `gaps` da sintese e
    // inventada. Registrado, porque e o que aponta a correcao.
    entry.gapIsNotReal = true
  }

  entry.expectedBands = Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, BANDS[answer[dimension]]]),
  )
  // A proveniencia da **sintese** e a do **rotulo de prontidao** sao coisas
  // diferentes. Revisar a sintese nao torna o rotulo de prontidao humano — e
  // mexer nisso seria dizer que alguem revisou o que ninguem revisou.
  entry.synthesisProvenance = 'human'
  if (answer.unsupportedClaims) {
    entry.unsupportedClaims = answer.unsupportedClaims
  }
  applied += 1
}

writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')

const reviewed = golden.cases.filter((entry) => entry.expectedBands).length
console.log(`aplicados: ${applied} | pulados: ${skipped}`)
console.log(`casos com banda esperada: ${reviewed} de ${golden.cases.length}`)
for (const problem of problems) console.log(`  - ${problem}`)
if (reviewed === 0) {
  console.log('\nnenhuma revisao aplicada ainda: a medicao continua sem ground truth humano.')
}
