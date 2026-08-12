import { describe, expect, it } from 'vitest'
import type { StructuralAuditEdit } from './ai'
import { applyStructuralAuditEdit } from './structuralAuditApply'

const CONTENT = 'Paragrafo antes do titulo.\n\n## Secao\n\nConteudo da secao.\n'

describe('applyStructuralAuditEdit', () => {
  it('insere um titulo antes do offset (preambulo)', () => {
    const offset = CONTENT.indexOf('Paragrafo')
    const result = applyStructuralAuditEdit(CONTENT, {
      kind: 'insertHeadingBefore',
      startUtf16: offset,
      endUtf16: null,
      insert: '## Introducao\n\n',
      ops: null,
    })
    expect(result).toBe('## Introducao\n\nParagrafo antes do titulo.\n\n## Secao\n\nConteudo da secao.\n')
  })

  it('remove o intervalo de uma linha (titulo vazio)', () => {
    const start = CONTENT.indexOf('## Secao\n\nConteudo')
    const end = start + '## Secao'.length
    const result = applyStructuralAuditEdit(CONTENT, {
      kind: 'removeLines',
      startUtf16: start,
      endUtf16: end,
      insert: null,
      ops: null,
    })
    expect(result).toBe('Paragrafo antes do titulo.\n\n\n\nConteudo da secao.\n')
  })

  it('respeita offsets UTF-16 (caracteres fora do BMP)', () => {
    const content = 'emoji 😀 meio\n'
    // 'emoji ' = 6 unidades, depois o emoji ocupa 2 unidades UTF-16 (surrogate pair)
    const result = applyStructuralAuditEdit(content, {
      kind: 'insertHeadingBefore',
      startUtf16: 6,
      endUtf16: null,
      insert: '## T\n\n',
      ops: null,
    })
    expect(result).toBe('emoji ## T\n\n😀 meio\n')
  })

  it('devolve null para offset fora do tamanho', () => {
    expect(applyStructuralAuditEdit('abc', {
      kind: 'insertHeadingBefore',
      startUtf16: 10,
      endUtf16: null,
      insert: '## X\n\n',
      ops: null,
    })).toBeNull()
  })

  it('devolve null para intervalo invertido', () => {
    expect(applyStructuralAuditEdit('abc', {
      kind: 'removeLines',
      startUtf16: 3,
      endUtf16: 1,
      insert: null,
      ops: null,
    })).toBeNull()
  })

  it('devolve null para kind desconhecido', () => {
    expect(applyStructuralAuditEdit('abc', {
      kind: 'nope' as StructuralAuditEdit['kind'],
      startUtf16: 0,
      endUtf16: null,
      insert: 'x',
      ops: null,
    })).toBeNull()
  })

  it('aplica uma divisao de secao (multi-insercao) do maior para o menor offset', () => {
    const paragraph = 'Um dois tres quatro cinco seis sete oito nove dez.'
    const content = `# Topico\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`
    const starts: number[] = []
    let from = 0
    while (starts.length < 5) {
      const index = content.indexOf(paragraph, from)
      if (index === -1) break
      starts.push(index)
      from = index + 1
    }
    const result = applyStructuralAuditEdit(content, {
      kind: 'splitSection',
      startUtf16: 0,
      endUtf16: null,
      insert: null,
      ops: [
        { startUtf16: starts[2], insert: '## Topico — parte 2\n\n' },
        { startUtf16: starts[4], insert: '## Topico — parte 3\n\n' },
      ],
    })
    expect(result).not.toBeNull()
    expect(result).toContain('## Topico — parte 2\n\n' + paragraph)
    expect(result).toContain('## Topico — parte 3\n\n' + paragraph)
    // Os titulos aparecem antes do 3o e do 5o paragrafo, na ordem certa.
    expect(result!.indexOf('## Topico — parte 2')).toBeLessThan(result!.indexOf('## Topico — parte 3'))
    expect(result!.match(/Um dois tres quatro cinco seis sete oito nove dez\./g)).toHaveLength(5)
  })

  it('devolve null para divisao sem ops ou com ops fora do tamanho', () => {
    const base = { kind: 'splitSection' as const, startUtf16: 0, endUtf16: null, insert: null }
    expect(applyStructuralAuditEdit('abc', { ...base, ops: [] })).toBeNull()
    expect(applyStructuralAuditEdit('abc', { ...base, ops: [{ startUtf16: 99, insert: '## X\n\n' }] })).toBeNull()
    expect(applyStructuralAuditEdit('abc', { ...base, ops: null })).toBeNull()
  })
})
