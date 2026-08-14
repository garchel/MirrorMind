import { describe, expect, it } from 'vitest'
import { TagIndex } from './tagIndex'

describe('TagIndex', () => {
  it('extrai as tags de cada nota e as unifica em ordem alfabetica', () => {
    const index = new TagIndex()
    index.sync([
      { relativePath: 'a.md', content: '# Titulo\n\n#revisao #quimica' },
      { relativePath: 'b.md', content: '# Outra\n\n#revisao #matematica' },
    ])
    expect(index.size).toBe(2)
    // extractMarkdownTags ja devolve as tags em ordem alfabetica (sem duplicatas).
    expect(index.tagsOf('a.md')).toEqual(['quimica', 'revisao'])
    expect(index.tagsOf('b.md')).toEqual(['matematica', 'revisao'])
    expect(index.allTags()).toEqual(['matematica', 'quimica', 'revisao'])
  })

  it('nao reextrai notas cujo conteudo nao mudou (versao por conteudo)', () => {
    const index = new TagIndex()
    index.sync([
      { relativePath: 'a.md', content: '# A\n\n#tag1' },
      { relativePath: 'b.md', content: '# B\n\n#tag2' },
    ])
    // Mesmo conteudo: nenhuma nota recalculada.
    expect(index.sync([
      { relativePath: 'a.md', content: '# A\n\n#tag1' },
      { relativePath: 'b.md', content: '# B\n\n#tag2' },
    ])).toEqual([])
    // Conteudo alterado: somente a nota afetada e recalculada.
    expect(index.sync([
      { relativePath: 'a.md', content: '# A\n\n#tag1 #tag-nova' },
      { relativePath: 'b.md', content: '# B\n\n#tag2' },
    ])).toEqual(['a.md'])
    expect(index.tagsOf('a.md')).toEqual(['tag-nova', 'tag1'])
    expect(index.tagsOf('b.md')).toEqual(['tag2'])
  })

  it('remove notas que sumiram do conjunto e devolve vazio para as ausentes', () => {
    const index = new TagIndex()
    index.sync([
      { relativePath: 'a.md', content: '# A\n\n#tag1' },
      { relativePath: 'b.md', content: '# B\n\n#tag2' },
    ])
    index.sync([{ relativePath: 'a.md', content: '# A\n\n#tag1' }])
    expect(index.size).toBe(1)
    expect(index.has('b.md')).toBe(false)
    expect(index.tagsOf('b.md')).toEqual([])
  })

  it('mantem a ordem alfabetica de allTags mesmo com conteudo alterado', () => {
    const index = new TagIndex()
    index.sync([{ relativePath: 'a.md', content: '# A\n\n#zebra #alface' }])
    index.sync([{ relativePath: 'a.md', content: '# A\n\n#banana' }])
    expect(index.allTags()).toEqual(['banana'])
  })
})
