#!/usr/bin/env node
/**
 * Auditoria de CSS morto — candidatos, nao veredito.
 *
 * Por que "candidatos"
 * --------------------
 * Um seletor pode nao casar com nenhuma string do fonte e ainda assim ser
 * usado: classes montadas em runtime, classes que bibliotecas geram
 * (CodeMirror, KaTeX, remark) e classes escritas em HTML de docs. O scanner
 * e CONSERVADOR de proposito: na duvida, considera vivo. O que sobra e uma
 * lista para revisao humana, nao para `sed -i`.
 *
 * Heuristica
 * ----------
 * 1. Extrai `.classe` de todo seletor nos .css de `src` (com linha).
 * 2. Junta TODO o texto de `src` e `tests` e procura o nome COMPLETO da
 *    classe. Busca por palavra solta revivia classe morta (a palavra
 *    aparecia num texto qualquer), entao a comparacao e por nome inteiro.
 * 3. Fragamentos estaticos de template (`ui-button--${size}`) viram
 *    prefixos: toda classe que comeca com eles conta como viva.
 * 4. Allowlist para classes geradas por bibliotecas.
 *
 * Saidas:
 *   node scripts/scan-dead-css.mjs          (resumo)
 *   node scripts/scan-dead-css.mjs --json   (para gerar o relatorio)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const JSON_OUT = process.argv.includes('--json')

const ALLOW_PREFIXES = [
  'cm-', 'cm6-', 'ͼ', 'tok-', 'katex', 'shiki', 'hljs', 'language-',
  'mermaid', 'prose', 'task-list', 'contains-task-list', 'footnote-',
  'anchor', 'heading-anchor', 'data-', 'radix-', 'rehype-', 'remark-',
  'tiptap', 'svelte-',
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'target') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const srcFiles = walk(join(ROOT, 'src'))
const testFiles = walk(join(ROOT, 'tests'))
const tauriFiles = walk(join(ROOT, 'src-tauri'))
const cssFiles = srcFiles.filter((f) => f.endsWith('.css'))
const sourceFiles = srcFiles
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
  .concat(testFiles.filter((f) => /\.(ts|tsx|mjs)$/.test(f)))

/**
 * Todo texto nao-CSS de src/tests (+ index.html). Inclui .rs e .html:
 * uma classe pode ser emitida por Rust ou pelo HTML de entrada, e isso
 * nao pode virar falso "morto". CSS fica de fora de proposito (senao a
 * propria declaracao contaria como uso).
 */
const BINARY = /\.(css|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|map|lock)$/i
const textFiles = srcFiles
  .concat(testFiles)
  .concat(tauriFiles)
  .filter((f) => !BINARY.test(f))
  .concat([join(ROOT, 'index.html')])

/** Troca comentarios por espacos, preservando newlines (offset/linha). */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, ' '),
  )
}

const CLASS = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g

// --- 1. Regras e classes declaradas ------------------------------------
const rules = []
const declared = new Map() // classe -> [{ file, line, selector }]
for (const file of cssFiles) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const text = blankComments(readFileSync(file, 'utf8'))
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const rawSelector = match[1]
    const selector = rawSelector.trim().replace(/\s+/g, ' ')
    if (!selector || selector.startsWith('@')) continue
    const leading = rawSelector.length - rawSelector.trimStart().length
    const start = match.index + leading
    const line = text.slice(0, start).split('\n').length
    const classes = [...selector.matchAll(CLASS)].map((m) => m[1])
    if (classes.length === 0) continue
    rules.push({
      file: rel,
      line,
      start,
      end: match.index + match[0].length,
      selector,
      classes,
    })
    for (const name of new Set(classes)) {
      if (!declared.has(name)) declared.set(name, [])
      declared.get(name).push({ file: rel, line, selector })
    }
  }
}

// --- 2. Prefixos dinamicos --------------------------------------------
const prefixes = new Set()
function addFragment(fragment) {
  for (const raw of fragment.trim().split(/\s+/)) {
    const token = raw.replace(/[^\w-]/g, '')
    if (token.length < 3) continue
    if (token.endsWith('-') || token.endsWith('--') || token.endsWith('_')) prefixes.add(token)
  }
}

function literalsFrom(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    const quote = text[i]
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      i++
      continue
    }
    let j = i + 1
    let body = ''
    while (j < text.length) {
      const char = text[j]
      if (char === '\\') {
        body += text[j + 1] ?? ''
        j += 2
        continue
      }
      if (char === quote) break
      if (quote !== '`' && char === '\n') break
      body += char
      j++
    }
    if (j < text.length && text[j] === quote) {
      out.push({ quote, body })
      i = j + 1
    } else {
      i++
    }
  }
  return out
}

const sourceText = textFiles
  .filter((file) => {
    try {
      return statSync(file).isFile()
    } catch {
      return false
    }
  })
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')
for (const file of sourceFiles) {
  for (const { quote, body } of literalsFrom(readFileSync(file, 'utf8'))) {
    if (!body || body.includes('\n')) continue
    if (quote === '`' && body.includes('${')) {
      for (const fragment of body.split(/\$\{[^}]*\}/)) addFragment(fragment)
    } else {
      addFragment(body)
    }
  }
}

function isAllowed(name) {
  return ALLOW_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function isUsed(name) {
  if (sourceText.includes(name)) return true
  if (isAllowed(name)) return true
  for (const prefix of prefixes) if (name.startsWith(prefix)) return true
  return false
}

// --- 3. Candidatos -----------------------------------------------------
const dead = []
const allowed = []
for (const [name, uses] of declared) {
  const entry = {
    name,
    uses: uses.length,
    files: [...new Set(uses.map((u) => u.file))],
    sample: uses[0].selector,
    line: uses[0].line,
  }
  if (isAllowed(name)) {
    allowed.push(entry)
    continue
  }
  if (isUsed(name)) continue
  dead.push(entry)
}
dead.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
const deadNames = new Set(dead.map((d) => d.name))

// Regra "inteiramente morta": toda parte (separada por virgula) tem classe
// e TODAS as classes dela sao candidatas. Se qualquer classe viva aparece,
// a regra nao entra (ela ainda pinta algo).
function parts(selector) {
  return selector
    .split(',')
    .map((part) => [...part.matchAll(CLASS)].map((m) => m[1]))
    .filter((classes) => classes.length > 0)
}
const fullyDeadRules = rules.filter((rule) => {
  const parsed = parts(rule.selector)
  if (parsed.length === 0) return false
  return parsed.every((classes) => classes.every((name) => deadNames.has(name)))
})

const reportIndex = process.argv.indexOf('--report')
const REPORT_PATH = reportIndex >= 0 ? process.argv[reportIndex + 1] : null

function buildReport() {
  const today = new Date().toISOString().slice(0, 10)
  const byFile = new Map()
  for (const entry of dead) {
    const file = entry.files[0]
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(entry)
  }
  const lines = []
  lines.push('# Auditoria de CSS morto — candidatos')
  lines.push('')
  lines.push(`Gerado em ${today} por \`node scripts/scan-dead-css.mjs --report docs/css-dead-code-report.md\`.`)
  lines.push('')
  lines.push('**Isto é uma lista de candidatos, não um veredito.** O scanner é conservador:')
  lines.push('considera vivo tudo que aparece no fonte (`.ts`/`.tsx`/`.mjs`/`.rs`/`.html`),')
  lines.push('tudo que casa com prefixo de template (`ui-button--${size}`) e as classes')
  lines.push('geradas por bibliotecas. O que sobra é o que **não tem nenhuma referência')
  lines.push('literal** — pode ser código morto ou uma classe montada de um jeito que o')
  lines.push('scanner não vê. Revisar antes de remover.')
  lines.push('')
  lines.push('## Números')
  lines.push('')
  lines.push(`- Classes declaradas em CSS: **${declared.size}** (${rules.length} regras com classe).`)
  lines.push(`- Candidatas a mortas: **${dead.length}**.`)
  lines.push(`- Regras inteiramente mortas (todas as classes da regra são candidatas): **${fullyDeadRules.length}**.`)
  lines.push(`- Classes externas/geradas reconhecidas: **${allowed.length}**.`)
  lines.push('')
  lines.push('## Classes candidatas')
  lines.push('')
  lines.push('| classe | regras | arquivo (1ª ocorrência) | linha |')
  lines.push('|---|---:|---|---:|')
  for (const entry of dead) {
    lines.push(`| \`${entry.name}\` | ${entry.uses} | \`${entry.files.join('`, `')}\` | ${entry.line} |`)
  }
  lines.push('')
  lines.push('## Regras inteiramente mortas')
  lines.push('')
  lines.push('Regras em que **toda** parte do seletor depende de classe candidata. Se a')
  lines.push('classe não é usada, a regra não pinta nada. (Regras com uma classe viva no')
  lines.push('meio ficam de fora de propósito.)')
  lines.push('')
  lines.push('| arquivo | linha | seletor |')
  lines.push('|---|---:|---|')
  for (const rule of fullyDeadRules) {
    lines.push(`| \`${rule.file}\` | ${rule.line} | \`${rule.selector.replace(/\|/g, '\\|')}\` |`)
  }
  lines.push('')
  lines.push('## Como usar')
  lines.push('')
  lines.push('1. Confirme que a classe não é montada em runtime (procure o prefixo no fonte).')
  lines.push('2. Remova a classe/regra em um commit pequeno, por arquivo.')
  lines.push('3. `npm run build`, os 3 gates e `npm run test`; se algo quebrar, a classe estava viva.')
  lines.push('4. Regenere este relatório para ver o número cair.')
  lines.push('')
  return lines.join('\n')
}

if (REPORT_PATH) {
  writeFileSync(REPORT_PATH, buildReport(), 'utf8')
  console.log(`relatorio: ${REPORT_PATH}`)
  process.exit(0)
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    declared: declared.size,
    rules: rules.length,
    candidates: dead.length,
    allowedExternal: allowed.length,
    fullyDeadRules: fullyDeadRules.length,
    candidatesList: dead,
    rulesList: fullyDeadRules,
  }, null, 2))
  process.exit(0)
}

console.log(`classes declaradas em CSS: ${declared.size} (${rules.length} regras com classe)`)
console.log(`externas/geradas (allowlist): ${allowed.length}`)
console.log(`candidatas a mortas: ${dead.length}`)
console.log(`regras inteiramente mortas: ${fullyDeadRules.length}`)
console.log('')
for (const entry of dead) {
  console.log(`  ${entry.name}  (${entry.uses}x, linha ${entry.line})  ${entry.files.join(', ')}`)
}
