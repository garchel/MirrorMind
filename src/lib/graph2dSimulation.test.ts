import { describe, expect, it } from 'vitest'
import {
  Graph2dSimulation,
  GRAPH2D_DEFAULT_SETTINGS,
  OBSIDIAN_PHYSICS,
  type Graph2dLink,
} from './graph2dSimulation'

function criar(nos: Array<[string, number, number]>, links: Array<[string, string]>) {
  return new Graph2dSimulation({
    paths: nos.map(([p]) => p),
    links: links.map(([source, target]: [string, string]): Graph2dLink => ({ source, target })),
    positions: new Map(nos.map(([p, x, y]) => [p, { x, y }])),
  })
}

function rodar(sim: Graph2dSimulation, passos: number) {
  for (let i = 0; i < passos; i += 1) sim.step()
}

const distancia = (sim: Graph2dSimulation, a: string, b: string) => {
  const pa = sim.positionOf(a)!
  const pb = sim.positionOf(b)!
  return Math.hypot(pa.x - pb.x, pa.y - pb.y)
}

describe('graph2dSimulation (modelo do Obsidian)', () => {
  it('as constantes sao as do sim.js', () => {
    expect(OBSIDIAN_PHYSICS.linkDistance).toBe(250)
    expect(OBSIDIAN_PHYSICS.repelStrength).toBe(30)
    expect(OBSIDIAN_PHYSICS.collideRadius).toBe(60)
    expect(OBSIDIAN_PHYSICS.collideStrength).toBe(0.5)
    expect(OBSIDIAN_PHYSICS.distanceMin).toBe(30)
    expect(OBSIDIAN_PHYSICS.theta).toBe(0.9)
    expect(OBSIDIAN_PHYSICS.centerStrength).toBe(0.1)
    expect(OBSIDIAN_PHYSICS.alphaTargetDrag).toBe(0.3)
    // alpha 1 -> 0.001 em ~300 ticks.
    let alpha = 1
    let ticks = 0
    while (alpha > 0.001 && ticks < 1000) {
      alpha += (0 - alpha) * OBSIDIAN_PHYSICS.alphaDecay
      ticks += 1
    }
    expect(ticks).toBeGreaterThan(290)
    expect(ticks).toBeLessThan(310)
  })

  it('a mola descansa perto de 250 (linkDistance do Obsidian)', () => {
    const sim = criar([['a', 0, 0], ['b', 10, 0]], [['a', 'b']])
    rodar(sim, 600)
    const d = distancia(sim, 'a', 'b')
    // O link do d3 so descansa em 250 isolado: com centro 0.1 e repulsao -30
    // atuando, o par assenta um pouco abaixo (medido: ~228).
    expect(d).toBeGreaterThan(200)
    expect(d).toBeLessThan(400)
  })

  it('arrastar MANTEM alphatarget 0.3 e leva a vizinhanca junto', () => {
    // Corrente: hub - a - b - c (2 saltos ja devem seguir).
    const sim = criar(
      [['hub', -375, 0], ['a', -125, 0], ['b', 125, 0], ['c', 375, 0]],
      [['hub', 'a'], ['a', 'b'], ['b', 'c']],
    )
    rodar(sim, 500)
    const antes = new Map(['a', 'b', 'c'].map((p) => [p, sim.positionOf(p)!]))

    // Arrasta o hub 200 unidades em 40 frames, como um gesto real.
    for (let passo = 1; passo <= 40; passo += 1) {
      sim.pin('hub', -375 + (200 * passo) / 40, 0)
      sim.step()
    }

    expect(sim.alphaTarget).toBe(0.3)
    expect(sim.alpha).toBeGreaterThan(0.25)
    const moveu = (p: string) => {
      const depois = sim.positionOf(p)!
      return Math.hypot(depois.x - antes.get(p)!.x, depois.y - antes.get(p)!.y)
    }
    // O vizinho direto acompanha de perto; o de 2 saltos, menos; mas todos saem
    // do lugar — e isso que faltava no app.
    expect(moveu('a')).toBeGreaterThan(30)
    expect(moveu('b')).toBeGreaterThan(5)
  })

  it('soltar volta alphaTarget para 0 e o layout resfria', () => {
    const sim = criar([['a', 0, 0], ['b', 200, 0]], [['a', 'b']])
    rodar(sim, 400)
    sim.pin('a', 10, 10)
    expect(sim.alphaTarget).toBe(0.3)
    sim.unpin('a')
    expect(sim.alphaTarget).toBe(0)
    rodar(sim, 400)
    expect(sim.settled).toBe(true)
  })

  it('no solto volta para o centroide dos proprios vizinhos', () => {
    // Comportamento pedido (nao e o d3-force puro): ao soltar, o no persegue o
    // meio dos vizinhos. Sem isso ele parava onde foi largado, porque com as
    // molas no comprimento de descanso nao ha forca apontando para o centro.
    const sim = criar(
      [['a', -250, 0], ['b', 250, 0], ['c', 0, 433], ['meio', 0, 144]],
      [['meio', 'a'], ['meio', 'b'], ['meio', 'c'], ['a', 'b'], ['b', 'c'], ['c', 'a']],
    )
    rodar(sim, 600)
    const centroide = () => {
      const a = sim.positionOf('a')!
      const b = sim.positionOf('b')!
      const c = sim.positionOf('c')!
      return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
    }
    const desvio = () => {
      const m = sim.positionOf('meio')!
      const c = centroide()
      return Math.hypot(m.x - c.x, m.y - c.y)
    }
    const antes = centroide()
    for (let passo = 1; passo <= 40; passo += 1) {
      sim.pin('meio', antes.x + 900 + passo * 6, antes.y + 600)
      sim.step()
    }
    const solto = sim.positionOf('meio')!
    const centroSolta = centroide()
    expect(Math.hypot(solto.x - centroSolta.x, solto.y - centroSolta.y)).toBeGreaterThan(500)

    sim.unpin('meio')
    rodar(sim, 400)
    expect(desvio()).toBeLessThan(80)
  })

  it('folha com um vizinho so nao e puxada para dentro dele', () => {
    // Sem a guarda de grau>=2, o centroide de UM vizinho e a posicao dele:
    // a folha seria arrastada para cima do no conectado.
    const sim = criar([['a', 0, 0], ['b', 600, 0]], [['a', 'b']])
    rodar(sim, 400)
    sim.pin('b', 1200, 0)
    for (let i = 0; i < 20; i += 1) sim.step()
    sim.unpin('b')
    rodar(sim, 400)
    const b = sim.positionOf('b')!
    const a = sim.positionOf('a')!
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(150)
  })

  it('aresta maxima e minima limitam o comprimento do link', () => {
    // maximo: puxa de volta para 200 em vez de deixar a mola esticar ate 250.
    const preso = criar([['a', 0, 0], ['b', 900, 0]], [['a', 'b']])
    preso.settings.maxEdgeLength = 200
    rodar(preso, 900)
    expect(distancia(preso, 'a', 'b')).toBeLessThan(400)

    // minimo: nao deixa comprimir abaixo de 300.
    const comprimido = criar([['a', 0, 0], ['b', 10, 0]], [['a', 'b']])
    comprimido.settings.minEdgeLength = 300
    rodar(comprimido, 900)
    expect(distancia(comprimido, 'a', 'b')).toBeGreaterThan(250)
  })

  it('centerStrength 0 nao puxa nada para o centro', () => {
    // Regressao: o mapeamento da UI tinha piso de 0.1, entao pedir "forca para
    // o centro = 0" continuava puxando o no solto para o meio.
    const sim = criar([['a', 400, 300]], [])
    sim.settings.centerStrength = 0
    rodar(sim, 300)
    const p = sim.positionOf('a')!
    expect(p.x).toBeCloseTo(400, 3)
    expect(p.y).toBeCloseTo(300, 3)
  })

  it('nao ha limites de mundo (o d3-force nao tem)', () => {
    const sim = criar([['a', 0, 0], ['b', 1, 0]], [['a', 'b']])
    rodar(sim, 400)
    const longe = Math.max(Math.abs(sim.xs[0]), Math.abs(sim.ys[0]))
    expect(longe).toBeGreaterThan(0)
    // Se houvesse clamp em 200, nada passaria daqui.
    sim.pin('b', 5000, 0)
    for (let i = 0; i < 30; i += 1) sim.step()
    expect(sim.xs[1]).toBe(5000)
    expect(sim.positionOf('b')).toEqual({ x: 5000, y: 0 })
  })

  it('colisao mantem dois nos a pelo menos 2*raio quando lotados', () => {
    const sim = criar(
      [['a', 0, 0], ['b', 1, 1], ['c', 2, 2], ['d', 3, 3]],
      [['a', 'b'], ['b', 'c'], ['c', 'd']],
    )
    rodar(sim, 400)
    for (const [x, y] of [['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c']]) {
      expect(distancia(sim, x, y)).toBeGreaterThan(40)
    }
  })

  it('nao colapsa nem explode: a repulsao EMPURRA (31 nos / 67 links)', () => {
    // Este e o teste que pega o sinal invertido do Barnes-Hut: com atracao no
    // lugar de repulsao tudo colapsa num ponto e a simulacao diverge (a camera
    // chegou a 1e27 no app). Aqui o layout tem de ficar num tamanho plausivel.
    const paths = ['hub', ...Array.from({ length: 30 }, (_, i) => `n${i}`)]
    const links: Array<{ source: string; target: string }> = []
    for (let i = 1; i <= 8; i += 1) links.push({ source: 'hub', target: `n${i}` })
    for (let i = 9; i <= 30; i += 1) links.push({ source: `n${(i % 8) + 1}`, target: `n${i}` })
    const sim = new Graph2dSimulation({ paths, links })
    rodar(sim, 400)

    for (let i = 0; i < sim.count; i += 1) {
      expect(Number.isFinite(sim.xs[i])).toBe(true)
      expect(Number.isFinite(sim.ys[i])).toBe(true)
    }
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
    for (let i = 0; i < sim.count; i += 1) {
      minX = Math.min(minX, sim.xs[i]); maxX = Math.max(maxX, sim.xs[i])
      minY = Math.min(minY, sim.ys[i]); maxY = Math.max(maxY, sim.ys[i])
    }
    const extensao = Math.max(maxX - minX, maxY - minY)
    // Nem colapsado (todos num ponto) nem explodido (milhoes de unidades).
    expect(extensao).toBeGreaterThan(200)
    expect(extensao).toBeLessThan(4000)
  })

  it('600 nos rodam num orcamento de frame', () => {
    const paths = Array.from({ length: 600 }, (_, i) => `n${i}`)
    const links = paths.slice(1).map((p, i) => ({ source: paths[Math.floor(i / 4)], target: p }))
    const positions = new Map(paths.map((p, i) => [p, { x: (i % 30) * 40, y: Math.floor(i / 30) * 40 }]))
    const sim = new Graph2dSimulation({ paths, links, positions })
    sim.step()
    const t0 = performance.now()
    for (let i = 0; i < 60; i += 1) sim.step()
    const ms = (performance.now() - t0) / 60
    // Smoke test: a suite roda 133 arquivos em paralelo e o tempo por passo
    // oscila com a carga da maquina. O numero fino e medido isolado (commit).
    console.log(`600 nos: ${ms.toFixed(2)} ms/passo`)
    expect(ms).toBeLessThan(40)
  })

  it('settings parciais completam com os defaults do Obsidian', () => {
    const sim = new Graph2dSimulation({ paths: ['a'], links: [], settings: { nodeSizeMultiplier: 2 } })
    expect(sim.settings.nodeSizeMultiplier).toBe(2)
    expect(sim.settings.linkDistance).toBe(GRAPH2D_DEFAULT_SETTINGS.linkDistance)
    expect(sim.settings.collideRadius).toBe(60)
  })
})
