export function splitMarkdownBlocks(content: string) {
  return content.split(/\n{2,}/).filter((block) => block.trim())
}

const FRONTMATTER_PATTERN = /^(---\r?\n)([\s\S]*?)(\r?\n---)(?:\r?\n)?/

function frontmatterMatch(content: string) {
  return content.match(FRONTMATTER_PATTERN)
}

function parseFrontmatterValue(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed
    }
  }
  return trimmed
}

export function getMarkdownDescription(content: string) {
  const match = frontmatterMatch(content)
  if (!match) return ''
  const description = match[2].match(/^description:\s*(.*)$/mi)
  return description ? parseFrontmatterValue(description[1]) : ''
}

export function getMarkdownBody(content: string) {
  const match = frontmatterMatch(content)
  return match ? content.slice(match[0].length).replace(/^\r?\n/, '') : content
}

export function setMarkdownDescription(content: string, description: string) {
  const normalizedDescription = description.trim()
  const match = frontmatterMatch(content)

  if (!match) {
    return normalizedDescription
      ? `---\ndescription: ${JSON.stringify(normalizedDescription)}\n---\n\n${content}`
      : content
  }

  const frontmatterLines = match[2].split(/\r?\n/)
  const descriptionIndex = frontmatterLines.findIndex((line) => /^description:\s*/i.test(line))
  if (descriptionIndex >= 0) {
    if (normalizedDescription) frontmatterLines[descriptionIndex] = `description: ${JSON.stringify(normalizedDescription)}`
    else frontmatterLines.splice(descriptionIndex, 1)
  } else if (normalizedDescription) {
    frontmatterLines.push(`description: ${JSON.stringify(normalizedDescription)}`)
  }

  const nextFrontmatter = frontmatterLines.length
    ? `---\n${frontmatterLines.join('\n')}\n---\n\n`
    : ''
  return `${nextFrontmatter}${content.slice(match[0].length)}`
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
  else {
    const [before, after] = wrappers[format]
    replacement = `${before}${selected}${after}`
  }
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`
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

export function extractMarkdownTags(content: string) {
  return [...new Set(Array.from(content.matchAll(/(^|[^\w])#([\p{L}\p{N}_-]+)/gu), (match) => match[2].toLowerCase()))].sort()
}
