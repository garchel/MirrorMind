#!/usr/bin/env node
/**
 * Remocao assistida das regras que o scan-dead-css marcou como
 * INTEGRALMENTE mortas. Nao decide nada: le a lista do scanner e apaga
 * apenas os intervalos daquele arquivo, de tras para frente (para nao
 * deslocar os offsets).
 *
 * Uso:
 *   node scripts/remove-dead-css.mjs <arquivo>          (dry-run)
 *   node scripts/remove-dead-css.mjs <arquivo> --write  (aplica)
 *
 * Antes de aplicar, confira a lista impressa. O contrato e: a regra so
 * sai se TODAS as classes dela sao candidatas no relatorio atual.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [, , file, ...flags] = process.argv
const write = flags.includes('--write')

if (!file) {
  console.error('uso: node scripts/remove-dead-css.mjs <arquivo> [--write]')
  process.exit(2)
}

const json = execFileSync(process.execPath, ['scripts/scan-dead-css.mjs', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const data = JSON.parse(json)
const rules = data.rulesList
  .filter((rule) => rule.file === file)
  .sort((a, b) => b.start - a.start)

if (rules.length === 0) {
  console.log(`nada a remover em ${file}`)
  process.exit(0)
}

console.log(`${rules.length} regra(s) integralmente morta(s) em ${file}:`)
for (const rule of rules) console.log(`  linha ${rule.line}: ${rule.selector.slice(0, 100)}`)

if (!write) {
  console.log('\n(dry-run; use --write para aplicar)')
  process.exit(0)
}

const text = readFileSync(file, 'utf8')
let out = text
for (const rule of rules) {
  out = out.slice(0, rule.start) + out.slice(rule.end)
}
// Nao deixa buracos de 3+ linhas em branco.
out = out.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
writeFileSync(file, out, 'utf8')
console.log(`\nremovidas ${rules.length} regra(s) de ${file}`)
