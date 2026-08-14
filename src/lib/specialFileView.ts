/** Parsers puros para a visualizacao SOMENTE LEITURA de arquivos especiais do
 * Obsidian (Canvas e Excalidraw): extraem um resumo estruturado do JSON sem
 * executar nada e sem alterar o arquivo. JSON invalido cai para a fonte crua. */

export type CanvasNodeSummary = {
  id: string
  type: string
  text: string
}

export type SpecialFileSummary = {
  kind: 'canvas' | 'excalidraw'
  /** Contagem de nos/elementos. */
  itemCount: number
  /** Contagem por tipo (estavel e ordenada). */
  types: Array<{ type: string; count: number }>
  /** Nos de texto do Canvas (rotulos visiveis). */
  canvasNodes: CanvasNodeSummary[]
  /** JSON invalido ou nao parseavel: o conteudo cru e exibido. */
  raw: string | null
}

/** Resume um arquivo `.canvas` (JSON com `nodes` e `edges`). */
export function summarizeCanvas(json: string): SpecialFileSummary {
  try {
    const parsed = JSON.parse(json) as { nodes?: unknown; edges?: unknown }
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
    const edges = Array.isArray(parsed.edges) ? parsed.edges : []
    const typeCounts = new Map<string, number>()
    const canvasNodes: CanvasNodeSummary[] = []
    for (const node of nodes) {
      if (typeof node !== 'object' || node === null) continue
      const record = node as { id?: unknown; type?: unknown; text?: unknown; label?: unknown }
      const type = typeof record.type === 'string' && record.type ? record.type : 'unknown'
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
      const text = [record.text, record.label]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
      if (text) {
        canvasNodes.push({
          id: typeof record.id === 'string' ? record.id : `no-${canvasNodes.length}`,
          type,
          text,
        })
      }
    }
    typeCounts.set('edges', edges.length)
    return {
      kind: 'canvas',
      itemCount: nodes.length,
      types: [...typeCounts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
      canvasNodes: canvasNodes.slice(0, 200),
      raw: null,
    }
  } catch {
    return { kind: 'canvas', itemCount: 0, types: [], canvasNodes: [], raw: json }
  }
}

/** Resume um arquivo `.excalidraw` (JSON com `elements`). */
export function summarizeExcalidraw(json: string): SpecialFileSummary {
  try {
    const parsed = JSON.parse(json) as { elements?: unknown }
    const elements = Array.isArray(parsed.elements) ? parsed.elements : []
    const typeCounts = new Map<string, number>()
    for (const element of elements) {
      if (typeof element !== 'object' || element === null) continue
      const record = element as { type?: unknown }
      const type = typeof record.type === 'string' && record.type ? record.type : 'unknown'
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
    }
    return {
      kind: 'excalidraw',
      itemCount: elements.length,
      types: [...typeCounts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
      canvasNodes: [],
      raw: null,
    }
  } catch {
    return { kind: 'excalidraw', itemCount: 0, types: [], canvasNodes: [], raw: json }
  }
}

/** Escolhe o resumo pelo tipo de arquivo especial. */
export function summarizeSpecialFile(kind: 'canvas' | 'excalidraw', json: string): SpecialFileSummary {
  return kind === 'canvas' ? summarizeCanvas(json) : summarizeExcalidraw(json)
}
