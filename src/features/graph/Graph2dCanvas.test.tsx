import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Graph2dCanvas, type Graph2dCanvasProps } from './Graph2dCanvas'
import { Graph2dSimulation } from '../../lib/graph2dSimulation'

const NOS: Graph2dCanvasProps['nodes'] = [
  { path: 'a.md', label: 'a', degree: 1, color: null, isCurrent: false },
  { path: 'b.md', label: 'b', degree: 1, color: null, isCurrent: false },
]

function props(extra: Partial<Graph2dCanvasProps> = {}): Graph2dCanvasProps {
  return {
    nodes: NOS,
    links: [{ source: 'a.md', target: 'b.md' }],
    settings: {
      linkDistance: 250,
      linkStrength: 1,
      repelStrength: 30,
      centerStrength: 0.1,
      collideRadius: 60,
      collideStrength: 0.5,
      nodeSizeMultiplier: 1,
      alphaTargetDrag: 0.3,
      recentroSeconds: 2,
      minEdgeLength: 0,
      maxEdgeLength: 0,
    },
    hoveredPath: null,
    neighbors: null,
    reorganizeKey: 0,
    // O no `a` comeca exatamente na origem do mundo; com o canvas em 0x0 no
    // jsdom, ele cai em (0,0) na tela — e o alvo do ponteiro.
    initialPositions: { 'a.md': { x: 0, y: 0 }, 'b.md': { x: 250, y: 0 } },
    onHover: () => {},
    onOpen: () => {},
    onFocus: () => {},
    ...extra,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Graph2dCanvas (modelo do Obsidian)', () => {
  it('desenha em canvas (nao em um elemento por nota)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    render(<Graph2dCanvas {...props()} />)
    const canvas = screen.getByRole('application', { name: 'Grafo de notas' })
    expect(canvas.tagName).toBe('CANVAS')
  })

  it('pointerdown fixa o no (forceNode) e pointerup sem mover abre o painel', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const pin = vi.spyOn(Graph2dSimulation.prototype, 'pin')
    const unpin = vi.spyOn(Graph2dSimulation.prototype, 'unpin')
    const onFocus = vi.fn()
    render(<Graph2dCanvas {...props({ onFocus })} />)
    const canvas = screen.getByRole('application', { name: 'Grafo de notas' })
    // A simulacao nasce num efeito; sob carga da suite ela pode chegar depois.
    await waitFor(() => {
      fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 })
      expect(pin).toHaveBeenCalled()
    })

    fireEvent.pointerUp(canvas, { clientX: 0, clientY: 0, pointerId: 1 })
    expect(unpin).toHaveBeenCalled()
    expect(onFocus).toHaveBeenCalledWith('a.md')
  })

  it('arrastar NAO abre o painel', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onFocus = vi.fn()
    render(<Graph2dCanvas {...props({ onFocus })} />)
    const canvas = screen.getByRole('application', { name: 'Grafo de notas' })
    await waitFor(() => expect(canvas).toBeInTheDocument())

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 30, pointerId: 1 })

    expect(onFocus).not.toHaveBeenCalled()
  })

  it('lista as notas em botoes acessiveis (teclado)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onOpen = vi.fn()
    render(<Graph2dCanvas {...props({ onOpen })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir nota b no grafo' }))
    expect(onOpen).toHaveBeenCalledWith('b.md')
  })
})
