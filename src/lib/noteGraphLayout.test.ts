import { describe, expect, it } from 'vitest'
import {
  accumulateObsidianForces2D,
  graph2dLineTransform,
  GRAPH_2D_BOUNDS,
  GRAPH_2D_WORLD_CENTER,
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
      ['a', { x: 99, y: 100 }],
      ['b', { x: 101, y: 100 }], // d = 2
    ])
    const far = positionsOf([
      ['c', { x: 97, y: 100 }],
      ['d', { x: 103, y: 100 }], // d = 6
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
    // Ambos dentro do anel da center force (dist ao centro 40 < anel 60) e a
    // 80 um do outro (> cutoff 55): so a repulsao 1/d² poderia mover, e ela
    // e ignorada no cutoff — as velocidades permanecem zero.
    const positions = positionsOf([
      ['a', { x: 60, y: 100 }],
      ['b', { x: 140, y: 100 }], // d = 80 > cutoff
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
    const inside = positionsOf([['a', { x: 105, y: 100 }]]) // d ao centro = 5 < anel 60
    const outside = positionsOf([['b', { x: 170, y: 100 }]]) // d ao centro = 70 > anel 60
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

  it('a colisao separa nos colocalizados deterministicamente (+x)', () => {
    // No centro do mundo (sem center force) e sem arestas (sem repulsao em
    // d=0), a UNICA forca sobre o par colocalizado e a colisao: separa o
    // primeiro para -x e o segundo para +x.
    const positions = positionsOf([
      ['a', { x: 100, y: 100 }],
      ['b', { x: 100, y: 100 }],
    ])
    const velocities = velocitiesOf(['a', 'b'])
    accumulateObsidianForces2D({ paths: ['a', 'b'], positions, velocities, delta: 1 / 60 })
    // Raio base 3 + padding 2 = 5 por no; soma 10. push = 10 * collideStrength / 60.
    // Com l = 0 a normal e +x: a e empurrado para +x e b para -x (separam-se).
    const push = (10 * OBSIDIAN_PHYSICS_2D.collideStrength) / 60
    expect(velocities.get('a')!.x).toBeCloseTo(push, 10)
    expect(velocities.get('a')!.y).toBe(0)
    expect(velocities.get('b')!.x).toBeCloseTo(-push, 10)
    expect(velocities.get('b')!.y).toBe(0)
  })

  it('a colisao respeita o contrato de pinned: o fixo empurra mas nao se move', () => {
    const positions = positionsOf([
      ['a', { x: 100, y: 100 }], // fixo (ancora do arrasto): sem velocity
      ['b', { x: 100, y: 100 }], // movente colocalizado
    ])
    const velocities = velocitiesOf(['b'])
    accumulateObsidianForces2D({ paths: ['a', 'b'], positions, velocities, delta: 1 / 60 })
    // b (movente) e empurrado para -x pela colisao com o fixo a (+x).
    const push = (10 * OBSIDIAN_PHYSICS_2D.collideStrength) / 60
    expect(velocities.get('b')!.x).toBeCloseTo(-push, 10)
    expect(velocities.get('a')).toBeUndefined()
  })

  it('pares alem da soma dos raios nao colidem (so a repulsao age)', () => {
    // d = 12 > soma dos raios (5 + 5): a colisao nao contribui; a velocidade
    // e exatamente a predicao da repulsao 1/d² (repulsionStrength / 144 / 60).
    const positions = positionsOf([
      ['a', { x: 100, y: 100 }],
      ['b', { x: 112, y: 100 }],
    ])
    const velocities = velocitiesOf(['a', 'b'])
    accumulateObsidianForces2D({ paths: ['a', 'b'], positions, velocities, delta: 1 / 60 })
    const repulsionOnly = OBSIDIAN_PHYSICS_2D.repulsionStrength / 144 / 60
    expect(velocities.get('a')!.x).toBeCloseTo(-repulsionOnly, 10)
    expect(velocities.get('b')!.x).toBeCloseTo(repulsionOnly, 10)
  })

  it('a centralizacao de hubs puxa nos com muitas conexoes ao centro mesmo dentro do anel', () => {
    // Hub com grau 4 em (130, 100) e 4 vizinhos equidistantes (a 60, alem do
    // cutoff 55 e dos raios de colisao): molas e repulsao se cancelam (neto
    // zero) e so a centralizacao de hubs age — puxa o hub para o centro com
    // forca exata dist * hubCenterStrength = 30 * 0.08.
    const positions = positionsOf([
      ['hub', { x: 130, y: 100 }],
      ['n1', { x: 70, y: 100 }],
      ['n2', { x: 190, y: 100 }],
      ['n3', { x: 130, y: 40 }],
      ['n4', { x: 130, y: 160 }],
    ])
    const velocities = velocitiesOf(['hub', 'n1', 'n2', 'n3', 'n4'])
    accumulateObsidianForces2D({
      paths: ['hub', 'n1', 'n2', 'n3', 'n4'],
      positions,
      velocities,
      edges: [
        { source: 'hub', target: 'n1' },
        { source: 'hub', target: 'n2' },
        { source: 'hub', target: 'n3' },
        { source: 'hub', target: 'n4' },
      ],
      delta: 1 / 60,
    })
    // dx/dist = -1 (hub a direita do centro), pull = 30 * hubCenterStrength.
    expect(velocities.get('hub')!.x).toBeCloseTo(-(30 * OBSIDIAN_PHYSICS_2D.hubCenterStrength) / 60, 10)
    expect(velocities.get('hub')!.y).toBeCloseTo(0, 10)
  })

  it('nos com poucas conexoes nao recebem a centralizacao de hubs (grau < minimo)', () => {
    // No isolado em (140, 100) com grau 0: dentro do anel (dist ao centro 40 <
    // 60) e abaixo do grau minimo da centralizacao — nenhuma forca age.
    const positions = positionsOf([['leaf', { x: 140, y: 100 }]])
    const velocities = velocitiesOf(['leaf'])
    accumulateObsidianForces2D({ paths: ['leaf'], positions, velocities, delta: 1 / 60 })
    expect(velocities.get('leaf')).toEqual({ x: 0, y: 0 })
  })

  it('a mola do grupo puxa os nos para o centro da propria pasta', () => {
    const positions = positionsOf([
      ['a', { x: 90, y: 50 }], // longe do centro do grupo
      ['b', { x: 20, y: 50 }],
    ])
    const velocities = velocitiesOf(['a', 'b'])
    accumulateObsidianForces2D({
      paths: ['a', 'b'],
      positions,
      velocities,
      groupCenters: new Map([
        ['a', { x: 70, y: 50 }],
        ['b', { x: 30, y: 50 }],
      ]),
      groupInnerRadius: 5,
      delta: 1 / 60,
    })
    // a e puxado para a esquerda (ao centro 70); b para a direita (ao 30).
    expect(velocities.get('a')!.x).toBeLessThan(0)
    expect(velocities.get('b')!.x).toBeGreaterThan(0)
  })

  it('a mola do grupo nao age dentro do raio interno (no livre)', () => {
    const positions = positionsOf([['a', { x: 71, y: 50 }]]) // a 1 do centro 70
    const velocities = velocitiesOf(['a'])
    accumulateObsidianForces2D({
      paths: ['a'],
      positions,
      velocities,
      groupCenters: new Map([['a', { x: 70, y: 50 }]]),
      groupInnerRadius: 5,
      delta: 1 / 60,
    })
    expect(velocities.get('a')).toEqual({ x: 0, y: 0 })
  })

  it('o alpha escala a mola do grupo (resfriamento)', () => {
    const full = positionsOf([['a', { x: 90, y: 50 }]])
    const cooled = positionsOf([['b', { x: 90, y: 50 }]])
    const fullVelocities = velocitiesOf(['a'])
    const cooledVelocities = velocitiesOf(['b'])
    accumulateObsidianForces2D({
      paths: ['a'], positions: full, velocities: fullVelocities,
      groupCenters: new Map([['a', { x: 70, y: 50 }]]), groupInnerRadius: 5, delta: 1 / 60,
    })
    accumulateObsidianForces2D({
      paths: ['b'], positions: cooled, velocities: cooledVelocities,
      groupCenters: new Map([['b', { x: 70, y: 50 }]]), groupInnerRadius: 5, alpha: 0.5, delta: 1 / 60,
    })
    expect(Math.abs(cooledVelocities.get('b')!.x)).toBeCloseTo(Math.abs(fullVelocities.get('a')!.x) * 0.5, 10)
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

  it('um grafo estrela assenta em circulo ao redor do hub (atomo/eletrons)', () => {
    // Hub com 15 vizinhos (estrela): depois de relaxar, os vizinhos ficam a
    // distancias uniformes do hub (circulo), o hub no centro do mundo e nenhum
    // par sobreposto (colisao) — o comportamento visual do Obsidian. Espelha
    // o big bang real: anel frouxo inicial (16-26) + decay de assentamento.
    const hub = 'hub'
    const neighbors = Array.from({ length: 15 }, (_, index) => `n-${index}`)
    const all = [hub, ...neighbors]
    const positions = new Map<string, NoteGraphPosition>()
    const velocities = new Map<string, NoteGraphPosition>()
    const edges = neighbors.map((target) => ({ source: hub, target }))
    for (const [index, path] of all.entries()) {
      const angle = (Math.PI * 2 * index) / all.length - Math.PI / 2
      const radius = 20 + (index % 5) * 1.5
      positions.set(path, { x: GRAPH_2D_WORLD_CENTER + Math.cos(angle) * radius, y: GRAPH_2D_WORLD_CENTER + Math.sin(angle) * radius })
      velocities.set(path, { x: 0, y: 0 })
    }
    const settleDecay = Math.max(OBSIDIAN_PHYSICS_2D.velocityDecay, OBSIDIAN_PHYSICS_2D.settleVelocityDecayMin)
    let alpha = 1
    let guard = 0
    while (guard < 600) {
      guard += 1
      // linkRest 30 = padrao do App (settings.linkDistance), nao o fallback 10
      // da funcao — o anel do Obsidian precisa do descanso largo para os
      // vizinhos deslizarem sem travar na colisao.
      accumulateObsidianForces2D({ paths: all, positions, velocities, edges, linkRest: 30, alpha, delta: 1 / 60 })
      let remaining = 0
      for (const path of all) {
        const current = positions.get(path)!
        const velocity = velocities.get(path)!
        const damping = Math.max(0, 1 - settleDecay * (1 / 60))
        velocity.x *= damping
        velocity.y *= damping
        current.x = Math.max(GRAPH_2D_BOUNDS.minX, Math.min(GRAPH_2D_BOUNDS.maxX, current.x + velocity.x * (1 / 60)))
        current.y = Math.max(GRAPH_2D_BOUNDS.minY, Math.min(GRAPH_2D_BOUNDS.maxY, current.y + velocity.y * (1 / 60)))
        remaining += velocity.x * velocity.x + velocity.y * velocity.y
      }
      alpha *= OBSIDIAN_PHYSICS_2D.alphaDecay
      if (remaining < 0.05 || alpha < OBSIDIAN_PHYSICS_2D.alphaMin) break
    }
    const hubPosition = positions.get(hub)!
    const distances = neighbors.map((path) => {
      const current = positions.get(path)!
      return Math.hypot(current.x - hubPosition.x, current.y - hubPosition.y)
    })
    const mean = distances.reduce((sum, distance) => sum + distance, 0) / distances.length
    // Circulo: nenhum vizinho foge do anel (desvio relativo pequeno).
    const maxDeviation = Math.max(...distances.map((distance) => Math.abs(distance - mean) / mean))
    expect(maxDeviation).toBeLessThan(0.25)
    // Hub centralizado (perto do centro do mundo).
    expect(Math.hypot(hubPosition.x - GRAPH_2D_WORLD_CENTER, hubPosition.y - GRAPH_2D_WORLD_CENTER)).toBeLessThan(15)
    // Nenhum par de vizinhos sobreposto (colisao funcionou).
    for (let left = 0; left < neighbors.length; left += 1) {
      for (let right = left + 1; right < neighbors.length; right += 1) {
        const a = positions.get(neighbors[left])!
        const b = positions.get(neighbors[right])!
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(7)
      }
    }
  })

  it('durante o ARRASTO (molas cheias + boost da aresta do no segurado) o cluster segue a folha arrastada', () => {
    // Regressao do "conectados se movem quase a zero": no arrasto, a folha
    // segurada e PINNED e o hub deve ser puxado por ela com MUITO mais
    // velocidade do que no layout ambiente (ponderacao por grau + hub
    // centering brigando com o controle do usuario). O boost de arrasto
    // (dragAnchor/dragSpringBoost) deixa a aresta do no segurado mais rigida
    // — e a alavanca que faz o cluster acompanhar.
    function runDrag(dragMode: boolean) {
      const hub = 'hub'
      const dragged = 'dragged'
      const neighbors = Array.from({ length: 14 }, (_, index) => `n-${index}`)
      const all = [hub, dragged, ...neighbors]
      // Anel pre-assentado (razao 32) para o arrasto nao ser contaminado pela
      // explosao do big bang: so a dinamica de seguimento e medida.
      const positions = new Map<string, NoteGraphPosition>()
      const velocities = new Map<string, NoteGraphPosition>()
      for (const [index, path] of all.entries()) {
        const angle = (Math.PI * 2 * index) / all.length - Math.PI / 2
        positions.set(path, { x: GRAPH_2D_WORLD_CENTER + Math.cos(angle) * 32, y: GRAPH_2D_WORLD_CENTER + Math.sin(angle) * 32 })
        velocities.set(path, { x: 0, y: 0 })
      }
      positions.set(hub, { x: GRAPH_2D_WORLD_CENTER, y: GRAPH_2D_WORLD_CENTER })
      const edges = [dragged, ...neighbors].map((target) => ({ source: hub, target }))
      // A folha arrastada fica PINNED (sem entrada em velocities).
      velocities.delete(dragged)
      const delta = 1 / 60
      for (let frame = 0; frame < 120; frame += 1) {
        // Cursor arrasta a folha continuamente de (100,100) ate (175,100) em
        // 1.5s e segura (arrasto real).
        const targetX = GRAPH_2D_WORLD_CENTER + 75 * Math.min(1, frame / 90)
        positions.get(dragged)!.x = targetX
        accumulateObsidianForces2D({
          paths: all.filter((path) => path !== dragged),
          positions,
          velocities,
          edges,
          linkRest: 30,
          alpha: 1,
          delta,
          // Modo arrasto: molas cheias, sem centralizacao, com boost na
          // aresta do no segurado. Modo layout: ponderado por grau + hub
          // centering (o comportamento ambiente, que congela o cluster).
          springBiasByDegree: dragMode ? false : undefined,
          hubCentering: dragMode ? false : undefined,
          dragAnchor: dragMode ? dragged : undefined,
          dragSpringBoost: dragMode ? OBSIDIAN_PHYSICS_2D.dragSpringBoost : undefined,
        })
        for (const path of all) {
          if (path === dragged) continue
          const current = positions.get(path)!
          const velocity = velocities.get(path)!
          const damping = Math.max(0, 1 - OBSIDIAN_PHYSICS_2D.velocityDecay * delta)
          velocity.x *= damping
          velocity.y *= damping
          current.x += velocity.x * delta
          current.y += velocity.y * delta
        }
      }
      const hubPosition = positions.get(hub)!
      return Math.hypot(hubPosition.x - GRAPH_2D_WORLD_CENTER, hubPosition.y - GRAPH_2D_WORLD_CENTER)
    }
    const dragFollow = runDrag(true) // molas cheias + boost (o arrasto real)
    const layoutFollow = runDrag(false) // ponderado por grau + centralizacao
    // O hub acompanha a folha arrastada com velocidade real no modo arrasto...
    expect(dragFollow).toBeGreaterThan(25)
    // ...e pelo menos 3x mais rapido que o modo layout (que congela o cluster).
    expect(dragFollow).toBeGreaterThan(layoutFollow * 3)
  })

  it('o boost de arrasto so age nas arestas INCIDENTES ao no segurado', () => {
    // Hub conectado a folha arrastada (boost) e a outra folha (sem boost):
    // com a folha arrastada mais longe, so a forca da aresta dela e
    // amplificada — a aresta da outra folha usa a rigidez base.
    const positions = positionsOf([
      ['hub', { x: 100, y: 100 }],
      ['dragged', { x: 175, y: 100 }], // d = 75, com boost
      ['other', { x: 100, y: 130 }], // d = 30, sem boost (descanso: forca 0; perpendicular p/ nao contaminar o eixo x)
    ])
    const velocities = velocitiesOf(['hub', 'other'])
    const edges = [
      { source: 'hub', target: 'dragged' },
      { source: 'hub', target: 'other' },
    ]
    accumulateObsidianForces2D({
      paths: ['hub', 'other', 'dragged'],
      positions,
      velocities,
      edges,
      linkRest: 30,
      alpha: 1,
      delta: 1 / 60,
      springBiasByDegree: false,
      hubCentering: false,
      dragAnchor: 'dragged',
      dragSpringBoost: 4,
    })
    // Aresta boostada (d=75, rigidez 16): puxa o hub com (75-30)*16/60.
    // Aresta em descanso (d=30) nao contribui. O clamp em 60 nao limita aqui.
    // A repulsao hub-other (d=30 < cutoff) so empurra o hub no eixo y (~0.037).
    const boostPull = (75 - 30) * 4 * 4 / 60
    expect(velocities.get('hub')!.x).toBeCloseTo(boostPull, 10)
    expect(Math.abs(velocities.get('hub')!.y)).toBeLessThan(0.05)
  })

  it('graph2dLineTransform liga source -> target com rotacao e escala', () => {
    // Linha horizontal de comprimento 100: sem rotacao nem escala.
    expect(graph2dLineTransform({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe('translate(0 0) rotate(0) scale(1)')
    // Diagonal 45 graus: rotacao 45 e escala 0.7071 (100/141.42).
    const diagonal = graph2dLineTransform({ x: 50, y: 50 }, { x: 100, y: 100 })
    expect(diagonal).toContain('translate(50 50)')
    expect(diagonal).toContain('rotate(45)')
    // Colocalizados (comprimento 0): escala 0 (linha invisivel, sem NaN).
    expect(graph2dLineTransform({ x: 20, y: 30 }, { x: 20, y: 30 })).toBe('translate(20 30) rotate(0) scale(0)')
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
    expect(positions.get('b')!.x).toBeLessThanOrEqual(196)
  })
})
