// Gera o pacote de revisao do ground truth da feature "melhorar a nota".
//
//   node scripts/golden-improvement-review.mjs --file
//
// ## A pergunta e OUTRA
//
// O pacote de prontidao pergunta *"esta nota sustenta uma revisao?"*. Este
// pergunta *"que termo, definido, melhoraria esta nota?"*.
//
// Sao perguntas diferentes, e a medicao da feature so funciona com a segunda.
// Uma nota **sobre** o ciclo de Calvin nao precisa definir "rubisco" para
// sustentar uma revisao — mas ganha com essa definicao. Julgar a feature
// pelos rotulos de prontidao mede a coisa errada.
//
// ## O que o revisor responde
//
// A lista de termos que, se definidos, melhorariam a nota. Pode ser vazia.
//
// ## Por que o recall e a metrica principal
//
// A lista do revisor pode estar incompleta — um revisor pode deixar passar um
// termo. Isso tornaria a **precisao** injusta: uma proposta fora da lista
// seria contada como falso positivo mesmo que o revisor apenas nao a viu.
//
// O **recall** nao tem esse problema: das definições que o revisor disse que
// melhorariam a nota, quantas o pipeline encontrou? Essa pergunta tem
// resposta certa mesmo com lista incompleta.

import { readFileSync, writeFileSync } from 'node:fs'
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
const casesDir = join(root, 'src-tauri', 'tests', 'fixtures', 'jev-golden', 'cases')

const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

const lines = []
lines.push('# Revisão do ground truth de "melhorar a nota"')
lines.push('')
lines.push('Cada bloco é uma nota. A pergunta **não** é se a nota está pronta para')
lines.push('revisão — é **que termo, definido, melhoraria esta nota**.')
lines.push('')
lines.push('Responda com a lista dos termos que a nota usa como premissa **sem nunca')
lines.push('definir**, e que seriam uteis definir. Se a nota não tem nenhum, a')
lines.push('lista é vazia.')
lines.push('')
lines.push('**Cite a frase da nota** onde o termo aparece, para que a medição possa')
lines.push('verificar a âncora.')
lines.push('')
lines.push('Uma nota pode não ter nenhum termo assim — e isso é uma resposta')
lines.push('perfeitamente válida, não uma falha.')
lines.push('')
lines.push('```json')
lines.push('{')
lines.push('  "caseId": "ciclo-calvin",')
lines.push('  "terms": [')
lines.push('    { "term": "rubisco", "sourceQuote": "a enzima rubisco, que adiciona CO2" }')
lines.push('  ]')
lines.push('}')
lines.push('```')
lines.push('')
lines.push('---')
lines.push('')

for (const entry of golden.cases) {
  const note = readFileSync(join(casesDir, entry.note), 'utf8').trim()
  lines.push(`## CASO \`${entry.id}\``)
  lines.push('')
  lines.push(`Rótulo de prontidão (contexto, não é o que você está julgando): \`${entry.readiness.label}\``)
  lines.push('')
  lines.push('### A NOTA')
  lines.push('')
  lines.push('```')
  lines.push(note)
  lines.push('')
  lines.push('```')
  lines.push('')
  lines.push('### SUAS RESPOSTAS')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push(`  "caseId": "${entry.id}",`)
  lines.push('  "terms": []')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('---')
  lines.push('')
}

const output = lines.join('\n')
const target = join(root, 'docs', 'golden-improvement-review.md')
writeFileSync(target, `${output}\n`, 'utf8')
console.log(`pacote em ${target} (${golden.cases.length} casos)`)
