import { describe, expect, it } from 'vitest'
import {
  ambientWorkerPositionsSnapshot,
  ambientWorkerSettled,
  createAmbientWorkerState,
  stepAmbientWorker,
} from './graphPhysicsWorkerCore'

const settings = {
  linkStiffness: 2.2,
  linkRest: 10,
  repulsionStrength: 1600,
  velocityDecay: 1.0,
  centerStrength: 0.06,
}

describe('createAmbientWorkerState', () => {
  it('inicializa velocidades zeradas para todos os caminhos', () => {
    const state = createAmbientWorkerState({
      requestId: 7,
      paths: ['a.md', 'b.md'],
      positions: { 'a.md': { x: 10, y: 10 }, 'b.md': { x: 90, y: 90 } },
      edges: [{ source: 'a.md', target: 'b.md' }],
      settings,
      startedAt: 1000,
    })
    expect(state.alpha).toBe(1)
    expect(state.velocities.get('a.md')).toEqual({ x: 0, y: 0 })
    expect(state.velocities.get('b.md')).toEqual({ x: 0, y: 0 })
  })
})

describe('stepAmbientWorker', () => {
  it('move nos conectados pela mola ate o descanso, dentro dos limites', () => {
    const state = createAmbientWorkerState({
      requestId: 1,
      paths: ['a.md', 'b.md'],
      // Distantes: a mola puxa para o linkRest e a repulsao empurra.
      positions: { 'a.md': { x: 5, y: 50 }, 'b.md': { x: 95, y: 50 } },
      edges: [{ source: 'a.md', target: 'b.md' }],
      settings,
      startedAt: 0,
    })
    const before = { a: { ...state.positions.get('a.md')! }, b: { ...state.positions.get('b.md')! } }
    const { remaining } = stepAmbientWorker(state, 0.016)
    const a = state.positions.get('a.md')!
    const b = state.positions.get('b.md')!
    expect(a.x).toBeGreaterThan(before.a.x)
    expect(b.x).toBeLessThan(before.b.x)
    expect(remaining).toBeGreaterThan(0)
    expect(a.x).toBeGreaterThanOrEqual(4)
    expect(a.x).toBeLessThanOrEqual(96)
  })

  it('resfria o alpha a cada passo', () => {
    const state = createAmbientWorkerState({
      requestId: 1,
      paths: ['a.md'],
      positions: { 'a.md': { x: 50, y: 50 } },
      edges: [],
      settings,
      startedAt: 0,
    })
    stepAmbientWorker(state, 0.016)
    expect(state.alpha).toBeLessThan(1)
  })

  it('nao deixa nos presos ao centro quando a repulsao e alta (big bang)', () => {
    const paths = Array.from({ length: 20 }, (_, index) => `n-${index}.md`)
    // Com jitter deterministico (como o big bang real), os nos nao partem
    // colocalizados — pares no mesmo ponto nao se repelem (dx = 0).
    const positions: Record<string, { x: number; y: number }> = {}
    for (const [index, path] of paths.entries()) {
      const angle = (Math.PI * 2 * index) / paths.length
      const radius = 1 + (index % 3) * 0.5
      positions[path] = { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius }
    }
    const state = createAmbientWorkerState({
      requestId: 2,
      paths,
      positions,
      edges: [],
      settings,
      startedAt: 0,
    })
    // Roda ate assentar (ou timeout de 4s simulados).
    let guard = 0
    while (guard < 1000) {
      const { remaining } = stepAmbientWorker(state, 0.016)
      guard += 1
      if (ambientWorkerSettled(state, remaining, guard * 16)) break
    }
    // O big bang espalhou os nos: nao ficam todos no mesmo ponto.
    const xs = new Set([...state.positions.values()].map((position) => Math.round(position.x * 10) / 10))
    const ys = new Set([...state.positions.values()].map((position) => Math.round(position.y * 10) / 10))
    expect(xs.size).toBeGreaterThan(1)
    expect(ys.size).toBeGreaterThan(1)
    // E respeitam os limites do viewBox.
    for (const position of state.positions.values()) {
      expect(position.x).toBeGreaterThanOrEqual(4)
      expect(position.x).toBeLessThanOrEqual(96)
    }
  })
})

describe('ambientWorkerSettled / snapshot', () => {
  it('assenta por energia residual, alpha minimo ou timeout', () => {
    const state = createAmbientWorkerState({
      requestId: 1,
      paths: ['a.md'],
      positions: { 'a.md': { x: 50, y: 50 } },
      edges: [],
      settings,
      startedAt: 0,
    })
    expect(ambientWorkerSettled(state, 0.001, 100)).toBe(true)
    expect(ambientWorkerSettled(state, 5, 100)).toBe(false)
    state.alpha = 0.01
    expect(ambientWorkerSettled(state, 5, 100)).toBe(true)
    state.alpha = 0.5
    expect(ambientWorkerSettled(state, 5, 5000)).toBe(true)
  })

  it('serializa as posicoes em objeto plano', () => {
    const state = createAmbientWorkerState({
      requestId: 1,
      paths: ['a.md'],
      positions: { 'a.md': { x: 12, y: 34 } },
      edges: [],
      settings,
      startedAt: 0,
    })
    expect(ambientWorkerPositionsSnapshot(state)).toEqual({ 'a.md': { x: 12, y: 34 } })
  })
})
