import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Graph2dSimulation, type Graph2dSettings } from '../../lib/graph2dSimulation'
import {
  drawGraph2d,
  pickNode,
  screenToWorld,
  worldScale,
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

const ZOOM_MIN = 0.35
const ZOOM_MAX = 4
/** Alpha usado enquanto o usuario arrasta: o cluster acompanha sem oscilar. */
const ALPHA_DRAG = 0.55
/** A partir daqui os nomes aparecem sem hover. O zoom inicial e 1 (grafo
 * inteiro): mostrar todos os nomes ali vira mancha de texto — medido no
 * harness, com 120 nos os rotulos cobriam as bolinhas. */
const ZOOM_LABELS = 1.6

/** Cores concretas: o canvas nao resolve `var(--token)`. */
const CORES = {
  background: 'transparent',
  link: 'rgb(120 138 125 / 34%)',
  linkDim: 'rgb(120 138 125 / 9%)',
  node: 'rgb(226 214 178)',
  nodeRing: 'rgb(28 36 39 / 78%)',
  nodeCurrent: 'rgb(196 106 62)',
  label: 'rgb(28 36 39)',
  labelDim: 'rgb(48 62 52 / 82%)',
} as const

/**
 * Grafo 2D em canvas — o modelo do Obsidian.
 *
 * O documento nao tem um elemento por nota: o desenho e o `<canvas>`, e o
 * loop so roda enquanto o layout tem trabalho. Quando `alpha` cai abaixo do
 * limite, nenhum `requestAnimationFrame` fica agendado (custo ocioso zero) e
 * o proximo gesto acorda a simulacao.
 *
 * O esmaecimento do hover vem por prop (estado do app) e e aplicado no
 * desenho: nao re-renderiza React a cada movimento do mouse.
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
  const viewRef = useRef<Graph2dView>({ panX: 0, panY: 0, zoom: 1 })
  const sizeRef = useRef<{ width: number; height: number; dpr: number }>({ width: 0, height: 0, dpr: 1 })
  const frameRef = useRef<number | null>(null)
  const hoverRef = useRef(-1)
  const vizinhosRef = useRef<Set<number> | null>(null)
  const estilosRef = useRef<Graph2dNodeStyle[]>([])
  // Nasce sem rotulos: com todos visiveis o grafo vira uma mancha de texto.
  const labelsRef = useRef(false)
  const arrastoRef = useRef<
    { tipo: 'no'; path: string; x: number; y: number; movido: boolean } | { tipo: 'pano'; x: number; y: number; movido: boolean } | null
  >(null)
  /** Posicoes atuais, para trocar o conjunto de nos sem re-explodir. */
  const posicoesRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled
  /** Evita persistir o mesmo layout a cada frame parado. */
  const persistidoRef = useRef(false)

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
      radius: 2.4,
      labels: labelsRef.current,
      colors: CORES,
      nodeStyles: estilosRef.current,
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
      desenhar()
      // Assentou: persiste UMA vez (nao por frame). `persistido` volta a false
      // quando o layout e reaquecido (arrasto, reorganizar).
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

  // (Re)cria a simulacao quando o conjunto de nos muda.
  useEffect(() => {
    const anterior = simRef.current
    const posicoes = new Map<string, { x: number; y: number }>()
    if (!anterior && initialPositions && reorganizeKey === 0) {
      for (const node of nodes) {
        const salva = initialPositions[node.path]
        if (salva) posicoes.set(node.path, { x: salva.x, y: salva.y })
      }
    }
    if (anterior && reorganizeKey === 0) {
      for (const node of nodes) {
        const posicao = anterior.positionOf(node.path)
        if (posicao) posicoes.set(node.path, posicao)
      }
    }
    for (const node of nodes) {
      const posicao = anterior?.positionOf(node.path)
      if (posicao) posicoesRef.current.set(node.path, posicao)
    }
    const sim = new Graph2dSimulation({
      paths: nodes.map((node) => node.path),
      links,
      positions: posicoes,
      settings,
    })
    // Abrir o grafo (ou reorganizar) e big bang: todos do centro, alpha cheio.
    if (anterior === null || reorganizeKey > 0) sim.reheat(1)
    else sim.reheat(0.45)
    simRef.current = sim
    persistidoRef.current = false
    estilosRef.current = nodes.map((node) => ({
      color: node.color,
      isCurrent: node.isCurrent,
      scale: 1 + Math.min(node.degree, 8) * 0.09,
    }))
    hoverRef.current = -1
    vizinhosRef.current = null
    desenhar()
    pedirFrame()
    // `settings` e aplicado ao vivo no efeito abaixo; nao recria a simulacao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, reorganizeKey])

  // Constantes ao vivo (sliders da toolbar).
  useEffect(() => {
    if (simRef.current) simRef.current.settings = { ...settings }
  }, [settings])

  // Hover do app -> canvas.
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const indice = hoveredPath ? (sim.indexByPath.get(hoveredPath) ?? -1) : -1
    let vizinhos: Set<number> | null = null
    if (neighbors) {
      vizinhos = new Set()
      for (const path of neighbors) {
        const i = sim.indexByPath.get(path)
        if (i !== undefined) vizinhos.add(i)
      }
    }
    hoverRef.current = indice
    vizinhosRef.current = vizinhos
    labelsRef.current = vizinhos !== null || viewRef.current.zoom > ZOOM_LABELS
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
      // Atribuir `canvas.width/height` LIMPA o canvas. Um ResizeObserver que
      // reatribui a cada medicao apagava o desenho logo depois de pinta-lo
      // (medido: 171 frames desenhados e 0 pixels no buffer). Só redimensiona
      // quando o valor muda de fato.
      const largura = Math.max(1, Math.round(rect.width * dpr))
      const altura = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== largura) canvas.width = largura
      if (canvas.height !== altura) canvas.height = altura
      // Desenha ja: o primeiro quadro nao pode depender do rAF, que fica
      // pausado com a janela em segundo plano (o grafo abria em branco ate o
      // primeiro gesto).
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
      // Zerar o ref e obrigatorio: sem isso ele fica com o id de um frame
      // CANCELADO e `pedirFrame` passa a sair cedo para sempre — a simulacao
      // nunca mais da um passo e nem o pan/arrasto redesenham. Em dev o
      // StrictMode monta/desmonta/remonta os efeitos, e era exatamente onde o
      // loop morria (medido no app: passos=0 com alpha=1 e settled=false).
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
    return pickNode(sim, ponto.x, ponto.y, viewRef.current, width, height, 2.4)
  }

  const aoPressionar = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ponto = pontoLocal(event)
    const indice = noNoPonto(ponto)
    // `setPointerCapture` lanca InvalidStateError quando o ponteiro nao esta
    // ativo. Sem o try, a excecao abortava o handler ANTES de marcar o
    // arrasto: pan e arrasto de no ficavam mortos sem nenhum erro visivel.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* sem captura: o arrasto segue pelos eventos da propria janela */
    }
    const sim = simRef.current
    if (indice >= 0 && sim) {
      const path = sim.paths[indice]
      const { width, height } = sizeRef.current
      const mundo = screenToWorld(ponto.x, ponto.y, viewRef.current, width, height)
      sim.pin(path, mundo.x, mundo.y)
      sim.reheat(ALPHA_DRAG)
      persistidoRef.current = false
      arrastoRef.current = { tipo: 'no', path, x: ponto.x, y: ponto.y, movido: false }
      onFocus?.(path)
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
        viewRef.current = { ...viewRef.current, panX: viewRef.current.panX + dx, panY: viewRef.current.panY + dy }
      } else {
        const { width, height } = sizeRef.current
        const mundo = screenToWorld(ponto.x, ponto.y, viewRef.current, width, height)
        simRef.current?.pin(arrasto.path, mundo.x, mundo.y)
        simRef.current?.reheat(ALPHA_DRAG)
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
      labelsRef.current = indice >= 0 || viewRef.current.zoom > ZOOM_LABELS
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
      sim.unpin(arrasto.path)
      sim.reheat(0.4)
      if (!arrasto.movido) {
        onFocus?.(arrasto.path)
        onOpen(arrasto.path)
      }
      pedirFrame()
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* ja liberado pelo navegador */
    }
  }

  const aoRolar = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const ponto = pontoLocal(event)
    const view = viewRef.current
    const { width, height } = sizeRef.current
    const antes = screenToWorld(ponto.x, ponto.y, view, width, height)
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * Math.exp(-event.deltaY * 0.0015)))
    const base = worldScale(width, height) * zoom
    viewRef.current = {
      zoom,
      panX: ponto.x - width / 2 - (antes.x - 100) * base,
      panY: ponto.y - height / 2 - (antes.y - 100) * base,
    }
    labelsRef.current = hoverRef.current >= 0 || zoom > ZOOM_LABELS
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
        reorganizar e clique para abrir. As notas também estão listadas logo abaixo, acessíveis pelo teclado.
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
