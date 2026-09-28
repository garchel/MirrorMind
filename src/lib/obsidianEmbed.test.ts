import { describe, expect, it } from 'vitest'
import { extractObsidianEmbedFragment } from './obsidianEmbed'

const NOTE = [
  '# Aula',
  '',
  'Introducao geral.',
  '',
  '## Resumo',
  '',
  'Conteudo do resumo.',
  '',
  '```',
  '## Nao e titulo',
  '```',
  '',
  'Final ^bloco1',
].join('\n')

describe('extractObsidianEmbedFragment', () => {
  it('sem fragmento devolve o conteudo inteiro', () => {
    expect(extractObsidianEmbedFragment(NOTE, null)).toBe(NOTE)
  })

  it('resolve titulo ATX com a secao ate o proximo titulo', () => {
    // Sem proximo titulo, a secao vai ate o fim (fence pertence a ela).
    expect(extractObsidianEmbedFragment(NOTE, 'Resumo')).toBe(
      '## Resumo\n\nConteudo do resumo.\n\n```\n## Nao e titulo\n```\n\nFinal ^bloco1',
    )
  })

  it('ignora titulos dentro de fence e resolve bloco por marcador', () => {
    expect(extractObsidianEmbedFragment(NOTE, 'Nao e titulo')).toBe('')
    expect(extractObsidianEmbedFragment(NOTE, '^bloco1')).toBe('Final')
  })

  it('fragmento inexistente devolve vazio', () => {
    expect(extractObsidianEmbedFragment(NOTE, 'Inexistente')).toBe('')
  })
})
