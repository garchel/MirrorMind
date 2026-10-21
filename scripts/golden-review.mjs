// Revisor interativo das sínteses do golden set.
//
//   node scripts/golden-review.mjs            -> revisa, um caso por vez
//   node scripts/golden-review.mjs --status   -> só o que falta
//   node scripts/golden-review.mjs --reset     -> limpa as respostas
//
// ## Por que interativo
//
// Editar um JSON com 19 entradas de 6 campos é lento e propaga erro de digitação
// silencioso. Aqui cada pergunta é feita e respondida no lugar, e a resposta é
// gravada **na hora** — se a sessão travar no caso 12, os 11 anteriores estão
// salvos.
//
// ## As perguntas
//
// Quatro dimensões, com `y` (demonstra bem), `p` (parcialmente) e `n` (não
// demonstra). Depois, duas perguntas sobre o texto:
//
//   - a lacuna admitida é REAL para esta nota? (`gapIsReal`)
//   - a síntese afirma algo que a nota não sustenta? (texto livre)
//
// A lacuna ser real é a pergunta que nenhuma máquina responde, e a que mais
// importa: uma lacuna inventada faria o motor parecer bom pelo motivo errado.
//
// ## O que NÃO é perguntado
//
// "O JEV está certo?" Não. Essa é a pergunta que a medição faz depois,
// comparando a régua do motor com a sua revisão. Se a revisão concordasse com
// o motor, a medição não mediria nada.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

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
const answersPath = join(here, 'golden-review-answers.json')

const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const answers = existsSync(answersPath)
  ? JSON.parse(readFileSync(answersPath, 'utf8'))
  : {}

const DIMENSIONS = [
  { key: 'core', label: 'Cerne', question: 'reconstrói a ideia central?' },
  { key: 'connections', label: 'Conexões', question: 'relaciona os conceitos, ou só os lista?' },
  { key: 'application', label: 'Aplicação', question: 'usa o material numa situação nova?' },
  { key: 'gaps', label: 'Lacunas', question: 'admite a lacuna que a nota realmente deixa?' },
]

/**
 * Compara texto ignorando acentos.
 *
 * As sínteses do golden set foram escritas sem acento ("Ainda nao sei bem"),
 * e o marcador de verificação usa a forma acentuada. Comparar sem normalizar
 * faria a folha marcar `[ ]` em todas as sínteses — e o revisor acabaria
 * "corrigindo" uma parte que existe.
 */
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const PARTS = [
  { marker: 'A ideia central', dimension: 'core' },
  { marker: 'Os conceitos se conectam', dimension: 'connections' },
  { marker: 'Isso se aplica', dimension: 'application' },
  { marker: 'Ainda nao sei bem', dimension: 'gaps' },
]

const withSynthesis = golden.cases.filter((entry) => entry.synthesis)

function isAnswered(entry) {
  const answer = answers[entry.id]
  if (!answer || typeof answer !== 'object') return false
  return DIMENSIONS.every((dimension) => answer[dimension.key]) && answer.gapIsReal !== null
}

function save() {
  const ordered = { _como_usar: answers._como_usar ?? '' }
  for (const entry of golden.cases) {
    if (answers[entry.id]) ordered[entry.id] = answers[entry.id]
  }
  writeFileSync(answersPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8')
}

if (process.argv.includes('--reset')) {
  for (const entry of golden.cases) delete answers[entry.id]
  save()
  console.log('respostas limpas.')
  process.exit(0)
}

const pending = withSynthesis.filter((entry) => !isAnswered(entry))

if (process.argv.includes('--status')) {
  console.log(`${withSynthesis.length} casos com síntese, ${pending.length} pendentes.\n`)
  for (const entry of pending) {
    console.log(`  ${entry.id}  (prontidão: ${entry.readiness.label})`)
  }
  process.exit(0)
}

if (!pending.length) {
  console.log('nada pendente. Rode `node scripts/apply-golden-review.mjs`.')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })

// Leitor de linha proprio, em vez de `rl.question`.
//
// Motivo: o `readline` com `question` bufferiza **todo** o stdin na primeira
// pergunta. Num terminal isso nao aparece, mas com a entrada pipeada as
// perguntas seguintes ficam esperando para sempre. O iterador assincrono consome
// uma linha por vez, e funciona igual nos dois casos — o que tambem permite
// testar a ferramenta sem digitar 19 casos a mao.
const lines = rl[Symbol.asyncIterator]()

async function readLine() {
  const { value, done } = await lines.next()
  if (done) return null
  return value
}

async function ask(question, { choices } = {}) {
  for (;;) {
    const suffix = choices ? ` [${choices.join('/')}]` : ''
    process.stdout.write(`${question}${suffix}: `)
    const line = await readLine()
    if (line === null) {
      console.log('\n\nEntrada encerrada. As respostas ja salvas foram mantidas.')
      process.exit(0)
    }
    const trimmed = line.trim()
    if (!trimmed) return ''
    if (!choices) return trimmed
    if (choices.some((choice) => choice.toLowerCase() === trimmed.toLowerCase())) {
      return trimmed.toLowerCase()
    }
    console.log(`  responda ${choices.join(' ou ')}`)
  }
}

console.log(`Revisão das sínteses: ${pending.length} caso(s) pendente(s).\n`)
console.log('y = demonstra bem | p = parcialmente | n = não demonstra\n')

for (const entry of pending) {
  const note = readFileSync(join(casesDir, entry.note), 'utf8').trim()

  console.log('='.repeat(72))
  console.log(`CASO  ${entry.id}   (prontidão: ${entry.readiness.label})`)
  console.log('='.repeat(72))
  console.log('\n--- A NOTA ---\n')
  console.log(note)
  console.log('\n--- A SÍNTESE ---\n')
  console.log(entry.synthesis)
  console.log('\n--- AS 4 PARTES ---')
  for (const part of PARTS) {
    const found = normalize(entry.synthesis).includes(normalize(part.marker))
    console.log(`  ${found ? '[x]' : '[ ]'} ${part.dimension}`)
  }
  console.log('')

  const answer = {}
  for (const dimension of DIMENSIONS) {
    answer[dimension.key] = await ask(
      `  ${dimension.label} — ${dimension.question}`,
      { choices: ['y', 'p', 'n'] },
    )
  }
  const gapReal = await ask('  A lacuna admitida é REAL para esta nota?', {
    choices: ['s', 'n'],
  })
  answer.gapIsReal = gapReal === 's'
  answer.unsupportedClaims = await ask(
    '  A síntese afirma algo que a nota NÃO sustenta? (vazio se não)',
  )
  answer.notes = ''

  answers[entry.id] = answer
  save()
  console.log(`\n  salvo. restam ${pending.indexOf(entry) + 1}/${pending.length} neste lote.\n`)
}

rl.close()
console.log('Todas as respostas salvas. Rode `node scripts/apply-golden-review.mjs`.')
