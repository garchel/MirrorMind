#!/usr/bin/env node
/**
 * Prepara a auditoria dos termos que o motor aceitou sem casar com o gabarito.
 *
 * O relatorio guarda so `caso: termo`. Para decidir se um extra e sinonimo,
 * extra legitimo (o gabarito esta incompleto) ou erro, e preciso ver a nota e
 * a lista do revisor. Este script junta os dois, por caso, para leitura humana.
 *
 * Uso:
 *   node scripts/audit-extras.mjs [report.json] [golden.json]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const reportPath = resolve(process.argv[2] ?? 'docs/jev-eval-report.json')
const goldenPath = resolve(
  process.argv[3] ?? 'src-tauri/tests/fixtures/jev-golden/golden.json',
)
const notesDir = join(dirname(goldenPath), 'cases')

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const byId = new Map(golden.cases.map((entry) => [entry.id, entry]))

const extras = report.definitionRecall?.acceptedUnmatchedTerms ?? []
if (extras.length === 0) {
  console.log('_Nenhum termo aceito fora do gabarito nesta rodada._')
  process.exit(0)
}

/** Agrupa "caso: termo" por caso, preservando a ordem do relatorio. */
const byCase = new Map()
for (const line of extras) {
  const at = line.indexOf(': ')
  if (at < 0) continue
  const caseId = line.slice(0, at)
  const term = line.slice(at + 2)
  if (!byCase.has(caseId)) byCase.set(caseId, [])
  byCase.get(caseId).push(term)
}

const lines = [
  '# Auditar os extras: o que o motor aceitou fora do gabarito',
  '',
  `Fonte: \`${reportPath}\`. Rodada \`${report.runId}\`.`,
  '',
  `Termos aceitos fora do gabarito: **${extras.length}** em ${byCase.size} casos.`,
  '',
]

for (const [caseId, terms] of byCase) {
  const entry = byId.get(caseId)
  lines.push(`## ${caseId}`, '')
  if (!entry) {
    lines.push(`_Caso ausente do golden set: ${caseId}_`, '')
    continue
  }
  const expected = (entry.expectedDefinitions ?? []).map((item) => item.term)
  lines.push(
    `**Extras:** ${terms.map((term) => `\`${term}\``).join(', ')}`,
    '',
    `**Gabarito:** ${expected.length ? expected.map((term) => `\`${term}\``).join(', ') : '_o revisor nao esperava nenhum termo_'} (${entry.expectedDefinitionsProvenance ?? 'sem proveniencia'})`,
    '',
  )
  const note = readFileSync(join(notesDir, entry.note), 'utf8').trim()
  lines.push('```markdown', note, '```', '')
}

console.log(lines.join('\n'))
