#!/usr/bin/env node
/**
 * Inventario dos `<button>` crus do produto.
 *
 * O doc `docs/design-system-maturation.md` cita este script, mas ele nao
 * existia no repo. Ele responde tres perguntas com o mesmo numero:
 *
 *   1. quantos `<button>` crus sobraram no produto (fora de teste e do
 *      proprio primitivo);
 *   2. quantos nao declaram `className` (os que a onda 1 migra direto);
 *   3. quantos declaram classe estatica ou dinamica (os que precisam
 *      preservar a classe na migracao).
 *
 * Uso:
 *   node scripts/scan-buttons.mjs
 *   node scripts/scan-buttons.mjs --json
 *
 * O parser e deliberadamente simples: acha `<button` e le ate o `>` de
 * fechamento da tag, respeitando chaves e strings, para nao confundir
 * `=>` nem `className={`...`}` com o fim da tag.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Le a tag `<button ...>` a partir de `start`, respeitando chaves/strings. */
function readTag(source, start) {
  let i = start + '<button'.length
  let depth = 0
  let quote = null
  for (; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

/** Extrai a classe declarada na tag: estatica, dinamica ou ausente. */
function classNameOf(tag) {
  const match = tag.match(/\bclassName=(\{[^}]*\}|"[^"]*"|'[^']*')/)
  if (!match) return { kind: 'none', value: null }
  const raw = match[1]
  if (raw.startsWith('{')) return { kind: 'dynamic', value: raw.slice(1, -1).trim() }
  return { kind: 'static', value: raw.slice(1, -1) }
}

const files = walk(SRC).filter(
  (file) => !file.endsWith('.test.tsx') && !file.endsWith('Button.tsx'),
)

const rows = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const re = /<button\b/g
  let match
  while ((match = re.exec(source)) !== null) {
    const tag = readTag(source, match.index)
    const line = source.slice(0, match.index).split('\n').length
    rows.push({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      line,
      className: classNameOf(tag),
      tag,
    })
  }
}

const counts = {
  total: rows.length,
  none: rows.filter((row) => row.className.kind === 'none').length,
  static: rows.filter((row) => row.className.kind === 'static').length,
  dynamic: rows.filter((row) => row.className.kind === 'dynamic').length,
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, rows }, null, 2))
} else {
  for (const row of rows) {
    const label =
      row.className.kind === 'none'
        ? '(sem classe)'
        : `[${row.className.kind}] ${row.className.value}`
    console.log(`${row.file}:${row.line}  ${label}`)
  }
  console.log('')
  console.log(
    `total ${counts.total} | sem classe ${counts.none} | classe estatica ${counts.static} | classe dinamica ${counts.dynamic}`,
  )
}
