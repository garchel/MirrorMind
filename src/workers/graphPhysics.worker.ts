/**
 * Worker de layout do grafo 2D: roda a simulacao ambiente (big bang Obsidian)
 * FORA da thread de interface, para que a tela continue responsiva mesmo com
 * milhares de nos. A thread principal envia o estado inicial (posicoes,
 * arestas, configuracoes e centros de grupo), o worker integra as forcas e
 * devolve as posicoes de cada passo; ao assentar, avisa para persistir o
 * layout. `stop` cancela a simulacao (ex.: inicio de arrasto ou reorganizar).
 *
 * Protocolo (postMessage):
 *   in  -> { type: 'ambient-start', requestId, paths, positions, edges, settings, groupCenters? }
 *   in  -> { type: 'stop' }
 *   out -> { type: 'ambient-step',    requestId, positions }
 *   out -> { type: 'ambient-settled', requestId, positions }
 */
import {
  ambientWorkerPositionsSnapshot,
  ambientWorkerSettled,
  createAmbientWorkerState,
  stepAmbientWorker,
} from '../lib/graphPhysicsWorkerCore'
import type { AmbientWorkerState, WorkerForceSettings } from '../lib/graphPhysicsWorkerCore'
import type { NoteGraphLayoutLink, NoteGraphPosition } from '../lib/noteGraphLayout'

type AmbientStartMessage = {
  type: 'ambient-start'
  requestId: number
  paths: string[]
  positions: Record<string, NoteGraphPosition>
  edges: NoteGraphLayoutLink[]
  settings: WorkerForceSettings
  groupCenters?: Record<string, NoteGraphPosition>
}

type WorkerInputMessage = AmbientStartMessage | { type: 'stop' }

const STEP_INTERVAL_MS = 16

let current: {
  state: AmbientWorkerState
  timer: number | null
  lastStep: number
} | null = null

function stopCurrent(): void {
  if (current?.timer !== null && current?.timer !== undefined) {
    self.clearTimeout(current.timer)
  }
  current = null
}

function runAmbient(): void {
  if (!current) return
  const now = self.performance.now()
  const last = current.lastStep === 0 ? now : current.lastStep
  const delta = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
  current.lastStep = now
  const { remaining } = stepAmbientWorker(current.state, delta)
  const positions = ambientWorkerPositionsSnapshot(current.state)
  self.postMessage({ type: 'ambient-step', requestId: current.state.requestId, positions })
  if (ambientWorkerSettled(current.state, remaining, now)) {
    self.postMessage({ type: 'ambient-settled', requestId: current.state.requestId, positions })
    current = null
    return
  }
  current.timer = self.setTimeout(runAmbient, STEP_INTERVAL_MS)
}

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  const message = event.data
  if (message.type === 'stop') {
    stopCurrent()
    return
  }
  if (message.type === 'ambient-start') {
    stopCurrent()
    current = {
      state: createAmbientWorkerState({
        requestId: message.requestId,
        paths: message.paths,
        positions: message.positions,
        edges: message.edges,
        settings: message.settings,
        groupCenters: message.groupCenters,
        startedAt: self.performance.now(),
      }),
      timer: null,
      lastStep: 0,
    }
    current.timer = self.setTimeout(runAmbient, STEP_INTERVAL_MS)
  }
}
