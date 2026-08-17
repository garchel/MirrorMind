import { describe, expect, it } from 'vitest'
import {
  GRAPH_CULLING_MARGIN_PX,
  graphPositionToScreen,
  isNodeInViewport,
  selectRenderedGraphDocuments,
} from './graphCulling'

const viewport = { scale: 1, x: 0, y: 0 }
const surface = { width: 800, height: 600 }

describe('graphPositionToScreen', () => {
  it('projeta as unidades do mundo 0-200 para pixels aplicando scale e pan', () => {
    expect(graphPositionToScreen({ x: 100, y: 100 }, viewport, surface)).toEqual({ x: 400, y: 300 })
    expect(graphPositionToScreen({ x: 50, y: 0 }, { scale: 2, x: -100, y: 40 }, surface)).toEqual({ x: 300, y: 40 })
  })
})

describe('isNodeInViewport', () => {
  it('mantem nos dentro da superficie e descarta os de fora (com margem)', () => {
    expect(isNodeInViewport({ x: 12, y: 34 }, viewport, surface)).toBe(true)
    expect(isNodeInViewport({ x: 90, y: 90 }, viewport, surface)).toBe(true)
    // Fora da margem: no extremo superior-esquerdo com pan negativo.
    const panned = { scale: 1, x: -1000, y: -1000 }
    expect(isNodeInViewport({ x: 10, y: 10 }, panned, surface)).toBe(false)
  })

  it('aceita a margem de seguranca alem da borda', () => {
    // 700px com margem de 160: ainda visivel mesmo apos 800px de largura.
    expect(isNodeInViewport({ x: 96, y: 50 }, { scale: 1, x: -60, y: 0 }, surface)).toBe(true)
  })

  it('nunca descarta nada sem tamanho de superficie conhecido', () => {
    expect(isNodeInViewport({ x: 96, y: 95 }, { scale: 2.4, x: -2000, y: -2000 }, null)).toBe(true)
  })

  it('respeita a margem personalizada', () => {
    const panned = { scale: 1, x: -200, y: 0 }
    expect(isNodeInViewport({ x: 10, y: 50 }, panned, surface, 200)).toBe(true)
    expect(isNodeInViewport({ x: 10, y: 50 }, panned, surface, 100)).toBe(false)
    expect(GRAPH_CULLING_MARGIN_PX).toBeGreaterThan(0)
  })
})

describe('selectRenderedGraphDocuments', () => {
  const docs = [
    { relativePath: 'a.md' },
    { relativePath: 'b.md' },
    { relativePath: 'c.md' },
    { relativePath: 'd.md' },
  ]
  const positions: Record<string, { x: number; y: number }> = {
    'a.md': { x: 10, y: 10 },
    'b.md': { x: 30, y: 30 },
    'c.md': { x: 60, y: 60 },
    'd.md': { x: 90, y: 90 },
  }

  it('renderiza tudo quando o total esta abaixo do limite', () => {
    expect(selectRenderedGraphDocuments({ documents: docs, positions, viewport, surfaceSize: surface, limit: 10 })).toHaveLength(4)
  })

  it('renderiza tudo sem tamanho de superficie (jsdom/desconhecido)', () => {
    expect(selectRenderedGraphDocuments({ documents: docs, positions, viewport, surfaceSize: null, limit: 2 })).toHaveLength(4)
  })

  it('corta por viewport quando o limite e excedido', () => {
    // Pan desloca tudo para fora: apenas nos prioritarios permanecem.
    const panned = { scale: 1, x: -2000, y: -2000 }
    const rendered = selectRenderedGraphDocuments({ documents: docs, positions, viewport: panned, surfaceSize: surface, limit: 3 })
    expect(rendered).toHaveLength(0)
  })

  it('mantem os caminhos prioritarios mesmo fora do viewport', () => {
    const panned = { scale: 1, x: -2000, y: -2000 }
    const rendered = selectRenderedGraphDocuments({
      documents: docs,
      positions,
      viewport: panned,
      surfaceSize: surface,
      limit: 2,
      priorityPaths: ['a.md', 'd.md'],
    })
    expect(rendered.map((document) => document.relativePath)).toEqual(['a.md', 'd.md'])
  })

  it('mistura visiveis com prioritarios', () => {
    const panned = { scale: 1, x: -2000, y: 0 }
    // y -2000 joga tudo para cima; apenas o prioritario fica.
    const rendered = selectRenderedGraphDocuments({
      documents: docs,
      positions,
      viewport: panned,
      surfaceSize: surface,
      limit: 1,
      priorityPaths: ['c.md'],
    })
    expect(rendered.map((document) => document.relativePath)).toEqual(['c.md'])
  })
})
