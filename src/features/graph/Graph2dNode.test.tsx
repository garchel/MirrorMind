import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Graph2dNode, type Graph2dNodeHandlers } from './Graph2dNode'

afterEach(cleanup)

function handlers(): { ref: React.MutableRefObject<Graph2dNodeHandlers>; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    hover: vi.fn(),
    open: vi.fn(),
    dragStart: vi.fn(),
    dragMove: vi.fn(),
    dragEnd: vi.fn(),
    dragCancel: vi.fn(),
    focus: vi.fn(),
    register: vi.fn(),
  }
  return { ref: { current: spies as unknown as Graph2dNodeHandlers }, spies }
}

function renderNode(overrides: Partial<Parameters<typeof Graph2dNode>[0]> = {}) {
  const { ref, spies } = handlers()
  const props = {
    relativePath: 'Biologia/Celula.md',
    label: 'Celula',
    degree: 3,
    isCurrent: false,
    isFocused: false,
    isFilterMatch: false,
    isFilteredOut: false,
    leftPercent: 40,
    topPercent: 60,
    dotScale: 1.2,
    folderColor: null,
    labelHidden: false,
    handlersRef: ref,
    ...overrides,
  }
  render(<Graph2dNode {...props} />)
  return { spies, ...props }
}

describe('Graph2dNode', () => {
  it('desenha o nome acessivel e a posicao em porcentagem', () => {
    renderNode()
    const no = screen.getByRole('button', { name: 'Abrir nota Celula no grafo' })
    expect(no).toHaveStyle({ left: '40%', top: '60%' })
    expect(no).toHaveTextContent('Celula')
    expect(no).toHaveAttribute('title', 'Celula, 3 conexão(ões)')
  })

  it('nao carrega estado de hover nas classes (aplicado imperativamente)', () => {
    // Hover/esmaecimento sao escritos no DOM por efeito, fora do React: se
    // voltassem para o JSX, o `memo` pararia de valer e o hover custaria um
    // render da arvore inteira (medido: 20ms em 300 nos).
    renderNode({ isCurrent: true, isFilterMatch: true, isFilteredOut: true })
    const no = screen.getByRole('button', { name: /Abrir nota Celula/ })
    expect(no.className).toContain('is-current')
    expect(no.className).toContain('is-match')
    expect(no.className).toContain('is-filtered-out')
    expect(no.className).not.toContain('is-hovered')
    expect(no.className).not.toContain('is-dimmed')
  })

  it('dispara hover, foco e clique pelos handlers do ref', async () => {
    const user = userEvent.setup()
    const { spies } = renderNode()

    await user.hover(screen.getByRole('button', { name: /Abrir nota Celula/ }))
    expect(spies.hover).toHaveBeenCalledWith('Biologia/Celula.md')

    await user.click(screen.getByRole('button', { name: /Abrir nota Celula/ }))
    expect(spies.open).toHaveBeenCalledWith('Biologia/Celula.md')
  })

  it('registra o elemento no ref e aceita o rotulo escondido', () => {
    const { spies } = renderNode({ labelHidden: true })
    expect(spies.register).toHaveBeenCalled()
    expect(document.querySelector('.note-graph-node-label')?.className).toContain('is-hidden')
  })
})
