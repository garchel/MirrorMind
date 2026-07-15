import { describe, expect, it } from 'vitest'
import { detectUnsupportedMarkdownFeatures, formatFrontmatterPropertyInput, formatMarkdownSelection, getMarkdownBody, getMarkdownDescription, getMarkdownFrontmatterProperties, getMarkdownFrontmatterPropertySource, getMarkdownPreviewText, parseFrontmatterPropertiesInput, parseObsidianCalloutSegments, removeMarkdownFrontmatterProperty, renderObsidianCalloutsAsMarkdown, renderWikiLinksAsMarkdown, replaceMarkdownBlock, replaceMarkdownBody, setMarkdownDescription, setMarkdownFrontmatterProperties, setMarkdownFrontmatterPropertySource, setMarkdownFrontmatterSource, toggleChecklistAtLine, transformMarkdownTable } from './markdown'

describe('note description frontmatter', () => {
  it('creates and reads the description property without changing the body', () => {
    const content = setMarkdownDescription('Conteudo da nota', 'Resumo da nota')

    expect(content).toContain('description: Resumo da nota')
    expect(getMarkdownDescription(content)).toBe('Resumo da nota')
    expect(getMarkdownBody(content)).toBe('Conteudo da nota')
  })

  it('preserves nested frontmatter while updating the description and body', () => {
    const content = '---\ntags:\n  - estudo\n  - portugues\nreview:\n  interval: 7\ndescription: "Antiga"\n---\n\nCorpo antigo'
    const updated = setMarkdownDescription(content, 'Nova descricao')

    expect(getMarkdownFrontmatterProperties(updated)).toMatchObject({
      tags: ['estudo', 'portugues'],
      review: { interval: 7 },
    })
    expect(getMarkdownDescription(updated)).toBe('Nova descricao')
    expect(replaceMarkdownBody(updated, 'Corpo novo')).toContain('Corpo novo')
  })

  it('does not overwrite an invalid existing frontmatter document', () => {
    const content = '---\ntags: [estudo\n---\n\nCorpo antigo'

    expect(setMarkdownDescription(content, 'Nova descricao')).toBe(content)
  })

  it('preserves spaces while the user is typing a description', () => {
    const content = setMarkdownDescription('Conteudo da nota', 'Resumo atualizado')

    expect(getMarkdownDescription(content)).toBe('Resumo atualizado')
  })

  it('updates only description without reserializing other YAML source', () => {
    const content = '---\n# comentario\ndefaults: &defaults\n  status: active\ndescription: "Antiga"\nplugin: { enabled: true }\n---\n\nCorpo'

    expect(setMarkdownDescription(content, 'Nova descricao')).toBe('---\n# comentario\ndefaults: &defaults\n  status: active\ndescription: Nova descricao\nplugin: { enabled: true }\n---\n\nCorpo')
  })

  it('safely replaces block descriptions, quoted keys, and replacement tokens', () => {
    const blockDescription = '---\n"description": |-\n  linha 1\n  linha 2\nplugin: true\n---\nCorpo'
    const updated = setMarkdownDescription(blockDescription, '$&')

    expect(updated).toBe('---\n"description": $&\nplugin: true\n---\nCorpo')
    expect(getMarkdownDescription(updated)).toBe('$&')
  })
})

describe('generic frontmatter properties', () => {
  it('validates and persists scalar, list, and nested object properties', () => {
    const parsed = parseFrontmatterPropertiesInput('source: livro\ntags:\n  - estudo\n  - portugues\nreview:\n  interval: 7\n  repetitions: 3')
    expect(parsed).toEqual({
      error: null,
      properties: {
        source: 'livro',
        tags: ['estudo', 'portugues'],
        review: { interval: 7, repetitions: 3 },
      },
    })
    expect(getMarkdownFrontmatterProperties(setMarkdownFrontmatterProperties('Corpo', parsed.properties!))).toEqual({
      source: 'livro',
      tags: ['estudo', 'portugues'],
      review: { interval: 7, repetitions: 3 },
    })
  })

  it('rejects invalid YAML and non-object frontmatter', () => {
    expect(parseFrontmatterPropertiesInput('source: livro\nsource: artigo').error).toBeTruthy()
    expect(parseFrontmatterPropertiesInput('- estudo\n- portugues').error).toContain('deve conter propriedades')
    expect(parseFrontmatterPropertiesInput('review: *missing').error).toContain('Unresolved alias')
  })

  it('preserves YAML syntax that MirrorMind does not interpret when saving a valid source', () => {
    const source = '# Mantido pelo Obsidian\ntitle: "Aula: 1"\ndefaults: &defaults\n  status: active\nreview:\n  <<: *defaults\ncustom-plugin: { enabled: true }'
    const updated = setMarkdownFrontmatterSource('---\ntitle: anterior\n---\n\nCorpo', source)

    expect(updated).toBe(`---\n${source}\n---\n\nCorpo`)
  })

  it('updates one property without changing comments, order, quotes, anchors, or line endings', () => {
    const content = '---\r\n# comentario\r\ndefaults: &defaults\r\n  status: active\r\ntitle: "Aula: 1"\r\ntags: [antiga, lista] # manter inline\r\nreview:\r\n  <<: *defaults\r\ncustom-plugin: { enabled: true }\r\n---\r\n\r\nCorpo'
    const result = setMarkdownFrontmatterPropertySource(content, 'tags', '- estudo\n- portugues')

    expect(result.error).toBeNull()
    expect(result.content).toBe('---\r\n# comentario\r\ndefaults: &defaults\r\n  status: active\r\ntitle: "Aula: 1"\r\ntags:\r\n  - estudo\r\n  - portugues\r\n  # manter inline\r\nreview:\r\n  <<: *defaults\r\ncustom-plugin: { enabled: true }\r\n---\r\n\r\nCorpo')
  })

  it('adds and removes individual properties without reserializing existing YAML', () => {
    const content = '---\nquoted: "mantida"\nplugin: { enabled: true }\n---\n\nCorpo'
    const added = setMarkdownFrontmatterPropertySource(content, 'review', 'interval: 7\nrepetitions: 3')
    const removed = removeMarkdownFrontmatterProperty(added.content, 'review')

    expect(added.error).toBeNull()
    expect(getMarkdownFrontmatterProperties(added.content).review).toEqual({ interval: 7, repetitions: 3 })
    expect(removed).toEqual({ content, error: null })
  })

  it('writes one-item block maps and sequences using valid indentation', () => {
    const content = '---\ntitle: Nota\n---\nCorpo'
    const withMap = setMarkdownFrontmatterPropertySource(content, 'review', 'interval: 7')
    const withSequence = setMarkdownFrontmatterPropertySource(withMap.content, 'tags', '- estudo')

    expect(withMap.error).toBeNull()
    expect(withSequence.error).toBeNull()
    expect(withSequence.content).toBe('---\ntitle: Nota\nreview:\n  interval: 7\ntags:\n  - estudo\n---\nCorpo')
  })

  it('accepts aliases that resolve against anchors in another property', () => {
    const content = '---\ndefaults: &defaults\n  status: active\nreview:\n  status: pending\n---\n\nCorpo'
    const result = setMarkdownFrontmatterPropertySource(content, 'review', '*defaults')

    expect(result).toEqual({
      content: '---\ndefaults: &defaults\n  status: active\nreview: *defaults\n---\n\nCorpo',
      error: null,
    })
    expect(getMarkdownFrontmatterPropertySource(result.content, 'review')).toBe('*defaults')
  })

  it('refuses to remove an anchor while another property still references it', () => {
    const content = '---\ndefaults: &defaults\n  status: active\nreview: *defaults\n---\n\nCorpo'
    const result = removeMarkdownFrontmatterProperty(content, 'defaults')

    expect(result.error).toContain('Unresolved alias')
    expect(result.content).toBe(content)
  })

  it('rejects invalid values without changing the note', () => {
    const content = '---\ntags: [estudo]\n---\n\nCorpo'
    const result = setMarkdownFrontmatterPropertySource(content, 'tags', '[estudo')

    expect(result.error).toBeTruthy()
    expect(result.content).toBe(content)
    expect(formatFrontmatterPropertyInput({ interval: 7 })).toBe('interval: 7')
  })

  it('keeps delimiters, line endings, and body spacing byte-equivalent', () => {
    const content = '---\r\ntitle: Nota\r\n---\r\nCorpo'

    expect(setMarkdownFrontmatterSource(content, 'title: Nota')).toBe(content)
    expect(setMarkdownFrontmatterPropertySource(content, 'title', 'Atualizada')).toEqual({
      content: '---\r\ntitle: Atualizada\r\n---\r\nCorpo',
      error: null,
    })
  })
})

describe('Markdown editing helpers', () => {
  it('creates a GFM table and toggles the selected checklist item', () => {
    expect(formatMarkdownSelection('', 0, 0, 'table')).toContain('| --- | --- |')
    expect(toggleChecklistAtLine('- [ ] Estudar\n- [x] Revisar', 1)).toBe('- [x] Estudar\n- [x] Revisar')
    expect(toggleChecklistAtLine('- [x] Estudar\n- [x] Revisar', 2)).toBe('- [x] Estudar\n- [ ] Revisar')
  })

  it('adds and removes rows and columns in the table at the cursor', () => {
    const table = '| Titulo | Estado |\n| --- | --- |\n| Revisar | Pendente |'
    const withRow = transformMarkdownTable(table, table.length, 'addRow')
    const withColumn = transformMarkdownTable(withRow, 4, 'addColumn')

    expect(withRow).toContain('|  |  |')
    expect(withColumn).toContain('| Titulo | Estado |  |')
    expect(transformMarkdownTable(withColumn, withColumn.indexOf('Revisar'), 'removeRow')).not.toContain('Revisar')
    expect(transformMarkdownTable(withColumn, withColumn.indexOf('Estado'), 'removeColumn')).not.toContain('Estado')
  })
})

describe('Markdown preview text', () => {
  it('prioritizes the description and removes Markdown syntax from the fallback', () => {
    expect(getMarkdownPreviewText('---\ndescription: Resumo curto\n---\n\n# Titulo\n**Texto**')).toBe('Resumo curto')
    expect(getMarkdownPreviewText('# Titulo\n\nVeja [[materias/aula|a aula]] e [guia](https://example.com).')).toBe('Titulo Veja a aula e guia.')
  })
})

describe('Obsidian Markdown preservation', () => {
  it('identifies syntax that is preserved but not fully interpreted', () => {
    expect(detectUnsupportedMarkdownFeatures('> [!warning] Aviso\n> Conteudo\n\n<div class="widget">HTML</div>\n\n```dataview\nLIST\n```\n\n<% tp.file.title %>\n\n%% privado %%')).toEqual(['html', 'plugin-block', 'plugin-inline', 'obsidian-comment'])
  })

  it('parses regular, collapsible, and nested callouts without changing source', () => {
    const source = 'Antes\n\n> [!warning]- Cuidado\n> Conteudo **importante**.\n>\n> > [!tip]+ Dica interna\n> > Texto\n\nDepois'
    const segments = parseObsidianCalloutSegments(source)

    expect(segments).toHaveLength(3)
    expect(segments[1]).toMatchObject({
      content: 'Conteudo **importante**.\n\n> [!tip]+ Dica interna\n> Texto',
      defaultCollapsed: true,
      foldable: true,
      kind: 'callout',
      title: 'Cuidado',
      type: 'warning',
    })
    expect(source).toContain('> [!warning]- Cuidado')
  })

  it('does not parse callout markers inside fenced, indented, or list code contexts', () => {
    const source = '```md\n> [!warning] Codigo\n> texto\n```\n\n    > [!tip] Indentado\n\n- item\n  > [!note] Na lista'

    expect(parseObsidianCalloutSegments(source)).toEqual([{ content: source, kind: 'markdown', startLine: 1 }])
  })

  it('does not transform wikilinks inside code or raw HTML attributes', () => {
    const source = '[[real]]\n\n```md\n[[fenced]]\n```\n\n`[[inline]]`\n\n<div data-note="[[attribute]]">[[html-body]]</div>'
    const rendered = renderWikiLinksAsMarkdown(source)

    expect(rendered).toContain('[real](https://mirrormind.local/note/real.md)')
    expect(rendered).toContain('```md\n[[fenced]]\n```')
    expect(rendered).toContain('`[[inline]]`')
    expect(rendered).toContain('<div data-note="[[attribute]]">[[html-body]]</div>')
  })

  it('uses the note resolver for note embeds', () => {
    const rendered = renderWikiLinksAsMarkdown('![[aula]]', () => 'projetos/aula.md')

    expect(rendered).toContain('/embed/projetos%2Faula.md')
  })

  it('replaces one mixed-mode block without normalizing untouched separators', () => {
    const body = 'primeiro\n\n\n<!-- preservar -->\n\n\n\n:::plugin\nvalor  \n:::\n'
    const updated = replaceMarkdownBlock(body, 0, 'primeiro editado')

    expect(updated).toBe('primeiro editado\n\n\n<!-- preservar -->\n\n\n\n:::plugin\nvalor  \n:::\n')
  })

  it('preserves the CRLF frontmatter boundary when replacing the body', () => {
    const content = '---\r\ntags: [teste]\r\n---\r\n\r\n- [ ] tarefa\r\n'
    const body = toggleChecklistAtLine(getMarkdownBody(content), 1)

    expect(replaceMarkdownBody(content, body)).toBe('---\r\ntags: [teste]\r\n---\r\n\r\n- [x] tarefa\r\n')
  })

  it('renders Obsidian callouts as standard Markdown without changing source', () => {
    const source = '> [!warning] Cuidado\n> Conteudo importante.'

    expect(renderObsidianCalloutsAsMarkdown(source)).toBe('> **Warning: Cuidado**\n> Conteudo importante.')
    expect(source).toBe('> [!warning] Cuidado\n> Conteudo importante.')
  })

  it('keeps unsupported Markdown byte-equivalent when the body is not edited', () => {
    const source = '---\naliases: [Aula]\n---\n\n> [!warning] Aviso\n> Conteudo\n\n<div class="widget">HTML</div>\n\n```custom-plugin-language\nUNKNOWN\n```\n\n:::future-extension\nvalor\n:::'

    expect(replaceMarkdownBody(source, getMarkdownBody(source))).toBe(source)
  })
})
