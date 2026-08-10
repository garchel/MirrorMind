export type TextMatch = { from: number; to: number }

function escapeRegExp(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findTextMatches(text: string, query: string): TextMatch[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const regex = new RegExp(escapeRegExp(trimmed), 'gi')
  const matches: TextMatch[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length })
    if (match.index === regex.lastIndex) regex.lastIndex += 1
  }
  return matches
}
