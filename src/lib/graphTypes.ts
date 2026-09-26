import type { NoteGraphLayoutLink } from './noteGraphLayout'
import type { NoteDocument } from './vault'

/** Tipos do grafo, extraídos do `App.tsx` sem mudança (App e GraphPage usam). */

export type GraphDocument = Pick<NoteDocument, 'name' | 'relativePath' | 'content'>
export type NoteGraphLink = { source: string; target: string }
export type GraphPosition = { x: number; y: number }
export type GraphViewport = { scale: number; x: number; y: number }


/** Estado da fisica continua do grafo 2D no modelo do Obsidian: o no arrastado
 * e o UNICO ponto fixado (pinned) e todo o grafo visivel flui pelas mesmas
 * forcas — molas das arestas, repulsao 1/d² e center force com zona morta —
 * com resfriamento alpha ate assentar. Ao soltar, a simulacao continua (hub
 * fixo no ponto da soltura) ate parar. Uma simulacao AMBIENTE roda ao abrir
 * o grafo (big bang: nos juntos no centro se espalham).
 * Tudo roda num rAF enquanto houver arrasto, assentamento ou ambiente ativo. */
export type Graph2DPhysics = {
  positions: Map<string, GraphPosition>
  /** Arestas entre os nos visiveis (molas), usadas por drag/coast/ambient.
   * Ja em forma de objeto para o loop nao alocar arrays por frame. */
  edges: NoteGraphLayoutLink[]
  /** Tamanho em px da superficie capturado no inicio da simulacao (para
   * converter as posicoes % em transform translate px — composicao GPU, sem
   * forcar layout a cada frame). */
  surfaceSize: { width: number; height: number } | null
  drag: {
    anchor: string
    /** Todos os nos visiveis menos o ancora (fluem pelas forcas). */
    paths: string[]
    velocities: Map<string, GraphPosition>
    draggedTarget: GraphPosition
    /** Ultima posicao do alvo processada (para detectar cursor parado e
     * "dormir" o loop — 60fps desnecessarios com o arrasto imovel). */
    lastTarget: GraphPosition
    startX: number
    startY: number
    moved: boolean
    /** Bounds da superficie capturados no inicio do arrasto (para nao chamar
     * getBoundingClientRect a cada pointermove, que forca layout sincrono). */
    bounds: { left: number; top: number; width: number; height: number } | null
  } | null
  /** Assentamento pos-arrasto: o no que foi arrastado fica FIXO no ponto da
   * soltura e o restante do grafo visivel assenta com alpha decaindo. */
  coast: {
    hub: string
    paths: string[]
    velocities: Map<string, GraphPosition>
    startedAt: number
    alpha: number
  } | null
  /** Simulacao ambiente (big bang): todos os nos visiveis partem do centro
   * com pequena perturbacao e se espalham pelas forcas ate assentar. */
  ambient: {
    paths: string[]
    velocities: Map<string, GraphPosition>
    startedAt: number
    alpha: number
  } | null
}
