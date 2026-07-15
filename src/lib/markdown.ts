import { isCollection, isMap, isNode, isScalar, parseDocument, stringify } from 'yaml'
import type { Node, Pair } from 'yaml'

export function splitMarkdownBlocks(content: string) {
  return getMarkdownBlockRanges(content).map((block) => block.content)
}

export type MarkdownBlockRange = {
  content: string
  end: number
  start: number
}

export function getMarkdownBlockRanges(content: string): MarkdownBlockRange[] {
  const blocks: MarkdownBlockRange[] = []
  const separatorPattern = /(?:\r?\n){2,}/g
  let start = 0
  let separator: RegExpExecArray | null

  while ((separator = separatorPattern.exec(content)) !== null) {
    const block = content.slice(start, separator.index)
    if (block.trim()) blocks.push({ content: block, end: separator.index, start })
    start = separator.index + separator[0].length
  }

  const block = content.slice(start)
  if (block.trim() || blocks.length === 0) blocks.push({ content: block, end: content.length, start })
  return blocks
}

export function replaceMarkdownBlock(content: string, blockIndex: number, replacement: string) {
  const block = getMarkdownBlockRanges(content)[blockIndex]
  if (!block) return content
  return `${content.slice(0, block.start)}${replacement}${content.slice(block.end)}`
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

  let parsed: unknown
  try {
    parsed = document.toJS()
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Frontmatter YAML invalido.',
      properties: null,
    }
  }
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

export function getMarkdownFrontmatterPropertySource(content: string, key: string) {
  const source = getMarkdownFrontmatterSource(content)
  const current = findFrontmatterPair(source, key)
  if (current.error || !current.pair || !isNode(current.pair.value) || !current.pair.value.range) return null

  const [start, end] = current.pair.value.range
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  const indentation = source.slice(lineStart, start)
  const valueSource = source.slice(start, end).trimEnd()
  if (!indentation) return valueSource
  return valueSource.split(/\r?\n/).map((line, index) => (
    index === 0 ? line : line.startsWith(indentation) ? line.slice(indentation.length) : line
  )).join('\n')
}

export function parseFrontmatterPropertiesInput(input: string) {
  return parseFrontmatterDocument(input)
}

export function formatFrontmatterPropertyInput(value: FrontmatterValue) {
  return stringify(value, { lineWidth: 0 }).trimEnd()
}

function parseFrontmatterPropertyValue(input: string) {
  const source = input.trimEnd()
  const indentedSource = (source || 'null').split(/\r?\n/).map((line) => `  ${line}`).join('\n')
  const document = parseDocument(`value:\n${indentedSource}\n`, {
    keepSourceTokens: true,
    prettyErrors: false,
    uniqueKeys: true,
  })
  if (document.errors.length > 0 || !isMap(document.contents)) {
    return { error: document.errors[0]?.message ?? 'Valor YAML invalido.', pair: null }
  }

  return { error: null, pair: document.contents.items[0] as Pair<Node, Node> }
}

function findFrontmatterPair(source: string, key: string) {
  const document = parseDocument(source, {
    keepSourceTokens: true,
    prettyErrors: false,
    uniqueKeys: true,
  })
  if (document.errors.length > 0 || !isMap(document.contents)) {
    return { document, error: document.errors[0]?.message ?? 'O frontmatter deve ser um objeto YAML.', pair: null }
  }

  const pair = document.contents.items.find((item) => (
    isScalar(item.key) && String(item.key.value) === key
  )) as Pair<Node, Node> | undefined
  return { document, error: null, pair: pair ?? null }
}

function frontmatterPairEnd(source: string, pair: Pair<Node, Node>) {
  if (isNode(pair.value) && pair.value.range) return pair.value.range[2]
  const keyEnd = isNode(pair.key) && pair.key.range ? pair.key.range[2] : 0
  const nextLine = source.indexOf('\n', keyEnd)
  return nextLine === -1 ? source.length : nextLine + 1
}

function stringifyFrontmatterKey(key: string) {
  return stringify({ [key]: null }, { lineWidth: 0 }).trimEnd().replace(/:\s*null$/, '')
}

function buildFrontmatterPairSource(
  keySource: string,
  valueSource: string,
  lineEnding: string,
  currentValue: Node | null,
  nextValue: Node,
) {
  const normalizedValue = (valueSource.trimEnd() || 'null').replace(/\r?\n/g, lineEnding)
  const currentAnchor = (isScalar(currentValue) || isCollection(currentValue)) ? currentValue.anchor : undefined
  const nextAnchor = (isScalar(nextValue) || isCollection(nextValue)) ? nextValue.anchor : undefined
  const retainedAnchor = currentAnchor && !nextAnchor ? ` &${currentAnchor}` : ''
  const currentComment = currentValue?.comment
  const retainedComment = currentComment && !nextValue.comment ? currentComment : null

  const usesBlockStyle = normalizedValue.includes(lineEnding) || (isCollection(nextValue) && !nextValue.flow)
  if (!usesBlockStyle) {
    return `${keySource}:${retainedAnchor} ${normalizedValue}${retainedComment ? ` #${retainedComment}` : ''}`
  }

  const indentedValue = normalizedValue.split(lineEnding).map((line) => `  ${line}`).join(lineEnding)
  return `${keySource}:${retainedAnchor}${lineEnding}${indentedValue}${retainedComment ? `${lineEnding}  #${retainedComment}` : ''}`
}

function validateFrontmatterSource(source: string) {
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true })
  if (document.errors.length > 0) return document.errors[0].message
  try {
    document.toJS()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Frontmatter YAML invalido.'
  }
}

export type FrontmatterPropertyMutationResult = {
  content: string
  error: string | null
}

/** Updates one top-level property without serializing unrelated YAML source. */
export function setMarkdownFrontmatterPropertySource(
  content: string,
  key: string,
  valueSource: string,
): FrontmatterPropertyMutationResult {
  const normalizedKey = key.trim()
  if (!normalizedKey) return { content, error: 'Informe o nome da propriedade.' }

  const parsedValue = parseFrontmatterPropertyValue(valueSource)
  if (parsedValue.error || !parsedValue.pair || !isNode(parsedValue.pair.value)) {
    return { content, error: parsedValue.error ?? 'Valor YAML invalido.' }
  }

  const match = frontmatterMatch(content)
  const lineEnding = match?.[1].includes('\r\n') ? '\r\n' : '\n'
  if (!match) {
    const source = buildFrontmatterPairSource(
      stringifyFrontmatterKey(normalizedKey),
      valueSource,
      lineEnding,
      null,
      parsedValue.pair.value,
    )
    const error = validateFrontmatterSource(source)
    return error
      ? { content, error }
      : { content: `---${lineEnding}${source}${lineEnding}---${lineEnding}${lineEnding}${content}`, error: null }
  }

  const source = match[2]
  const current = findFrontmatterPair(source, normalizedKey)
  if (current.error) return { content, error: current.error }

  const keySource = current.pair && isNode(current.pair.key) && current.pair.key.range
    ? source.slice(current.pair.key.range[0], current.pair.key.range[1])
    : stringifyFrontmatterKey(normalizedKey)
  const replacement = buildFrontmatterPairSource(
    keySource,
    valueSource,
    lineEnding,
    current.pair && isNode(current.pair.value) ? current.pair.value : null,
    parsedValue.pair.value,
  )
  let nextSource: string
  if (current.pair && isNode(current.pair.key) && current.pair.key.range) {
    const start = current.pair.key.range[0]
    const end = frontmatterPairEnd(source, current.pair)
    const trailingLineEnding = source.slice(start, end).endsWith(lineEnding) ? lineEnding : ''
    nextSource = `${source.slice(0, start)}${replacement}${trailingLineEnding}${source.slice(end)}`
  } else {
    nextSource = `${source}${source && !source.endsWith(lineEnding) ? lineEnding : ''}${replacement}`
  }

  const error = validateFrontmatterSource(nextSource)
  return error
    ? { content, error }
    : {
        content: `${match[1]}${nextSource}${content.slice(match[1].length + match[2].length)}`,
        error: null,
      }
}

/** Removes one top-level property while retaining every unrelated source byte. */
export function removeMarkdownFrontmatterProperty(content: string, key: string): FrontmatterPropertyMutationResult {
  const match = frontmatterMatch(content)
  if (!match) return { content, error: null }

  const source = match[2]
  const current = findFrontmatterPair(source, key)
  if (current.error) return { content, error: current.error }
  if (!current.pair || !isNode(current.pair.key) || !current.pair.key.range) return { content, error: null }

  const start = current.pair.key.range[0]
  const end = frontmatterPairEnd(source, current.pair)
  const nextSource = `${source.slice(0, start)}${source.slice(end)}`.replace(/\r?\n$/, '')
  if (!nextSource.trim()) return { content: getMarkdownBody(content), error: null }

  const error = validateFrontmatterSource(nextSource)
  if (error) return { content, error }

  return {
    content: `${match[1]}${nextSource}${content.slice(match[1].length + match[2].length)}`,
    error: null,
  }
}

export function setMarkdownFrontmatterProperties(content: string, properties: FrontmatterProperties) {
  const body = getMarkdownBody(content)
  const frontmatter = stringify(properties, { lineWidth: 0 }).trimEnd()
  return frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body
}

/**
 * Replaces frontmatter only after validation, retaining the user's YAML source.
 * This avoids rewriting comments, key order, quoting, anchors, and unsupported fields.
 */
export function setMarkdownFrontmatterSource(content: string, source: string) {
  const parsed = parseFrontmatterDocument(source)
  if (parsed.error || !parsed.properties) return content

  const frontmatter = source.trimEnd()
  const match = frontmatterMatch(content)
  if (!frontmatter) return match ? getMarkdownBody(content) : content
  if (!match) return `---\n${frontmatter}\n---\n\n${content}`
  return `${match[1]}${frontmatter}${content.slice(match[1].length + match[2].length)}`
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
  const result = hasDescription
    ? setMarkdownFrontmatterPropertySource(content, 'description', formatFrontmatterPropertyInput(description))
    : removeMarkdownFrontmatterProperty(content, 'description')
  return result.error ? content : result.content
}

export function replaceMarkdownBody(content: string, body: string) {
  const match = frontmatterMatch(content)
  if (!match) return body
  const afterFrontmatter = content.slice(match[0].length)
  const additionalSeparator = afterFrontmatter.match(/^\r?\n/)?.[0].length ?? 0
  const bodyStart = match[0].length + additionalSeparator
  return `${content.slice(0, bodyStart)}${body}`
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

export type ObsidianWikiLink = {
  alias: string
  fragment: string | null
  path: string
}

function compareUnicodeCodePoints(left: string, right: string) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]
  }
  return leftPoints.length - rightPoints.length
}

type ObsidianEmbed = {
  label: string
  fragment: string | null
  path: string
  isNote: boolean
}

export function parseObsidianWikiLink(rawLink: string): ObsidianWikiLink | null {
  const aliasSeparator = rawLink.indexOf('|')
  const targetAndFragment = aliasSeparator >= 0 ? rawLink.slice(0, aliasSeparator) : rawLink
  const rawAlias = aliasSeparator >= 0 ? rawLink.slice(aliasSeparator + 1) : ''
  const fragmentSeparator = targetAndFragment.indexOf('#')
  const rawPath = fragmentSeparator >= 0 ? targetAndFragment.slice(0, fragmentSeparator) : targetAndFragment
  const rawFragment = fragmentSeparator >= 0 ? targetAndFragment.slice(fragmentSeparator + 1) : ''
  const normalizedPath = rawPath.trim().replace(/\\/g, '/')
  const fragment = rawFragment.trim()
  if ((!normalizedPath && !fragment) || normalizedPath.includes('..') || normalizedPath.startsWith('/')) return null

  const path = !normalizedPath
    ? ''
    : normalizedPath.toLowerCase().endsWith('.md')
    ? normalizedPath
    : `${normalizedPath}.md`
  const fallbackAlias = normalizedPath
    ? (normalizedPath.split('/').at(-1)?.replace(/\.md$/i, '') ?? normalizedPath)
    : fragment

  return {
    alias: rawAlias.trim() || fallbackAlias,
    fragment: fragment || null,
    path,
  }
}

export function resolveObsidianWikiLinkPath(linkPath: string, sourcePath: string, availablePaths: string[]) {
  const normalize = (path: string) => path.replace(/\\/g, '/').toLowerCase()
  const normalizedLink = normalize(linkPath)
  const normalizedPaths = availablePaths.map((path) => ({ normalized: normalize(path), path }))
  const normalizedSource = normalize(sourcePath)
  if (!normalizedLink) return normalizedPaths.find(({ normalized }) => normalized === normalizedSource)?.path ?? sourcePath

  const sourceFolder = normalizedSource.split('/').slice(0, -1).join('/')
  const relativeCandidate = sourceFolder ? `${sourceFolder}/${normalizedLink}` : normalizedLink
  const exactRootMatch = normalizedPaths.find(({ normalized }) => normalized === normalizedLink)?.path

  if (normalizedLink.includes('/')) return exactRootMatch ?? linkPath

  return normalizedPaths.find(({ normalized }) => normalized === relativeCandidate)?.path
    ?? exactRootMatch
    ?? normalizedPaths
      .filter(({ normalized }) => normalized.split('/').at(-1) === normalizedLink.split('/').at(-1))
      .sort((left, right) => {
        const sourceSegments = sourceFolder.split('/')
        const sharedSegments = (path: string) => {
          const pathSegments = path.split('/')
          let count = 0
          while (count < sourceSegments.length && pathSegments[count] === sourceSegments[count]) count += 1
          return count
        }
        return sharedSegments(right.normalized) - sharedSegments(left.normalized) || compareUnicodeCodePoints(left.path, right.path)
      })[0]?.path
    ?? linkPath
}

export function resolveObsidianAttachmentPath(embedPath: string, sourcePath: string, attachmentPaths: string[]) {
  const normalize = (path: string) => path.replace(/\\/g, '/').normalize('NFC').toLowerCase()
  const normalizedEmbed = normalize(embedPath)
  const sourceSegments = normalize(sourcePath).split('/').slice(0, -1)
  const normalizedRelativePath = (() => {
    if (!normalizedEmbed.startsWith('./') && !normalizedEmbed.startsWith('../')) return null
    const segments = [...sourceSegments]
    for (const segment of normalizedEmbed.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        if (segments.length === 0) return null
        segments.pop()
      } else {
        segments.push(segment)
      }
    }
    return segments.join('/')
  })()
  if ((normalizedEmbed.startsWith('./') || normalizedEmbed.startsWith('../')) && !normalizedRelativePath) {
    return embedPath
  }

  const normalizedTarget = normalizedRelativePath ?? normalizedEmbed
  const exactMatch = attachmentPaths.find((path) => normalize(path) === normalizedTarget)
  if (normalizedRelativePath) return exactMatch ?? embedPath
  if (normalizedEmbed.includes('/')) return exactMatch ?? embedPath

  return exactMatch ?? attachmentPaths
      .filter((path) => normalize(path).split('/').at(-1) === normalizedTarget.split('/').at(-1))
      .sort((left, right) => {
        const distanceFromSource = (path: string) => {
          const pathSegments = normalize(path).split('/').slice(0, -1)
          let shared = 0
          while (shared < sourceSegments.length && pathSegments[shared] === sourceSegments[shared]) shared += 1
          return sourceSegments.length - shared + pathSegments.length - shared
        }
        return distanceFromSource(left) - distanceFromSource(right) || compareUnicodeCodePoints(left, right)
      })[0]
    ?? embedPath
}

export function renderWikiLinksAsMarkdown(
  content: string,
  resolvePath?: (path: string) => string,
  resolveAttachmentPath?: (path: string) => string,
) {
  return transformMarkdownTextRegions(content, (text) => {
    const withEmbeds = text.replace(/!\[\[([^\]]+)\]\]/g, (match, rawEmbed: string) => {
      const embed = parseObsidianEmbed(rawEmbed)
      if (!embed) return match
      const prefix = embed.isNote ? 'embed' : 'asset'
      const fragment = embed.fragment ? `?fragment=${encodeURIComponent(embed.fragment)}` : ''
      const resolvedPath = embed.isNote
        ? (resolvePath?.(embed.path) ?? embed.path)
        : (resolveAttachmentPath?.(embed.path) ?? embed.path)
      return `![${embed.label}](https://mirrormind.local/${prefix}/${encodeURIComponent(resolvedPath)}${fragment})`
    })

    return withEmbeds.replace(/\[\[([^\]]+)\]\]/g, (match, rawLink: string) => {
      const link = parseObsidianWikiLink(rawLink)
      if (!link) return match
      const fragment = link.fragment ? `?fragment=${encodeURIComponent(link.fragment)}` : ''
      return `[${link.alias}](https://mirrormind.local/note/${encodeURIComponent(resolvePath?.(link.path) ?? link.path)}${fragment})`
    })
  })
}

export function extractObsidianWikiLinks(content: string) {
  const links: ObsidianWikiLink[] = []
  transformMarkdownTextRegions(content, (text) => {
    for (const match of text.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
      if (match[1]) {
        const embed = parseObsidianEmbed(match[2])
        if (embed?.isNote) links.push({ alias: embed.label, fragment: embed.fragment, path: embed.path })
      } else {
        const link = parseObsidianWikiLink(match[2])
        if (link) links.push(link)
      }
    }
    return text
  })
  return links
}

function transformMarkdownTextRegions(content: string, transform: (text: string) => string) {
  const lines = content.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? []
  let fence: { character: string; length: number } | null = null
  let htmlBlock: string | null = null

  return lines.map((line) => {
    const text = line.replace(/\r?\n$/, '')
    const ending = line.slice(text.length)
    if (fence) {
      const closing = text.match(/^ {0,3}(`+|~+)\s*$/)
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null
      return line
    }

    const opening = text.match(/^ {0,3}(`{3,}|~{3,})/)
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length }
      return line
    }
    if (/^(?: {4}|\t)/.test(text)) return line

    if (htmlBlock) {
      if (new RegExp(`</${htmlBlock}\\s*>`, 'i').test(text) || (htmlBlock === '!--' && text.includes('-->'))) htmlBlock = null
      return line
    }
    const htmlOpening = text.match(/^\s*<(address|article|aside|blockquote|details|dialog|div|fieldset|figure|footer|form|header|main|nav|ol|pre|script|section|style|table|textarea|ul)\b/i)
    if (htmlOpening) {
      if (!new RegExp(`</${htmlOpening[1]}\\s*>`, 'i').test(text)) htmlBlock = htmlOpening[1]
      return line
    }
    if (/^\s*<!--/.test(text) && !text.includes('-->')) {
      htmlBlock = '!--'
      return line
    }

    const protectedParts: string[] = []
    const protect = (value: string) => {
      const token = `\uE000MIRMIND${protectedParts.length}\uE001`
      protectedParts.push(value)
      return token
    }
    const protectedText = text
      .replace(/(\\+)(!?\[\[[^\]\n]+\]\])/g, (match, slashes: string) => (
        slashes.length % 2 === 1 ? protect(match) : match
      ))
      .replace(/(`+)([^`]|`(?!\1))*?\1/g, protect)
      .replace(/<!--.*?-->|<[^>]*>/g, protect)
    const transformed = transform(protectedText).replace(/\uE000MIRMIND(\d+)\uE001/g, (_match, index: string) => protectedParts[Number(index)] ?? '')
    return `${transformed}${ending}`
  }).join('')
}

function parseObsidianEmbed(rawEmbed: string): ObsidianEmbed | null {
  const labelSeparator = rawEmbed.indexOf('|')
  const targetAndFragment = labelSeparator >= 0 ? rawEmbed.slice(0, labelSeparator) : rawEmbed
  const rawLabel = labelSeparator >= 0 ? rawEmbed.slice(labelSeparator + 1) : ''
  const fragmentSeparator = targetAndFragment.indexOf('#')
  const rawPath = fragmentSeparator >= 0 ? targetAndFragment.slice(0, fragmentSeparator) : targetAndFragment
  const rawFragment = fragmentSeparator >= 0 ? targetAndFragment.slice(fragmentSeparator + 1) : ''
  const path = rawPath.trim().replace(/\\/g, '/')
  const fragment = rawFragment.trim()
  if ((!path && !fragment) || path.startsWith('/')) return null

  const isNote = !path || !/\.[^/]+$/u.test(path) || path.toLowerCase().endsWith('.md')
  const normalizedPath = !path ? '' : isNote && !path.toLowerCase().endsWith('.md') ? `${path}.md` : path
  return {
    label: rawLabel.trim() || path.split('/').at(-1)?.replace(/\.md$/i, '') || fragment,
    fragment: fragment || null,
    path: normalizedPath,
    isNote,
  }
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

export function normalizeMarkdownTag(value: string) {
  const tag = value.trim().replace(/^#/, '').normalize('NFC')
  if (!tag || tag.startsWith('/') || tag.endsWith('/') || tag.includes('//')) return null
  if ([...tag].length > 128 || !/^[\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]+)*$/u.test(tag)) return null
  return tag.toLowerCase()
}

function collectFrontmatterTags(value: FrontmatterValue | undefined, tags: Set<string>) {
  if (typeof value === 'string') {
    for (const candidate of value.split(',')) {
      const tag = normalizeMarkdownTag(candidate)
      if (tag) tags.add(tag)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFrontmatterTags(item, tags)
  }
}

export function extractMarkdownTags(content: string) {
  const tagDocument = content.startsWith('\uFEFF') ? content.slice(1) : content
  const tags = new Set<string>()
  let inObsidianComment = false
  transformMarkdownTextRegions(getMarkdownBody(tagDocument), (text) => {
    const characters = Array.from(text)
    const visibleCharacters: string[] = []
    for (let index = 0; index < characters.length; index += 1) {
      if (characters[index] === '%' && characters[index + 1] === '%') {
        inObsidianComment = !inObsidianComment
        index += 1
      } else if (!inObsidianComment) {
        visibleCharacters.push(characters[index])
      }
    }

    for (let index = 0; index < visibleCharacters.length; index += 1) {
      if (visibleCharacters[index] !== '#') continue
      const previous = visibleCharacters[index - 1]
      if (previous && (/^[\p{L}\p{M}\p{N}_#]$/u.test(previous) || previous === '/' || previous === '\\')) continue
      let end = index + 1
      while (end < visibleCharacters.length && /^[\p{L}\p{M}\p{N}_/-]$/u.test(visibleCharacters[end])) end += 1
      const tag = normalizeMarkdownTag(visibleCharacters.slice(index + 1, end).join(''))
      if (tag) tags.add(tag)
      index = end - 1
    }
    return text
  })
  collectFrontmatterTags(getMarkdownFrontmatterProperties(tagDocument)?.tags, tags)
  return [...tags].sort()
}

export type ObsidianCalloutSegment = {
  content: string
  startLine: number
} & (
  | { kind: 'markdown' }
  | {
      defaultCollapsed: boolean
      foldable: boolean
      kind: 'callout'
      title: string
      type: string
    }
)

export function parseObsidianCalloutSegments(content: string): ObsidianCalloutSegment[] {
  const lines = content.split('\n')
  const segments: ObsidianCalloutSegment[] = []
  let markdownStart = 0
  let index = 0
  let fence: { character: string; length: number } | null = null

  const pushMarkdown = (end: number) => {
    if (end <= markdownStart) return
    const markdown = lines.slice(markdownStart, end).join('\n')
    if (markdown) segments.push({ content: markdown, kind: 'markdown', startLine: markdownStart + 1 })
  }

  while (index < lines.length) {
    const currentLine = lines[index]
    if (fence) {
      const closing = currentLine.match(/^ {0,3}(`+|~+)\s*$/)
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null
      index += 1
      continue
    }
    const opening = currentLine.match(/^ {0,3}(`{3,}|~{3,})/)
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length }
      index += 1
      continue
    }

    const header = currentLine.match(/^>\s*\[!([^\]\s]+)\]([+-])?\s*(.*)$/u)
    if (!header) {
      index += 1
      continue
    }

    pushMarkdown(index)
    const contentLines: string[] = []
    const startLine = index + 2
    index += 1
    while (index < lines.length) {
      const quotedLine = lines[index].match(/^\s*> ?(.*)$/u)
      if (!quotedLine) break
      contentLines.push(quotedLine[1])
      index += 1
    }

    segments.push({
      content: contentLines.join('\n'),
      defaultCollapsed: header[2] === '-',
      foldable: Boolean(header[2]),
      kind: 'callout',
      startLine,
      title: header[3].trim(),
      type: header[1].toLowerCase(),
    })
    markdownStart = index
  }

  pushMarkdown(lines.length)
  return segments.length > 0 ? segments : [{ content, kind: 'markdown', startLine: 1 }]
}

export function detectUnsupportedMarkdownFeatures(content: string) {
  const features: string[] = []
  if (/<\/?[a-z][^>]*>/iu.test(content)) features.push('html')
  if (/^```(?:dataview(?:js)?|tasks|query|ad-[\w-]+|button|meta-bind|tracker|calendar)\b/imu.test(content)) features.push('plugin-block')
  if (/<%[\s\S]*?%>/u.test(content) || /^\s*\$?=\s+.+$/mu.test(content)) features.push('plugin-inline')
  if (/%%[\s\S]*?%%/u.test(content)) features.push('obsidian-comment')
  return features
}

export function renderObsidianCalloutsAsMarkdown(content: string) {
  return content.replace(/^>\s*\[!([\w-]+)\]\s*(.*)$/gim, (_match, type: string, title: string) => {
    const label = `${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()}`
    return `> **${label}${title.trim() ? `: ${title.trim()}` : ''}**`
  })
}
