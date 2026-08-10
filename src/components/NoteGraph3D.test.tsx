import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteGraph3D } from './NoteGraph3D'

describe('NoteGraph3D', () => {
  it('renderiza o fallback quando o WebGL nao esta disponivel (jsdom)', () => {
    render(
      <NoteGraph3D
        nodes={[{ name: 'inicial.md', relativePath: 'inicial.md' }]}
        links={[]}
        degreeByPath={{}}
        focusedPath={null}
        currentPath={null}
        layoutVersion={0}
        hideAllLabels={false}
        nodeSize={0.55}
        nodeSpacing={8}
        orbitSpeed={1}
        maxEdgeLength={14}
        minEdgeLength={2.5}
        degreeGrowth={0.13}
        onFocus={() => undefined}
        onOpenNote={() => undefined}
      />,
    )

    expect(screen.getByText(/Modo 3D indisponivel/)).toBeInTheDocument()
  })
})
