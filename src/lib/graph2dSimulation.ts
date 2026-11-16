/**
 * Grafo 2D — porte fiel do simulador do Obsidian.
 *
 * Fonte: `sim.js` (17.693 bytes) de dentro do `obsidian.asar` instalado nesta
 * maquina, lido por engenharia reversa. O simulador do Obsidian e o d3-force
 * com estes numeros (constantes do proprio bundle):
 *
 *   centro ....... forceX(0).strength(0.1) + forceY(0).strength(0.1)
 *   link ......... .id(d => d.id).distance(250)
 *                  strength = linkStrength * (1/min(grau dos dois))  [default d3]
 *   muitas-corpos .strength(-30).distanceMin(30).theta(0.9)
 *   colisao ...... .radius(60).strength(0.5)
 *   integracao ... null == fx ? (x += vx *= .6) : (x = fx, vx = 0)
 *   alpha ........ 1 -> 0.001 em ~300 ticks (alphaDecay = 1 - 0.001^(1/300))
 *   arrasto ...... forceNode{id,x,y} + alphaTarget .3        (app.js)
 *                  soltar -> forceNode{x:null,y:null} + alphaTarget 0
 *
 * Nao ha limites de mundo: o d3-force tambem nao tem. O enquadramento e da
 * camera (zoom/pan), como no Obsidian.
 *
 * Nada de codigo do Obsidian foi copiado — o bundle e proprietario. O que veio
 * dele sao as constantes e a semantica das forcas.
 */

export type Graph2dSettings = {
  /** Distancia de descanso das molas (Obsidian: 250). */
  linkDistance: number
  /** Multiplicador da rigidez (Obsidian: 1; o link usa 1/min(grau)). */
  linkStrength: number
  /** Repulsao em modulo (Obsidian: 30; internamente vira -repelStrength). */
  repelStrength: number
  /** Atracao para a origem. Obsidian: 0.1. */
  centerStrength: number
  /** Raio de colisao (Obsidian: 60). */
  collideRadius: number
  /** Intensidade da colisao (Obsidian: 0.5). */
  collideStrength: number
  /** Raio VISUAL do no no espaco do mundo (Obsidian: 5 x multiplicador). */
  nodeSize: number
}

/** Constantes do `sim.js`, para os testes e para a UI partir delas. */
export const OBSIDIAN_PHYSICS = {
  centerStrength: 0.1,
  linkDistance: 250,
  linkStrength: 1,
  repelStrength: 30,
  distanceMin: 30,
  theta: 0.9,
  collideRadius: 60,
  collideStrength: 0.5,
  /** `vx *= .6` no sim.js (equivalente a velocityDecay 0.4 do d3). */
  velocityDecay: 0.4,
  /** alpha 1 -> 0.001 em ~300 ticks. */
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  /** alphaTarget que o app.js manda enquanto arrasta. */
  alphaTargetDrag: 0.3,
  /** Abaixo disso a simulacao dorme. */
  alphaSleep: 0.001,
  /** Raio visual do no (antes do multiplicador). */
  nodeSize: 5,
} as const

export const GRAPH2D_DEFAULT_SETTINGS: Graph2dSettings = {
  linkDistance: OBSIDIAN_PHYSICS.linkDistance,
  linkStrength: OBSIDIAN_PHYSICS.linkStrength,
  repelStrength: OBSIDIAN_PHYSICS.repelStrength,
  centerStrength: OBSIDIAN_PHYSICS.centerStrength,
  collideRadius: OBSIDIAN_PHYSICS.collideRadius,
  collideStrength: OBSIDIAN_PHYSICS.collideStrength,
  nodeSize: OBSIDIAN_PHYSICS.nodeSize,
}

export type Graph2dLink = { source: string; target: string }

const THETA2 = OBSIDIAN_PHYSICS.theta * OBSIDIAN_PHYSICS.theta
const MAX_DEPTH = 14
const QUAD_STACK = new Int32Array(1 << 16)

type Quad = {
  x: Float64Array
  y: Float64Array
  mass: Float64Array
  size: Float64Array
  body: Int32Array
  child: Int32Array
  count: number
  capacity: number
}

function createQuad(capacity: number): Quad {
  return {
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    mass: new Float64Array(capacity),
    size: new Float64Array(capacity),
    body: new Int32Array(capacity).fill(-1),
    child: new Int32Array(capacity * 4).fill(-1),
    count: 0,
    capacity,
  }
}

function growQuad(quad: Quad): void {
  const capacity = quad.capacity * 2
  const x = new Float64Array(capacity); x.set(quad.x); quad.x = x
  const y = new Float64Array(capacity); y.set(quad.y); quad.y = y
  const mass = new Float64Array(capacity); mass.set(quad.mass); quad.mass = mass
  const size = new Float64Array(capacity); size.set(quad.size); quad.size = size
  const body = new Int32Array(capacity).fill(-1); body.set(quad.body); quad.body = body
  const child = new Int32Array(capacity * 4).fill(-1); child.set(quad.child); quad.child = child
  quad.capacity = capacity
}

export class Graph2dSimulation {
  readonly paths: string[]
  readonly indexByPath: Map<string, number>
  readonly count: number
  readonly xs: Float32Array
  readonly ys: Float32Array
  readonly vxs: Float32Array
  readonly vys: Float32Array
  /** Pares achatados [a0,b0,a1,b1,...]. */
  readonly edgePairs: Int32Array
  /** Grau de cada no (bias do link = 1/min(grau dos dois)). */
  readonly degree: Int32Array
  /** Buffer de leitura [x0,y0,x1,y1,...]. */
  readonly buffer: Float32Array
  readonly pinned = new Map<number, { x: number; y: number }>()
  settings: Graph2dSettings
  alpha: number
  alphaTarget = 0

  private readonly quad: Quad
  private readonly buckets = new Map<number, number[]>()
  private readonly bucketKeys: number[] = []

  constructor(input: {
    paths: string[]
    links: Graph2dLink[]
    positions?: Map<string, { x: number; y: number }>
    settings?: Partial<Graph2dSettings>
  }) {
    const { paths, links, positions } = input
    this.paths = paths
    this.count = paths.length
    this.settings = { ...GRAPH2D_DEFAULT_SETTINGS, ...input.settings }
    this.indexByPath = new Map(paths.map((path, index) => [path, index]))
    const n = this.count
    this.xs = new Float32Array(n)
    this.ys = new Float32Array(n)
    this.vxs = new Float32Array(n)
    this.vys = new Float32Array(n)
    this.buffer = new Float32Array(n * 2)
    this.degree = new Int32Array(n)
    // Sem posicoes salvas: disco aleatorio. Largar todos num pontinho faz a
    // colisao (raio 60) explodir o grafo em poucos frames — o Obsidian tambem
    // distribui os nos ao abrir.
    const raioInicial = Math.max(60, this.settings.linkDistance * 0.9 * Math.sqrt(Math.max(1, n) / 8))
    for (let i = 0; i < n; i += 1) {
      const p = positions?.get(paths[i])
      if (p) { this.xs[i] = p.x; this.ys[i] = p.y; continue }
      const angulo = Math.random() * Math.PI * 2
      const raio = raioInicial * Math.sqrt(Math.random())
      this.xs[i] = Math.cos(angulo) * raio
      this.ys[i] = Math.sin(angulo) * raio
    }
    const pares: number[] = []
    for (const link of links) {
      const a = this.indexByPath.get(link.source)
      const b = this.indexByPath.get(link.target)
      if (a === undefined || b === undefined || a === b) continue
      pares.push(a, b)
      this.degree[a] += 1
      this.degree[b] += 1
    }
    this.edgePairs = Int32Array.from(pares)
    this.quad = createQuad(Math.max(64, n * 4))
    this.alpha = 1
  }

  step(): void {
    const { xs, ys, vxs, vys, settings, count } = this
    this.alpha += (this.alphaTarget - this.alpha) * OBSIDIAN_PHYSICS.alphaDecay
    const alpha = this.alpha
    if (alpha < 1e-8) return

    // 1) centro: forceX(0)/forceY(0), strength 0.1
    const center = settings.centerStrength * alpha
    if (center !== 0) {
      for (let i = 0; i < count; i += 1) {
        vxs[i] -= xs[i] * center
        vys[i] -= ys[i] * center
      }
    }

    // 2) link: distance 250, strength = linkStrength * (1/min(grau)), bias 1/2
    const { edgePairs, degree } = this
    const distance = settings.linkDistance
    const strengthScale = settings.linkStrength * alpha
    for (let e = 0; e < edgePairs.length / 2; e += 1) {
      const a = edgePairs[e * 2]
      const b = edgePairs[e * 2 + 1]
      // d3 usa (posicao + velocidade) no link; sem isso a mola atrasa 1 frame.
      const ax = xs[a] + vxs[a]
      const ay = ys[a] + vys[a]
      let dx = xs[b] + vxs[b] - ax
      let dy = ys[b] + vys[b] - ay
      let d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1e-6) { dx = 1e-3; dy = 0; d = 1e-3 }
      const bias = 1 / Math.max(1, Math.min(degree[a], degree[b]))
      const k = ((d - distance) / d) * strengthScale * bias * 0.5
      const fx = dx * k
      const fy = dy * k
      vxs[a] += fx
      vys[a] += fy
      vxs[b] -= fx
      vys[b] -= fy
    }

    // 3) muitas-corpos: strength -30, distanceMin 30, theta 0.9 (Barnes-Hut)
    this.buildQuad()
    // dx = no - celula; para EMPURRAR a forca precisa ser positiva.
    const repulsao = settings.repelStrength * alpha
    const dMin2 = OBSIDIAN_PHYSICS.distanceMin * OBSIDIAN_PHYSICS.distanceMin
    const quad = this.quad
    const stack = QUAD_STACK
    for (let i = 0; i < count; i += 1) {
      let fx = 0
      let fy = 0
      const xi = xs[i]
      const yi = ys[i]
      let top = 0
      stack[top++] = 0
      while (top > 0) {
        const cell = stack[--top]
        const mass = quad.mass[cell]
        if (mass === 0) continue
        const dx = xi - quad.x[cell]
        const dy = yi - quad.y[cell]
        let d2 = dx * dx + dy * dy
        const body = quad.body[cell]
        if (body >= 0) {
          if (body === i) continue
          // Dois nos na MESMA posicao davam d2 = 0 -> Infinity -> NaN, e o
          // grafo inteiro sumia. O d3 resolve com jiggle; aqui um piso resolve.
          if (d2 < 1e-9) d2 = 1e-9
          const d = Math.sqrt(d2)
          const f = repulsao / d2
          fx += (dx / d) * f
          fy += (dy / d) * f
          continue
        }
        const size = quad.size[cell]
        if ((size * size) / d2 < THETA2) {
          const dd = Math.max(d2, dMin2)
          const d = Math.sqrt(dd)
          const f = (repulsao * mass) / dd
          fx += (dx / d) * f
          fy += (dy / d) * f
        } else if (top + 4 < stack.length) {
          const base = cell * 4
          const c0 = quad.child[base]
          const c1 = quad.child[base + 1]
          const c2 = quad.child[base + 2]
          const c3 = quad.child[base + 3]
          if (c0 >= 0) stack[top++] = c0
          if (c1 >= 0) stack[top++] = c1
          if (c2 >= 0) stack[top++] = c2
          if (c3 >= 0) stack[top++] = c3
        }
      }
      vxs[i] += fx
      vys[i] += fy
    }

    // 4) colisao: raio 60, strength 0.5 (d3 collide, com peso por massa)
    const raio = settings.collideRadius
    const raio2 = raio * raio
    const cellSize = raio * 2
    const buckets = this.buckets
    for (const key of this.bucketKeys) buckets.get(key)!.length = 0
    this.bucketKeys.length = 0
    const chave = (cx: number, cy: number) => (cx + 4096) * 16384 + (cy + 4096)
    for (let i = 0; i < count; i += 1) {
      const key = chave(Math.floor((xs[i] + vxs[i]) / cellSize), Math.floor((ys[i] + vys[i]) / cellSize))
      const bucket = buckets.get(key)
      if (bucket) bucket.push(i)
      else { buckets.set(key, [i]); this.bucketKeys.push(key) }
    }
    const forca = settings.collideStrength * alpha
    for (let i = 0; i < count; i += 1) {
      const xi = xs[i] + vxs[i]
      const yi = ys[i] + vys[i]
      const cx = Math.floor(xi / cellSize)
      const cy = Math.floor(yi / cellSize)
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = buckets.get(chave(cx + ox, cy + oy))
          if (!bucket) continue
          for (let k = 0; k < bucket.length; k += 1) {
            const j = bucket[k]
            if (j <= i) continue
            const xj = xs[j] + vxs[j]
            const yj = ys[j] + vys[j]
            let dx = xj - xi
            let dy = yj - yi
            let d2 = dx * dx + dy * dy
            if (d2 >= raio2) continue
            if (d2 < 1e-9) {
              dx = 0.001 * (((i + j) % 12) - 6)
              dy = 0.001 * (((i * 7 + j) % 12) - 6)
              d2 = dx * dx + dy * dy || 1e-9
            }
            const d = Math.sqrt(d2)
            const scale = ((raio - d) / d) * forca * 0.5
            const fx = dx * scale
            const fy = dy * scale
            vxs[i] -= fx
            vys[i] -= fy
            vxs[j] += fx
            vys[j] += fy
          }
        }
      }
    }

    // 5) integracao: x += vx *= .6 (no preso: x = fx, vx = 0)
    for (let i = 0; i < count; i += 1) {
      const pin = this.pinned.get(i)
      if (pin) {
        xs[i] = pin.x
        ys[i] = pin.y
        vxs[i] = 0
        vys[i] = 0
        continue
      }
      vxs[i] *= 1 - OBSIDIAN_PHYSICS.velocityDecay
      vys[i] *= 1 - OBSIDIAN_PHYSICS.velocityDecay
      xs[i] += vxs[i]
      ys[i] += vys[i]
      // Rede de seguranca contra divergencia numerica (e contra um layout
      // salvo em escala incompativel): nunca deixa a posicao fugir ao absurdo.
      if (!Number.isFinite(xs[i]) || Math.abs(xs[i]) > 100000) { xs[i] = (Math.random() - 0.5) * 100; vxs[i] = 0 }
      if (!Number.isFinite(ys[i]) || Math.abs(ys[i]) > 100000) { ys[i] = (Math.random() - 0.5) * 100; vys[i] = 0 }
    }
  }

  snapshot(): Float32Array {
    for (let i = 0; i < this.count; i += 1) {
      this.buffer[i * 2] = this.xs[i]
      this.buffer[i * 2 + 1] = this.ys[i]
    }
    return this.buffer
  }

  positionOf(path: string): { x: number; y: number } | null {
    const index = this.indexByPath.get(path)
    if (index === undefined) return null
    return { x: this.xs[index], y: this.ys[index] }
  }

  /** `forceNode{id,x,y}` + alphaTarget .3 do app.js. */
  pin(path: string, x: number, y: number): void {
    const index = this.indexByPath.get(path)
    if (index === undefined) return
    this.pinned.set(index, { x, y })
    this.alphaTarget = OBSIDIAN_PHYSICS.alphaTargetDrag
    if (this.alpha < OBSIDIAN_PHYSICS.alphaTargetDrag) this.alpha = OBSIDIAN_PHYSICS.alphaTargetDrag
  }

  /** `forceNode{x:null,y:null}` + alphaTarget 0. */
  unpin(path: string): void {
    const index = this.indexByPath.get(path)
    if (index === undefined) return
    this.pinned.delete(index)
    this.alphaTarget = 0
  }

  reheat(value = 0.3): void {
    if (this.alpha < value) this.alpha = value
  }

  get settled(): boolean {
    return this.alphaTarget === 0 && this.alpha < OBSIDIAN_PHYSICS.alphaSleep
  }

  /** Centroide, para a camera enquadrar o grafo. */
  centroid(): { x: number; y: number } {
    let x = 0
    let y = 0
    for (let i = 0; i < this.count; i += 1) { x += this.xs[i]; y += this.ys[i] }
    const n = Math.max(1, this.count)
    return { x: x / n, y: y / n }
  }

  private buildQuad(): void {
    const quad = this.quad
    const { xs, ys, count } = this
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (let i = 0; i < count; i += 1) {
      if (xs[i] < minX) minX = xs[i]
      if (ys[i] < minY) minY = ys[i]
      if (xs[i] > maxX) maxX = xs[i]
      if (ys[i] > maxY) maxY = ys[i]
    }
    let size = Math.max(maxX - minX, maxY - minY)
    if (!Number.isFinite(size) || size <= 0) size = 1
    quad.count = 1
    quad.x[0] = (minX + maxX) / 2
    quad.y[0] = (minY + maxY) / 2
    quad.mass[0] = 0
    quad.size[0] = size
    quad.body[0] = -1
    for (let k = 0; k < 4; k += 1) quad.child[k] = -1
    for (let i = 0; i < count; i += 1) this.insert(i, 0, 0)
  }

  private insert(body: number, cell: number, depth: number): void {
    const quad = this.quad
    const mass = quad.mass[cell]
    const total = mass + 1
    quad.x[cell] = (quad.x[cell] * mass + this.xs[body]) / total
    quad.y[cell] = (quad.y[cell] * mass + this.ys[body]) / total
    quad.mass[cell] = total
    const ocupante = quad.body[cell]
    if (ocupante === -1) { quad.body[cell] = body; return }
    if (depth >= MAX_DEPTH) return
    if (ocupante >= 0) {
      quad.body[cell] = -2
      this.subdivide(cell)
      this.insert(ocupante, this.childFor(cell, this.xs[ocupante], this.ys[ocupante]), depth + 1)
      this.insert(body, this.childFor(cell, this.xs[body], this.ys[body]), depth + 1)
      return
    }
    this.insert(body, this.childFor(cell, this.xs[body], this.ys[body]), depth + 1)
  }

  private subdivide(cell: number): void {
    const quad = this.quad
    const half = quad.size[cell] / 2
    const quarter = half / 2
    for (let k = 0; k < 4; k += 1) {
      const index = this.newCell()
      quad.x[index] = quad.x[cell] + (k & 1 ? quarter : -quarter)
      quad.y[index] = quad.y[cell] + (k & 2 ? quarter : -quarter)
      quad.size[index] = half
      quad.mass[index] = 0
      quad.body[index] = -1
      for (let c = 0; c < 4; c += 1) quad.child[index * 4 + c] = -1
      quad.child[cell * 4 + k] = index
    }
  }

  private newCell(): number {
    const quad = this.quad
    if (quad.count >= quad.capacity) growQuad(quad)
    const index = quad.count
    quad.count += 1
    return index
  }

  private childFor(cell: number, x: number, y: number): number {
    const quad = this.quad
    const k = (x >= quad.x[cell] ? 1 : 0) + (y >= quad.y[cell] ? 2 : 0)
    const child = quad.child[cell * 4 + k]
    return child >= 0 ? child : cell
  }
}
