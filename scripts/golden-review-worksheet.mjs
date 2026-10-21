// Gera a folha de revisão das sínteses do golden set.
//
//   node scripts/golden-review-worksheet.mjs          -> imprime a folha
//   node scripts/golden-review-worksheet.mjs --file   -> grava em docs/
//
// ## Por que isto existe
//
// A revisão humana de 19 sínteses × 4 dimensões = 76 julgamentos é carga
// demais para fazer "de cabeça", e o modo como ela falha é silencioso: o
// revisor aceita que a síntese "está boa" e o golden set ganha um rótulo
// que ninguém checou.
//
// A folha separa o que é **mecânico** (a síntese tem as 4 partes? a lacuna
// admitida é a lacuna que a nota realmente tem?) do que é **humano** (esta
// síntese demonstra esta dimensão?).
//
// ## O que a folha NÃO pergunta
//
// Ela não pergunta "o JEV está certo?". Essa é a pergunta que a medição faz
// depois, comparando a régua do JEV com a da sua revisão. Se a folha
// perguntasse isso, o revisor estaria só concordando com o motor, e a
// medição não mediria nada.
//
// ## O que a folha pergunta, por caso
//
// 1. As 4 partes estão lá? (mecânico — a folha já verifica)
// 2. A síntese demonstra cada dimensão? (humano)
// 3. A lacuna que ela admite é uma lacuna REAL desta nota? (humano)
// 4. A síntese afirma algo que a nota não sustenta? (humano)
//
// A pergunta 3 é a que mais importa e a que nenhuma máquina responde: uma
// síntese que admite uma lacuna inventada faria o JEV parecer bom pelo motivo
// errado.

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
const casesDir = join(root, 'src-tauri', 'tests', 'fixtures', 'jev-golden', 'cases')

const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

// As mesmas dimensoes e rubricas que a tela mostra. Copy daqui para a
// aplicação: `levels_for` em `calibrated/synthesis.rs` e `SYNTHESIS_DIMENSIONS`
// em `ReviewSessionPage.tsx`.
const DIMENSIONS = [
  {
    key: 'core',
    label: 'Cerne',
    hint: 'Reconstrução da ideia central',
    question: 'A síntese reconstrói a ideia central da nota?',
    level0: 'Não aparece, ou aparece distorcendo a ideia central da nota.',
    level4: 'Aparece completa e com precisão: cobre a dimensão por inteiro, sem pontos fracos relevantes.',
  },
  {
    key: 'connections',
    label: 'Conexões',
    hint: 'Relações entre conceitos',
    question: 'A síntese relaciona os conceitos, ou apenas os lista?',
    level0: 'Não aparece, ou os conceitos ficam listados sem relação entre si.',
    level4: 'Aparece completa e com precisão: cobre a dimensão por inteiro, sem pontos fracos relevantes.',
  },
  {
    key: 'application',
    label: 'Aplicação',
    hint: 'Uso em situações novas',
    question: 'A síntese usa o material numa situação nova, ou só o reproduz?',
    level0: 'Não aparece: a síntese só reproduz, sem ir além.',
    level4: 'Aparece completa e com precisão: cobre a dimensão por inteiro, sem pontos fracos relevantes.',
  },
  {
    key: 'gaps',
    label: 'Lacunas',
    hint: 'Integração do que ainda não domina',
    question: 'A síntese admite a lacuna que a nota realmente deixa em aberto?',
    level0: 'Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.',
    level4: 'Aparece completa e com precisão: cobre a dimensão por inteiro, sem pontos fracos relevantes.',
  },
]

const ANSWERS_PATH = join(here, 'golden-review-answers.json')
const answers = existsSync(ANSWERS_PATH)
  ? JSON.parse(readFileSync(ANSWERS_PATH, 'utf8'))
  : {}

const PARTS = [
  { marker: 'A ideia central', dimension: 'core' },
  { marker: 'Os conceitos se conectam', dimension: 'connections' },
  { marker: 'Isso se aplica', dimension: 'application' },
  { marker: 'Ainda não sei bem', dimension: 'gaps' },
]

const lines = []
lines.push('# Revisão das sínteses do golden set')
lines.push('')
lines.push('Uma entrada por caso. Preencha e salve em `scripts/golden-review-answers.json`.')
lines.push('')
lines.push('**Respostas possíveis por dimensão:** `yes` (demonstra bem) / `partial` (demonstra parcialmente)')
lines.push('/ `no` (não demonstra).')
lines.push('')
lines.push('```json')
lines.push('{')
lines.push('  "ciclo-calvin": {')
lines.push('    "core": "yes", "connections": "yes", "application": "yes", "gaps": "yes",')
lines.push('    "gapIsReal": true,')
lines.push('    "unsupportedClaims": "",')
lines.push('    "notes": ""')
lines.push('  }')
lines.push('}')
lines.push('```')
lines.push('')
lines.push('---')
lines.push('')

let reviewed = 0
let pending = 0

for (const entry of golden.cases) {
  if (!entry.synthesis) continue
  const note = readFileSync(join(casesDir, entry.note), 'utf8').trim()
  const answer = answers[entry.id]

  lines.push(`## ${entry.id}`)
  lines.push('')
  lines.push(`**Rótulo de prontidão:** \`${entry.readiness.label}\``)
  lines.push('')
  lines.push('### A nota')
  lines.push('')
  lines.push('```')
  lines.push(note)
  lines.push('```')
  lines.push('')
  lines.push('### A síntese')
  lines.push('')
  lines.push('```')
  lines.push(entry.synthesis)
  lines.push('```')
  lines.push('')
  lines.push('### As 4 partes')
  lines.push('')
  for (const part of PARTS) {
    const found = entry.synthesis.includes(part.marker)
    lines.push(`- [${found ? 'x' : ' '}] ${part.dimension} — "${part.marker}..."`)
  }
  lines.push('')
  lines.push('### Suas respostas')
  lines.push('')
  for (const dimension of DIMENSIONS) {
    const current = answer?.[dimension.key] ?? '___'
    lines.push(`- **${dimension.label}** (${dimension.hint}) → \`${current}\``)
    lines.push(`  - ${dimension.question}`)
    lines.push(`  - nível 0: _${dimension.level0}_`)
  }
  lines.push('')
  lines.push('- **A lacuna admitida é uma lacuna REAL desta nota?** → `' + (answer?.gapIsReal ?? '___') + '`')
  lines.push('- **A síntese afirma algo que a nota não sustenta?** → `' + (answer?.unsupportedClaims || '___') + '`')
  lines.push('')

  if (answer) reviewed += 1
  else pending += 1
}

lines.push('---')
lines.push('')
lines.push(`**${reviewed} revisados, ${pending} pendentes.**`)
lines.push('')
lines.push('Nenhuma resposta sua é usada para medir nada até que as sínteses E os')
lines.push('rótulos de prontidão estiverem revisados. É por isso que o ECE ainda mede')
lines.push('concordância com a construção de quem escreveu os casos.')

const output = lines.join('\n')
if (process.argv.includes('--file')) {
  const target = join(root, 'docs', 'golden-review-worksheet.md')
  writeFileSync(target, `${output}\n`, 'utf8')
  console.log(`folha em ${target}`)
} else {
  console.log(output)
}
