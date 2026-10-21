// Exporta o pacote de revisão do golden set.
//
//   node scripts/golden-review-export.mjs            -> imprime (para colar)
//   node scripts/golden-review-export.mjs --file     -> grava em docs/
//
// ## Para que outro modelo julgue
//
// O revisor **nao** pode ser o mesmo motor que esta sendo medido: a pergunta
// e "esta sintese demonstra esta dimensao?", e um modelo que responde "sim"
// para quase tudo tornaria a medicao tautologica. Use um modelo de outra
// familia (a revisao do JEV com um Gemini, ou vice-versa).
//
// ## A tarefa e mais factual do que parece
//
// O revisor nao esta juzgando a qualidade literaria da sintese. Ele esta
// comparando **a sintese com a nota**, e a resposta esta no texto:
// a nota deixa essa lacuna em aberto? ( procure a frase )
// a sintese usa o material numa situacao nova? ( procure a frase )
// a sintese afirma algo que a nota nao sustenta? ( procure a frase )
//
// ## A regra anti-leniencia
//
// O modo de falha conhecido deste tipo de revisao e a **leniencia**: um
// revisor tender a dizer "sim, demonstra" porque a sintese parece completa.
// A unica defesa e obrigar o revisor a **procurar a falha primeiro** e citar
// a evidencia. Por isso o prompt exige a evidencia dos dois lados, e por isso
// a resposta `no` e `partial` nao sao menos validas que `yes`.
//
// ## A lacuna e a pergunta que mais importa
//
// `gapIsReal` e respondida contra a **nota**, nao contra a sintese: a nota
// realmente deixa essa lacuna em aberto? Uma sintese que admite uma lacuna
// inventada faria o motor parecer bom pelo motivo errado.

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
const cases = golden.cases.filter((entry) => entry.synthesis)

const lines = []
lines.push('# Pacote de revisão das sínteses do golden set')
lines.push('')
lines.push('Cada bloco abaixo é um caso. O bloco inteiro (nota + síntese) deve ser')
lines.push('avaliado de forma independente, sem comparar com os outros casos.')
lines.push('')
lines.push('## O que fazer com cada bloco')
lines.push('')
lines.push('1. Leia a **nota** inteira.')
lines.push('2. Leia a **síntese** inteira.')
lines.push('3. Para cada uma das 4 dimensões, **procure primeiro a evidência')
lines.push('   contra** e depois a evidência a favor. Se a evidência contra for')
lines.push('   vazia, escreva isso explicitamente — mas a ausência de evidência')
lines.push('   contra não é o mesmo que evidência a favor.')
lines.push('4. Responda as 2 perguntas extras.')
lines.push('')
lines.push('Responda **apenas** com o JSON do bloco, sem texto em volta.')
lines.push('')
lines.push('---')
lines.push('')

for (const entry of cases) {
  const note = readFileSync(join(casesDir, entry.note), 'utf8').trim()
  lines.push(`## CASO \`${entry.id}\``)
  lines.push('')
  lines.push(`Rótulo de prontidão da nota (contexto, não é o que você está julgando): \`${entry.readiness.label}\``)
  lines.push('')
  lines.push('### NOTA')
  lines.push('')
  lines.push('```')
  lines.push(note)
  lines.push('```')
  lines.push('')
  lines.push('### SÍNTESE QUE VOCÊ VAI JULGAR')
  lines.push('')
  lines.push('```')
  lines.push(entry.synthesis)
  lines.push('```')
  lines.push('')
  lines.push('### PERGUNTAS')
  lines.push('')
  lines.push('Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra')
  lines.push('parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**')
  lines.push('sentidos.')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push(`  "caseId": "${entry.id}",`)
  lines.push('  "dimensions": {')
  lines.push('    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },')
  lines.push('    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },')
  lines.push('    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },')
  lines.push('    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }')
  lines.push('  },')
  lines.push('  "gapIsReal": { "answer": null, "noteEvidence": "" },')
  lines.push('  "unsupportedClaims": []')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('**Definições das dimensões** (a régua que o app usa):')
  lines.push('')
  lines.push('- **Cerne** — a ideia central aparece, sem distorção?')
  lines.push('  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*')
  lines.push('  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*')
  lines.push('- **Conexões** — os conceitos ficam relacionados, ou apenas listados?')
  lines.push('  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*')
  lines.push('  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*')
  lines.push('- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?')
  lines.push('  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*')
  lines.push('  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*')
  lines.push('- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?')
  lines.push('  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*')
  lines.push('  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*')
  lines.push('')
  lines.push('**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna')
  lines.push('**REAL desta nota**? Responda contra a **nota**, não contra a síntese:')
  lines.push('existe na nota algo que ficou em aberto e que a síntese admite?')
  lines.push('  - `true` + a citação da nota que deixa a lacuna em aberto; ou')
  lines.push('  - `false` + por que não existe.')
  lines.push('')
  lines.push('**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste')
  lines.push('cada uma com a citação exata. Lista vazia se não houver.')
  lines.push('')
  lines.push('---')
  lines.push('')
}

const output = lines.join('\n')
if (process.argv.includes('--file')) {
  const target = join(root, 'docs', 'golden-review-package.md')
  writeFileSync(target, `${output}\n`, 'utf8')
  console.log(`pacote em ${target} (${cases.length} casos)`)
} else {
  console.log(output)
}
