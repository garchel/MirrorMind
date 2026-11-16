import { describe, expect, it } from 'vitest'
import { Graph2dSimulation } from '../../lib/graph2dSimulation'
import {
  drawGraph2d,
  pickNode,
  screenToWorld,
  worldScale,
  worldToScreen,
  type Graph2dRendererOptions,
  type Graph2dView,
} from './graph2dRenderer'

const VIEW: Graph2dView = { panX: 0, panY: 0, zoom: 1 }
const W = 800
const H = 600

function sim(entries: Array<[string, number, number]>, links: Array<[string, string]> = []): Graph2dSimulation {
  return new Graph2dSimulation({
    paths: entries.map(([path]) => path),
    links: links.map(([source, target]) => ({ source, target })),
    positions: new Map(entries.map(([path, x, y]) => [path, { x, y }])),
    settings: { linkStiffness: 1, linkRest: 12, repulsionStrength: 300, velocityDecay: 0.4, centerStrength: 0.02 },
  })
}

const OPCOES: Graph2dRendererOptions = {
  width: W,
  height: H,
  dpr: 1,
  view: VIEW,
  hovered: -1,
  neighbors: null,
  radius: 2.4,
  labels: false,
  colors: {
    background: '#fff',
    link: '#999',
    linkDim: '#ddd',
    node: '#333',
    nodeRing: '#000',
    nodeCurrent: '#c60',
    label: '#000',
    labelDim: '#666',
  },
}

function contextoFake() {
  const chamadas: string[] = []
  const ctx = {
    save: () => chamadas.push('save'),
    restore: () => chamadas.push('restore'),
    setTransform: () => chamadas.push('setTransform'),
    clearRect: () => chamadas.push('clearRect'),
    fillRect: () => chamadas.push('fillRect'),
    beginPath: () => chamadas.push('beginPath'),
    arc: () => chamadas.push('arc'),
    moveTo: () => chamadas.push('moveTo'),
    lineTo: () => chamadas.push('lineTo'),
    stroke: () => chamadas.push('stroke'),
    fill: () => chamadas.push('fill'),
    fillText: () => chamadas.push('fillText'),
    measureText: () => ({ width: 20 }),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, chamadas }
}

describe('mapeamento mundo <-> tela', () => {
  it('o centro do mundo cai no centro da tela', () => {
    const p = worldToScreen(100, 100, VIEW, W, H)
    expect(p.x).toBeCloseTo(W / 2, 6)
    expect(p.y).toBeCloseTo(H / 2, 6)
  })

  it('worldToScreen e screenToWorld sao inversas', () => {
    const view = { panX: 37, panY: -22, zoom: 1.8 }
    const volta = screenToWorld(123, 456, view, W, H)
    const ida = worldToScreen(volta.x, volta.y, view, W, H)
    expect(ida.x).toBeCloseTo(123, 6)
    expect(ida.y).toBeCloseTo(456, 6)
  })

  it('o zoom amplia a distancia ao centro', () => {
    const longe = worldToScreen(200, 100, VIEW, W, H)
    const perto = worldToScreen(200, 100, { ...VIEW, zoom: 2 }, W, H)
    expect(Math.abs(perto.x - W / 2)).toBeCloseTo(Math.abs(longe.x - W / 2) * 2, 6)
  })

  it('worldScale usa o menor lado', () => {
    expect(worldScale(W, H)).toBeCloseTo(H / 200, 6)
  })
})

describe('pickNode', () => {
  it('acha o no sob o ponteiro e ignora longe', () => {
    const s = sim([['a', 100, 100], ['b', 150, 100]])
    const alvo = worldToScreen(s.xs[1], s.ys[1], VIEW, W, H)
    expect(pickNode(s, alvo.x, alvo.y, VIEW, W, H, 2.4)).toBe(1)
    expect(pickNode(s, alvo.x, alvo.y + 200, VIEW, W, H, 2.4)).toBe(-1)
  })

  it('devolve o mais proximo quando dois estao perto', () => {
    const s = sim([['a', 100, 100], ['b', 100.4, 100]])
    const b = worldToScreen(s.xs[1], s.ys[1], VIEW, W, H)
    expect(pickNode(s, b.x, b.y, VIEW, W, H, 2.4, 40)).toBe(1)
  })
})

describe('drawGraph2d', () => {
  it('desenha arestas e nos sem lancar', () => {
    const s = sim([['a', 90, 100], ['b', 110, 100]], [['a', 'b']])
    const { ctx, chamadas } = contextoFake()
    drawGraph2d(ctx, s, OPCOES)
    expect(chamadas).toContain('clearRect')
    // Arestas num stroke agrupado (com Path2D) ou em um path unico (sem).
    expect(chamadas.filter((c) => c === 'stroke').length).toBeGreaterThanOrEqual(1)
    expect(chamadas.filter((c) => c === 'fill').length).toBeGreaterThanOrEqual(1)
  })

  it('esmaece quem nao e vizinho do no em hover', () => {
    const s = sim([['a', 90, 100], ['b', 110, 100], ['c', 140, 100]])
    const { ctx, chamadas } = contextoFake()
    drawGraph2d(ctx, s, { ...OPCOES, hovered: 0, neighbors: new Set([0, 1]) })
    // Dois grupos de cor/alpha (normal e esmaecido) + anel do hover.
    expect(chamadas.filter((c) => c === 'fill').length).toBeGreaterThanOrEqual(2)
    expect(chamadas).toContain('arc')
  })

  it('com labels desenha o nome e sem labels nao', () => {
    const s = sim([['Biologia/Celula.md', 100, 100]])
    const semRotulo = contextoFake()
    drawGraph2d(semRotulo.ctx, s, OPCOES)
    expect(semRotulo.chamadas).not.toContain('fillText')

    const comRotulo = contextoFake()
    drawGraph2d(comRotulo.ctx, s, { ...OPCOES, labels: true })
    expect(comRotulo.chamadas).toContain('fillText')
  })
})
