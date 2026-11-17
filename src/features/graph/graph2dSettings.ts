/**
 * Traducao dos sliders do menu para as constantes do simulador.
 *
 * O simulador 2D usa a escala do Obsidian (link 250, repulsao -1000, colisao
 * 60). Os sliders da UI continuam com os valores historicos do app; aqui eles
 * sao convertidos para essa escala, de forma que os DEFAULTS do app caiam
 * exatamente nos valores do Obsidian:
 *
 *   distancia 30 -> 250      firmeza 4  -> 1
 *   afastamento 2000 -> 1000 centro 100 -> 0,1
 *
 * Nao existe piso: se o usuario zera um controle, ele vale zero. (Uma versao
 * anterior usava `Math.max(0.1, ...)` no centro "para nao explodir" e o efeito
 * era o slider mentir — pedir 0 e continuar puxando.)
 */

export type Graph2dSliderValues = {
  /** `graph2dRepulsionStrength` (default 2000). */
  repelStrength: number
  /** `graph2dLinkStiffness` (default 4). */
  linkStiffness: number
  /** `graph2dVelocityDecay` (default 0.4). */
  velocityDecay: number
  /** `graph2dLinkDistance` (default 30). */
  linkDistance: number
  /** `graph2dCenterForce` (default 100). */
  centerForce: number
  /** `graph2dCollideRadius` (default 60). */
  collideRadius: number
  /** `graph2dCollideStrength` (default 0.5). */
  collideStrength: number
  /** `graph2dRecentroSeconds` (default 2). */
  recentroSeconds: number
  /** `graph2dDragAlpha` (default 0.3). */
  dragAlpha: number
  /** `graph2dMinEdgeLength` (default 0 = sem limite). */
  minEdgeLength: number
  /** `graph2dMaxEdgeLength` (default 50). */
  maxEdgeLength: number
  /** `graph2dLabelZoom` (default 1.45). */
  labelZoom: number
}

export type Graph2dSimSettings = {
  linkDistance: number
  linkStrength: number
  repelStrength: number
  centerStrength: number
  collideRadius: number
  collideStrength: number
  nodeSizeMultiplier: number
  alphaTargetDrag: number
  recentroSeconds: number
  minEdgeLength: number
  maxEdgeLength: number
  velocityDecay: number
  labelZoom: number
}

export function buildGraph2dSettings(values: Graph2dSliderValues): Graph2dSimSettings {
  return {
    // Dividir ANTES de multiplicar deixa os defaults exatos (30/30 = 1):
    // multiplicar pela razao pre-calculada dava 250.00000000000003.
    linkDistance: (values.linkDistance / 30) * 250,
    linkStrength: values.linkStiffness / 4,
    repelStrength: (values.repelStrength / 2000) * 1000,
    centerStrength: (values.centerForce / 100) * 0.1,
    collideRadius: values.collideRadius,
    collideStrength: values.collideStrength,
    nodeSizeMultiplier: 1,
    alphaTargetDrag: values.dragAlpha,
    recentroSeconds: values.recentroSeconds,
    // Mesma escala da distancia das conexoes (30 no app = 250 no motor).
    velocityDecay: values.velocityDecay,
    minEdgeLength: (values.minEdgeLength / 30) * 250,
    maxEdgeLength: (values.maxEdgeLength / 30) * 250,
    labelZoom: values.labelZoom,
  }
}
