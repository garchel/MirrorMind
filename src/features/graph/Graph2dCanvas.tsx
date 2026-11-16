import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Graph2dSimulation, type Graph2dSettings } from '../../lib/graph2dSimulation'
import {
  drawGraph2d,
  pickNode,
  screenToWorld,
  type Graph2dNodeStyle,
  type Graph2dView,
} from './graph2dRenderer'

export type Graph2dCanvasNode = {
  path: string
  label: string
  degree: number
  color: string | null
  isCurrent: boolean
}

export type Graph2dCanvasLink = { source: string; target: string }

export type Graph2dCanvasProps = {
  nodes: Graph2dCanvasNode[]
  links: Graph2dCanvasLink[]
  settings: Graph2dSettings
  /** No em hover (vindo do estado do app). */
  hoveredPath: string | null
  /** Vizinhos do hover, para esmaecer o resto. `null` = nada esmaecido. */
  neighbors: Set<string> | null
  /** Muda de valor para reorganizar do centro (big bang). */
  reorganizeKey: number
  /** Layout salvo do vault: o grafo reabre onde parou. */
  initialPositions?: Record<string, { x: number; y: number }>
  /** Chamado quando o layout assenta: e a hora de persistir. */
  onSettled?: (positions: Record<string, { x: number; y: number }>) => void
  onHover: (path: string | null) => void
  onOpen: (path: string) => void
  onFocus?: (path: string) => void
  ariaLabel?: string
}

const ZOOM_MIN = 0.15
const ZOOM_MAX = 6
/** A partir daqui os nomes aparecem sem hover. */
const ZOOM_LABELS = 1.45

/** Cores concretas: o canvas nao resolve `var(--token)`. */
const CORES = {
  link: 'rgb(120 138 125 / 40%)',
  linkDim: 'rgb(120 138 125 / 10%)',
  node: 'rgb(226 214 178)',
  nodeRing: 'rgb(28 36 39 / 70%)',
  nodeCurrent: 'rgb(196 106 62)',
  label: 'rgb(28 36 39)',
  labelDim: 'rgb(48 62 52 / 80%)',
} as const

/**
 * Grafo 2D em canvas — mesma fisica e mesmas interacoes do Obsidian.
 *
 * A simulacao e criada UMA vez por conjunto de notas e vive num ref: nenhum
 * re-render do React a recria (recriar no meio de um gesto era o que fazia o
 * arrasto parecer que so movia o no clicado). O loop de `requestAnimationFrame`
 * para sozinho quando o alpha assenta e acorda no proximo gesto.
 */
export function Graph2dCanvas({
  nodes,
  links,
  settings,
  hoveredPath,
  neighbors,
  reorganizeKey,
  initialPositions,
  onSettled,
  onHover,
  onOpen,
  onFocus,
  ariaLabel = 'Grafo de notas',
}: Graph2dCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const simRef = useRef<Graph2dSimulation | null>(null)
  const viewRef = useRef<Graph2dView>({ x: 0, y: 0, zoom: 1 })
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 })
  const frameRef = useRef<number | null>(null)
  const hoverRef = useRef(-1)
  const vizinhosRef = useRef<Set<number> | null>(null)
  const estilosRef = useRef<Graph2dNodeStyle[]>([])
  const arrastoRef = useRef<
    | { tipo: 'no'; path: string; x: number; y: number; movido: boolean }
    | { tipo: 'pano'; x: number; y: number; movido: boolean }
    | null
  >(null)
  /** Ultimo `settings` recebido: lido pelo efeito que aplica ao vivo. */
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  /** Assinatura dos VALORES (nao da identidade do objeto, que muda a cada
   * render do pai). So reaquece quando algum numero muda de fato. */
  const settingsKey = [
    settings.linkDistance,
    settings.linkStrength,
    settings.repelStrength,
    settings.centerStrength,
    settings.collideRadius,
    settings.collideStrength,
    settings.nodeSizeMultiplier,
  ].join('|')
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled
  const persistidoRef = useRef(false)
  /** Primeira vez: a camera enquadra o grafo quando ele assentar. */
  const enquadradoRef = useRef(false)

  const assinatura = useMemo(
    () => `${nodes.map((node) => node.path).join('|')}::${links.length}`,
    [nodes, links.length],
  )

  const desenhar = useCallback(() => {
    const canvas = canvasRef.current
    const sim = simRef.current
    if (!canvas || !sim) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width, height, dpr } = sizeRef.current
    if (width === 0 || height === 0) return
    drawGraph2d(ctx, sim, {
      width,
      height,
      dpr,
      view: viewRef.current,
      hovered: hoverRef.current,
      neighbors: vizinhosRef.current,
      labels: hoverRef.current >= 0 || viewRef.current.zoom > ZOOM_LABELS,
      colors: CORES,
      nodeStyles: estilosRef.current,
      nodeSizeMultiplier: sim.settings.nodeSizeMultiplier,
    })
  }, [])

  /** Agenda um frame se ainda nao houver um. O loop para sozinho ao assentar. */
  const pedirFrame = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const sim = simRef.current
      if (!sim) return
      const ativo = arrastoRef.current !== null || !sim.settled
      if (ativo) {
        sim.step()
        desenhar()
        pedirFrame()
        return
      }
      // Assentou: enquadra UMA vez e persiste UMA vez.
      if (!enquadradoRef.current && sim.count > 0 && sim.alpha < 0.4) {
        enquadradoRef.current = true
        const c = sim.centroid()
        let maior = 1
        for (let i = 0; i < sim.count; i += 1) {
          maior = Math.max(maior, Math.hypot(sim.xs[i] - c.x, sim.ys[i] - c.y))
        }
        const { width, height } = sizeRef.current
        const caber = Math.min(width, height) / (maior * 2.4)
        // Piso de 0.3: enquadrar uma cadeia longa inteira levava o zoom a
        // 0.15 e as bolinhas a 2px — o usuario abria o grafo e via um borrao.
        viewRef.current = { x: c.x, y: c.y, zoom: Math.max(0.3, Math.min(1.1, caber)) }
      }
      desenhar()
      if (!persistidoRef.current && onSettledRef.current) {
        persistidoRef.current = true
        const snapshot: Record<string, { x: number; y: number }> = {}
        for (const path of sim.paths) {
          const posicao = sim.positionOf(path)
          if (posicao) snapshot[path] = posicao
        }
        onSettledRef.current(snapshot)
      }
    })
  }, [desenhar])

  // (Re)cria a simulacao quando o conjunto de nos muda — e so entao.
  useEffect(() => {
    const anterior = simRef.current
    const posicoes = new Map<string, { x: number; y: number }>()
    if (anterior && reorganizeKey === 0) {
      for (const node of nodes) {
        const posicao = anterior.positionOf(node.path)
        if (posicao) posicoes.set(node.path, posicao)
      }
    } else if (reorganizeKey === 0 && initialPositions) {
      // Layouts salvos antes desta versao estao na escala 0..200 do mundo
      // antigo; com link 250 eles comecariam comprimidos e explodiriam.
      // Se a extensao for menor que o link, o layout e de outra escala.
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
      for (const node of nodes) {
        const salva = initialPositions[node.path]
        if (!salva) continue
        minX = Math.min(minX, salva.x); maxX = Math.max(maxX, salva.x)
        minY = Math.min(minY, salva.y); maxY = Math.max(maxY, salva.y)
      }
      const extensao = Math.max(maxX - minX, maxY - minY)
      if (Number.isFinite(extensao) && extensao >= (settings.linkDistance ?? 250) * 0.5) {
        for (const node of nodes) {
          const salva = initialPositions[node.path]
          if (salva) posicoes.set(node.path, { x: salva.x, y: salva.y })
        }
      }
    }
    const sim = new Graph2dSimulation({
      paths: nodes.map((node) => node.path),
      links,
      positions: posicoes,
      settings,
    })
    // Abrir o grafo ou reorganizar = big bang (alpha cheio, todos do centro).
    if (!anterior || reorganizeKey > 0) {
      sim.alpha = 1
      enquadradoRef.current = false
    } else {
      sim.reheat(0.35)
    }
    simRef.current = sim
    persistidoRef.current = false
    estilosRef.current = nodes.map((node) => ({ color: node.color, isCurrent: node.isCurrent }))
    hoverRef.current = -1
    vizinhosRef.current = null
    desenhar()
    pedirFrame()
    // `settings` e aplicado ao vivo no efeito abaixo; nao recria a simulacao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, reorganizeKey])

  // Constantes ao vivo (sliders da toolbar). O layout dorme em alpha 0.001:
  // so trocar `settings` nao move nada ate o proximo gesto, e o slider parecia
  // nao ter efeito. Reaquecer (0.3, o mesmo valor do arrasto) faz a mudanca
  // aparecer na hora.
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    sim.settings = { ...settingsRef.current }
    sim.reheat(0.3)
    persistidoRef.current = false
    pedirFrame()
  }, [settingsKey, pedirFrame])

  // Hover do app -> canvas.
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    hoverRef.current = hoveredPath ? (sim.indexByPath.get(hoveredPath) ?? -1) : -1
    let vizinhos: Set<number> | null = null
    if (neighbors) {
      vizinhos = new Set()
      for (const path of neighbors) {
        const i = sim.indexByPath.get(path)
        if (i !== undefined) vizinhos.add(i)
      }
    }
    vizinhosRef.current = vizinhos
    pedirFrame()
  }, [hoveredPath, neighbors, pedirFrame])

  // Tamanho + devicePixelRatio.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const medir = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { width: rect.width, height: rect.height, dpr }
      // Atribuir `canvas.width/height` LIMPA o buffer: so quando muda de fato.
      const largura = Math.max(1, Math.round(rect.width * dpr))
      const altura = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== largura) canvas.width = largura
      if (canvas.height !== altura) canvas.height = altura
      // Primeiro quadro sincrono: rAF fica pausado com a janela em segundo plano.
      desenhar()
      pedirFrame()
    }
    medir()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', medir)
      return () => window.removeEventListener('resize', medir)
    }
    const observer = new ResizeObserver(medir)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [pedirFrame, desenhar])

  useEffect(
    () => () => {
      // Zerar o ref e obrigatorio: senao ele guarda um frame CANCELADO e
      // `pedirFrame` passa a sair cedo para sempre (loop morto no StrictMode).
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    },
    [],
  )

  const pontoLocal = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const noNoPonto = (ponto: { x: number; y: number }) => {
    const sim = simRef.current
    if (!sim) return -1
    const { width, height } = sizeRef.current
    return pickNode(sim, ponto.x, ponto.y, viewRef.current, width, height, sim.settings.nodeSizeMultiplier)
  }

  const aoPressionar = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ponto = pontoLocal(event)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* sem captura: o arrasto segue pelos eventos da janela */
    }
    const indice = noNoPonto(ponto)
    const sim = simRef.current
    if (indice >= 0 && sim) {
      const { width, height } = sizeRef.current
      const mundo = screenToWorld(ponto.x, ponto.y, viewRef.current, width, height)
      // `pin` = forceNode{x,y} + alphaTarget .3 (app.js do Obsidian).
      sim.pin(sim.paths[indice], mundo.x, mundo.y)
      persistidoRef.current = false
      arrastoRef.current = { tipo: 'no', path: sim.paths[indice], x: ponto.x, y: ponto.y, movido: false }
      pedirFrame()
      return
    }
    arrastoRef.current = { tipo: 'pano', x: ponto.x, y: ponto.y, movido: false }
  }

  const aoMover = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ponto = pontoLocal(event)
    const arrasto = arrastoRef.current
    if (arrasto) {
      const dx = ponto.x - arrasto.x
      const dy = ponto.y - arrasto.y
      if (Math.hypot(dx, dy) > 2) arrasto.movido = true
      if (arrasto.tipo === 'pano') {
        const view = viewRef.current
        viewRef.current = { ...view, x: view.x - dx / view.zoom, y: view.y - dy / view.zoom }
      } else {
        const { width, height } = sizeRef.current
        const mundo = screenToWorld(ponto.x, ponto.y, viewRef.current, width, height)
        simRef.current?.pin(arrasto.path, mundo.x, mundo.y)
        persistidoRef.current = false
      }
      arrasto.x = ponto.x
      arrasto.y = ponto.y
      pedirFrame()
      return
    }
    const indice = noNoPonto(ponto)
    if (indice !== hoverRef.current) {
      hoverRef.current = indice
      const sim = simRef.current
      onHover(indice >= 0 && sim ? sim.paths[indice] : null)
      pedirFrame()
    }
  }

  const aoSoltar = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const arrasto = arrastoRef.current
    arrastoRef.current = null
    const sim = simRef.current
    if (arrasto?.tipo === 'no' && sim) {
      // Soltar: unpin + alphaTarget 0 (o par do app.js).
      sim.unpin(arrasto.path)
      // Clique simples abre o painel; arrastar nao abre nada.
      if (!arrasto.movido) onFocus?.(arrasto.path)
      pedirFrame()
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* ja liberado */
    }
  }

  const aoRolar = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const ponto = pontoLocal(event)
    const view = viewRef.current
    const { width, height } = sizeRef.current
    const antes = screenToWorld(ponto.x, ponto.y, view, width, height)
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * Math.exp(-event.deltaY * 0.0015)))
    // Mantem o ponto sob o cursor parado (zoom no cursor, como no Obsidian).
    viewRef.current = {
      zoom,
      x: antes.x - (ponto.x - width / 2) / zoom,
      y: antes.y - (ponto.y - height / 2) / zoom,
    }
    pedirFrame()
  }

  return (
    <div className="graph2d-canvas-shell">
      <canvas
        ref={canvasRef}
        className="graph2d-canvas"
        role="application"
        aria-label={ariaLabel}
        aria-describedby="graph2d-canvas-ajuda"
        tabIndex={0}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onPointerLeave={() => {
          if (hoverRef.current !== -1) {
            hoverRef.current = -1
            onHover(null)
            pedirFrame()
          }
        }}
        onWheel={aoRolar}
      />
      <p id="graph2d-canvas-ajuda" className="visually-hidden">
        Grafo das notas. Arraste o fundo para mover, use a roda para aproximar, arraste uma nota para
        reorganizar e clique para ver os detalhes. As notas também estão listadas logo abaixo,
        acessíveis pelo teclado.
      </p>
      <ul className="visually-hidden" aria-label="Notas no grafo">
        {nodes.map((node) => (
          <li key={node.path}>
            <button type="button" onClick={() => onOpen(node.path)}>
              Abrir nota {node.label} no grafo
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
