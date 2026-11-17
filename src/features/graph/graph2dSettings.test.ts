import { describe, expect, it } from 'vitest'
import { buildGraph2dSettings } from './graph2dSettings'
import { OBSIDIAN_PHYSICS } from '../../lib/graph2dSimulation'

const PADRAO = {
  repelStrength: 2000, linkStiffness: 4, velocityDecay: 0.4, linkDistance: 30, centerForce: 100,
  collideRadius: 60, collideStrength: 0.5, recentroSeconds: 2, dragAlpha: 0.3,
  minEdgeLength: 0, maxEdgeLength: 0,
}

describe('buildGraph2dSettings', () => {
  it('os defaults do app caem exatamente nos valores do Obsidian', () => {
    const s = buildGraph2dSettings(PADRAO)
    expect(s.linkDistance).toBe(OBSIDIAN_PHYSICS.linkDistance)
    expect(s.linkStrength).toBe(OBSIDIAN_PHYSICS.linkStrength)
    expect(s.repelStrength).toBe(1000) // `repelStrength: slider^3` no app.js
    expect(s.centerStrength).toBeCloseTo(OBSIDIAN_PHYSICS.centerStrength, 10)
    expect(s.collideRadius).toBe(OBSIDIAN_PHYSICS.collideRadius)
    expect(s.collideStrength).toBe(OBSIDIAN_PHYSICS.collideStrength)
    expect(s.alphaTargetDrag).toBe(OBSIDIAN_PHYSICS.alphaTargetDrag)
    expect(s.recentroSeconds).toBe(2)
    // 0 = sem limite; a escala e a mesma da distancia (30 -> 250).
    expect(s.minEdgeLength).toBe(0)
    expect(s.maxEdgeLength).toBe(0)
  })

  it('zero significa zero — nenhum controle tem piso', () => {
    const s = buildGraph2dSettings({ ...PADRAO, centerForce: 0 })
    // Era aqui que o slider mentia: com piso de 0.1 o no continuava sendo
    // puxado para o centro mesmo com o campo em 0.
    expect(s.centerStrength).toBe(0)
    expect(buildGraph2dSettings({ ...PADRAO, repelStrength: 0 }).repelStrength).toBe(0)
    expect(buildGraph2dSettings({ ...PADRAO, linkStiffness: 0 }).linkStrength).toBe(0)
    expect(buildGraph2dSettings({ ...PADRAO, linkDistance: 0 }).linkDistance).toBe(0)
  })

  it('limites de aresta usam a mesma escala da distancia', () => {
    const s = buildGraph2dSettings({ ...PADRAO, minEdgeLength: 15, maxEdgeLength: 60 })
    expect(s.minEdgeLength).toBeCloseTo(125, 10)
    expect(s.maxEdgeLength).toBeCloseTo(500, 10)
  })

  it('escala proporcional nos valores intermediarios', () => {
    const s = buildGraph2dSettings({ ...PADRAO, linkDistance: 60, centerForce: 250, repelStrength: 4000 })
    expect(s.linkDistance).toBeCloseTo(500, 10)
    expect(s.centerStrength).toBeCloseTo(0.25, 10)
    expect(s.repelStrength).toBeCloseTo(2000, 10)
  })
})
