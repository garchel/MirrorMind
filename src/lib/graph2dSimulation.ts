/**
 * Simulacao do grafo 2D — modelo Obsidian (d3-force): forcas sobre arrays
 * tipados, repulsao Barnes-Hut e um loop que DORME quando assenta.
 *
 * Por que reescrever em vez de ajustar a anterior (medido):
 *
 * - A anterior guardava posicoes num `Map<string, {x,y}>` e, a cada passo,
 *   serializava TUDO num objeto novo para o postMessage. Medido no worker:
 *   600 nos custavam 13,8ms por passo contra 2,1ms so de forcas (6,5x) — o
 *   resto era alocacao, structured clone e a limpeza de colisao rodando em
 *   cada frame em vez de uma vez no fim.
 * - A repulsao era O(n^2): 600 nos = 180 mil pares por passo.
 * - O render era DOM: um `<button>` por nota com `will-change: transform`,
 *   ou seja, centenas de camadas de composicao.
 *
 * Aqui: posicoes em `Float32Array`, repulsao Barnes-Hut O(n log n), um unico
 * buffer reaproveitado para ler as posicoes (zero alocacao por frame) e o
 * chamador decide quando parar (`alpha < GRAPH2D_ALPHA_SLEEP`).
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
  /** Pares mais distantes que isso nao se repelem: repulsao LOCAL, para os
   * grupos nao se empurrarem entre si (o ajuste calibrado no app). */
  repulsionCutoff?: number
  /** Raio do anel onde a forca central comeca a puxar. */
  centerRadius?: number
  /** Multiplicador da rigidez das arestas ligadas ao no sendo arrastado.
   * Sem ele os vizinhos so esticam a mola (medido: a folha acompanhava ~15%
   * do deslocamento do hub) — no Obsidian a rede vem junto. */
  dragSpringBoost?: number
}

export type Graph2dLink = { source: string; target: string }

/** Limites do mundo, em unidades (o mesmo 0..200 do layout existente). */
export const GRAPH2D_WORLD = { min: 0, max: 200 } as const

/** Raio de colisao: a bolinha tem 18px; num mundo de 200 desenhado em ~764px
 * o raio real e 2,4. */
export const GRAPH2D_NODE_RADIUS = 2.4

/** alpha=1 -> 0.02 cai em ~170 passos (2,8s a 60fps), como o d3-force. */
export const GRAPH2D_ALPHA_DECAY = 0.0228
/** Abaixo disso o layout e considerado assentado e o loop dorme. */
export const GRAPH2D_ALPHA_SLEEP = 0.02

/** Vizinhanca puxada junto ao arrastar — os MESMOS numeros do grafo 3D
 * (`DRAG_PULL_HOPS` / `DRAG_PULL_FACTOR` em NoteGraph3D.tsx): o no arrastado
 * leva ate 3 saltos de vizinhos, cada salto valendo 60% do anterior. */
export const GRAPH2D_DRAG_PULL_HOPS = 3
export const GRAPH2D_DRAG_PULL_FACTOR = 0.6
/** Rigidez do puxao por passo. Nao escala por alpha de proposito: com o
 * layout assentado o alpha e ~0,02 e qualquer forca multiplicada por ele nao
 * move nada — foi por isso que o arrasto nao levava os vizinhos. */
export const GRAPH2D_DRAG_PULL_STIFFNESS = 0.35

/** theta^2 do Barnes-Hut (0.9^2): erro desprezivel com ganho grande. */
const THETA2 = 0.81
/** Profundidade maxima da quadtree (corpos coincidentes nao descem infinito). */
const MAX_DEPTH = 12
/** Abaixo deste tamanho de celula nao vale subdividir: o erro do agregado e
 * menor que o raio do no, e a arvore parava de crescer (medido: 1200 nos
 * chegavam a 65ms/passo por causa de centenas de milhares de celulas). */
const MIN_CELL = 1.2
/** Acima disso, o bucket da grade e tratado como pilha e distribuido em anel. */
const BUCKET_MAX = 16
/** Distancia minima ao quadrado da repulsao (o `distanceMin` do d3-force):
 * sem isso dois nos coincidentes geram forca infinita e NaN. */
const DIST_MIN2 = 4
/** Teto de velocidade por passo, em unidades de mundo: evita que uma forca
 * grande arremesse o no para fora do mundo e o layout exploda. */
const VEL_MAX = 8
const QUAD_STACK = new Int32Array(65536)

type Quad = {
  x: Float64Array
  y: Float64Array
  mass: Float64Array
  size: Float64Array
  /** >= 0: indice do corpo (folha); -1 vazio; -2 celula interna. */
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
  /** Descanso por aresta, nunca abaixo da soma dos raios. */
  readonly edgeRest: Float32Array
  /** Buffer de leitura [x0,y0,x1,y1,...] — sempre o mesmo objeto. */
  readonly buffer: Float32Array
  /** Nos fixados durante o arrasto: indice -> alvo. */
  readonly pinned = new Map<number, { x: number; y: number }>()
  /** No sendo arrastado: as arestas dele usam `dragSpringBoost`. */
  dragAnchor: number | null = null
  /** Vizinhanca puxada no arrasto (BFS com fator por salto, como no 3D). */
  private dragPull: {
    anchor: number
    factors: Map<number, number>
    restX: Float32Array
    restY: Float32Array
    anchorRestX: number
    anchorRestY: number
  } | null = null
  /** Adjacencia para o BFS do arrasto, montada uma vez. */
  private readonly adjacency: number[][]
  readonly count: number
  alpha: number
  settings: Graph2dSettings

  private readonly quad: Quad
  private readonly buckets = new Map<number, number[]>()

  constructor(input: {
    paths: string[]
    links: Graph2dLink[]
    positions: Map<string, { x: number; y: number }>
    settings: Graph2dSettings
    radius?: number
  }) {
    const { paths, links, positions, settings } = input
    const radius = input.radius ?? GRAPH2D_NODE_RADIUS
    this.paths = paths
    this.count = paths.length
    this.settings = { ...settings }
    this.indexByPath = new Map(paths.map((path, index) => [path, index]))
    this.xs = new Float32Array(this.count)
    this.ys = new Float32Array(this.count)
    this.vxs = new Float32Array(this.count)
    this.vys = new Float32Array(this.count)
    this.buffer = new Float32Array(this.count * 2)
    for (let i = 0; i < this.count; i += 1) {
      const position = positions.get(paths[i])
      this.xs[i] = position?.x ?? 100
      this.ys[i] = position?.y ?? 100
    }
    const pares: number[] = []
    const rests: number[] = []
    const descanso = Math.max(settings.linkRest, radius * 2)
    for (const link of links) {
      const a = this.indexByPath.get(link.source)
      const b = this.indexByPath.get(link.target)
      if (a === undefined || b === undefined || a === b) continue
      pares.push(a, b)
      rests.push(descanso)
    }
    this.edgePairs = Int32Array.from(pares)
    this.edgeRest = Float32Array.from(rests)
    this.adjacency = Array.from({ length: this.count }, () => [] as number[])
    for (let e = 0; e < rests.length; e += 1) {
      const a = pares[e * 2]
      const b = pares[e * 2 + 1]
      this.adjacency[a].push(b)
      this.adjacency[b].push(a)
    }
    this.quad = createQuad(Math.max(32, this.count * 2))
    this.alpha = 1
  }

  /** Um passo de simulacao (passo fixo, como o d3-force: a velocidade ja e o
   * deslocamento de um passo). Devolve a energia residual (soma de v²). */
  step(): number {
    const { xs, ys, vxs, vys, settings, count, alpha } = this
    this.buildQuad()
    // 1) Repulsao Barnes-Hut. `repulsao` fora do laco: uma multiplicacao por
    // no vira zero.
    const repulsao = settings.repulsionStrength * alpha
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
        if (d2 < DIST_MIN2) { d2 = DIST_MIN2 }
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
        const cutoff = settings.repulsionCutoff ?? 55
        // Poda: a celula inteira esta fora do alcance da repulsao.
        if (Math.sqrt(d2) - size > cutoff) continue
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
      vxs[i] += Math.max(-VEL_MAX, Math.min(VEL_MAX, fx))
      vys[i] += Math.max(-VEL_MAX, Math.min(VEL_MAX, fy))
    }
    // 2) Molas.
    const { edgePairs, edgeRest } = this
    const boost = settings.dragSpringBoost ?? 1
    const ancora = this.dragAnchor
    for (let e = 0; e < edgeRest.length; e += 1) {
      const a = edgePairs[e * 2]
      const b = edgePairs[e * 2 + 1]
      let dx = xs[b] - xs[a]
      let dy = ys[b] - ys[a]
      let d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1e-6) { dx = 1e-3; dy = 0; d = 1e-3 }
      // Arestas do no arrastado ficam mais rigidas: a rede acompanha o
      // cursor em vez de esticar e voltar quando ele solta.
      const rigidez = ancora !== null && (a === ancora || b === ancora) ? settings.linkStiffness * boost : settings.linkStiffness
      const f = ((rigidez * alpha) / d) * (d - edgeRest[e])
      const fx = dx * f
      const fy = dy * f
      vxs[a] += fx
      vys[a] += fy
      vxs[b] -= fx
      vys[b] -= fy
    }
    // 3) Centro.
    const meio = (GRAPH2D_WORLD.min + GRAPH2D_WORLD.max) / 2
    const center = settings.centerStrength * alpha
    const anel = settings.centerRadius ?? 60
    for (let i = 0; i < count; i += 1) {
      const dx = meio - xs[i]
      const dy = meio - ys[i]
      const d = Math.sqrt(dx * dx + dy * dy)
      // Dentro do anel nada puxa: os vizinhos do hub se organizam em circulo
      // em vez de colapsarem no centro.
      if (d <= anel) continue
      const forca = ((d - anel) / d) * center
      vxs[i] += dx * forca
      vys[i] += dy * forca
    }
    // 3b) Puxao do arrasto: a vizinhanca acompanha o no segurado, com forca
    // que NAO depende de alpha (o layout costuma estar assentado, alpha ~0,02,
    // e qualquer forca escalada por ele nao move nada — era o bug do arrasto
    // nao levar os conectados).
    const puxao = this.dragPull
    if (puxao) {
      const dxAncora = xs[puxao.anchor] - puxao.anchorRestX
      const dyAncora = ys[puxao.anchor] - puxao.anchorRestY
      for (const [indice, fator] of puxao.factors) {
        if (indice === puxao.anchor || this.pinned.has(indice)) continue
        const alvoX = puxao.restX[indice] + dxAncora
        const alvoY = puxao.restY[indice] + dyAncora
        const k = GRAPH2D_DRAG_PULL_STIFFNESS * fator
        vxs[indice] += (alvoX - xs[indice]) * k
        vys[indice] += (alvoY - ys[indice]) * k
      }
    }
    // 4) Integracao no esquema do d3-force: a velocidade E o deslocamento por
    // passo (nao ha multiplicacao por delta). As constantes de forca ficam na
    // mesma ordem do d3 e `delta` sai da conta.
    const damping = Math.max(0, 1 - settings.velocityDecay)
    let remaining = 0
    for (let i = 0; i < count; i += 1) {
      vxs[i] = Math.max(-VEL_MAX, Math.min(VEL_MAX, vxs[i] * damping))
      vys[i] = Math.max(-VEL_MAX, Math.min(VEL_MAX, vys[i] * damping))
      const pin = this.pinned.get(i)
      if (pin) {
        xs[i] = pin.x
        ys[i] = pin.y
        vxs[i] = 0
        vys[i] = 0
        continue
      }
      xs[i] = Math.max(GRAPH2D_WORLD.min, Math.min(GRAPH2D_WORLD.max, xs[i] + vxs[i]))
      ys[i] = Math.max(GRAPH2D_WORLD.min, Math.min(GRAPH2D_WORLD.max, ys[i] + vys[i]))
      remaining += vxs[i] * vxs[i] + vys[i] * vys[i]
    }
    // 5) Colisao geometrica por grade (O(n)).
    this.separate()
    // Decai a TAXA, nao o valor: `alpha *= 0.0228` matava a simulacao no
    // primeiro passo (nenhuma forca atuava depois).
    this.alpha *= 1 - GRAPH2D_ALPHA_DECAY
    return remaining
  }

  /** Posicoes no buffer reaproveitado: [x0,y0,x1,y1,...]. */
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

  pin(path: string, x: number, y: number): void {
    const index = this.indexByPath.get(path)
    if (index !== undefined) this.pinned.set(index, { x, y })
  }

  unpin(path: string): void {
    const index = this.indexByPath.get(path)
    if (index !== undefined) this.pinned.delete(index)
  }

  /** Comeca o arrasto: guarda a posicao de repouso de todos e o BFS da
   * vizinhanca (ate 3 saltos, fator 0.6 por salto) — o mesmo modelo do 3D. */
  beginDrag(path: string): void {
    const anchor = this.indexByPath.get(path)
    if (anchor === undefined) return
    const factors = new Map<number, number>()
    factors.set(anchor, 1)
    const visitados = new Set<number>([anchor])
    let fronteira = [anchor]
    for (let hop = 0; hop < GRAPH2D_DRAG_PULL_HOPS && fronteira.length > 0; hop += 1) {
      const proxima: number[] = []
      for (const no of fronteira) {
        for (const vizinho of this.adjacency[no]) {
          if (visitados.has(vizinho)) continue
          visitados.add(vizinho)
          factors.set(vizinho, Math.pow(GRAPH2D_DRAG_PULL_FACTOR, hop + 1))
          proxima.push(vizinho)
        }
      }
      fronteira = proxima
    }
    this.dragAnchor = anchor
    this.dragPull = {
      anchor,
      factors,
      restX: this.xs.slice(),
      restY: this.ys.slice(),
      anchorRestX: this.xs[anchor],
      anchorRestY: this.ys[anchor],
    }
  }

  endDrag(): void {
    this.dragPull = null
    this.dragAnchor = null
  }

  /** Acorda a simulacao num gesto (arrasto, reorganizar). */
  reheat(value = 1): void {
    this.alpha = Math.max(this.alpha, value)
  }

  get settled(): boolean {
    return this.alpha < GRAPH2D_ALPHA_SLEEP
  }

  private separate(): void {
    const { xs, ys, count } = this
    const radius = GRAPH2D_NODE_RADIUS
    const cellSize = radius * 2.2
    const buckets = this.buckets
    for (const bucket of buckets.values()) bucket.length = 0
    const chave = (cx: number, cy: number) => (cx + 512) * 4096 + (cy + 512)
    for (let i = 0; i < count; i += 1) {
      const key = chave(Math.floor(xs[i] / cellSize), Math.floor(ys[i] / cellSize))
      const bucket = buckets.get(key)
      if (bucket) bucket.push(i)
      else buckets.set(key, [i])
    }
    const minDistance = radius * 2
    const limite = minDistance * minDistance
    for (let i = 0; i < count; i += 1) {
      const cx = Math.floor(xs[i] / cellSize)
      const cy = Math.floor(ys[i] / cellSize)
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = buckets.get(chave(cx + ox, cy + oy))
          if (!bucket || bucket.length === 0) continue
          if (bucket.length > BUCKET_MAX) {
            // Pilha de nos coincidentes (o big bang): comparar todos os pares
            // aqui e O(n^2) e travava justamente no inicio da animacao.
            // Distribui em aneis concentricos, deterministico e O(n).
            for (let k = 0; k < bucket.length; k += 1) {
              const index = bucket[k]
              const anel = Math.floor(k / 12) + 1
              const ang = (k % 12) * (Math.PI / 6)
              const raio = radius * (1 + anel * 0.6)
              if (!this.pinned.has(index)) {
                xs[index] = Math.max(GRAPH2D_WORLD.min, Math.min(GRAPH2D_WORLD.max, xs[index] + Math.cos(ang) * raio))
                ys[index] = Math.max(GRAPH2D_WORLD.min, Math.min(GRAPH2D_WORLD.max, ys[index] + Math.sin(ang) * raio))
              }
            }
            continue
          }
          for (let k = 0; k < bucket.length; k += 1) {
            const j = bucket[k]
            if (j <= i) continue
            let dx = xs[j] - xs[i]
            let dy = ys[j] - ys[i]
            let d2 = dx * dx + dy * dy
            if (d2 >= limite) continue
            if (d2 < 1e-8) {
              dx = 0.001 * (((i + j) % 12) - 6)
              dy = 0.001 * (((i * 7 + j) % 12) - 6)
              d2 = dx * dx + dy * dy
            }
            const d = Math.sqrt(d2)
            const push = (minDistance - d) / 2
            const ux = dx / d
            const uy = dy / d
            const pj = this.pinned.has(j)
            const pi = this.pinned.has(i)
            if (!pi) { xs[i] -= ux * push * (pj ? 2 : 1); ys[i] -= uy * push * (pj ? 2 : 1) }
            if (!pj) { xs[j] += ux * push * (pi ? 2 : 1); ys[j] += uy * push * (pi ? 2 : 1) }
          }
        }
      }
    }
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
    if (quad.body[cell] === -1) {
      quad.body[cell] = body
      return
    }
    if (quad.body[cell] === -2 || depth >= MAX_DEPTH) {
      if (depth >= MAX_DEPTH) return
      this.insert(body, this.childFor(cell, this.xs[body], this.ys[body]), depth + 1)
      return
    }
    // Folha ocupada: subdivide e desce os dois corpos.
    const residente = quad.body[cell]
    if (quad.size[cell] < MIN_CELL) {
      // Celula pequena demais: os dois corpos ficam no agregado desta celula.
      return
    }
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
