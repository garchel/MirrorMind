import { describe, expect, it } from 'vitest'
import {
  collectColumns,
  filterRows,
  frontmatterValueToText,
  sortRows,
  type BaseRow,
} from './bases'

const rows: BaseRow[] = [
  {
    relativePath: 'Notas/quimica.md',
    name: 'quimica.md',
    properties: { area: 'Ciencia', nivel: 2, tags: ['estudo', 'prova'] },
  },
  {
    relativePath: 'Diarios/2026.md',
    name: '2026.md',
    properties: { ano: 2026, tags: ['diario'] },
  },
  {
    relativePath: 'raiz.md',
    name: 'raiz.md',
    properties: { area: 'Pessoal' },
  },
]

describe('frontmatterValueToText', () => {
  it('formata valores primitivos, listas e objetos', () => {
    expect(frontmatterValueToText('texto')).toBe('texto')
    expect(frontmatterValueToText(7)).toBe('7')
    expect(frontmatterValueToText(true)).toBe('true')
    expect(frontmatterValueToText(null)).toBe('')
    expect(frontmatterValueToText(undefined)).toBe('')
    expect(frontmatterValueToText(['a', 'b'])).toBe('a, b')
    expect(frontmatterValueToText({ intervalo: 7 })).toBe('intervalo: 7')
  })
})

describe('collectColumns', () => {
  it('coloca o nome primeiro e as propriedades na ordem de primeira aparicao', () => {
    const columns = collectColumns(rows)
    expect(columns.map((column) => column.key)).toEqual(['__name__', 'area', 'nivel', 'tags', 'ano'])
    expect(columns[0]).toMatchObject({ label: 'Nota', kind: 'name' })
  })

  it('produz somente a coluna de nome quando nao ha propriedades', () => {
    const columns = collectColumns([{ relativePath: 'a.md', name: 'a.md', properties: {} }])
    expect(columns).toHaveLength(1)
  })
})

describe('sortRows', () => {
  const columns = collectColumns(rows)
  const columnOf = (key: string) => columns.find((column) => column.key === key)!

  it('ordena por nome em ordem alfabetica (ascendente) e descendente', () => {
    const asc = sortRows(rows, columnOf('__name__'), 'asc')
    expect(asc.map((row) => row.name)).toEqual(['2026.md', 'quimica.md', 'raiz.md'])
    const desc = sortRows(rows, columnOf('__name__'), 'desc')
    expect(desc.map((row) => row.name)).toEqual(['raiz.md', 'quimica.md', '2026.md'])
  })

  it('ordena numeros numericamente e linhas sem valor ficam no fim', () => {
    const sorted = sortRows(rows, columnOf('nivel'), 'asc')
    expect(sorted.map((row) => row.name)).toEqual(['quimica.md', '2026.md', 'raiz.md'])
    // Descendente: linhas sem valor ficam primeiro (sem invertes com valores).
    const desc = sortRows(rows, columnOf('nivel'), 'desc')
    expect(desc.map((row) => row.name)).toEqual(['2026.md', 'raiz.md', 'quimica.md'])
  })
})

describe('filterRows', () => {
  it('filtra por nome, caminho e valor de propriedade (case-insensitive)', () => {
    expect(filterRows(rows, 'quimica').map((row) => row.name)).toEqual(['quimica.md'])
    expect(filterRows(rows, 'diarios').map((row) => row.name)).toEqual(['2026.md'])
    expect(filterRows(rows, 'pessoal').map((row) => row.name)).toEqual(['raiz.md'])
    expect(filterRows(rows, 'prova').map((row) => row.name)).toEqual(['quimica.md'])
  })

  it('retorna tudo com busca vazia e nada quando nao ha correspondencia', () => {
    expect(filterRows(rows, '')).toHaveLength(3)
    expect(filterRows(rows, 'inexistente')).toHaveLength(0)
  })
})
