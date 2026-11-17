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
  /** Arestas do conjunto em hover. */
  linkFocus: string
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
  /** Peso 0..1 por no: quanto do destaque de hover ele esta recebendo agora. */
  focus: Float32Array
  /** Intensidade global (0..1) — o quanto o conjunto esta em destaque. */
  focusIntensity: number
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

/** `#rrggbb` -> `rgb(r g b / a)`, para o glow poder ter alfa. */
function comAlfa(cor: string, alfa: number): string {
  if (!cor.startsWith('#') || cor.length !== 7) return cor
  const n = Number.parseInt(cor.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgb(${r} ${g} ${b} / ${alfa})`
}

export function drawGraph2d(
  ctx: CanvasRenderingContext2D,
  sim: Graph2dSimulation,
  options: Graph2dRenderOptions,
): void {
  const { width, height, dpr, view, hovered, labels, colors, nodeStyles, nodeSizeMultiplier, focus, focusIntensity } = options
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const emHover = hovered >= 0
  /** Peso do no no destaque (0 = fora, 1 = totalmente destacado). */
  const peso = (i: number) => focus[i] ?? 0

  // --- links ---------------------------------------------------------------
  // Separa em tres grupos: fora do conjunto (esmaece suave), do conjunto
  // (ganha espessura conforme o peso) e o caso sem hover.
  ctx.lineWidth = 1
  ctx.strokeStyle = colors.link
  ctx.beginPath()
  const foraPath = new Path2D()
  const focoPath = new Path2D()
  const { edgePairs } = sim
  for (let e = 0; e < edgePairs.length / 2; e += 1) {
    const a = edgePairs[e * 2]
    const b = edgePairs[e * 2 + 1]
    const pa = worldToScreen(sim.xs[a], sim.ys[a], view, width, height)
    const pb = worldToScreen(sim.xs[b], sim.ys[b], view, width, height)
    if (Math.max(pa.x, pb.x) < -20 || Math.min(pa.x, pb.x) > width + 20) continue
    if (Math.max(pa.y, pb.y) < -20 || Math.min(pa.y, pb.y) > height + 20) continue
    const toca = Math.max(peso(a), peso(b))
    if (toca > 0.02) {
      focoPath.moveTo(pa.x, pa.y)
      focoPath.lineTo(pb.x, pb.y)
      continue
    }
    if (emHover) {
      foraPath.moveTo(pa.x, pa.y)
      foraPath.lineTo(pb.x, pb.y)
      continue
    }
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
  }
  ctx.stroke()
  if (focusIntensity > 0.01) {
    // As de fora perdem opacidade junto com a intensidade (sem corte seco).
    ctx.globalAlpha = 1 - 0.72 * focusIntensity
    ctx.strokeStyle = colors.link
    ctx.stroke(foraPath)
    ctx.globalAlpha = 1
    // As do conjunto engrossam conforme o destaque entra.
    ctx.globalAlpha = 0.55 + 0.45 * focusIntensity
    ctx.strokeStyle = colors.linkFocus
    ctx.lineWidth = 1 + focusIntensity
    ctx.stroke(focoPath)
    ctx.lineWidth = 1
    ctx.globalAlpha = 1
  }

  // --- nos: glow na cor do grupo, sem mudar o tamanho ----------------------
  const TAU = Math.PI * 2
  for (let i = 0; i < sim.count; i += 1) {
    const s = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
    const raio = Math.max(1.2, nodeRadiusPx(sim.degree[i], nodeSizeMultiplier, view.zoom))
    const w = peso(i)
    if (s.x < -raio - 20 || s.x > width + raio + 20 || s.y < -raio - 20 || s.y > height + raio + 20) continue
    const estilo = nodeStyles[i]
    const corDoNo = estilo?.color ?? (estilo?.isCurrent ? colors.nodeCurrent : colors.node)
    // Fora do conjunto: esmaece proporcionalmente ao destaque do conjunto.
    ctx.globalAlpha = 1 - 0.66 * focusIntensity * (1 - w)

    if (w > 0.02) {
      // Glow: gradiente radial que nasce na borda do no e some para fora.
      const fora = raio * (2.1 + 1.5 * w)
      const gradiente = ctx.createRadialGradient(s.x, s.y, raio * 0.7, s.x, s.y, fora)
      gradiente.addColorStop(0, comAlfa(corDoNo, 0.5 * w))
      gradiente.addColorStop(0.55, comAlfa(corDoNo, 0.22 * w))
      gradiente.addColorStop(1, comAlfa(corDoNo, 0))
      ctx.fillStyle = gradiente
      ctx.beginPath()
      ctx.arc(s.x, s.y, fora, 0, TAU)
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(s.x, s.y, raio, 0, TAU)
    ctx.fillStyle = corDoNo
    ctx.fill()
    ctx.lineWidth = 1 + w
    ctx.strokeStyle = colors.nodeRing
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // --- rotulos -------------------------------------------------------------
  ctx.font = '12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let i = 0; i < sim.count; i += 1) {
    const w = peso(i)
    // Com hover, so o nome do conjunto — e entrando/saindo pelo peso.
    if (emHover && w < 0.06) continue
    if (!emHover && !labels) continue
    const s = worldToScreen(sim.xs[i], sim.ys[i], view, width, height)
    if (s.x < -80 || s.x > width + 80 || s.y < -30 || s.y > height + 30) continue
    const raio = Math.max(1.2, nodeRadiusPx(sim.degree[i], nodeSizeMultiplier, view.zoom))
    ctx.globalAlpha = emHover ? w : 0.75
    ctx.fillStyle = emHover && w > 0.5 ? colors.label : colors.labelDim
    const nome = sim.paths[i].replace(/^.*\//, '').replace(/\.md$/i, '')
    ctx.fillText(nome, s.x, s.y + raio + 5)
  }
  ctx.globalAlpha = 1

  ctx.restore()
}
