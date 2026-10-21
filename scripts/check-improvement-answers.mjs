// Verifica as respostas da revisao do ground truth de "melhorar a nota".
//
//   node scripts/check-improvement-answers.mjs respostas.json
//
// ## Por que isto existe
//
// A revisao e feita a mao (ou por um modelo) e leva 20 minutos. Um erro de
// digitacao — um `caseId` errado, um termo que nao existe na nota, uma
// citacao que nao esta no texto — so apareceria **depois** da importacao,
// dentro de um numero de recall que ninguem sabe ler.
//
// Este script verifica as respostas **antes** da importacao e diz o que
// esta errado. Nao corrige nada: corrige quem escreveu.
//
// ## O que ele checa
//
// 1. O JSON parses (e sem BOM).
// 2. Todo caso do golden set tem resposta.
// 3. Nenhum caso repetido.
// 4. Todo `term` aparece **literalmente** na nota do caso.
// 5. Todo `sourceQuote`, quando presente, aparece **literalmente** na nota.
//
// ## Por que 4 e 5 sao literais
//
// A medicao de recall compara o termo encontrado com o termo esperado. Se o
// revisor escreve "fase escura" e a nota escreve "fase escura", casam. Se
// o revisor escreve "fase escura" e a nota escreve "a fase escura", a
// citacao literal nao casa — e a medicao diria que o pipeline errou quando
// o problema era a digitacao do revisor.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const goldenPath = resolve(
  here,
  '..',
  'src-tauri',
  'tests',
  'fixtures',
  'jev-golden',
  'golden.json',
)
const casesDir = resolve(here, '..', 'src-tauri', 'tests', 'fixtures', 'jev-golden', 'cases')

const input = process.argv[2]
if (!input) {
  console.error('uso: node scripts/check-improvement-answers.mjs <respostas.json>')
  process.exit(1)
}
if (!existsSync(resolve(input))) {
  console.error(`nao achei o arquivo: ${input}`)
  process.exit(1)
}

const raw = readFileSync(resolve(input), 'utf8').replace(/^﻿/, '').trim()
let parsed
try {
  parsed = JSON.parse(raw)
} catch (error) {
  console.error(`nao consegui ler como JSON: ${error.message}`)
  console.error('Se o arquivo foi salvo com BOM, salve como UTF-8 sem BOM.')
  process.exit(1)
}

const entries = Array.isArray(parsed)
  ? parsed
  : Object.entries(parsed).map(([caseId, value]) => ({ caseId, ...value }))

const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const problems = []
const warnings = []

// 1. Todo caso do golden set tem resposta.
const answered = new Set(entries.map((entry) => entry.caseId ?? entry.id))
for (const goldenCase of golden.cases) {
  if (!answered.has(goldenCase.id)) {
    problems.push(`${goldenCase.id}: sem resposta — todo caso do conjunto precisa de uma`)
  }
}

// 2. Nenhum caso repetido.
const seen = new Set()
for (const entry of entries) {
  const caseId = entry.caseId ?? entry.id
  if (!caseId) {
    problems.push('um bloco sem `caseId`')
    continue
  }
  if (seen.has(caseId)) {
    problems.push(`${caseId}: resposta repetida`)
  }
  seen.add(caseId)
}

// 3 e 4. Os termos e as citacoes existem na nota.
for (const entry of entries) {
  const caseId = entry.caseId ?? entry.id
  if (!caseId) continue
  const goldenCase = golden.cases.find((item) => item.id === caseId)
  if (!goldenCase) {
    problems.push(`${caseId}: caso inexistente no golden set`)
    continue
  }
  const notePath = join(casesDir, goldenCase.note)
  if (!existsSync(notePath)) {
    problems.push(`${caseId}: a nota ${goldenCase.note} nao existe no disco`)
    continue
  }
  const markdown = readFileSync(notePath, 'utf8')
  const terms = entry.terms ?? []
  if (!Array.isArray(terms)) {
    problems.push(`${caseId}: "terms" precisa ser uma lista`)
    continue
  }
  for (const raw of terms) {
    const term = typeof raw === 'string' ? raw : raw?.term
    const quote = typeof raw === 'string' ? undefined : raw?.sourceQuote
    if (typeof term !== 'string' || !term.trim()) {
      problems.push(`${caseId}: um termo sem texto`)
      continue
    }
    if (!markdown.includes(term)) {
      problems.push(
        `${caseId}: o termo "${term}" nao aparece literalmente na nota — ` +
          'a medicao compara o texto exato',
      )
    }
    if (quote && !markdown.includes(quote)) {
      problems.push(
        `${caseId}: a citacao "${quote}" nao aparece literalmente na nota`,
      )
    }
    if (!quote) {
      warnings.push(
        `${caseId}: "${term}" sem sourceQuote — a ancora nao podera ser conferida`,
      )
    }
  }
}

console.log(`respostas: ${entries.length} | casos do conjunto: ${golden.cases.length}`)
console.log('')

if (warnings.length) {
  console.log(`${warnings.length} aviso(s):`)
  for (const warning of warnings) console.log(`  ! ${warning}`)
  console.log('')
}

if (problems.length) {
  console.log(`${problems.length} problema(s) — corrija antes de importar:`)
  for (const problem of problems) console.log(`  x ${problem}`)
  console.log('')
  console.log('A importacao foi recusada de proposito: um erro aqui viraria um')
  console.log('numero de recall que ninguem conseguiria ler.')
  process.exit(1)
}

console.log('Tudo conferido. Importe com:')
console.log(`  node scripts/golden-improvement-import.mjs ${input}`)
