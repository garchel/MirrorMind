import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { NoteImprovementDiff } from './NoteImprovementDiff'

afterEach(() => {
  cleanup()
})

const NOTA = `# Ciclo de Calvin

A fixacao de carbono ocorre no estroma dos cloroplastos.

A glicose e o produto final.`

const SUGESTAO = {
  term: 'estroma',
  definition: 'O fluido interno do cloroplasto.',
  sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
}

describe('NoteImprovementDiff', () => {
  it('mostra o antes e o depois, com o novo bloco marcado', () => {
    render(<NoteImprovementDiff before={NOTA} suggestions={[SUGESTAO]} />)

    expect(screen.getByText('Antes')).toBeInTheDocument()
    expect(screen.getByText('Depois')).toBeInTheDocument()
    expect(screen.getByText('O fluido interno do cloroplasto.')).toBeInTheDocument()
    expect(screen.getByText('estroma')).toBeInTheDocument()
  })

  it('marca o bloco inserido e o trecho que ele explica', () => {
    const { container } = render(
      <NoteImprovementDiff before={NOTA} suggestions={[SUGESTAO]} />,
    )

    const inserted = container.querySelector('.is-inserted')
    expect(inserted).not.toBeNull()
    expect(inserted?.textContent).toContain('O fluido interno do cloroplasto.')

    // O trecho original aparece destacado no "antes" e no "depois".
    const anchored = container.querySelectorAll('.is-anchored')
    expect(anchored.length).toBeGreaterThanOrEqual(2)
  })

  it('o hover num par destaca o par', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <NoteImprovementDiff before={NOTA} suggestions={[SUGESTAO]} />,
    )

    const pair = container.querySelector('.review-improvement-pair')
    expect(pair?.className).not.toContain('is-active')

    await user.hover(pair as Element)
    expect(pair?.className).toContain('is-active')
  })

  it('avisa quando nenhuma sugestao pode ser ancorada', () => {
    render(
      <NoteImprovementDiff
        before={NOTA}
        suggestions={[
          { term: 'x', definition: 'y', sourceQuote: 'uma frase que nao esta na nota' },
        ]}
      />,
    )

    expect(screen.getByText(/Nenhuma sugestão pôde ser ancorada/)).toBeInTheDocument()
  })

  it('nao mostra nada quando nao ha sugestoes', () => {
    render(<NoteImprovementDiff before={NOTA} suggestions={[]} />)
    expect(screen.getByText(/Nenhuma sugestão pôde ser ancorada/)).toBeInTheDocument()
  })
})
