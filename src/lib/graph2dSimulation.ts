/**
 * Simulacao do grafo 2D — modelo do Obsidian, extraido do binario instalado.
 *
 * Os parametros abaixo vieram do `sim.js` dentro de `obsidian.asar` (17.693
 * bytes) e do `app.js` (mensagens da UI), lidos por engenharia reversa:
 *
 *   sim.js:  null == t.fx ? t.x += t.vx *= .6 : (t.x = t.fx, t.vx = 0)
 *            distance(250)                      // forca de link
 *            many-body: distanceMin(30), theta 0.9
 *            collide: raio 60, strength 0.5
 *            alpha 1 -> 0.001 em ~300 ticks
 *   app.js:  arrastar -> forceNode{id,x,y} + alphaTarget .3
 *            soltar   -> forceNode{id,x:null,y:null} + alphaTarget 0
 *
 * O `alphaTarget` e o ponto que faz o arrasto levar a vizinhanca: enquanto o
 * no esta fixado, o alpha e mantido em 0.3, e as molas (que escalam por alpha)
 * continuam puxando. Sem ele o layout assentado (alpha ~0.001) nao move nada.
 *
 * As distancias do Obsidian estao no espaco dele; aqui elas sao convertidas
 * para o nosso mundo 0..200 por `ESCALA` (as razoes entre as forcas sao
 * preservadas, que e o que define o comportamento).
 */

export type Graph2dSettings = {
  /** Rigidez das molas (0-1). */
  linkStiffness: number
  /** Distancia de descanso das molas, em unidades de mundo. */
  linkRest: number
  /** Forca de repulsao entre todos os pares. */
  repulsionStrength: number
  /** Amortecimento por segundo (0-1). */
  velocityDecay: number
  /** Atracao para o centro do mundo (0-1). */
  centerStrength: number
}

export type Graph2dLink = { source: string; target: string }

/** Limites do mundo, em unidades (o mesmo 0..200 do layout do app). */
export const GRAPH2D_WORLD = { min: 0, max: 200 } as const

/** Raio da bolinha em unidades de mundo (18px num mundo 200 em ~764px). */
export const GRAPH2D_NODE_RADIUS = 2.4

/**
 * Valores do Obsidian convertidos para o mundo 0..200.
 * O espaco do Obsidian tem link distance 250; aqui usamos 20 (1/12,5), entao
 * `ESCALA` leva as outras distancias pela mesma razao.
 */
const ESCALA = 20 / 250
/** distância(250) do sim.js. */
export const OBSIDIAN_LINK_DISTANCE = 250 * ESCALA
/** collide: raio 60, strength 0.5. */
export const OBSIDIAN_COLLIDE_RADIUS = 60 * ESCALA
const OBSIDIAN_COLLIDE_STRENGTH = 0.5
/** many-body: distanceMin 30, theta 0.9. */
export const OBSIDIAN_DISTANCE_MIN = 30 * ESCALA
const THETA2 = 0.81
/** center: forceX(0)+forceY(0) com strength 0.1 (o mundo e centrado em 100). */
const OBSIDIAN_CENTER_STRENGTH = 0.1
/** velocityDecay do d3 aplicado como `vx *= 0.6` no sim.js. */
const OBSIDIAN_VELOCITY_DECAY = 0.4
/** alpha 1 -> 0.001 em 300 ticks: alphaDecay = 1 - 0.001^(1/300). */
const OBSIDIAN_ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300)
/** alphaTarget que o app.js manda enquanto arrasta. */
export const OBSIDIAN_ALPHA_TARGET_DRAG = 0.3
/** Abaixo disso a simulacao dorme (o Obsidian para em 0.001). */
export const GRAPH2D_ALPHA_SLEEP = 0.001
/** Profundidade maxima da quadtree. */
const MAX_DEPTH = 12
const MIN_CELL = 1.2
const QUAD_STACK = new Int32Array(65536)

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
  readonly xs: Float32Array
  readonly ys: Float32Array
  readonly vxs: Float32Array
  readonly vys: Float32Array
  /** Pares achatados: [a0,b0,a1,b1,...]. */
  readonly edgePairs: Int32Array
  /** Grau de cada no (o link strength do d3 e 1/min(grau dos dois)). */
  readonly degree: Int32Array
  /** Buffer de leitura [x0,y0,x1,y1,...]. */
  readonly buffer: Float32Array
  /** Nos fixados (arrasto): indice -> alvo. */
  readonly pinned = new Map<number, { x: number; y: number }>()
  readonly count: number
  /** Alpha atual e alvo (o alvo e o que mantem o arrasto quente). */
  alpha: number
  alphaTarget = 0
  settings: Graph2dSettings

  private readonly quad: Quad
  private readonly buckets = new Map<number, number[]>()

  constructor(input: {
    paths: string[]
    links: Graph2dLink[]
    positions: Map<string, { x: number; y: number }>
    settings: Graph2dSettings
  }) {
    const { paths, links, positions, settings } = input
    this.paths = paths
    this.count = paths.length
    this.settings = { ...settings }
    this.indexByPath = new Map(paths.map((path, index) => [path, index]))
    this.xs = new Float32Array(this.count)
    this.ys = new Float32Array(this.count)
    this.vxs = new Float32Array(this.count)
    this.vys = new Float32Array(this.count)
    this.buffer = new Float32Array(this.count * 2)
    this.degree = new Int32Array(this.count)
    for (let i = 0; i < this.count; i += 1) {
      const position = positions.get(paths[i])
      this.xs[i] = position?.x ?? 100
      this.ys[i] = position?.y ?? 100
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
    this.quad = createQuad(Math.max(32, this.count * 2))
    this.alpha = 1
  }

  /** Um passo, na ordem do sim.js: forcas -> integracao com `vx *= 0.6`. */
  step(): number {
    const { xs, ys, vxs, vys, settings, count } = this
    // 1) alpha em direcao ao alvo (o `alphaTarget` do d3, usado no arrasto).
    this.alpha += (this.alphaTarget - this.alpha) * OBSIDIAN_ALPHA_DECAY
    const alpha = this.alpha

    this.buildQuad()
    // 2) Repulsao many-body (Barnes-Hut, theta 0.9, distanceMin 30).
    const repulsao = settings.repulsionStrength * alpha
    const distanciaMin2 = OBSIDIAN_DISTANCE_MIN * OBSIDIAN_DISTANCE_MIN
    for (let i = 0; i < count; i += 1) {
      let fx = 0
      let fy = 0
      const xi = xs[i]
      const yi = ys[i]
      const quad = this.quad
      const stack = QUAD_STACK
      let top = 0
      stack[top++] = 0
      while (top > 0) {
        const cell = stack[--top]
        const mass = quad.mass[cell]
        if (mass <= 0) continue
        let dx = xi - quad.x[cell]
        let dy = yi - quad.y[cell]
        let d2 = dx * dx + dy * dy
        if (d2 < distanciaMin2) d2 = distanciaMin2
        const body = quad.body[cell]
        if (body >= 0) {
          if (body === i) continue
          const d = Math.sqrt(d2)
          const force = repulsao / d2
          fx += (dx / d) * force
          fy += (dy / d) * force
          continue
        }
        const size = quad.size[cell]
        if ((size * size) / d2 < THETA2) {
          const d = Math.sqrt(d2)
          const force = (repulsao * mass) / d2
          fx += (dx / d) * force
          fy += (dy / d) * force
        } else {
          const base = cell * 4
          if (top + 4 < stack.length) {
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
      }
      vxs[i] += fx
      vys[i] += fy
    }

    // 3) Molas: strength do d3 = 1 / min(grau dos dois) * rigidez da UI.
    const { edgePairs, degree } = this
    for (let e = 0; e < edgePairs.length / 2; e += 1) {
      const a = edgePairs[e * 2]
      const b = edgePairs[e * 2 + 1]
      let dx = xs[b] - xs[a]
      let dy = ys[b] - ys[a]
      let d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1e-6) { dx = 1e-3; dy = 0; d = 1e-3 }
      const grauMin = Math.max(1, Math.min(degree[a], degree[b]))
      const forca = (settings.linkStiffness * alpha) / grauMin
      const f = (forca / d) * (d - settings.linkRest)
      const fx = dx * f
      const fy = dy * f
      vxs[a] += fx
      vys[a] += fy
      vxs[b] -= fx
      vys[b] -= fy
    }

    // 4) Centro: forceX/forceY com strength 0.1, aplicada em torno do centro.
    const meio = (GRAPH2D_WORLD.min + GRAPH2D_WORLD.max) / 2
    const center = (settings.centerStrength || OBSIDIAN_CENTER_STRENGTH) * alpha
    for (let i = 0; i < count; i += 1) {
      vxs[i] += (meio - xs[i]) * center
      vys[i] += (meio - ys[i]) * center
    }

    // 5) Colisao como forca suave (collide raio 60, strength 0.5), por grade
    // espacial para nao virar O(n^2): pares proximos recebem empurrao suave.
    const raioTotal = OBSIDIAN_COLLIDE_RADIUS * 2
    const cellSize = OBSIDIAN_COLLIDE_RADIUS * 2.2
    const buckets = this.buckets
    for (const bucket of buckets.values()) bucket.length = 0
    const chave = (cx: number, cy: number) => (cx + 512) * 4096 + (cy + 512)
    for (let i = 0; i < count; i += 1) {
      const key = chave(Math.floor(xs[i] / cellSize), Math.floor(ys[i] / cellSize))
      const bucket = buckets.get(key)
      if (bucket) bucket.push(i)
      else buckets.set(key, [i])
    }
    for (let i = 0; i < count; i += 1) {
      const cx = Math.floor(xs[i] / cellSize)
      const cy = Math.floor(ys[i] / cellSize)
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = buckets.get(chave(cx + ox, cy + oy))
          if (!bucket) continue
          for (let k = 0; k < bucket.length; k += 1) {
            const j = bucket[k]
            if (j <= i) continue
            let dx = xs[j] - xs[i]
            let dy = ys[j] - ys[i]
            let d2 = dx * dx + dy * dy
            if (d2 >= raioTotal * raioTotal) continue
            if (d2 < 1e-6) {
              dx = 0.001 * (((i + j) % 12) - 6)
              dy = 0.001 * (((i * 7 + j) % 12) - 6)
              d2 = dx * dx + dy * dy || 1e-6
            }
            const d = Math.sqrt(d2)
            const forca = ((raioTotal - d) / d) * OBSIDIAN_COLLIDE_STRENGTH * alpha * 0.5
            const fx = dx * forca
            const fy = dy * forca
            if (!this.pinned.has(i)) { vxs[i] -= fx; vys[i] -= fy }
            if (!this.pinned.has(j)) { vxs[j] += fx; vys[j] += fy }
          }
        }
      }
    }

    // 6) Integracao: `vx *= 0.6` e `x += vx`; nos fixados vao direto ao alvo.
    let remaining = 0
    for (let i = 0; i < count; i += 1) {
      const pin = this.pinned.get(i)
      if (pin) {
        xs[i] = pin.x
        ys[i] = pin.y
        vxs[i] = 0
        vys[i] = 0
        continue
      }
      vxs[i] *= 1 - (settings.velocityDecay || OBSIDIAN_VELOCITY_DECAY)
      vys[i] *= 1 - (settings.velocityDecay || OBSIDIAN_VELOCITY_DECAY)
      xs[i] = Math.max(GRAPH2D_WORLD.min, Math.min(GRAPH2D_WORLD.max, xs[i] + vxs[i]))
      ys[i] = Math.max(GRAPH2D_WORLD.min, Math.min(GRAPH2D_WORLD.max, ys[i] + vys[i]))
      remaining += vxs[i] * vxs[i] + vys[i] * vys[i]
    }
    return remaining
  }

  /** Posicoes no buffer reaproveitado. */
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

  /** Fixa o no no alvo (o `forceNode{x,y}` do app.js). */
  pin(path: string, x: number, y: number): void {
    const index = this.indexByPath.get(path)
    if (index === undefined) return
    this.pinned.set(index, { x, y })
    // Reaquece para 0.3 como o Obsidian: e o que faz a vizinhanca seguir.
    this.alphaTarget = OBSIDIAN_ALPHA_TARGET_DRAG
    this.alpha = Math.max(this.alpha, OBSIDIAN_ALPHA_TARGET_DRAG)
  }

  /** Solta o no (o `forceNode{x:null,y:null}` + `alphaTarget: 0`). */
  unpin(path: string): void {
    const index = this.indexByPath.get(path)
    if (index === undefined) return
    this.pinned.delete(index)
    this.alphaTarget = 0
  }

  /** Acorda a simulacao (reorganizar, mudanca de dados). */
  reheat(value = 0.3): void {
    this.alpha = Math.max(this.alpha, value)
  }

  get settled(): boolean {
    return this.alpha < GRAPH2D_ALPHA_SLEEP
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
    if (quad.body[cell] === -1) { quad.body[cell] = body; return }
    if (quad.body[cell] === -2 || depth >= MAX_DEPTH) {
      if (depth >= MAX_DEPTH) return
      this.insert(body, this.childFor(cell, this.xs[body], this.ys[body]), depth + 1)
      return
    }
    const residente = quad.body[cell]
    if (quad.size[cell] < MIN_CELL) return
    quad.body[cell] = -2
    this.subdivide(cell)
    this.insert(residente, this.childFor(cell, this.xs[residente], this.ys[residente]), depth + 1)
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
