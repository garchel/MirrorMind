/**
 * Desenho do grafo 2D — o visual do Obsidian, em canvas 2D.
 *
 * O Obsidian desenha com PixiJS (WebGL). Aqui o mesmo desenho e feito em
 * canvas 2D, com as regras que importam para a leitura:
 *
 * - camera com zoom e pan; o mundo nao tem limites (igual ao simulador);
 * - raio do no cresce com o GRAU e com sqrt(zoom), como no Obsidian (o no
 *   cresce menos que o zoom para nao engolir a tela);
 * - links finos (1px de tela) com opacidade baixa, sem seta por padrao;
 * - rotulos aparecem no hover e, acima de um limiar de zoom, em todos;
 * - hover esmaece o que nao e vizinho (o grafo do Obsidian faz o mesmo).
 */

import type { Graph2dSimulation } from '../../lib/graph2dSimulation'

export type Graph2dView = { x: number; y: number; zoom: number }

export type Graph2dNodeStyle = {
  color: string | null
  isCurrent: boolean
}

export type Graph2dColors = {
  link: string
  linkDim: string
  node: string
  nodeRing: string
  nodeCurrent: string
  label: string
  labelDim: string
}

export type Graph2dRenderOptions = {
  width: number
  height: number
  dpr: number
  view: Graph2dView
  hovered: number
  neighbors: Set<number> | null
  labels: boolean
  colors: Graph2dColors
  nodeStyles: Graph2dNodeStyle[]
  nodeSizeMultiplier: number
}

/**
 * Tamanho do no, formula do Obsidian (`app.js`):
 *
 *   getSize() { return fNodeSizeMult * Math.max(8, Math.min(3*sqrt(weight+1), 30)) }
 *
 * `weight` e o numero de conexoes. O piso de 8 faz quase todo no nascer do
 * mesmo tamanho; o crescimento e por raiz, entao a diferenca entre um no de
 * grau 1 e um de grau 20 e ~1,7x, nao 10x. O teto de 30 chega em ~100 conexoes.
 * O valor e em pixels de TELA; o zoom entra como sqrt (ver `nodeRadiusPx`).
 */
export function nodeSizePx(degree: number, nodeSizeMultiplier: number): number {
  return nodeSizeMultiplier * Math.max(8, Math.min(3 * Math.sqrt(degree + 1), 30))
}

/** Raio em px na tela, ja com o zoom (o Obsidian multiplica por sqrt(zoom)). */
export function nodeRadiusPx(degree: number, nodeSizeMultiplier: number, zoom: number): number {
  return nodeSizePx(degree, nodeSizeMultiplier) * Math.sqrt(Math.max(0.05, zoom))
}

export function worldToScreen(
  x: number,
  y: number,
  view: Graph2dView,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (x - view.x) * view.zoom,
    y: height / 2 + (y - view.y) * view.zoom,
  }
}

export function screenToWorld(
  x: number,
  y: number,
  view: Graph2dView,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (x - width / 2) / view.zoom + view.x,
    y: (y - height / 2) / view.zoom + view.y,
  }
}

/** No sob o cursor (com folga de 4px, como o alvo de clique do Obsidian). */
export function pickNode(
  sim: Graph2dSimulation,
  screenX: number,
  screenY: number,
  view: Graph2dView,
  width: number,
  height: number,
  nodeSizeMultiplier: number,
): number {
  let melhor = -1
  let melhorDist = Infinity
  for (let i = 0; i < sim.count; i += 1) {
    const s = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
    const raio = nodeRadiusPx(sim.degree[i], nodeSizeMultiplier, view.zoom) + 4
    const dx = s.x - screenX
    const dy = s.y - screenY
    const d = dx * dx + dy * dy
    if (d <= raio * raio && d < melhorDist) {
      melhorDist = d
      melhor = i
    }
  }
  return melhor
}

export function drawGraph2d(
  ctx: CanvasRenderingContext2D,
  sim: Graph2dSimulation,
  options: Graph2dRenderOptions,
): void {
  const { width, height, dpr, view, hovered, neighbors, labels, colors, nodeStyles, nodeSizeMultiplier } = options
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const dim = neighbors !== null && hovered >= 0
  const noVisivel = (i: number) => !dim || i === hovered || (neighbors?.has(i) ?? false)

  // --- links: 1px de tela, opacidade baixa; esmaece o que nao toca o hover ---
  ctx.lineWidth = 1
  ctx.strokeStyle = colors.link
  ctx.beginPath()
  const dimPath = new Path2D()
  const { edgePairs } = sim
  for (let e = 0; e < edgePairs.length / 2; e += 1) {
    const a = edgePairs[e * 2]
    const b = edgePairs[e * 2 + 1]
    const pa = worldToScreen(sim.xs[a], sim.ys[a], view, width, height)
    const pb = worldToScreen(sim.xs[b], sim.ys[b], view, width, height)
    // Descarta links fora da tela (culling).
    if (Math.max(pa.x, pb.x) < -20 || Math.min(pa.x, pb.x) > width + 20) continue
    if (Math.max(pa.y, pb.y) < -20 || Math.min(pa.y, pb.y) > height + 20) continue
    if (dim && !(noVisivel(a) || noVisivel(b))) {
      dimPath.moveTo(pa.x, pa.y)
      dimPath.lineTo(pb.x, pb.y)
      continue
    }
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
  }
  ctx.stroke()
  if (dim) {
    ctx.strokeStyle = colors.linkDim
    ctx.stroke(dimPath)
  }

  // --- nos: mesmo tamanho do Obsidian (piso 8, sqrt do grau, teto 30) ---
  for (let i = 0; i < sim.count; i += 1) {
    const s = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
    const raio = Math.max(1.2, nodeRadiusPx(sim.degree[i], nodeSizeMultiplier, view.zoom))
    if (s.x < -raio - 2 || s.x > width + raio + 2 || s.y < -raio - 2 || s.y > height + raio + 2) continue
    const estilo = nodeStyles[i]
    const visivel = noVisivel(i)
    ctx.globalAlpha = visivel ? 1 : 0.18
    ctx.beginPath()
    ctx.arc(s.x, s.y, raio, 0, Math.PI * 2)
    ctx.fillStyle = estilo?.color ?? (estilo?.isCurrent ? colors.nodeCurrent : colors.node)
    ctx.fill()
    ctx.lineWidth = i === hovered ? 2 : 1
    ctx.strokeStyle = colors.nodeRing
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // --- rotulos: hover sempre; zoom alto mostra todos; fade no meio ---
  const mostraRotulos = labels || view.zoom > 1.15
  if (mostraRotulos) {
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let i = 0; i < sim.count; i += 1) {
      const destacado = i === hovered || (neighbors?.has(i) ?? false)
      if (!destacado && !labels && view.zoom < 1.45) continue
      const s = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
      if (s.x < -80 || s.x > width + 80 || s.y < -30 || s.y > height + 30) continue
      const raio = Math.max(1.2, nodeRadiusPx(sim.degree[i], nodeSizeMultiplier, view.zoom))
      ctx.globalAlpha = destacado ? 1 : 0.75
      ctx.fillStyle = destacado ? colors.label : colors.labelDim
      const nome = sim.paths[i].replace(/^.*\//, '').replace(/\.md$/i, '')
      ctx.fillText(nome, s.x, s.y + raio + 4)
    }
    ctx.globalAlpha = 1
  }

  ctx.restore()
}
