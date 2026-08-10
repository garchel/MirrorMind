/**
 * Fisica de interacao do grafo 2D durante o arrasto de um no, no espirito do
 * Obsidian: o no arrastado empurra os demais (repulsao com raio de influencia)
 * e os vizinhos conectados sao puxados por uma mola (resto ~13% do viewBox),
 * enquanto o proprio no arrastado segue o cursor.
 *
 * Posicoes em % do viewBox 0-100. Retorna um novo mapa de posicoes (imutavel),
 * pronto para virar o proximo `graphNodeOverrides`.
 */
export type NoteGraphPosition = { x: number; y: number }

export type NoteGraphLayoutLink = { source: string; target: string }

export type NoteGraphLayoutNode = { relativePath: string }

const BOUNDS = { minX: 4, maxX: 96, minY: 5, maxY: 95 }
/** Distancia de descanso da mola entre nos conectados (em % do viewBox). */
const LINK_REST_LENGTH = 13
/** Amortecimento do deslocamento por evento de pointermove (smooth). */
const DAMPING = 0.35

export function applyGraphDragForces(
  positions: Record<string, NoteGraphPosition>,
  links: NoteGraphLayoutLink[],
  documents: NoteGraphLayoutNode[],
  draggedPath: string,
  target: NoteGraphPosition,
): Record<string, NoteGraphPosition> {
  const next: Record<string, NoteGraphPosition> = { ...positions }
  const neighbors = new Set<string>()
  for (const link of links) {
    if (link.source === draggedPath) neighbors.add(link.target)
    if (link.target === draggedPath) neighbors.add(link.source)
  }
  for (const document of documents) {
    const path = document.relativePath
    if (path === draggedPath) {
      next[path] = target
      continue
    }
    const current = positions[path] ?? target
    const deltaX = current.x - target.x
    const deltaY = current.y - target.y
    const distance = Math.max(Math.hypot(deltaX, deltaY), 0.001)
    // Repulsao (inversa a distancia, com teto): nos se afastam do arrastado.
    const push = Math.min(2.5, 14 / distance)
    let nx = (deltaX / distance) * push
    let ny = (deltaY / distance) * push
    // Mola nos conectados: puxa para perto do no arrastado quando distante,
    // afasta quando colado demais.
    if (neighbors.has(path)) {
      const spring = (distance - LINK_REST_LENGTH) * 0.14
      nx += (deltaX / distance) * spring
      ny += (deltaY / distance) * spring
    }
    next[path] = {
      x: Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, current.x + nx * DAMPING)),
      y: Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, current.y + ny * DAMPING)),
    }
  }
  return next
}
