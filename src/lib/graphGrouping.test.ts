import { describe, expect, it } from 'vitest'
import {
  buildFolderGroups,
  buildFolderMaps,
  buildGraph2dGroupCenters,
  buildGraphGroups,
  buildGroupMaps,
  folderColor,
  folderGroupLabel,
  folderOf,
  GRAPH_FOLDER_PALETTE,
  primaryTagFor,
  tagGroupLabel,
} from './graphGrouping'

describe('folderOf', () => {
  it('retorna a pasta pai relativa ao vault (vazio para a raiz)', () => {
    expect(folderOf('Notas/Quimica.md')).toBe('Notas')
    expect(folderOf('a/b/c.md')).toBe('a/b')
    expect(folderOf('raiz.md')).toBe('')
    expect(folderOf('/absoluto.md')).toBe('')
  })
})

describe('folderGroupLabel', () => {
  it('rotula a raiz como "Raiz" e as pastas pelo proprio caminho', () => {
    expect(folderGroupLabel('')).toBe('Raiz')
    expect(folderGroupLabel('Notas')).toBe('Notas')
  })
})

describe('folderColor', () => {
  it('e deterministico e ciclico sobre a paleta', () => {
    expect(folderColor(0)).toBe(GRAPH_FOLDER_PALETTE[0])
    expect(folderColor(3)).toBe(GRAPH_FOLDER_PALETTE[3])
    expect(folderColor(GRAPH_FOLDER_PALETTE.length)).toBe(GRAPH_FOLDER_PALETTE[0])
  })
})

describe('buildFolderGroups', () => {
  const nodes = [
    { relativePath: 'raiz.md' },
    { relativePath: 'Notas/Quimica.md' },
    { relativePath: 'Notas/Fisica.md' },
    { relativePath: 'Diarios/2026.md' },
  ]

  it('agrupa por pasta em ordem deterministica (raiz primeiro, depois alfabetica)', () => {
    const groups = buildFolderGroups(nodes)
    expect(groups.map((group) => group.folder)).toEqual(['', 'Diarios', 'Notas'])
    expect(groups[0].paths).toEqual(['raiz.md'])
    expect(groups[2].paths).toEqual(['Notas/Quimica.md', 'Notas/Fisica.md'])
  })

  it('usa a mesma cor para a mesma pasta em chamadas diferentes (estavel)', () => {
    const first = buildFolderGroups(nodes)
    const second = buildFolderGroups(nodes)
    expect(first[2].color).toBe(second[2].color)
    expect(first[2].color).toBe(GRAPH_FOLDER_PALETTE[2])
  })

  it('rotula a raiz como "Raiz" e mantem a contagem de nos por grupo', () => {
    const groups = buildFolderGroups(nodes)
    expect(groups[0].label).toBe('Raiz')
    expect(groups[0].paths.length).toBe(1)
    expect(groups[2].paths.length).toBe(2)
  })
})

describe('buildFolderMaps', () => {
  it('produz pasta por caminho e cor por pasta consistentes com os grupos', () => {
    const nodes = [
      { relativePath: 'raiz.md' },
      { relativePath: 'Notas/Quimica.md' },
    ]
    const { groups, folderByPath, folderColorByPath } = buildFolderMaps(nodes)
    expect(folderByPath['raiz.md']).toBe('')
    expect(folderByPath['Notas/Quimica.md']).toBe('Notas')
    expect(folderColorByPath['Notas']).toBe(groups[1].color)
    expect(folderColorByPath['']).toBe(groups[0].color)
  })
})

describe('buildGraph2dGroupCenters', () => {
  it('distribui os grupos em um anel e associa cada no ao centro do proprio grupo', () => {
    const nodes = [
      { relativePath: 'raiz.md' },
      { relativePath: 'Notas/Quimica.md' },
      { relativePath: 'Notas/Fisica.md' },
      { relativePath: 'Diarios/2026.md' },
    ]
    const centers = buildGraph2dGroupCenters(nodes)
    expect(centers.get('raiz.md')).toEqual(centers.get('raiz.md'))
    expect(centers.get('Notas/Quimica.md')).toEqual(centers.get('Notas/Fisica.md'))
    expect(centers.get('Notas/Quimica.md')).not.toEqual(centers.get('raiz.md'))
    const raiz = centers.get('raiz.md')!
    const notas = centers.get('Notas/Quimica.md')!
    const diarios = centers.get('Diarios/2026.md')!
    // Centros dentro do espaco 0-100 e distintos entre grupos.
    expect(Math.hypot(raiz.x - 50, raiz.y - 50)).toBeGreaterThan(10)
    expect(raiz.x).not.toBe(notas.x)
    expect(notas.x).not.toBe(diarios.x)
  })
})

describe('tagGroupLabel', () => {
  it('rotula a tag com # e o grupo vazio como "Sem tag"', () => {
    expect(tagGroupLabel('')).toBe('Sem tag')
    expect(tagGroupLabel('quimica')).toBe('#quimica')
  })
})

describe('primaryTagFor', () => {
  it('usa a primeira tag da nota quando nao ha tag principal configurada', () => {
    expect(primaryTagFor(['a', 'b'])).toBe('a')
    expect(primaryTagFor([])).toBe('')
  })

  it('usa a tag principal configurada quando a nota a possui', () => {
    expect(primaryTagFor(['a', 'b', 'projeto'], 'projeto')).toBe('projeto')
    expect(primaryTagFor(['a', 'b'], 'projeto')).toBe('a')
  })
})

describe('buildGraphGroups (por tag)', () => {
  const nodes = [
    { relativePath: 'a.md' },
    { relativePath: 'b.md' },
    { relativePath: 'c.md' },
  ]
  const tagsOfPath = (path: string) => {
    if (path === 'a.md') return ['quimica', 'projeto']
    if (path === 'b.md') return ['projeto']
    return []
  }

  it('agrupa pela tag principal (vazio primeiro, depois alfabetica)', () => {
    const groups = buildGraphGroups(nodes, { kind: 'tag', tagsOfPath })
    expect(groups.map((group) => group.key)).toEqual(['', 'projeto', 'quimica'])
    expect(groups[0].label).toBe('Sem tag')
    expect(groups[0].paths).toEqual(['c.md'])
    expect(groups[1].paths).toEqual(['b.md'])
    expect(groups[2].paths).toEqual(['a.md'])
  })

  it('a tag principal configurada desempata notas com varias tags', () => {
    const groups = buildGraphGroups(nodes, { kind: 'tag', tagsOfPath, primaryTag: 'projeto' })
    expect(groups.map((group) => group.key)).toEqual(['', 'projeto'])
    expect(groups[1].paths).toEqual(['a.md', 'b.md'])
  })

  it('usa a paleta estavel para as tags', () => {
    const groups = buildGraphGroups(nodes, { kind: 'tag', tagsOfPath })
    expect(groups[1].color).toBe(GRAPH_FOLDER_PALETTE[1])
    expect(groups[2].color).toBe(GRAPH_FOLDER_PALETTE[2])
  })
})

describe('groupColor com overrides', () => {
  it('aplica o override do Vault e valida o formato hexadecimal', () => {
    const nodes = [
      { relativePath: 'Notas/a.md' },
      { relativePath: 'Diarios/b.md' },
    ]
    const maps = buildGroupMaps(nodes, {
      kind: 'folder',
      colorOverrides: { Notas: '#123456', Diarios: 'invalido' },
    })
    expect(maps.groupColorByKey['Notas']).toBe('#123456')
    // Override invalido cai para a paleta (Diarios e o primeiro grupo
    // alfabetico, sem raiz presente).
    expect(maps.groupColorByKey['Diarios']).toBe(GRAPH_FOLDER_PALETTE[0])
  })

  it('buildGroupMaps por tag produz chave, cor por caminho e grupos consistentes', () => {
    const nodes = [{ relativePath: 'a.md' }, { relativePath: 'b.md' }]
    const tagsOfPath = (path: string) => (path === 'a.md' ? ['x'] : [])
    const maps = buildGroupMaps(nodes, { kind: 'tag', tagsOfPath })
    expect(maps.groupByPath['a.md']).toBe('x')
    expect(maps.groupByPath['b.md']).toBe('')
    // Cor indexada pela chave do grupo, nao pelo caminho da nota.
    expect(maps.groupColorByPath['x']).toBe(maps.groupColorByKey['x'])
    expect(maps.groups.find((group) => group.key === 'x')?.paths).toEqual(['a.md'])
  })
})
