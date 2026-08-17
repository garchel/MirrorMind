/**
 * Renderizacao seletiva do grafo 2D: em vaults grandes, desenha apenas os nos
 * dentro (ou proximos) do viewport atual, mantendo a contagem total e o aviso
 * de resultado resumido. Funcoes puras — a integracao fica no App.
 */

export type CullingViewport = { scale: number; x: number; y: number }
export type CullingSurfaceSize = { width: number; height: number }
export type CullingPosition = { x: number; y: number }

/** Margem (px) alem da borda da superficie para nao "sumir" nos no pan. */
export const GRAPH_CULLING_MARGIN_PX = 160

/** Limite padrao de nos renderizados por cena (configuravel). */
export const GRAPH_RENDER_LIMIT_DEFAULT = 400

/** Projeta a posicao (unidades do mundo 0-GRAPH_2D_WORLD_SIZE) para pixels. */
export function graphPositionToScreen(
  position: CullingPosition,
  viewport: CullingViewport,
  surfaceSize: CullingSurfaceSize,
): { x: number; y: number } {
  return {
    x: (position.x / 200) * surfaceSize.width * viewport.scale + viewport.x,
    y: (position.y / 200) * surfaceSize.height * viewport.scale + viewport.y,
  }
}

/** Um no e visivel quando a projecao cai dentro da superficie (com margem).
 * Sem tamanho conhecido da superficie, nada e descartado. */
export function isNodeInViewport(
  position: CullingPosition,
  viewport: CullingViewport,
  surfaceSize: CullingSurfaceSize | null,
  marginPx = GRAPH_CULLING_MARGIN_PX,
): boolean {
  if (!surfaceSize || surfaceSize.width <= 0 || surfaceSize.height <= 0) return true
  const screen = graphPositionToScreen(position, viewport, surfaceSize)
  return screen.x >= -marginPx
    && screen.x <= surfaceSize.width + marginPx
    && screen.y >= -marginPx
    && screen.y <= surfaceSize.height + marginPx
}

/** Seleciona os documentos a renderizar: os que estao no viewport, mais
 * qualquer caminho prioritario (no focado, no hover e seus vizinhos) para o
 * contexto nao sumir durante o pan/zoom. So corta quando o total excede o
 * limite configuravel. */
export function selectRenderedGraphDocuments<T extends { relativePath: string }>(params: {
  documents: T[]
  /** Posicao em % do viewBox por caminho (todos os documentos). */
  positions: Record<string, CullingPosition>
  viewport: CullingViewport
  surfaceSize: CullingSurfaceSize | null
  limit: number
  /** Caminhos sempre visiveis, mesmo fora do viewport (contexto). */
  priorityPaths?: Iterable<string>
  marginPx?: number
}): T[] {
  const { documents, positions, viewport, surfaceSize, limit, marginPx } = params
  if (surfaceSize === null || documents.length <= limit) return documents
  const priority = new Set(params.priorityPaths ?? [])
  const rendered: T[] = []
  for (const document of documents) {
    const position = positions[document.relativePath]
    if (!position) continue
    if (priority.has(document.relativePath) || isNodeInViewport(position, viewport, surfaceSize, marginPx)) {
      rendered.push(document)
    }
  }
  return rendered
}
