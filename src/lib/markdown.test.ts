import { describe, expect, it } from 'vitest'
import { formatMarkdownSelection, getMarkdownBody, getMarkdownDescription, getMarkdownFrontmatterProperties, getMarkdownPreviewText, parseFrontmatterPropertiesInput, replaceMarkdownBody, setMarkdownDescription, setMarkdownFrontmatterProperties, toggleChecklistAtLine, transformMarkdownTable } from './markdown'

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
