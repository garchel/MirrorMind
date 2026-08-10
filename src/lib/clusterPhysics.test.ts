import { describe, expect, it } from 'vitest'
import { accumulateClusterForces, accumulateOrbitForces, computeOrbitTarget, ORBIT_PHYSICS, type OrbitElectronState, type Vec3 } from './clusterPhysics'

function makeCluster(positions: Record<string, Vec3>) {
  const positionMap = new Map<string, Vec3>()
  for (const [path, position] of Object.entries(positions)) positionMap.set(path, { ...position })
  const velocityMap = new Map<string, Vec3>()
  for (const path of Object.keys(positions)) velocityMap.set(path, { x: 0, y: 0, z: 0 })
  return { positionMap, velocityMap }
}

describe('accumulateClusterForces', () => {
  it('empurra nos sobrepostos para longe um do outro (repulsao par-a-par)', () => {
    // Ancora longe e molas no descanso (rest = distancia real ao ancora):
    // so a repulsao par-a-par age, separando a (-x) e b (+x).
    const { positionMap, velocityMap } = makeCluster({
      a: { x: 0, y: 0, z: 0 },
      b: { x: 1, y: 0, z: 0 },
    })
    accumulateClusterForces({
      anchor: { x: 100, y: 0, z: 0 },
      paths: ['a', 'b'],
      positions: positionMap,
      velocities: velocityMap,
      restDistances: new Map([['a', 100], ['b', 99]]),
      factors: new Map(),
      internalEdges: [],
      delta: 1 / 60,
    })
    expect(velocityMap.get('a')!.x).toBeLessThan(0)
    expect(velocityMap.get('b')!.x).toBeGreaterThan(0)
  })

  it('puxa o no para o ancora quando a aresta esta esticada', () => {
    const { positionMap, velocityMap } = makeCluster({ a: { x: 12, y: 0, z: 0 } })
    accumulateClusterForces({
      anchor: { x: 0, y: 0, z: 0 },
      paths: ['a'],
      positions: positionMap,
      velocities: velocityMap,
      restDistances: new Map([['a', 4]]),
      factors: new Map([['a', 1]]),
      internalEdges: [],
      delta: 1 / 60,
    })
    // dist 12 > descanso 4 -> mola puxa em direcao ao ancora (-x).
    expect(velocityMap.get('a')!.x).toBeLessThan(0)
  })

  it('empurra o no para longe do ancora quando estao colados', () => {
    const { positionMap, velocityMap } = makeCluster({ a: { x: 2, y: 0, z: 0 } })
    accumulateClusterForces({
      anchor: { x: 0, y: 0, z: 0 },
      paths: ['a'],
      positions: positionMap,
      velocities: velocityMap,
      restDistances: new Map([['a', 10]]),
      factors: new Map([['a', 1]]),
      internalEdges: [],
      delta: 1 / 60,
    })
    // dist 2 < descanso 10 -> mola empurra para longe (+x).
    expect(velocityMap.get('a')!.x).toBeGreaterThan(0)
  })

  it('preserva a distancia das arestas internas do cluster', () => {
    // Molas para o ancora no descanso (rest = distancia real): so a aresta
    // interna age — dist 2 < descanso 7, entao a e b se afastam.
    const { positionMap, velocityMap } = makeCluster({
      a: { x: 0, y: 0, z: 0 },
      b: { x: 2, y: 0, z: 0 },
    })
    accumulateClusterForces({
      anchor: { x: 100, y: 100, z: 100 },
      paths: ['a', 'b'],
      positions: positionMap,
      velocities: velocityMap,
      restDistances: new Map([['a', Math.hypot(100, 100, 100)], ['b', Math.hypot(98, 100, 100)]]),
      factors: new Map(),
      internalEdges: [['a', 'b']],
      delta: 1 / 60,
    })
    expect(velocityMap.get('a')!.x).toBeLessThan(0)
    expect(velocityMap.get('b')!.x).toBeGreaterThan(0)
  })

  it('nao aplica forca ao ancora (permanece fixo)', () => {
    const { positionMap, velocityMap } = makeCluster({
      a: { x: 3, y: 0, z: 0 },
      b: { x: 0, y: 3, z: 0 },
    })
    const anchorBefore = { ...positionMap.get('a')! }
    accumulateClusterForces({
      anchor: positionMap.get('a')!,
      paths: ['b'],
      positions: positionMap,
      velocities: velocityMap,
      restDistances: new Map(),
      factors: new Map(),
      internalEdges: [],
      delta: 1 / 60,
    })
    // O ancora (a) nao esta em paths: posicao intacta e sem velocidade.
    expect(positionMap.get('a')).toEqual(anchorBefore)
    expect(velocityMap.get('a')!.x).toBe(0)
    expect(velocityMap.get('a')!.y).toBe(0)
    expect(velocityMap.get('a')!.z).toBe(0)
  })

  it('puxa de volta extremos de arestas alem do comprimento maximo', () => {
    // a (movido) esta a 20 unidades de b: alem do maximo (14) -> puxado para b.
    const { positionMap, velocityMap } = makeCluster({
      a: { x: 0, y: 0, z: 0 },
      b: { x: 20, y: 0, z: 0 },
    })
    accumulateClusterForces({
      anchor: { x: 0, y: 0, z: 0 },
      paths: ['a', 'b'],
      positions: positionMap,
      velocities: velocityMap,
      restDistances: new Map(),
      factors: new Map(),
      internalEdges: [],
      maxEdgePairs: [['a', 'b']],
      delta: 1 / 60,
    })
    // a e puxado para +x (em direcao a b) e b para -x (em direcao a a).
    expect(velocityMap.get('a')!.x).toBeGreaterThan(0)
    expect(velocityMap.get('b')!.x).toBeLessThan(0)
  })

  it('empurra para longe extremos de arestas abaixo do comprimento minimo', () => {
    // Ancora longe e molas no descanso (rest = distancia real): so a forca do
    // comprimento minimo age — a e b a 0.5 unidade (abaixo do minimo 2.5).
    const { positionMap, velocityMap } = makeCluster({
      a: { x: 0, y: 0, z: 0 },
      b: { x: 0.5, y: 0, z: 0 },
    })
    accumulateClusterForces({
      anchor: { x: 50, y: 50, z: 50 },
      paths: ['a', 'b'],
      positions: positionMap,
      velocities: velocityMap,
      restDistances: new Map([['a', Math.hypot(50, 50, 50)], ['b', Math.hypot(49.5, 50, 50)]]),
      factors: new Map(),
      internalEdges: [],
      maxEdgePairs: [['a', 'b']],
      delta: 1 / 60,
    })
    // a vai para -x (longe de b) e b para +x (longe de a).
    expect(velocityMap.get('a')!.x).toBeLessThan(0)
    expect(velocityMap.get('b')!.x).toBeGreaterThan(0)
  })
})

describe('accumulateOrbitForces', () => {
  function electron(path: string, angle: number, extra: Partial<OrbitElectronState> = {}): OrbitElectronState {
    return {
      path,
      radius: 5,
      angle,
      angularSpeed: 1,
      inclination: Math.PI / 2,
      azimuth: 0,
      precessionSpeed: 0,
      velocity: { x: 0, y: 0, z: 0 },
      ...extra,
    }
  }

  it('avanca o angulo e puxa o eletron para o ponto da orbita ao redor do nucleo', () => {
    const nucleus = { x: 0, y: 0, z: 0 }
    const positions = new Map<string, Vec3>([['e', { x: 5, y: 0, z: 0 }]])
    const e = electron('e', 0)
    accumulateOrbitForces({ nucleus, electrons: [e], positions, edges: [], delta: 1 / 60 })
    // Angulo avancou e a mola leva o eletron em direcao ao ponto da orbita.
    expect(e.angle).toBeGreaterThan(0)
    const target = computeOrbitTarget(nucleus, e)
    const towards = { x: target.x - 5, y: target.y - 0, z: target.z - 0 }
    const dot = e.velocity.x * towards.x + e.velocity.y * towards.y + e.velocity.z * towards.z
    expect(dot).toBeGreaterThan(0)
    // O nucleo nao recebe velocidade (nunca e mutado).
    expect(nucleus).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('precessa o plano orbital ao longo do tempo (orbita varre a esfera)', () => {
    const nucleus = { x: 0, y: 0, z: 0 }
    const positions = new Map<string, Vec3>([['e', { x: 5, y: 0, z: 0 }]])
    const e = electron('e', 0, { inclination: Math.PI / 3, precessionSpeed: 0.4 })
    const initialTarget = computeOrbitTarget(nucleus, e)
    // Avanca 30 quadros: o azimute gira e o ponto da orbita muda de plano.
    for (let frame = 0; frame < 30; frame += 1) {
      accumulateOrbitForces({ nucleus, electrons: [e], positions, edges: [], delta: 1 / 60 })
    }
    expect(e.azimuth).toBeGreaterThan(0.1)
    const precessedTarget = computeOrbitTarget(nucleus, e)
    expect(Math.hypot(
      precessedTarget.x - initialTarget.x,
      precessedTarget.y - initialTarget.y,
      precessedTarget.z - initialTarget.z,
    )).toBeGreaterThan(0.1)
  })

  it('distribui os planos orbitais em 3D (esfera, nao circulo chapado)', () => {
    const nucleus = { x: 0, y: 0, z: 0 }
    // Altura maxima que cada orbita atinge (|y|) ao longo de uma volta.
    const maxAbsY = (state: OrbitElectronState) => {
      let maxY = 0
      for (let step = 0; step < 24; step += 1) {
        const target = computeOrbitTarget(nucleus, { ...state, angle: (step / 24) * Math.PI * 2 })
        maxY = Math.max(maxY, Math.abs(target.y))
      }
      return maxY
    }
    // Plano equatorial (inclinacao ~0): orbita fica no plano horizontal.
    const equatorial = electron('eq', 0, { inclination: 0.05, azimuth: 0 })
    expect(maxAbsY(equatorial)).toBeLessThan(0.5)
    // Plano vertical: a orbita varre toda a altura (y ~ raio).
    const vertical = electron('ve', 0, { inclination: Math.PI / 2, azimuth: 0 })
    expect(maxAbsY(vertical)).toBeGreaterThan(3)
    // Plano inclinado: num mesmo instante o ponto tem x, y e z nao nulos.
    const tilted = electron('ti', 0, { inclination: Math.PI / 3, azimuth: 0.7 })
    const tiltedTarget = computeOrbitTarget(nucleus, { ...tilted, angle: Math.PI / 4 })
    expect(Math.abs(tiltedTarget.x)).toBeGreaterThan(0.5)
    expect(Math.abs(tiltedTarget.y)).toBeGreaterThan(0.5)
    expect(Math.abs(tiltedTarget.z)).toBeGreaterThan(0.5)
  })

  it('repulsa eletrons sobrepostos na mesma orbita', () => {
    const nucleus = { x: 0, y: 0, z: 0 }
    // Eletrons no proprio ponto da orbita (mola em repouso) e sobrepostos:
    // com inclinacao pi/2 e azimute 0, o alvo fica em (0,0,-5).
    const positions = new Map<string, Vec3>([
      ['a', { x: 0, y: 0, z: -5 }],
      ['b', { x: 1, y: 0, z: -5 }],
    ])
    const a = electron('a', 0)
    const b = electron('b', 0)
    accumulateOrbitForces({ nucleus, electrons: [a, b], positions, edges: [], delta: 1 / 60 })
    // a empurra b para +x (afasta) e b empurra a para -x.
    expect(a.velocity.x).toBeLessThan(0)
    expect(b.velocity.x).toBeGreaterThan(0)
  })

  it('puxa eletrons de volta quando a aresta excede o comprimento maximo', () => {
    const nucleus = { x: 0, y: 0, z: 0 }
    // a e b a 20 unidades de distancia (acima do maximo de 14).
    const positions = new Map<string, Vec3>([
      ['a', { x: 0, y: 0, z: 0 }],
      ['b', { x: 20, y: 0, z: 0 }],
    ])
    const a = electron('a', 0, { radius: 0.5 })
    const b = electron('b', 0, { radius: 0.5 })
    accumulateOrbitForces({ nucleus, electrons: [a, b], positions, edges: [['a', 'b']], delta: 1 / 60 })
    // a vai para +x (em direcao a b) e b para -x.
    expect(a.velocity.x).toBeGreaterThan(0)
    expect(b.velocity.x).toBeLessThan(0)
    // Garante que a constante usada nos testes e a mesma do modulo.
    expect(ORBIT_PHYSICS.maxEdgeLength).toBe(14)
  })

  it('empurra eletrons conectados que estao abaixo do comprimento minimo', () => {
    const nucleus = { x: 0, y: 0, z: 0 }
    // a e b a 0.5 unidade (abaixo do minimo 2.5) com aresta entre eles.
    const positions = new Map<string, Vec3>([
      ['a', { x: 0, y: 0, z: 0 }],
      ['b', { x: 0.5, y: 0, z: 0 }],
    ])
    const a = electron('a', 0, { radius: 0.5 })
    const b = electron('b', 0, { radius: 0.5 })
    accumulateOrbitForces({ nucleus, electrons: [a, b], positions, edges: [['a', 'b']], delta: 1 / 60 })
    expect(a.velocity.x).toBeLessThan(0)
    expect(b.velocity.x).toBeGreaterThan(0)
    expect(ORBIT_PHYSICS.minEdgeLength).toBe(2.5)
  })
})
