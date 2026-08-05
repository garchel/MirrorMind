function markdownCodeLineMask(lines: string[]) {
  const mask = lines.map(() => false)
  let fence: { character: string; length: number } | null = null

  lines.forEach((line, index) => {
    if (fence) {
      mask[index] = true
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/)
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null
      return
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (opening) {
      mask[index] = true
      fence = { character: opening[1][0], length: opening[1].length }
      return
    }
    if (/^(?: {4}|\t)/.test(line)) mask[index] = true
  })

  return mask
}

function normalizeHeadingText(value: string) {
  const decoded = decodeHTMLStrict(value)
  return decoded
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function extractBlockReference(lines: string[], codeLines: boolean[], marker: string) {
  const markerPattern = new RegExp(`(?:^|\\s)\\^${marker}\\s*$`)
  const markerOnlyPattern = new RegExp(`^\\s*\\^${marker}\\s*$`)
  const markerIndex = lines.findIndex((line, index) => !codeLines[index] && markerPattern.test(line))
  if (markerIndex < 0) return ''

  if (markerOnlyPattern.test(lines[markerIndex])) {
    let end = markerIndex - 1
    while (end >= 0 && !lines[end].trim()) end -= 1
    if (end < 0 || codeLines[end]) return ''
    let start = end
    const listLine = (line: string) => /^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(line)
    const tableLine = (line: string) => /^\s*\|/.test(line)
    const structuralLine = listLine(lines[end]) ? listLine : tableLine(lines[end]) ? tableLine : null
    if (structuralLine === listLine) {
      while (start > 0) {
        const previous = lines[start - 1]
        if (codeLines[start - 1]) break
        if (listLine(previous) || /^\s+\S/.test(previous) || !previous.trim()) {
          start -= 1
          continue
        }
        break
      }
    } else if (structuralLine) {
      while (start > 0) {
        const previous = lines[start - 1]
        if (codeLines[start - 1]) break
        if (structuralLine(previous) || /^\s+\S/.test(previous)) {
          start -= 1
          continue
        }
        if (!previous.trim()) {
          let beforeBlank = start - 2
          while (beforeBlank >= 0 && !lines[beforeBlank].trim()) beforeBlank -= 1
          if (beforeBlank >= 0 && !codeLines[beforeBlank] && structuralLine(lines[beforeBlank])) {
            start -= 1
            continue
          }
        }
        break
      }
    } else {
      while (start > 0 && lines[start - 1].trim() && !codeLines[start - 1]) start -= 1
    }
    return lines.slice(start, end + 1).join('\n').trim()
  }

  let start = markerIndex
  while (start > 0 && lines[start - 1].trim() && !codeLines[start - 1]) start -= 1
  let end = markerIndex + 1
  while (end < lines.length && lines[end].trim() && !codeLines[end]) end += 1
  const block = lines.slice(start, end).join('\n')
  return block.replace(markerPattern, '').trim()
}

export function extractObsidianEmbedFragment(content: string, fragment: string | null) {
  if (!fragment) return content
  const lines = content.split('\n')
  const codeLines = markdownCodeLineMask(lines)

  if (fragment.startsWith('^')) {
    const marker = fragment.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return extractBlockReference(lines, codeLines, marker)
  }

  const target = normalizeHeadingText(fragment)
  const headings: Array<{ index: number; level: number; path: string[]; title: string }> = []
  const headingHierarchy: string[] = []

  lines.forEach((line, index) => {
    if (codeLines[index]) return
    const atx = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u)
    const setext = index + 1 < lines.length && !codeLines[index + 1]
      ? lines[index + 1].match(/^ {0,3}(=+|-+)\s*$/)
      : null
    if (!atx && !setext) return

    const level = atx ? atx[1].length : setext?.[1][0] === '=' ? 1 : 2
    const title = normalizeHeadingText(atx ? atx[2] : line)
    headingHierarchy.length = level - 1
    headingHierarchy[level - 1] = title
    headings.push({ index, level, path: headingHierarchy.filter(Boolean), title })
  })

  const targetPath = target.split('#').map((segment) => segment.trim()).filter(Boolean)
  const headingIndex = headings.findIndex((heading) =>
    targetPath.length === 1
      ? heading.title === targetPath[0]
      : heading.path.length >= targetPath.length
        && heading.path.slice(-targetPath.length).every((segment, index) => segment === targetPath[index]),
  )
  if (headingIndex < 0) return ''
  const heading = headings[headingIndex]
  const nextHeading = headings.slice(headingIndex + 1).find((candidate) => candidate.level <= heading.level)
  return lines.slice(heading.index, nextHeading?.index).join('\n').trimEnd()
}
import { decodeHTMLStrict } from 'entities'
