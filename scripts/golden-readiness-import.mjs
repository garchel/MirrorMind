// Importa a revisao dos ROTULOS DE PRONTIDAO.
//
//   node scripts/golden-readiness-import.mjs respostas.json
//
// ## O que ele grava
//
// Para cada caso revisado, o rotulo passa a `provenance: "human"` e recebe o
// `why` **do revisor** — que e a regra que ele aplicou, e nao a que eu
// escrevi. A regua original fica no `why` do golden set? Nao: o revisor
// reescreveu, e o `why` novo e o dele.
//
// O `synthesisProvenance` e o `expectedBands` da dimensao de sintese **nao** sao
// tocados: sao coisas diferentes, revisadas porReviews diferentes.
//
// ## Formatos aceitos
//
//   [ { "caseId": "...", "agreed": true, "label": "ready", ... } ]
//   { "ciclo-calvin": { "agreed": true, "label": "ready", ... } }
//
// `agreed: false` com um `label` diferente do proposta significa que o revisor
// **discordou** e reclassificou. A discordancia e registrada: e mais
// informativa que o rotulo concordante.

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
  console.error('uso: node scripts/golden-readiness-import.mjs <respostas.json>')
  process.exit(1)
}

// Um editor que salva com BOM estraga o JSON, e a mensagem de erro do Node
// para isso e inutil ("Unexpected token"). Tira a BOM e explica o problema.
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

const parsed = parseJson(readFileSync(input, 'utf8'), input)
const entries = Array.isArray(parsed)
  ? parsed
  : Object.entries(parsed).map(([caseId, value]) => ({ caseId, ...value }))

const LABELS = new Set(['ready', 'ambiguous', 'insufficient'])
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

let applied = 0
let disagreed = 0
const problems = []

// Limpa os artefatos de citacao que alguns revisores emitem.
//
// Um revisor que responde num formato de "nota com fonte" adiciona marcas
// como `[cite: 1]` ao texto. Elas nao tem significado aqui: o `why` vai
// para o golden set como justificativa do rotulo, e uma referencia a uma
// fonte que o conjunto nao guarda e ruido que ninguem pode conferir.
function stripCitations(text) {
  return String(text)
    .replace(/\s*\[cite:\s*\d+\]/gi, '')
    .replace(/\s*\[cite:\s*[^\]]*\]/gi, '')
    .trim()
}

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
  const label = String(entry.label ?? '').trim().toLowerCase()
  if (!LABELS.has(label)) {
    problems.push(`${caseId}: rotulo invalido "${entry.label}"`)
    continue
  }

  const agreed = entry.agreed === true || entry.agreed === 'true'
  // O que o conjunto **propunha**. A comparacao de discordancia e contra
  // isto, e nao contra o rotulo atual: reexecutar o importador sobre um
  // conjunto ja importado tem de ser inofensivo.
  const proposed = String(entry.proposed ?? target.readiness.label)
    .trim()
    .toLowerCase()
  if (!agreed && label === proposed) {
    problems.push(
      `${caseId}: "agreed" e false, mas o rotulo e o mesmo do proposto. ` +
        'Discordar com o mesmo rotulo nao faz sentido.',
    )
    continue
  }

  const why = stripCitations(String(entry.evidenceFor ?? '').trim()) ||
    stripCitations(entry.notes ?? '')
  // O rotulo ANTERIOR tem de ser lido **antes** de sobrescrever — senao o
  // registro de reclassificacao guarda o rotulo novo, e a discordancia some.
  //
  // `reclassifiedFrom` tem prioridade: ele guarda o rotulo **original** de
  // antes de qualquer revisao, e e ele que sobrevive a reexecucoes.
  const previousLabel = target.reclassifiedFrom ?? target.readiness.label
  target.readiness = {
    label,
    provenance: 'human',
    why: why
      ? `Revisado: ${why}`
      : `Revisado por humano/modelo independente; o rotulo anterior era "${previousLabel}".`,
  }
  if (!agreed) {
    target.reclassifiedFrom = target.reclassifiedFrom ?? previousLabel
    disagreed += 1
  }
  applied += 1
}

writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')

console.log(`aplicados: ${applied} | reclassificados: ${disagreed}`)
for (const problem of problems) console.log(`  - ${problem}`)
console.log('\nrode `node scripts/apply-golden-review.mjs` para recalcular as bandas.')
