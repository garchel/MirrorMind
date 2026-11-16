import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Graph2dCanvas, type Graph2dCanvasNode } from './Graph2dCanvas'

afterEach(cleanup)

const SETTINGS = {
  linkStiffness: 1,
  linkRest: 12,
  repulsionStrength: 300,
  velocityDecay: 0.4,
  centerStrength: 0.02,
}

const NOS: Graph2dCanvasNode[] = [
  { path: 'a.md', label: 'a', degree: 1, color: null, isCurrent: true },
  { path: 'b.md', label: 'b', degree: 1, color: '#c60', isCurrent: false },
]

function montar(extra: Partial<Parameters<typeof Graph2dCanvas>[0]> = {}) {
  const props = {
    nodes: NOS,
    links: [{ source: 'a.md', target: 'b.md' }],
    settings: SETTINGS,
    hoveredPath: null,
    neighbors: null,
    reorganizeKey: 0,
    onHover: vi.fn(),
    onOpen: vi.fn(),
    onFocus: vi.fn(),
    ...extra,
  }
  render(<Graph2dCanvas {...props} />)
  return props
}

describe('Graph2dCanvas', () => {
  it('desenha um canvas acessivel e nao um elemento por nota', () => {
    montar()
    const canvas = screen.getByRole('application', { name: 'Grafo de notas' })
    expect(canvas.tagName).toBe('CANVAS')
    expect(canvas).toHaveAttribute('tabindex', '0')
    expect(canvas).toHaveAttribute('aria-describedby', 'graph2d-canvas-ajuda')
    // Nenhum botao visivel por nota: o desenho e do canvas.
    expect(document.querySelectorAll('.note-graph-node').length).toBe(0)
  })

  it('lista as notas em botoes escondidos para teclado e leitor de tela', async () => {
    const user = userEvent.setup()
    const props = montar()
    const botao = screen.getByRole('button', { name: 'Abrir nota b no grafo' })
    await user.click(botao)
    expect(props.onOpen).toHaveBeenCalledWith('b.md')
  })

  it('restaura as posicoes salvas do vault e persiste quando assenta', async () => {
    const onSettled = vi.fn()
    montar({
      initialPositions: { 'a.md': { x: 10, y: 20 }, 'b.md': { x: 30, y: 40 } },
      onSettled,
    })
    await waitFor(() => expect(onSettled).toHaveBeenCalled(), { timeout: 8000 })
    const posicoes = onSettled.mock.calls[0][0] as Record<string, { x: number; y: number }>
    expect(Object.keys(posicoes).sort()).toEqual(['a.md', 'b.md'])
    // Partiu do layout salvo (10/20 e 30/40), nao do centro (100, 100).
    expect(posicoes['a.md'].x).toBeLessThan(60)
    expect(posicoes['b.md'].y).toBeLessThan(90)
  })

  it('explica os gestos para quem usa teclado', () => {
    montar()
    expect(screen.getByText(/Arraste o fundo para mover/)).toBeInTheDocument()
  })
})
