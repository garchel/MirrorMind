import { describe, expect, it } from 'vitest'
import {
  GRAPH2D_ALPHA_SLEEP,
  GRAPH2D_NODE_RADIUS,
  Graph2dSimulation,
  type Graph2dSettings,
} from './graph2dSimulation'

const BASE: Graph2dSettings = {
  linkStiffness: 1,
  linkRest: 12,
  repulsionStrength: 300,
  velocityDecay: 0.4,
  centerStrength: 0.02,
}

function criar(
  entries: Array<[string, number, number]>,
  links: Array<[string, string]>,
  settings: Partial<Graph2dSettings> = {},
): Graph2dSimulation {
  const positions = new Map(entries.map(([path, x, y]) => [path, { x, y }]))
  return new Graph2dSimulation({
    paths: entries.map(([path]) => path),
    links: links.map(([source, target]) => ({ source, target })),
    positions,
    settings: { ...BASE, ...settings },
  })
}

function rodar(sim: Graph2dSimulation, passos: number): void {
  for (let i = 0; i < passos; i += 1) sim.step()
}

describe('Graph2dSimulation', () => {
  it('a repulsao afasta dois nos sem conexao', () => {
    const sim = criar([['a', 100, 100], ['b', 100.2, 100]], [], { centerStrength: 0 })
    const antes = Math.hypot(sim.xs[0] - sim.xs[1], sim.ys[0] - sim.ys[1])
    rodar(sim, 30)
    const depois = Math.hypot(sim.xs[0] - sim.xs[1], sim.ys[0] - sim.ys[1])
    expect(depois).toBeGreaterThan(antes)
  })

  it('a mola aproxima dois nos ligados ate o descanso', () => {
    const sim = criar([['a', 60, 100], ['b', 140, 100]], [['a', 'b']], {
      repulsionStrength: 0,
      centerStrength: 0,
      linkStiffness: 1,
      linkRest: 12,
    })
    rodar(sim, 200)
    const d = Math.hypot(sim.xs[0] - sim.xs[1], sim.ys[0] - sim.ys[1])
    expect(d).toBeGreaterThan(10)
    expect(d).toBeLessThan(14)
  })

  it('a colisao impede sobreposicao mesmo partindo do mesmo ponto', () => {
    const sim = criar([['a', 100, 100], ['b', 100, 100], ['c', 100, 100]], [])
    rodar(sim, 120)
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        const d = Math.hypot(sim.xs[i] - sim.xs[j], sim.ys[i] - sim.ys[j])
        // Toca no maximo; nunca invade o raio do outro.
        expect(d).toBeGreaterThan(GRAPH2D_NODE_RADIUS * 2 - 0.15)
      }
    }
  })

  it('assenta: alpha cai abaixo do limite de sono e a energia diminui', () => {
    const nos = Array.from({ length: 40 }, (_, i) => [`n${i}`, 90 + (i % 8) * 3, 90 + Math.floor(i / 8) * 3] as [string, number, number])
    const links = nos.slice(1).map(([path]) => [nos[0][0], path] as [string, string])
    const sim = criar(nos, links)
    const energiaInicial = sim.step()
    rodar(sim, 200)
    expect(sim.alpha).toBeLessThan(GRAPH2D_ALPHA_SLEEP)
    expect(sim.settled).toBe(true)
    expect(sim.step()).toBeLessThan(energiaInicial)
  })

  it('nao aloca buffer novo por passo (snapshot reaproveita o mesmo objeto)', () => {
    const sim = criar([['a', 100, 100], ['b', 110, 100]], [['a', 'b']])
    const primeiro = sim.snapshot()
    rodar(sim, 10)
    expect(sim.snapshot()).toBe(primeiro)
  })

  it('nos fixados nao se movem', () => {
    const sim = criar([['a', 100, 100], ['b', 100, 100]], [['a', 'b']])
    sim.pin('a', 30, 40)
    rodar(sim, 60)
    expect(sim.positionOf('a')).toEqual({ x: 30, y: 40 })
    sim.unpin('a')
    sim.reheat()
    rodar(sim, 60)
    expect(sim.positionOf('a')).not.toEqual({ x: 30, y: 40 })
  })

  it('600 nos custam menos de 8ms por passo (Barnes-Hut, nao n^2)', () => {
    const nos = Array.from({ length: 600 }, (_, i) => [`n${i}`, 40 + Math.random() * 120, 40 + Math.random() * 120] as [string, number, number])
    const links = nos.slice(1).map((_, i) => [nos[i][0], nos[i + 1][0]] as [string, string])
    const sim = criar(nos, links)
    sim.step() // aquece alocacao
    const inicio = performance.now()
    const PASSOS = 60
    for (let i = 0; i < PASSOS; i += 1) sim.step()
    const porPasso = (performance.now() - inicio) / PASSOS
    console.log(`600 nos: ${porPasso.toFixed(2)} ms por passo`)
    expect(porPasso).toBeLessThan(8)
  })
})
