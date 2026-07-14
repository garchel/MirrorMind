import { parseDocument, stringify } from 'yaml'

export function splitMarkdownBlocks(content: string) {
  return content.split(/\n{2,}/).filter((block) => block.trim())
}

const FRONTMATTER_PATTERN = /^(---\r?\n)([\s\S]*?)(\r?\n---)(?:\r?\n)?/

function frontmatterMatch(content: string) {
  return content.match(FRONTMATTER_PATTERN)
}

export type FrontmatterValue = string | number | boolean | null | FrontmatterValue[] | { [key: string]: FrontmatterValue }
export type FrontmatterProperties = Record<string, FrontmatterValue>

function parseFrontmatterDocument(input: string) {
  const document = parseDocument(input, { prettyErrors: false, uniqueKeys: true })
  if (document.errors.length > 0) {
    return { error: document.errors[0].message, properties: null }
  }

  const parsed = document.toJS()
  if (parsed === null) return { error: null, properties: {} }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'O frontmatter deve conter propriedades YAML no formato chave: valor.', properties: null }
  }

  return { error: null, properties: parsed as FrontmatterProperties }
}

export function getMarkdownFrontmatterSource(content: string) {
  return frontmatterMatch(content)?.[2] ?? ''
}

export function getMarkdownFrontmatterProperties(content: string): FrontmatterProperties {
  return parseFrontmatterDocument(getMarkdownFrontmatterSource(content)).properties ?? {}
}

export function parseFrontmatterPropertiesInput(input: string) {
  return parseFrontmatterDocument(input)
}

export function setMarkdownFrontmatterProperties(content: string, properties: FrontmatterProperties) {
  const body = getMarkdownBody(content)
  const frontmatter = stringify(properties, { lineWidth: 0 }).trimEnd()
  return frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body
}

export function getMarkdownDescription(content: string) {
  const description = getMarkdownFrontmatterProperties(content).description
  return typeof description === 'string' ? description : ''
}

export function getMarkdownBody(content: string) {
  const match = frontmatterMatch(content)
  return match ? content.slice(match[0].length).replace(/^\r?\n/, '') : content
}

export function setMarkdownDescription(content: string, description: string) {
  const hasDescription = description.trim().length > 0
  const parsed = parseFrontmatterDocument(getMarkdownFrontmatterSource(content))
  if (parsed.error || !parsed.properties) return content
  const properties = parsed.properties
  if (hasDescription) properties.description = description
  else delete properties.description
  return setMarkdownFrontmatterProperties(content, properties)
}

export function replaceMarkdownBody(content: string, body: string) {
  const match = frontmatterMatch(content)
  return match ? `${match[0].trimEnd()}\n\n${body}` : body
}

export type MarkdownFormat =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bold'
  | 'italic'
  | 'list'
  | 'orderedList'
  | 'checklist'
  | 'link'
  | 'quote'
  | 'code'
  | 'codeBlock'
  | 'divider'
  | 'table'

export type MarkdownTableAction = 'addColumn' | 'addRow' | 'removeColumn' | 'removeRow'

function isMarkdownTableRow(line: string) {
  return /^\s*\|?.+\|.+\|?\s*$/.test(line)
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function formatTableRow(cells: string[]) {
  return `| ${cells.join(' | ')} |`
}

function markdownTableAtCursor(content: string, cursor: number) {
  const lines = content.split('\n')
  let lineIndex = 0
  let offset = 0
  while (lineIndex < lines.length && offset + lines[lineIndex].length + 1 <= cursor) {
    offset += lines[lineIndex].length + 1
    lineIndex += 1
  }
  if (!isMarkdownTableRow(lines[lineIndex] ?? '')) return null

  let start = lineIndex
  let end = lineIndex
  while (start > 0 && isMarkdownTableRow(lines[start - 1])) start -= 1
  while (end < lines.length - 1 && isMarkdownTableRow(lines[end + 1])) end += 1
  if (start + 1 > end || !tableCells(lines[start + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) return null

  return { end, lineIndex, lines, start }
}

export function transformMarkdownTable(content: string, cursor: number, action: MarkdownTableAction) {
  const table = markdownTableAtCursor(content, cursor)
  if (!table) return content

  const { lines, start, end, lineIndex } = table
  const rows = lines.slice(start, end + 1).map(tableCells)
  const columnCount = rows[0].length

  if (action === 'addRow') {
    rows.push(Array.from({ length: columnCount }, () => ''))
  } else if (action === 'addColumn') {
    rows.forEach((row, index) => row.push(index === 1 ? '---' : ''))
  } else if (action === 'removeRow') {
    const rowIndex = lineIndex - start
    if (rowIndex < 2 || rows.length <= 3) return content
    rows.splice(rowIndex, 1)
  } else {
    if (columnCount <= 1) return content
    const lineStart = lines.slice(0, lineIndex).reduce((sum, line) => sum + line.length + 1, 0)
    const lineCursor = Math.max(0, cursor - lineStart)
    const pipes = [...lines[lineIndex].matchAll(/\|/g)].map((match) => match.index ?? 0)
    const columnIndex = Math.min(columnCount - 1, Math.max(0, pipes.findIndex((position) => position > lineCursor) - 1))
    rows.forEach((row) => row.splice(columnIndex, 1))
  }

  const formattedRows = rows.map(formatTableRow)
  return [...lines.slice(0, start), ...formattedRows, ...lines.slice(end + 1)].join('\n')
}

export function formatMarkdownSelection(content: string, start: number, end: number, format: MarkdownFormat) {
  const selected = content.slice(start, end) || 'texto'
  const wrappers: Record<Extract<MarkdownFormat, 'bold' | 'italic' | 'link' | 'code' | 'codeBlock'>, [string, string]> = {
    bold: ['**', '**'],
    italic: ['_', '_'],
    link: ['[', '](https://)'],
    code: ['`', '`'],
    codeBlock: ['```\n', '\n```'],
  }

  let replacement = selected
  if (format === 'heading1') replacement = `# ${selected}`
  else if (format === 'heading2') replacement = `## ${selected}`
  else if (format === 'heading3') replacement = `### ${selected}`
  else if (format === 'list') replacement = selected.split('\n').map((line) => `- ${line}`).join('\n')
  else if (format === 'orderedList') replacement = selected.split('\n').map((line, index) => `${index + 1}. ${line}`).join('\n')
  else if (format === 'checklist') replacement = selected.split('\n').map((line) => `- [ ] ${line}`).join('\n')
  else if (format === 'quote') replacement = selected.split('\n').map((line) => `> ${line}`).join('\n')
  else if (format === 'divider') replacement = '---'
  else if (format === 'table') replacement = '| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Valor 1 | Valor 2 |'
  else {
    const [before, after] = wrappers[format]
    replacement = `${before}${selected}${after}`
  }
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`
}

export function toggleChecklistAtLine(content: string, lineNumber: number) {
  const lines = content.split('\n')
  const index = lineNumber - 1
  if (index < 0 || index >= lines.length) return content
  lines[index] = lines[index].replace(/(\s*[-*+]\s+\[)( |x|X)(\])/, (_match, before, checked, after) => `${before}${checked.trim() ? ' ' : 'x'}${after}`)
  return lines.join('\n')
}

export function renderWikiLinksAsMarkdown(content: string) {
  return content.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_match, rawTarget: string, alias?: string) => {
    const target = rawTarget.trim().replace(/\\/g, '/')
    if (!target || target.includes('..')) return _match
    const normalizedPath = target.toLowerCase().endsWith('.md') ? target : `${target}.md`
    const label = (alias ?? target.split('/').at(-1) ?? target).trim()
    return `[${label}](https://mirrormind.local/note/${encodeURIComponent(normalizedPath)})`
  })
}

export function getMarkdownPreviewText(content: string, maxLength = 180) {
  const description = getMarkdownDescription(content).trim()
  const body = getMarkdownBody(content)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias?.trim() || target.split('/').at(-1)?.trim() || target)
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const preview = description || body
  return preview.length > maxLength ? `${preview.slice(0, maxLength).trimEnd()}...` : preview
}

export function extractMarkdownTags(content: string) {
  return [...new Set(Array.from(content.matchAll(/(^|[^\w])#([\p{L}\p{N}_-]+)/gu), (match) => match[2].toLowerCase()))].sort()
}
