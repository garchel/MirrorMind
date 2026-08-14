import { describe, expect, it } from 'vitest'
import { birthInterpolation, createForceGraph3DLayout } from './noteGraph3dLayout'

const nodes = [
  { relativePath: 'a.md' },
  { relativePath: 'b.md' },
  { relativePath: 'c.md' },
  { relativePath: 'd.md' },
  { relativePath: 'e.md' },
]

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('birthInterpolation (Big Bang)', () => {
  it('comeca tudo junto no centro (progresso 0) e assenta no layout (progresso 1)', () => {
    expect(birthInterpolation(0, 10, 20)).toBe(0)
    expect(birthInterpolation(1, 0, 20)).toBe(1)
    expect(birthInterpolation(1, 10, 20)).toBe(1)
    expect(birthInterpolation(1, 40, 20)).toBe(1)
  })

  it('nos mais distantes do centro saem na frente (sensacao de repulsao)', () => {
    const inner = birthInterpolation(0.5, 2, 20)
    const outer = birthInterpolation(0.5, 18, 20)
    expect(outer).toBeGreaterThan(inner)
  })

  it('e monotono no progresso e limitado a [0, 1] mesmo com entradas fora da faixa', () => {
    const earlier = birthInterpolation(0.3, 8, 20)
    const later = birthInterpolation(0.8, 8, 20)
    expect(later).toBeGreaterThan(earlier)
    expect(birthInterpolation(-0.5, 8, 20)).toBe(0)
    expect(birthInterpolation(2, 8, 20)).toBe(1)
  })

  it('sem nos distantes (maxRadius 0) usa fator neutro', () => {
    expect(birthInterpolation(0.5, 0, 0)).toBeGreaterThan(0)
    expect(birthInterpolation(0.5, 0, 0)).toBeLessThan(1)
  })
})

describe('createForceGraph3DLayout', () => {
  it('posiciona todos os nos e e deterministico para a mesma entrada', () => {
    const links = [{ source: 'a.md', target: 'b.md' }]
    const first = createForceGraph3DLayout(nodes, links)
    const second = createForceGraph3DLayout(nodes, links)

    expect(first.size).toBe(nodes.length)
    for (const node of nodes) {
      const position = first.get(node.relativePath)
      expect(position).toBeDefined()
      expect(Number.isFinite(position!.x)).toBe(true)
      expect(Number.isFinite(position!.y)).toBe(true)
      expect(Number.isFinite(position!.z)).toBe(true)
    }
    for (const node of nodes) {
      const a = first.get(node.relativePath)!
      const b = second.get(node.relativePath)!
      expect(a.x).toBeCloseTo(b.x)
      expect(a.y).toBeCloseTo(b.y)
      expect(a.z).toBeCloseTo(b.z)
    }
  })

  it('aproxima nos conectados por arestas', () => {
    const links = [{ source: 'a.md', target: 'b.md' }]
    const positions = createForceGraph3DLayout(nodes, links)
    const connected = distance(positions.get('a.md')!, positions.get('b.md')!)
    const unrelated = distance(positions.get('a.md')!, positions.get('e.md')!)
    expect(connected).toBeLessThan(unrelated)
  })

  it('mantem o grafo centralizado e dentro de uma esfera razoavel', () => {
    const links = [
      { source: 'a.md', target: 'b.md' },
      { source: 'b.md', target: 'c.md' },
      { source: 'c.md', target: 'd.md' },
      { source: 'd.md', target: 'e.md' },
    ]
    const positions = createForceGraph3DLayout(nodes, links)
    let maxRadius = 0
    for (const node of nodes) {
      const position = positions.get(node.relativePath)!
      maxRadius = Math.max(maxRadius, Math.hypot(position.x, position.y, position.z))
    }
    expect(maxRadius).toBeLessThan(60)
    expect(maxRadius).toBeGreaterThan(8)
  })

  it('mantem um hub com dezenas de conexoes compacto (nao espalha a 100+)', () => {
    // Regressao: a repulsao antiga empurrava os vizinhos do hub a ~125 unidades
    // de distancia; o layout calibrado mantem tudo dentro de ~35.
    const hubNodes = [{ relativePath: 'hub' }]
    const hubLinks = []
    for (let index = 0; index < 20; index += 1) {
      hubNodes.push({ relativePath: `v${index}` })
      hubLinks.push({ source: 'hub', target: `v${index}` })
    }
    const positions = createForceGraph3DLayout(hubNodes, hubLinks)
    let maxRadius = 0
    for (const node of hubNodes) {
      const position = positions.get(node.relativePath)!
      maxRadius = Math.max(maxRadius, Math.hypot(position.x, position.y, position.z))
    }
    expect(maxRadius).toBeLessThan(35)
    expect(maxRadius).toBeGreaterThan(8)
  })

  it('agrupa nos da mesma pasta proximos aos centros do proprio grupo', () => {
    const groupedNodes = [
      { relativePath: 'raiz.md' },
      { relativePath: 'Notas/Quimica.md' },
      { relativePath: 'Notas/Fisica.md' },
      { relativePath: 'Notas/Biologia.md' },
      { relativePath: 'Diarios/2026.md' },
      { relativePath: 'Diarios/2025.md' },
    ]
    const links = [{ source: 'Notas/Quimica.md', target: 'Diarios/2026.md' }]
    const groupOf = (node: { relativePath: string }) => node.relativePath.split('/').slice(0, -1).join('/')
    const positions = createForceGraph3DLayout(groupedNodes, links, 140, { groupOf })

    // Nos do mesmo grupo ficam mais proximos entre si do que de outros grupos.
    const notasInner = distance(positions.get('Notas/Quimica.md')!, positions.get('Notas/Fisica.md')!)
    const notasOuter = distance(positions.get('Notas/Quimica.md')!, positions.get('Diarios/2026.md')!)
    expect(notasInner).toBeLessThan(notasOuter)

    const diariosInner = distance(positions.get('Diarios/2026.md')!, positions.get('Diarios/2025.md')!)
    const diariosOuter = distance(positions.get('Diarios/2026.md')!, positions.get('Notas/Fisica.md')!)
    expect(diariosInner).toBeLessThan(diariosOuter)

    // Centro de cada grupo afastado do centro do mundo (clusters distintos).
    const notasCenter = {
      x: (positions.get('Notas/Quimica.md')!.x + positions.get('Notas/Fisica.md')!.x + positions.get('Notas/Biologia.md')!.x) / 3,
      y: (positions.get('Notas/Quimica.md')!.y + positions.get('Notas/Fisica.md')!.y + positions.get('Notas/Biologia.md')!.y) / 3,
      z: (positions.get('Notas/Quimica.md')!.z + positions.get('Notas/Fisica.md')!.z + positions.get('Notas/Biologia.md')!.z) / 3,
    }
    const diariosCenter = {
      x: (positions.get('Diarios/2026.md')!.x + positions.get('Diarios/2025.md')!.x) / 2,
      y: (positions.get('Diarios/2026.md')!.y + positions.get('Diarios/2025.md')!.y) / 2,
      z: (positions.get('Diarios/2026.md')!.z + positions.get('Diarios/2025.md')!.z) / 2,
    }
    expect(distance(notasCenter, diariosCenter)).toBeGreaterThan(5)
  })

  it('o layout agrupado e deterministico e mantem os nos dentro de uma esfera razoavel', () => {
    const groupedNodes = [
      { relativePath: 'raiz.md' },
      { relativePath: 'Notas/Quimica.md' },
      { relativePath: 'Diarios/2026.md' },
    ]
    const groupOf = (node: { relativePath: string }) => node.relativePath.split('/').slice(0, -1).join('/')
    const first = createForceGraph3DLayout(groupedNodes, [], 140, { groupOf })
    const second = createForceGraph3DLayout(groupedNodes, [], 140, { groupOf })
    for (const node of groupedNodes) {
      const a = first.get(node.relativePath)!
      const b = second.get(node.relativePath)!
      expect(a.x).toBeCloseTo(b.x)
      expect(a.y).toBeCloseTo(b.y)
      expect(a.z).toBeCloseTo(b.z)
      expect(Math.hypot(a.x, a.y, a.z)).toBeLessThan(40)
    }
  })

  it('escala o layout pela configuracao "Distancia entre nos"', () => {
    const links = [
      { source: 'a.md', target: 'b.md' },
      { source: 'b.md', target: 'c.md' },
      { source: 'c.md', target: 'd.md' },
      { source: 'd.md', target: 'e.md' },
    ]
    const compact = createForceGraph3DLayout(nodes, links, 140, { nodeSpacing: 8 })
    const spread = createForceGraph3DLayout(nodes, links, 140, { nodeSpacing: 16 })
    const radius = (positions: Map<string, { x: number; y: number; z: number }>) => {
      let max = 0
      for (const node of nodes) {
        const position = positions.get(node.relativePath)!
        max = Math.max(max, Math.hypot(position.x, position.y, position.z))
      }
      return max
    }
    expect(radius(spread)).toBeGreaterThan(radius(compact))
  })
})
