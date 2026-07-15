import type { Completion } from '@codemirror/autocomplete'

export type MarkdownAutocompleteData = {
  attachments: string[]
  notePaths: string[]
  tags: string[]
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
    const options: Completion[] = data.notePaths
      .filter((path) => path.toLowerCase().includes(query))
      .map((path) => {
        const target = path.replace(/\.md$/i, '')
        return { label: target, detail: 'Nota', type: 'text', apply: `${target}]]` }
      })
    return options.length ? { from: position - noteMatch[1].length, options } : null
  }

  const tagMatch = beforeCursor.match(/(?:^|\s)#([\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]*)*)$/u)
  if (tagMatch) {
    const query = tagMatch[1].toLowerCase()
    const options: Completion[] = data.tags
      .filter((tag) => tag.toLowerCase().includes(query))
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
