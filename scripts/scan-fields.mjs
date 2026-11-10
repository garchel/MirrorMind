#!/usr/bin/env node
/**
 * Inventario dos campos crus (`<input>`, `<select>`, `<textarea>`) do produto.
 *
 * Espelho do `scan-buttons.mjs` para a onda dos campos: responde
 *
 *   1. quantos campos crus sobraram (fora de teste, do primitivo
 *      `Field.tsx` e dos arquivos de verificacao);
 *   2. quantos nao declaram `className` (herdam o reset de `base.css`);
 *   3. quantos declaram classe estatica ou dinamica (a migracao
 *      preserva a classe).
 *
 * Uso:
 *   node scripts/scan-fields.mjs
 *   node scripts/scan-fields.mjs --json
 *
 * O parser e o mesmo do scan-buttons: le a tag inteira respeitando
 * chaves e strings (`=>`, `className={`...`}` nao confundem o fim).
 * `<select>` pode abrir filhos; so a tag de abertura interessa aqui.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const TAG_SET = new Set(['input', 'select', 'textarea'])

/** Tira comentarios JS/JSX antes de procurar tags: o trecho
 * "Substitui o select nativo" dentro de um comentario nao e campo.
 * A substituicao preserva o comprimento (espacos + mesma quebra de
 * linha), entao os numeros de linha continuam sendo os do arquivo. */
function blankOut(match) {
  return match.replace(/[\s\S]/g, (ch) => (ch === '\n' ? '\n' : ' '))
}
function withoutComments(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blankOut)
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    // eslint-disable-next-line no-useless-escape
    .replace(/(^|[^:])\/\/[^\n]*/g, blankOut)
}

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

/** Le a tag `<xxx ...>` a partir de `start`, respeitando chaves/strings. */
function readTag(source, start) {
  let i = start
  let depth = 0
  let quote = null
  // consome `<xxx` ate o primeiro espacio (nome da tag completo)
  while (i < source.length && !/[\s>]/.test(source[i])) i += 1
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
  (file) =>
    !file.endsWith('.test.tsx') &&
    !file.endsWith('Field.tsx') &&
    !file.endsWith('Button.tsx'),
)

const rows = []
for (const file of files) {
  const source = withoutComments(readFileSync(file, 'utf8'))
  const re = /<(input|select|textarea)\b/g
  let match
  while ((match = re.exec(source)) !== null) {
    if (!TAG_SET.has(match[1])) continue
    const tag = readTag(source, match.index)
    // `<input` pode aparecer em contextos nao-JSX? Neste repo, JSX so.
    const line = source.slice(0, match.index).split('\n').length
    const type = (tag.match(/\btype="([a-z]+)"/) || [])[1] ?? null
    rows.push({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      line,
      tagName: match[1],
      type,
      className: classNameOf(tag),
      tag,
    })
  }
}

const counts = {
  total: rows.length,
  byTag: {},
  none: rows.filter((row) => row.className.kind === 'none').length,
  static: rows.filter((row) => row.className.kind === 'static').length,
  dynamic: rows.filter((row) => row.className.kind === 'dynamic').length,
  files: new Set(rows.map((r) => r.file)).size,
}
for (const row of rows) counts.byTag[row.tagName] = (counts.byTag[row.tagName] ?? 0) + 1

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, rows }, null, 2))
} else {
  for (const row of rows) {
    const label =
      row.className.kind === 'none'
        ? '(sem classe)'
        : `[${row.className.kind}] ${row.className.value}`
    const tipo = row.type ? ` type=${row.type}` : ''
    console.log(`${row.file}:${row.line}  <${row.tagName}${tipo}>  ${label}`)
  }
  console.log('')
  console.log(
    `total ${counts.total} (${counts.files} arquivos) | sem classe ${counts.none} | classe estatica ${counts.static} | classe dinamica ${counts.dynamic} | por tag ${JSON.stringify(counts.byTag)}`,
  )
}
