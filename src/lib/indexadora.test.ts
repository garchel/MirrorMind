import { describe, expect, it } from 'vitest'
import {
  INDEXADORA_MARKER,
  isIndexadora,
  removeIndexadoraSection,
  setIndexadoraFlag,
  syncIndexadoraSection,
} from './indexadora'

const WITH_FLAG = '---\ntags:\n  - estudo\nindexadora: true\n---\n# Nota A\nConteudo.\n'
const WITHOUT_FLAG = '---\ntags:\n  - estudo\nindexadora: false\n---\n# Nota A\nConteudo.\n'
const NO_FRONTMATTER = '# Nota A\nConteudo.\n'

describe('isIndexadora', () => {
  it('reconhece a flag true no frontmatter', () => {
    expect(isIndexadora(WITH_FLAG)).toBe(true)
  })

  it('e falsa com flag false, sem flag ou sem frontmatter', () => {
    expect(isIndexadora(WITHOUT_FLAG)).toBe(false)
    expect(isIndexadora('# Nota A\n')).toBe(false)
    expect(isIndexadora(NO_FRONTMATTER)).toBe(false)
  })
})

describe('setIndexadoraFlag', () => {
  it('adiciona a propriedade quando nao existe frontmatter', () => {
    const result = setIndexadoraFlag(NO_FRONTMATTER, true)
    expect(isIndexadora(result)).toBe(true)
    expect(result).toContain('# Nota A')
  })

  it('alterna a propriedade existente sem tocar nas demais', () => {
    expect(isIndexadora(setIndexadoraFlag(WITHOUT_FLAG, true))).toBe(true)
    expect(setIndexadoraFlag(WITHOUT_FLAG, true)).toContain('tags:\n  - estudo')
    expect(isIndexadora(setIndexadoraFlag(WITH_FLAG, false))).toBe(false)
  })
})

describe('syncIndexadoraSection', () => {
  it('anexa um link por linha, ordenados por caminho', () => {
    const result = syncIndexadoraSection(NO_FRONTMATTER, ['z.md', 'a.md', 'b.md'])
    expect(result).toContain('## Índice')
    expect(result).toContain(INDEXADORA_MARKER)
    expect(result).toContain('[[a]]\n[[b]]\n[[z]]')
    // O conteudo original permanece no inicio.
    expect(result.startsWith('# Nota A\nConteudo.\n')).toBe(true)
  })

  it('usa o caminho relativo sem extensao no link', () => {
    const result = syncIndexadoraSection(NO_FRONTMATTER, ['subpasta/Nota B.md'])
    expect(result).toContain('[[subpasta/Nota B]]')
  })

  it('e idempotente: aplicar duas vezes com os mesmos links nao duplica', () => {
    const once = syncIndexadoraSection(NO_FRONTMATTER, ['a.md', 'b.md'])
    const twice = syncIndexadoraSection(once, ['a.md', 'b.md'])
    expect(twice).toBe(once)
  })

  it('atualiza a secao quando os backlinks mudam (adiciona e remove)', () => {
    const initial = syncIndexadoraSection(NO_FRONTMATTER, ['a.md', 'b.md'])
    const updated = syncIndexadoraSection(initial, ['b.md', 'c.md'])
    expect(updated).toContain('[[b]]\n[[c]]')
    expect(updated).not.toContain('[[a]]')
    // Apenas uma secao, sem duplicacao de cabecalho.
    expect(updated.match(/## Índice/g)).toHaveLength(1)
  })

  it('remove a secao quando nao ha mais backlinks', () => {
    const initial = syncIndexadoraSection(NO_FRONTMATTER, ['a.md'])
    const removed = syncIndexadoraSection(initial, [])
    expect(removed).not.toContain(INDEXADORA_MARKER)
    expect(removed).not.toContain('## Índice')
    expect(removed).toContain('Conteudo.')
  })

  it('preserva conteudo do usuario escrito depois da secao', () => {
    const withTail = `${syncIndexadoraSection(NO_FRONTMATTER, ['a.md'])}\nAnotacao final do usuario.\n`
    const result = removeIndexadoraSection(withTail)
    expect(result).not.toContain(INDEXADORA_MARKER)
    expect(result).toContain('Anotacao final do usuario.')
  })

  it('nao toca em um cabecalho "## Índice" do usuario sem o marcador', () => {
    const userSection = '# Nota A\n\n## Índice\n- item manual\n'
    expect(removeIndexadoraSection(userSection)).toBe(userSection)
    expect(syncIndexadoraSection(userSection, ['a.md'])).toContain('- item manual')
  })
})

describe('removeIndexadoraSection', () => {
  it('nao altera conteudo sem marcador', () => {
    expect(removeIndexadoraSection(NO_FRONTMATTER)).toBe(NO_FRONTMATTER)
  })

  it('remove a secao completa deixando o restante limpo', () => {
    const withSection = syncIndexadoraSection(NO_FRONTMATTER, ['a.md', 'b.md'])
    const result = removeIndexadoraSection(withSection)
    expect(result).toBe(NO_FRONTMATTER)
    expect(result.endsWith('\n')).toBe(true)
  })
})
