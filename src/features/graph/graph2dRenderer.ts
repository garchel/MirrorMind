/**
 * Renderizador do grafo 2D em `<canvas>` — o modelo do Obsidian.
 *
 * O render anterior era DOM: um `<button>` por nota, com `will-change:
 * transform` em cada um (uma camada de composicao por no) e um `<svg>` de
 * arestas. Centenas de elementos: cada frame custa reconciliacao, estilo,
 * layout e pintura. No canvas, um frame e um punhado de `arc` e um `stroke`
 * agrupado — o custo passa a ser proporcional ao que esta na tela, nao ao
 * numero de elementos do documento.
 *
 * Este modulo e puro: recebe a simulacao e um contexto 2D. Quem chama decide
 * quando desenhar.
 */

import { GRAPH2D_WORLD, type Graph2dSimulation } from '../../lib/graph2dSimulation'

export type Graph2dView = {
  /** Deslocamento em px. */
  panX: number
  panY: number
  /** Zoom (1 = ajustado ao maior lado). */
  zoom: number
}

export type Graph2dNodeStyle = {
  /** Cor da bolinha (grupo/pasta) ou null para a cor padrao. */
  color: string | null
  /** No da nota aberta. */
  isCurrent: boolean
  /** Multiplicador de raio por grau (1 + min(grau, 8) * 0.13). */
  scale: number
}

export type Graph2dRendererOptions = {
  width: number
  height: number
  /** devicePixelRatio (o canvas ja vem escalado). */
  dpr: number
  view: Graph2dView
  /** Indice do no sob o ponteiro, ou -1. */
  hovered: number
  /** Vizinhos do no em hover: o resto fica esmaecido. */
  neighbors: Set<number> | null
  /** Raio base da bolinha em unidades de mundo. */
  radius: number
  /** Mostra os nomes (zoom suficiente ou hover). */
  labels: boolean
  /** Estilo por no (cor, atual, escala). Opcional: sem ele, cor padrao. */
  nodeStyles?: Graph2dNodeStyle[]
  colors: {
    background: string
    link: string
    linkDim: string
    node: string
    nodeRing: string
    nodeCurrent: string
    label: string
    labelDim: string
  }
}

/** Px por unidade de mundo, antes do zoom. */
export function worldScale(width: number, height: number): number {
  return Math.min(width, height) / GRAPH2D_WORLD.max
}

/** Mundo (0..200) -> tela, em px de CSS. */
export function worldToScreen(
  x: number,
  y: number,
  view: Graph2dView,
  width: number,
  height: number,
): { x: number; y: number } {
  const base = worldScale(width, height) * view.zoom
  const meio = GRAPH2D_WORLD.max / 2
  return {
    x: (x - meio) * base + width / 2 + view.panX,
    y: (y - meio) * base + height / 2 + view.panY,
  }
}

/** Tela -> mundo (para arrastar e zoom no ponteiro). */
export function screenToWorld(
  x: number,
  y: number,
  view: Graph2dView,
  width: number,
  height: number,
): { x: number; y: number } {
  const base = worldScale(width, height) * view.zoom
  const meio = GRAPH2D_WORLD.max / 2
  return {
    x: (x - width / 2 - view.panX) / base + meio,
    y: (y - height / 2 - view.panY) / base + meio,
  }
}

/** No mais proximo do ponto, dentro do raio de acerto (px de tela). */
export function pickNode(
  sim: Graph2dSimulation,
  screenX: number,
  screenY: number,
  view: Graph2dView,
  width: number,
  height: number,
  radius: number,
  hitSlop = 12,
): number {
  const base = worldScale(width, height) * view.zoom
  const alcance = Math.max(radius * base, hitSlop)
  const alcance2 = alcance * alcance
  let melhor = -1
  let melhorDistancia = Infinity
  for (let i = 0; i < sim.count; i += 1) {
    const p = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
    const dx = p.x - screenX
    const dy = p.y - screenY
    const d2 = dx * dx + dy * dy
    if (d2 <= alcance2 && d2 < melhorDistancia) {
      melhorDistancia = d2
      melhor = i
    }
  }
  return melhor
}

/** Desenha o grafo. Nao le estado global: tudo vem por parametro. */
export function drawGraph2d(
  ctx: CanvasRenderingContext2D,
  sim: Graph2dSimulation,
  options: Graph2dRendererOptions,
): void {
  const { width, height, dpr, view, hovered, neighbors, radius, labels, colors } = options
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (colors.background) {
    ctx.fillStyle = colors.background
    ctx.fillRect(0, 0, width, height)
  }
  const base = worldScale(width, height) * view.zoom
  const raioTela = Math.max(1.5, radius * base)

  // Arestas: dois paths (normais e esmaecidas) em vez de um por aresta.
  if (sim.edgePairs.length > 0) {
    ctx.lineWidth = 1
    if (TEM_PATH2D) {
      const normais = new Path2D()
      const esmaecidas = new Path2D()
      for (let e = 0; e < sim.edgePairs.length / 2; e += 1) {
        const a = sim.edgePairs[e * 2]
        const b = sim.edgePairs[e * 2 + 1]
        const dim = neighbors !== null && !neighbors.has(a) && !neighbors.has(b)
        const path = dim ? esmaecidas : normais
        const pa = worldToScreen(sim.xs[a], sim.ys[a], view, width, height)
        const pb = worldToScreen(sim.xs[b], sim.ys[b], view, width, height)
        path.moveTo(pa.x, pa.y)
        path.lineTo(pb.x, pb.y)
      }
      ctx.strokeStyle = colors.linkDim
      ctx.stroke(esmaecidas)
      ctx.strokeStyle = colors.link
      ctx.stroke(normais)
    } else {
      ctx.strokeStyle = colors.link
      ctx.beginPath()
      for (let e = 0; e < sim.edgePairs.length / 2; e += 1) {
        const a = sim.edgePairs[e * 2]
        const b = sim.edgePairs[e * 2 + 1]
        const pa = worldToScreen(sim.xs[a], sim.ys[a], view, width, height)
        const pb = worldToScreen(sim.xs[b], sim.ys[b], view, width, height)
        ctx.moveTo(pa.x, pa.y)
        ctx.lineTo(pb.x, pb.y)
      }
      ctx.stroke()
    }
  }

  // Nos agrupados por cor e por estado, para nao trocar `fillStyle` por no.
  const porEstilo = new Map<string, number[]>()
  const raios = new Map<number, number>()
  for (let i = 0; i < sim.count; i += 1) {
    const estilo = options.nodeStyles?.[i]
    const cor = estilo?.isCurrent ? colors.nodeCurrent : (estilo?.color ?? colors.node)
    const esmaecido = neighbors !== null && !neighbors.has(i)
    const chave = `${cor}|${esmaecido ? 1 : 0}`
    const lista = porEstilo.get(chave)
    if (lista) lista.push(i)
    else porEstilo.set(chave, [i])
    raios.set(i, raioTela * (estilo?.scale ?? 1))
  }
  for (const [chave, indices] of porEstilo) {
    const [cor, esmaecido] = chave.split('|')
    ctx.globalAlpha = esmaecido === '1' ? 0.25 : 1
    ctx.fillStyle = cor
    if (TEM_PATH2D) {
      const path = new Path2D()
      const anel = new Path2D()
      for (const i of indices) {
        const p = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
        const r = raios.get(i) ?? raioTela
        // Fora da tela nao entra no path (culling de graca no canvas).
        if (p.x < -r || p.y < -r || p.x > width + r || p.y > height + r) continue
        path.moveTo(p.x + r, p.y)
        path.arc(p.x, p.y, r, 0, Math.PI * 2)
        // Borda fina: no DOM cada bolinha tinha contorno e sombra; sem ela o
        // canvas fica chapado e as bolinhas parecem "manchas".
        anel.moveTo(p.x + r, p.y)
        anel.arc(p.x, p.y, r, 0, Math.PI * 2)
      }
      ctx.fill(path)
      ctx.strokeStyle = colors.nodeRing
      ctx.lineWidth = 1
      ctx.stroke(anel)
    } else {
      for (const i of indices) {
        const p = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
        const r = raios.get(i) ?? raioTela
        if (p.x < -r || p.y < -r || p.x > width + r || p.y > height + r) continue
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = colors.nodeRing
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
  }
  ctx.globalAlpha = 1

  // Anel do no em hover.
  if (hovered >= 0 && hovered < sim.count) {
    const p = worldToScreen(sim.xs[hovered], sim.ys[hovered], view, width, height)
    const r = (raios.get(hovered) ?? raioTela) + 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.strokeStyle = colors.nodeRing
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // Nomes: so quando pedido (zoom alto ou hover) e so dos visiveis.
  if (labels) {
    ctx.font = `600 11px ${GRAPH2D_LABEL_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let i = 0; i < sim.count; i += 1) {
      const esmaecido = neighbors !== null && !neighbors.has(i)
      if (esmaecido && hovered !== i) continue
      const p = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
      const r = raios.get(i) ?? raioTela
      if (p.x < -80 || p.y < -20 || p.x > width + 80 || p.y > height + 20) continue
      ctx.fillStyle = hovered === i ? colors.label : colors.labelDim
      const nome = sim.paths[i].split('/').at(-1)?.replace(/\.md$/i, '') ?? sim.paths[i]
      ctx.fillText(nome, p.x, p.y + r + 3)
    }
  }
  ctx.restore()
}

/** Verdadeiro quando o ambiente tem Path2D (navegador). jsdom nao tem: nesse
 * caso o desenho vai direto no contexto, uma operacao por no. */
const TEM_PATH2D = typeof Path2D === 'function'

/** Fonte dos rotulos: a mesma do app (variavel CSS nao vale no canvas). */
export const GRAPH2D_LABEL_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
