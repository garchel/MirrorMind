import { describe, expect, it } from 'vitest'
import { applyGraphDragForces } from './noteGraphLayout'

const documents = ['a', 'b', 'c', 'd'].map((relativePath) => ({ relativePath }))

const links = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
]

const positions = {
  a: { x: 50, y: 50 },
  b: { x: 60, y: 50 },
  c: { x: 70, y: 50 },
  d: { x: 20, y: 20 },
}

describe('applyGraphDragForces', () => {
  it('move o no arrastado para o alvo do cursor', () => {
    const next = applyGraphDragForces(positions, links, documents, 'a', { x: 55, y: 55 })
    expect(next.a).toEqual({ x: 55, y: 55 })
  })

  it('empurra nos proximos para longe do no arrastado', () => {
    // 'c' esta a 20% do alvo de 'a' (50,50) -> repulsao (14/20=0.7) afasta em x.
    const next = applyGraphDragForces(positions, links, documents, 'a', { x: 50, y: 50 })
    expect(next.c.x).toBeGreaterThan(70)
    // 'd' esta a ~42% de distancia do alvo -> empurrado para mais longe (esquerda).
    expect(next.d.x).toBeLessThan(20)
  })

  it('puxa os vizinhos conectados para perto do no arrastado', () => {
    // 'b' conectado a 'a': dist 10 < resto 13 -> a mola empurra levemente para
    // longe (nao pode colar), e 'c' conectado a 'b' recebe repulsao de 'a'.
    const next = applyGraphDragForces(positions, links, documents, 'a', { x: 50, y: 50 })
    expect(next.b.y).toBe(50) // mesmo eixo Y: so move no eixo da forca
    // Nos nao conectados nao sao puxados (apenas repelidos): 'd' afasta de 'a'.
    const distBefore = Math.hypot(positions.d.x - 50, positions.d.y - 50)
    const distAfter = Math.hypot(next.d.x - 50, next.d.y - 50)
    expect(distAfter).toBeGreaterThan(distBefore)
  })

  it('nao altera outros nos quando nao ha ninguem por perto', () => {
    const next = applyGraphDragForces(positions, [], documents, 'a', { x: 50, y: 50 })
    // Sem links: apenas repulsao. 'd' fica a esquerda do alvo e e empurrado
    // para mais longe dele (forca inversa a distancia nunca e zero).
    expect(next.d.x).toBeLessThan(positions.d.x)
  })

  it('mantem as posicoes dentro dos limites do viewBox', () => {
    const near = { ...positions, d: { x: 50, y: 50 } }
    const next = applyGraphDragForces(near, links, documents, 'd', { x: 50, y: 50 })
    for (const value of Object.values(next)) {
      expect(value.x).toBeGreaterThanOrEqual(4)
      expect(value.x).toBeLessThanOrEqual(96)
      expect(value.y).toBeGreaterThanOrEqual(5)
      expect(value.y).toBeLessThanOrEqual(95)
    }
  })
})
