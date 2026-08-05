import { describe, expect, it } from 'vitest'
import { extractObsidianEmbedFragment } from '../lib/obsidianEmbed'

describe('Obsidian note embeds', () => {
  it('extracts a block identified by an Obsidian block reference', () => {
    const content = '# Titulo\n\nPrimeiro paragrafo.\n\nBloco importante para revisao. ^revisao-1\n\nTexto posterior.'

    expect(extractObsidianEmbedFragment(content, '^revisao-1')).toBe('Bloco importante para revisao.')
  })

  it('associates a standalone block reference with the preceding list or table', () => {
    expect(extractObsidianEmbedFragment('- Primeiro\n- Segundo\n\n^minha-lista\n\nDepois', '^minha-lista')).toBe(
      '- Primeiro\n- Segundo',
    )
    expect(extractObsidianEmbedFragment('| A | B |\n| - | - |\n| 1 | 2 |\n\n^tabela', '^tabela')).toBe(
      '| A | B |\n| - | - |\n| 1 | 2 |',
    )
    expect(extractObsidianEmbedFragment('- Primeiro\n\n- Segundo\n\n^lista-solta', '^lista-solta')).toBe(
      '- Primeiro\n\n- Segundo',
    )
    expect(extractObsidianEmbedFragment('- Primeiro\n\n  continuacao\n\n- Segundo\n\n^lista-com-paragrafo', '^lista-com-paragrafo')).toBe(
      '- Primeiro\n\n  continuacao\n\n- Segundo',
    )
  })

  it('ignores block references declared inside code', () => {
    const content = '```md\nExemplo ^alvo\n```\n\nBloco real. ^alvo'

    expect(extractObsidianEmbedFragment(content, '^alvo')).toBe('Bloco real.')
  })

  it('extracts a heading section without treating fenced code as headings', () => {
    const content = '# Inicio\n\n## API\n\n```js\n# nao e heading\n```\n\nTexto da API.\n\n## Final\n\nFim.'

    expect(extractObsidianEmbedFragment(content, 'API')).toBe('## API\n\n```js\n# nao e heading\n```\n\nTexto da API.')
  })

  it('resolves an Obsidian subheading path instead of the first duplicate heading', () => {
    const content = '# Primeiro\n\n## Detalhes\n\nErrado.\n\n# Segundo\n\n## Detalhes\n\nCorreto.\n\n## Final\n\nFim.'

    expect(extractObsidianEmbedFragment(content, 'Segundo#Detalhes')).toBe('## Detalhes\n\nCorreto.')
  })

  it('resolves Setext headings and headings containing inline Markdown', () => {
    expect(extractObsidianEmbedFragment('**API** `v2`\n-------------\n\nConteudo\n\nFim\n---\nOutro', 'API v2')).toBe(
      '**API** `v2`\n-------------\n\nConteudo',
    )
    expect(extractObsidianEmbedFragment('   ### [Guia](https://example.com)\n\nConteudo', 'Guia')).toBe(
      '   ### [Guia](https://example.com)\n\nConteudo',
    )
    expect(extractObsidianEmbedFragment('### C\\+\\+ &amp; R\n\nConteudo', 'C++ & R')).toBe(
      '### C\\+\\+ &amp; R\n\nConteudo',
    )
    expect(extractObsidianEmbedFragment('### Caf&eacute;\n\nConteudo', 'Café')).toBe(
      '### Caf&eacute;\n\nConteudo',
    )
  })

  it('returns empty content when the requested fragment does not exist', () => {
    expect(extractObsidianEmbedFragment('# Nota\n\nConteudo', 'Ausente')).toBe('')
    expect(extractObsidianEmbedFragment('# Nota\n\nConteudo', '^ausente')).toBe('')
  })
})
