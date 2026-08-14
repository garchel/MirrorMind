/**
 * Nucleo da simulacao ambiente (big bang) do grafo 2D, compartilhado entre o
 * Web Worker de layout (`src/workers/graphPhysics.worker.ts`) e seus testes
 * unitarios. Puro e serializavel: recebe apenas dados plain (objetos/arrays),
 * sem Maps do lado de fora — o worker converte na fronteira.
 *
 * Cada passo aplica as forcas do modelo Obsidian (repulsao 1/d², molas das
 * arestas, center force e mola de grupo opcional), integra com decaimento de
 * velocidade e resfria o alpha ate assentar — a mesma dinamica do loop da
 * thread principal, calculada fora dela para manter a interface responsiva.
 */
import {
  accumulateObsidianForces2D,
  GRAPH_2D_BOUNDS,
  OBSIDIAN_PHYSICS_2D,
} from './noteGraphLayout'
import type { NoteGraphLayoutLink, NoteGraphPosition } from './noteGraphLayout'

export type WorkerForceSettings = {
  linkStiffness: number
  linkRest: number
  repulsionStrength: number
  velocityDecay: number
  /** Center force ja escalada pelo slider (0-300 -> multiplicador). */
  centerStrength: number
}

export type AmbientWorkerState = {
  requestId: number
  paths: string[]
  positions: Map<string, NoteGraphPosition>
  velocities: Map<string, NoteGraphPosition>
  edges: NoteGraphLayoutLink[]
  settings: WorkerForceSettings
  groupCenters: Map<string, NoteGraphPosition> | null
  alpha: number
  startedAt: number
}

export function createAmbientWorkerState(params: {
  requestId: number
  paths: string[]
  positions: Record<string, NoteGraphPosition>
  edges: NoteGraphLayoutLink[]
  settings: WorkerForceSettings
  groupCenters?: Record<string, NoteGraphPosition>
  startedAt: number
}): AmbientWorkerState {
  const positions = new Map(Object.entries(params.positions))
  const velocities = new Map<string, NoteGraphPosition>()
  for (const path of params.paths) velocities.set(path, { x: 0, y: 0 })
  return {
    requestId: params.requestId,
    paths: params.paths,
    positions,
    velocities,
    edges: params.edges,
    settings: params.settings,
    groupCenters: params.groupCenters ? new Map(Object.entries(params.groupCenters)) : null,
    alpha: 1,
    startedAt: params.startedAt,
  }
}

/** Um passo da simulacao: forcas + integracao + resfriamento. Devolve a
 * energia cinetica residual (para o chamador decidir o assentamento). */
export function stepAmbientWorker(state: AmbientWorkerState, delta: number): { remaining: number } {
  const { positions, velocities, edges, settings, groupCenters } = state
  accumulateObsidianForces2D({
    paths: state.paths,
    positions,
    velocities,
    edges,
    linkStiffness: settings.linkStiffness,
    linkRest: settings.linkRest,
    repulsionStrength: settings.repulsionStrength,
    centerStrength: settings.centerStrength,
    groupCenters: groupCenters ?? undefined,
    alpha: state.alpha,
    delta,
  })
  let remaining = 0
  for (const path of state.paths) {
    const current = positions.get(path)
    const velocity = velocities.get(path)
    if (!current || !velocity) continue
    const damping = Math.max(0, 1 - settings.velocityDecay * delta)
    velocity.x *= damping
    velocity.y *= damping
    current.x = Math.max(GRAPH_2D_BOUNDS.minX, Math.min(GRAPH_2D_BOUNDS.maxX, current.x + velocity.x * delta))
    current.y = Math.max(GRAPH_2D_BOUNDS.minY, Math.min(GRAPH_2D_BOUNDS.maxY, current.y + velocity.y * delta))
    remaining += velocity.x * velocity.x + velocity.y * velocity.y
  }
  state.alpha *= OBSIDIAN_PHYSICS_2D.alphaDecay
  return { remaining }
}

/** Condicao de assentamento: energia residual minima, alpha abaixo do piso ou
 * timeout (mesmos limites do loop da thread principal). */
export function ambientWorkerSettled(state: AmbientWorkerState, remaining: number, now: number): boolean {
  return remaining < 0.05
    || state.alpha < OBSIDIAN_PHYSICS_2D.alphaMin
    || now - state.startedAt > 4000
}

/** Serializa as posicoes do estado para o postMessage (estrutura clone). */
export function ambientWorkerPositionsSnapshot(state: AmbientWorkerState): Record<string, NoteGraphPosition> {
  const snapshot: Record<string, NoteGraphPosition> = {}
  for (const [path, position] of state.positions) {
    snapshot[path] = { x: position.x, y: position.y }
  }
  return snapshot
}
