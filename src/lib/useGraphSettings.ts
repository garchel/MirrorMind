import { useEffect } from 'react'
import { GRAPH_RENDER_LIMIT_DEFAULT } from './graphCulling'
import { serializeNumber, usePref } from './prefs'

/** Configurações numéricas do grafo 2D/3D com persistência global.
 *
 * Extraído do `App.tsx`: 12 estados com inicialização validada de
 * `localStorage` + 2 efeitos de gravação viram 12 `usePref` (a gravação é
 * automática no setter). Chaves e regras de validação idênticas — inclui
 * os mesmos fallbacks e o arredondamento do limite de renderização.
 *
 * Escopo é global de propósito: apesar de comentários antigos no `App.tsx`
 * dizerem "persistidas por vault", as chaves sempre foram globais
 * (`mirrormind.graph*` sem prefixo de vault) e o comportamento foi
 * preservado como está.
 */

// Replica as validações que viviam nos inicializadores `useState` do App:
function persistedNumber(fallback: number, min: number, opts?: { exclusiveMin?: boolean; round?: boolean }) {
  return (raw: string): number => {
    const value = Number(raw)
    const aboveMin = opts?.exclusiveMin ? value > min : value >= min
    if (!Number.isFinite(value) || !aboveMin) return fallback
    return opts?.round ? Math.round(value) : value
  }
}

const parseRenderLimit = persistedNumber(GRAPH_RENDER_LIMIT_DEFAULT, 50, { round: true })
const parsePositive = (fallback: number) => persistedNumber(fallback, 0, { exclusiveMin: true })
const parseNonNegative = (fallback: number) => persistedNumber(fallback, 0)

const parseNodeSize3d = parsePositive(0.55)
const parseNodeSpacing3d = parsePositive(8)
const parseOrbitSpeed3d = parsePositive(1)
const parseMaxEdgeLength3d = parsePositive(14)
const parseMinEdgeLength3d = parseNonNegative(2.5)
const parseDegreeGrowth3d = parseNonNegative(0.13)
const parseRepulsion2d = parseNonNegative(2000)
const parseLinkStiffness2d = parsePositive(4.0)
const parseVelocityDecay2d = parseNonNegative(0.4)
const parseLinkDistance2d = parsePositive(30)
const parseCenterForce2d = parseNonNegative(100)
const parseCollideRadius2d = parsePositive(60)
const parseCollideStrength2d = parseNonNegative(0.5)
const parseRecentroSeconds2d = parsePositive(2)
const parseDragAlpha2d = parseNonNegative(0.3)
const parseEdgeLimit2d = parseNonNegative(0)

/** Marca da migracao das forcas 2D. O motor 2D foi trocado pelo do Obsidian
 * (link 250, repulsao -1000, colisao 60), entao os numeros salvos pelo motor
 * antigo (mundo 0..200) significam outra coisa na escala nova: um "Afastamento
 * 200" vira repulsao fraca e o grafo abre comprimido. A migracao roda UMA vez
 * e devolve os cinco valores 2D ao padrao; 3D e exibicao nao sao tocados. */
const CHAVE_MIGRACAO_FORCAS_2D = 'mirrormind.graph2d.physics-version'
const MIGRACAO_FORCAS_2D = '2'

export function useGraphSettings() {
  const [graphRenderLimit, setGraphRenderLimit] = usePref(
    'mirrormind.graph2d.render-limit', GRAPH_RENDER_LIMIT_DEFAULT, parseRenderLimit, serializeNumber,
  )
  const [graph3dNodeSize, setGraph3dNodeSize] = usePref(
    'mirrormind.graph3d.node-size', 0.55, parseNodeSize3d, serializeNumber,
  )
  const [graph3dNodeSpacing, setGraph3dNodeSpacing] = usePref(
    'mirrormind.graph3d.node-spacing', 8, parseNodeSpacing3d, serializeNumber,
  )
  const [graph3dOrbitSpeed, setGraph3dOrbitSpeed] = usePref(
    'mirrormind.graph3d.orbit-speed', 1, parseOrbitSpeed3d, serializeNumber,
  )
  const [graph3dMaxEdgeLength, setGraph3dMaxEdgeLength] = usePref(
    'mirrormind.graph3d.max-edge-length', 14, parseMaxEdgeLength3d, serializeNumber,
  )
  const [graph3dMinEdgeLength, setGraph3dMinEdgeLength] = usePref(
    'mirrormind.graph3d.min-edge-length', 2.5, parseMinEdgeLength3d, serializeNumber,
  )
  const [graph3dDegreeGrowth, setGraph3dDegreeGrowth] = usePref(
    'mirrormind.graph3d.degree-growth', 0.13, parseDegreeGrowth3d, serializeNumber,
  )
  const [graph2dRepulsionStrength, setGraph2dRepulsionStrength] = usePref(
    'mirrormind.graph2d.repulsion-strength', 2000, parseRepulsion2d, serializeNumber,
  )
  const [graph2dLinkStiffness, setGraph2dLinkStiffness] = usePref(
    'mirrormind.graph2d.link-stiffness', 4.0, parseLinkStiffness2d, serializeNumber,
  )
  const [graph2dVelocityDecay, setGraph2dVelocityDecay] = usePref(
    'mirrormind.graph2d.velocity-decay', 0.4, parseVelocityDecay2d, serializeNumber,
  )
  const [graph2dLinkDistance, setGraph2dLinkDistance] = usePref(
    'mirrormind.graph2d.link-distance', 30, parseLinkDistance2d, serializeNumber,
  )
  const [graph2dCenterForce, setGraph2dCenterForce] = usePref(
    'mirrormind.graph2d.center-force', 100, parseCenterForce2d, serializeNumber,
  )
  const [graph2dCollideRadius, setGraph2dCollideRadius] = usePref(
    'mirrormind.graph2d.collide-radius', 60, parseCollideRadius2d, serializeNumber,
  )
  const [graph2dCollideStrength, setGraph2dCollideStrength] = usePref(
    'mirrormind.graph2d.collide-strength', 0.5, parseCollideStrength2d, serializeNumber,
  )
  const [graph2dRecentroSeconds, setGraph2dRecentroSeconds] = usePref(
    'mirrormind.graph2d.recentro-seconds', 2, parseRecentroSeconds2d, serializeNumber,
  )
  const [graph2dDragAlpha, setGraph2dDragAlpha] = usePref(
    'mirrormind.graph2d.drag-alpha', 0.3, parseDragAlpha2d, serializeNumber,
  )
  const [graph2dMinEdgeLength, setGraph2dMinEdgeLength] = usePref(
    'mirrormind.graph2d.min-edge-length', 0, parseEdgeLimit2d, serializeNumber,
  )
  const [graph2dMaxEdgeLength, setGraph2dMaxEdgeLength] = usePref(
    'mirrormind.graph2d.max-edge-length', 0, parseEdgeLimit2d, serializeNumber,
  )

  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_MIGRACAO_FORCAS_2D) === MIGRACAO_FORCAS_2D) return
      localStorage.setItem(CHAVE_MIGRACAO_FORCAS_2D, MIGRACAO_FORCAS_2D)
    } catch {
      return
    }
    setGraph2dRepulsionStrength(2000)
    setGraph2dLinkStiffness(4)
    setGraph2dVelocityDecay(0.4)
    setGraph2dLinkDistance(30)
    setGraph2dCenterForce(100)
    setGraph2dCollideRadius(60)
    setGraph2dCollideStrength(0.5)
    setGraph2dRecentroSeconds(2)
    setGraph2dDragAlpha(0.3)
    setGraph2dMinEdgeLength(0)
    setGraph2dMaxEdgeLength(0)
    // Roda uma vez, no mount: os setters do usePref sao estaveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    graphRenderLimit,
    setGraphRenderLimit,
    graph3dNodeSize,
    setGraph3dNodeSize,
    graph3dNodeSpacing,
    setGraph3dNodeSpacing,
    graph3dOrbitSpeed,
    setGraph3dOrbitSpeed,
    graph3dMaxEdgeLength,
    setGraph3dMaxEdgeLength,
    graph3dMinEdgeLength,
    setGraph3dMinEdgeLength,
    graph3dDegreeGrowth,
    setGraph3dDegreeGrowth,
    graph2dRepulsionStrength,
    setGraph2dRepulsionStrength,
    graph2dLinkStiffness,
    setGraph2dLinkStiffness,
    graph2dVelocityDecay,
    setGraph2dVelocityDecay,
    graph2dLinkDistance,
    setGraph2dLinkDistance,
    graph2dCenterForce,
    setGraph2dCenterForce,
    graph2dCollideRadius,
    setGraph2dCollideRadius,
    graph2dCollideStrength,
    setGraph2dCollideStrength,
    graph2dRecentroSeconds,
    setGraph2dRecentroSeconds,
    graph2dDragAlpha,
    setGraph2dDragAlpha,
    graph2dMinEdgeLength,
    setGraph2dMinEdgeLength,
    graph2dMaxEdgeLength,
    setGraph2dMaxEdgeLength,
  }
}
