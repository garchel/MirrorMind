import { describe, expect, it } from 'vitest'
import { getMarkdownBody, getMarkdownDescription, replaceMarkdownBody, setMarkdownDescription } from './markdown'

describe('note description frontmatter', () => {
  it('creates and reads the description property without changing the body', () => {
    const content = setMarkdownDescription('Conteudo da nota', 'Resumo da nota')

    expect(content).toBe('---\ndescription: "Resumo da nota"\n---\n\nConteudo da nota')
    expect(getMarkdownDescription(content)).toBe('Resumo da nota')
    expect(getMarkdownBody(content)).toBe('Conteudo da nota')
  })

  it('preserves other frontmatter properties while updating the description and body', () => {
    const content = '---\ntags: [estudo]\ndescription: "Antiga"\n---\n\nCorpo antigo'
    const updated = setMarkdownDescription(content, 'Nova descricao')

    expect(updated).toContain('tags: [estudo]')
    expect(getMarkdownDescription(updated)).toBe('Nova descricao')
    expect(replaceMarkdownBody(updated, 'Corpo novo')).toContain('Corpo novo')
  })
})
