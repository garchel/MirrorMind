import type { Completion } from '@codemirror/autocomplete'
import { extractObsidianWikiLinks, resolveObsidianWikiLinkPath } from './markdown'

export type MarkdownAutocompleteData = {
  attachments: string[]
  notePaths: string[]
  tags: string[]
  /** Caminhos de notas conectadas a nota atual (backlinks + alvos), para ranquear sugestoes. */
  connectedNotePaths?: string[]
}

/** Deriva os dados do autocomplete a partir do estado do vault. Antes inline
 * no App: alvos do rascunho + backlinks do indice (vault, com fallback para
 * o do grafo) viram `connectedNotePaths` para ranquear sugestoes. Puro e
 * testavel sem montar nada — mesma regra, mesma ordem. */
export function resolveMarkdownAutocompleteData(input: {
  notePaths: string[]
  activeNotePath: string | null
  isNewNoteDraft: boolean
  draftContent: string
  attachments: string[]
  tags: string[]
  vaultBacklinks: Map<string, Set<string>> | null
  graphBacklinks: Map<string, Set<string>> | null
}): MarkdownAutocompleteData {
  const connectedNotePaths = new Set<string>()
  if (input.activeNotePath && !input.isNewNoteDraft) {
    for (const link of extractObsidianWikiLinks(input.draftContent)) {
      const targetPath = resolveObsidianWikiLinkPath(link.path, input.activeNotePath, input.notePaths)
      if (targetPath !== input.activeNotePath) connectedNotePaths.add(targetPath)
    }
    const backlinks = input.vaultBacklinks ?? input.graphBacklinks
    if (backlinks) {
      for (const source of backlinks.get(input.activeNotePath) ?? []) connectedNotePaths.add(source)
    }
  }
  return {
    attachments: input.attachments,
    notePaths: input.notePaths,
    tags: input.tags,
    connectedNotePaths: [...connectedNotePaths],
  }
}

export function getMarkdownAutocompleteResult(document: string, position: number, data: MarkdownAutocompleteData) {
  const beforeCursor = document.slice(Math.max(0, position - 240), position)
  const attachmentMatch = beforeCursor.match(/!\[\[([^\]\n]*)$/)
  if (attachmentMatch) {
    const query = attachmentMatch[1].toLowerCase()
    const options: Completion[] = data.attachments
      .filter((path) => path.toLowerCase().includes(query))
      .map((path) => ({ label: path, detail: 'Anexo', type: 'file', apply: `${path}]]` }))
    return options.length ? { from: position - attachmentMatch[1].length, options } : null
  }

  const noteMatch = beforeCursor.match(/\[\[([^\]\n]*)$/)
  if (noteMatch) {
    const query = noteMatch[1].toLowerCase()
    const connected = new Set(data.connectedNotePaths ?? [])
    const options: Completion[] = data.notePaths
      .filter((path) => path.toLowerCase().includes(query))
      .sort((left, right) => Number(connected.has(right)) - Number(connected.has(left)))
      .map((path) => {
        const target = path.replace(/\.md$/i, '')
        return { label: target, detail: connected.has(path) ? 'Nota conectada' : 'Nota', type: 'text', apply: `${target}]]` }
      })
    return options.length ? { from: position - noteMatch[1].length, options } : null
  }

  const tagMatch = beforeCursor.match(/(?:^|\s)#([\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]*)*)$/u)
  if (tagMatch) {
    const query = tagMatch[1].toLowerCase()
    const options: Completion[] = data.tags
      .filter((tag) => tag.toLowerCase().startsWith(query))
      .map((tag) => ({ label: tag, detail: 'Tag', type: 'keyword' }))
    return options.length ? { from: position - tagMatch[1].length, options } : null
  }

  const commandMatch = beforeCursor.match(/(?:^|\n)\s*(\/[a-z-]*)$/i)
  if (!commandMatch) return null
  const commands: Completion[] = [
    { label: '/titulo-1', detail: 'Titulo nivel 1', type: 'keyword', apply: '# ' },
    { label: '/titulo-2', detail: 'Titulo nivel 2', type: 'keyword', apply: '## ' },
    { label: '/lista', detail: 'Lista com marcadores', type: 'keyword', apply: '- ' },
    { label: '/lista-numerada', detail: 'Lista numerada', type: 'keyword', apply: '1. ' },
    { label: '/checklist', detail: 'Checklist', type: 'keyword', apply: '- [ ] ' },
    { label: '/citacao', detail: 'Citacao', type: 'keyword', apply: '> ' },
    { label: '/codigo', detail: 'Bloco de codigo', type: 'keyword', apply: '```\n\n```' },
    { label: '/tabela', detail: 'Tabela', type: 'keyword', apply: '| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Valor 1 | Valor 2 |' },
    { label: '/divisor', detail: 'Divisor horizontal', type: 'keyword', apply: '---' },
  ].filter((command) => command.label.includes(commandMatch[1].toLowerCase()))
  return commands.length ? { from: position - commandMatch[1].length, options: commands } : null
}
