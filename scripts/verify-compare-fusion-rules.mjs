// Verifica o simulador de fusao contra um relatorio sintetico com gabarito.
//
//   node scripts/verify-compare-fusion-rules.mjs
//
// O script de comparacao simula tres regras de fusao sobre a distribuicao do
// JEV. Uma simulacao errada numa decisao de produto e pior que nenhuma, entao
// este teste monta um relatorio com as respostas conhecidas e confere os
// numeros que o simulador produz.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Cada caso: `expected` e o rotulo certo; `distribution` e o que o JEV
// respondeu; `confidence` e a confianca declarada.
//
// - `a`: o JEV diz `ready` com 90% -> o fundido e `ready` (o legado concorda).
// - `b`: o JEV diz `ambiguous` com 70% da massa, mas o fundido mostra
//   `ready` porque o legado nao achou issue. O veredito do JEV esta
//   **correto** e foi descartado.
// - `c`: o JEV diz `insufficient` com 100% -> o fundido mostra `ready`, pelo
//   mesmo motivo.
//
// O status fundido e `ready` nos tres casos: e o que `adopt_status` produz
// quando o legado nao propoe issue — que e o caso mais comum.
const report = {
  candidate: {
    cases: [
      {
        id: 'a',
        expected: 'ready',
        prediction: {
          label: 'ready',
          confidence: 0.9,
          distribution: { ready: 0.9, ambiguous: 0.1 },
        },
      },
      {
        id: 'b',
        expected: 'ambiguous',
        prediction: {
          label: 'ready',
          confidence: 0.7,
          distribution: { ambiguous: 0.7, ready: 0.3 },
        },
      },
      {
        id: 'c',
        expected: 'insufficient',
        prediction: {
          label: 'ready',
          confidence: 1.0,
          distribution: { insufficient: 1.0, ready: 0.0 },
        },
      },
    ],
  },
}

const dir = mkdtempSync(join(tmpdir(), 'fusion-verify-'))
const reportPath = join(dir, 'report.json')
writeFileSync(reportPath, JSON.stringify(report), 'utf8')

// Roda o script de comparacao contra o relatorio sintetico.
const source = (await import('node:fs')).readFileSync(
  resolve(here, 'compare-fusion-rules.mjs'),
  'utf8',
)
const patched = source.replace(
  /const reportPath = resolve\(here, '\.\.', 'docs', 'jev-eval-report\.json'\)/,
  `const reportPath = ${JSON.stringify(reportPath)}`,
)
const patchedPath = join(dir, 'compare.mjs')
writeFileSync(patchedPath, patched, 'utf8')

const output = execFileSync(process.execPath, [patchedPath], { encoding: 'utf8' })
rmSync(dir, { recursive: true, force: true })

function numberFrom(label) {
  const line = output.split('\n').find((entry) => entry.includes(label))
  if (!line) throw new Error(`a linha "${label}" nao saiu:\n${output}`)
  const match = line.match(/\| (\d+)\/(\d+) \|/)
  if (!match) throw new Error(`a linha "${label}" nao tem a contagem:\n${line}`)
  return { correct: Number(match[1]), total: Number(match[2]) }
}

const merged = numberFrom('em uso (status fundido)')
const always = numberFrom('JEV decide sempre')
const gated = numberFrom('JEV decide, legado no veto')

const checks = [
  {
    what: 'a regra em uso acerta so `a` (o legado mandou em b e c)',
    got: merged.correct,
    expected: 1,
  },
  {
    what: 'o JEV decide sempre acerta os tres',
    got: always.correct,
    expected: 3,
  },
  {
    what: 'o JEV decide com o veto do legado acerta os tres (o JEV tem veredito em b e c)',
    got: gated.correct,
    expected: 3,
  },
  {
    what: 'o total de casos e 3 nas tres regras',
    got: merged.total + always.total + gated.total,
    expected: 9,
  },
]

let failed = false
for (const check of checks) {
  const ok = check.got === check.expected
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${check.what}: ${check.got} (esperado ${check.expected})`)
}

if (failed) {
  console.error('\no simulador de fusao nao bate com o gabarito:\n')
  console.error(output)
  process.exit(1)
}
console.log('\no simulador de fusao bate com o gabarito.')
