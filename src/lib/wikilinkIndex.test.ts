import { describe, expect, it } from 'vitest'
import {
  applyWikilinkEdit,
  buildWikilinkIndex,
  countWikilinkEdges,
  getWikilinkBacklinks,
  getWikilinkTargets,
  removeWikilinkEntry,
} from './wikilinkIndex'

describe('buildWikilinkIndex', () => {
  it('resolve wikilinks relativos e por basename', () => {
    const snapshot = buildWikilinkIndex([
      { relativePath: 'notas/a.md', content: 'Veja [[b]] e [[notas/c]] e [[d]].' },
      { relativePath: 'notas/b.md', content: 'Sem links.' },
      { relativePath: 'notas/c.md', content: 'Volta para [[a]].' },
    ])

    expect(getWikilinkTargets(snapshot, 'notas/a.md').sort()).toEqual(['notas/b.md', 'notas/c.md'])
    expect(getWikilinkTargets(snapshot, 'notas/c.md')).toEqual(['notas/a.md'])
    expect(getWikilinkTargets(snapshot, 'notas/b.md')).toEqual([])
  })

  it('ignora embeds de anexos e links quebrados no grafo', () => {
    const snapshot = buildWikilinkIndex([
      { relativePath: 'a.md', content: '![[imagem.png]] e [[b]] e [[nao-existe]].' },
      { relativePath: 'b.md', content: '' },
    ])
    // So links para notas existentes aparecem como alvos validos.
    expect(getWikilinkTargets(snapshot, 'a.md')).toEqual(['b.md'])
  })

  it('computa backlinks invertidos', () => {
    const snapshot = buildWikilinkIndex([
      { relativePath: 'a.md', content: '[[b]]' },
      { relativePath: 'b.md', content: '' },
      { relativePath: 'c.md', content: '[[b]] e [[a]]' },
    ])
    expect(getWikilinkBacklinks(snapshot, 'b.md')).toEqual(['a.md', 'c.md'])
    expect(getWikilinkBacklinks(snapshot, 'a.md')).toEqual(['c.md'])
    expect(getWikilinkBacklinks(snapshot, 'c.md')).toEqual([])
  })

  it('conta as arestas do grafo', () => {
    const snapshot = buildWikilinkIndex([
      { relativePath: 'a.md', content: '[[b]]' },
      { relativePath: 'b.md', content: '[[a]] [[c]]' },
      { relativePath: 'c.md', content: '' },
    ])
    expect(countWikilinkEdges(snapshot)).toBe(3)
  })
})

describe('edicao incremental', () => {
  it('recalcula somente a nota alterada (entradas nao tocadas preservam identidade)', () => {
    const initial = buildWikilinkIndex([
      { relativePath: 'a.md', content: '[[b]]' },
      { relativePath: 'b.md', content: '[[c]]' },
      { relativePath: 'c.md', content: '' },
    ])
    const updated = applyWikilinkEdit(initial, 'a.md', 'Agora aponta para [[c]]')
    expect(updated.entries.get('a.md')).not.toBe(initial.entries.get('a.md')) // so a editada mudou
    expect(updated.entries.get('b.md')).toBe(initial.entries.get('b.md'))
    expect(updated.entries.get('c.md')).toBe(initial.entries.get('c.md'))
    expect(getWikilinkTargets(updated, 'a.md')).toEqual(['c.md'])
    expect(getWikilinkBacklinks(updated, 'c.md')).toEqual(['a.md', 'b.md'])
    expect(getWikilinkBacklinks(updated, 'b.md')).toEqual([])
  })

  it('edicao com conteudo identico nao recalcula (no-op)', () => {
    const initial = buildWikilinkIndex([{ relativePath: 'a.md', content: '[[b]]' }, { relativePath: 'b.md', content: '' }])
    const updated = applyWikilinkEdit(initial, 'a.md', '[[b]]')
    expect(updated).toBe(initial)
  })

  it('remove nota e atualiza backlinks', () => {
    const initial = buildWikilinkIndex([
      { relativePath: 'a.md', content: '[[b]]' },
      { relativePath: 'b.md', content: '' },
    ])
    const updated = removeWikilinkEntry(initial, 'a.md')
    expect(getWikilinkBacklinks(updated, 'b.md')).toEqual([])
    expect(updated.entries.has('a.md')).toBe(false)
  })
})

describe('desempenho', () => {
  it('constroi o indice de milhares de notas rapidamente', () => {
    const notes = Array.from({ length: 3_000 }, (_, index) => ({
      relativePath: `notas/nota-${index}.md`,
      content: `Conteudo [[nota-${(index + 1) % 3_000}]] e [[nota-${(index + 7) % 3_000}]].`,
    }))
    const started = performance.now()
    const snapshot = buildWikilinkIndex(notes)
    const elapsed = performance.now() - started
    expect(snapshot.entries.size).toBe(3_000)
    expect(countWikilinkEdges(snapshot)).toBe(6_000)
    expect(elapsed).toBeLessThan(5_000)
  })
})
