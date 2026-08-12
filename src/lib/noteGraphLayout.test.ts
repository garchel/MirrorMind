import { describe, expect, it } from 'vitest'
import {
  accumulateObsidianForces2D,
  GRAPH_2D_BOUNDS,
  OBSIDIAN_PHYSICS_2D,
  type NoteGraphPosition,
} from './noteGraphLayout'

function positionsOf(entries: [string, NoteGraphPosition][]): Map<string, NoteGraphPosition> {
  return new Map(entries)
}

function velocitiesOf(paths: string[]): Map<string, NoteGraphPosition> {
  return new Map(paths.map((path) => [path, { x: 0, y: 0 }]))
}

describe('accumulateObsidianForces2D', () => {
  it('a repulsao e inversa ao quadrado (1/d²): pares proximos se repelem muito mais', () => {
    const close = positionsOf([
      ['a', { x: 49, y: 50 }],
      ['b', { x: 51, y: 50 }], // d = 2
    ])
    const far = positionsOf([
      ['c', { x: 47, y: 50 }],
      ['d', { x: 53, y: 50 }], // d = 6
    ])
    const closeVelocities = velocitiesOf(['a', 'b'])
    const farVelocities = velocitiesOf(['c', 'd'])
    accumulateObsidianForces2D({ paths: ['a', 'b'], positions: close, velocities: closeVelocities, delta: 1 / 60 })
    accumulateObsidianForces2D({ paths: ['c', 'd'], positions: far, velocities: farVelocities, delta: 1 / 60 })
    // F = k / d²: em d=2 a forca e 9x a de d=6 (36/4).
    const closePush = Math.abs(closeVelocities.get('a')!.x)
    const farPush = Math.abs(farVelocities.get('c')!.x)
    expect(closePush).toBeGreaterThan(0)
    expect(closePush / farPush).toBeGreaterThan(7)
    // A e b se afastam.
    expect(closeVelocities.get('a')!.x).toBeLessThan(0)
    expect(closeVelocities.get('b')!.x).toBeGreaterThan(0)
  })

  it('pares alem do cutoff de distancia nao se repelem', () => {
    // Ambos dentro do anel da center force (dist ao centro 20 < anel 30) e a
    // 40 um do outro (= cutoff): so a repulsao 1/d² poderia mover, e ela e
    // ignorada no cutoff — as velocidades permanecem zero.
    const positions = positionsOf([
      ['a', { x: 30, y: 50 }],
      ['b', { x: 70, y: 50 }], // d = 40 = cutoff
    ])
    const velocities = velocitiesOf(['a', 'b'])
    accumulateObsidianForces2D({ paths: ['a', 'b'], positions, velocities, delta: 1 / 60 })
    expect(velocities.get('a')).toEqual({ x: 0, y: 0 })
    expect(velocities.get('b')).toEqual({ x: 0, y: 0 })
  })

  it('a mola da aresta puxa os extremos para o descanso (link distance)', () => {
    const positions = positionsOf([
      ['a', { x: 30, y: 50 }],
      ['b', { x: 70, y: 50 }], // d = 40 > rest 10
    ])
    const velocities = velocitiesOf(['a', 'b'])
    accumulateObsidianForces2D({
      paths: ['a', 'b'],
      positions,
      velocities,
      edges: [{ source: 'a', target: 'b' }],
      linkRest: 10,
      delta: 1 / 60,
    })
    // a e puxado para a direita, b para a esquerda (aproximando).
    expect(velocities.get('a')!.x).toBeGreaterThan(0)
    expect(velocities.get('b')!.x).toBeLessThan(0)
  })

  it('a mola empurra extremos proximos demais para longe', () => {
    const positions = positionsOf([
      ['a', { x: 49, y: 50 }],
      ['b', { x: 51, y: 50 }], // d = 2 < rest 10
    ])
    const velocities = velocitiesOf(['a', 'b'])
    accumulateObsidianForces2D({
      paths: ['a', 'b'],
      positions,
      velocities,
      edges: [{ source: 'a', target: 'b' }],
      linkRest: 10,
      delta: 1 / 60,
    })
    expect(velocities.get('a')!.x).toBeLessThan(0)
    expect(velocities.get('b')!.x).toBeGreaterThan(0)
  })

  it('a center force so age FORA do anel (zona morta no meio)', () => {
    const inside = positionsOf([['a', { x: 55, y: 50 }]]) // d ao centro = 5 < anel 30
    const outside = positionsOf([['b', { x: 85, y: 50 }]]) // d ao centro = 35 > anel 30
    const insideVelocities = velocitiesOf(['a'])
    const outsideVelocities = velocitiesOf(['b'])
    accumulateObsidianForces2D({ paths: ['a'], positions: inside, velocities: insideVelocities, delta: 1 / 60 })
    accumulateObsidianForces2D({ paths: ['b'], positions: outside, velocities: outsideVelocities, delta: 1 / 60 })
    // Dentro do anel: nenhuma forca. Fora: puxado para o centro (esquerda).
    expect(insideVelocities.get('a')).toEqual({ x: 0, y: 0 })
    expect(outsideVelocities.get('b')!.x).toBeLessThan(0)
  })

  it('nos sem entrada em velocities sao fixos (pinned): repelem mas nao se movem', () => {
    const positions = positionsOf([
      ['a', { x: 51, y: 50 }], // fixo (ancora do arrasto): sem velocity
      ['b', { x: 53, y: 50 }], // movente, colado no fixo
    ])
    const velocities = velocitiesOf(['b']) // so o movente tem entrada
    accumulateObsidianForces2D({ paths: ['a', 'b'], positions, velocities, delta: 1 / 60 })
    // b e empurrado para longe de a (direita) pela repulsao; a nao ganha velocidade.
    expect(velocities.get('b')!.x).toBeGreaterThan(0)
    expect(velocities.get('a')).toBeUndefined()
  })

  it('o alpha escala todas as forcas (resfriamento da simulacao)', () => {
    const full = positionsOf([
      ['a', { x: 49, y: 50 }],
      ['b', { x: 51, y: 50 }],
    ])
    const cooled = positionsOf([
      ['c', { x: 49, y: 50 }],
      ['d', { x: 51, y: 50 }],
    ])
    const fullVelocities = velocitiesOf(['a', 'b'])
    const cooledVelocities = velocitiesOf(['c', 'd'])
    accumulateObsidianForces2D({ paths: ['a', 'b'], positions: full, velocities: fullVelocities, delta: 1 / 60 })
    accumulateObsidianForces2D({ paths: ['c', 'd'], positions: cooled, velocities: cooledVelocities, alpha: 0.5, delta: 1 / 60 })
    const fullPush = Math.abs(fullVelocities.get('a')!.x)
    const cooledPush = Math.abs(cooledVelocities.get('c')!.x)
    expect(cooledPush).toBeCloseTo(fullPush * 0.5, 10)
  })

  it('respeita os limites do viewBox ao integrar passos completos', () => {
    // Simulacao completa (forcas + amortecimento + movimento) de um par colado
    // no canto: nada sai dos limites do viewBox.
    const positions = positionsOf([
      ['a', { x: 6, y: 5 }],
      ['b', { x: 8, y: 5 }],
    ])
    const velocities = velocitiesOf(['a', 'b'])
    for (let step = 0; step < 240; step += 1) {
      accumulateObsidianForces2D({ paths: ['a', 'b'], positions, velocities, delta: 1 / 60 })
      for (const path of ['a', 'b']) {
        const current = positions.get(path)!
        const velocity = velocities.get(path)!
        const damping = Math.max(0, 1 - OBSIDIAN_PHYSICS_2D.velocityDecay * (1 / 60))
        velocity.x *= damping
        velocity.y *= damping
        current.x = Math.max(GRAPH_2D_BOUNDS.minX, Math.min(GRAPH_2D_BOUNDS.maxX, current.x + velocity.x * (1 / 60)))
        current.y = Math.max(GRAPH_2D_BOUNDS.minY, Math.min(GRAPH_2D_BOUNDS.maxY, current.y + velocity.y * (1 / 60)))
      }
    }
    expect(positions.get('a')!.x).toBeGreaterThanOrEqual(4)
    expect(positions.get('b')!.x).toBeLessThanOrEqual(96)
  })
})
