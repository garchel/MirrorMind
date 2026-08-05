import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RootErrorBoundary } from './RootErrorBoundary'

function Bomb(): never {
  throw new Error('falha esperada no teste')
}

describe('RootErrorBoundary', () => {
  it('renderiza os filhos quando nao ha erro', () => {
    render(
      <RootErrorBoundary>
        <div>conteudo normal</div>
      </RootErrorBoundary>,
    )
    expect(screen.getByText('conteudo normal')).toBeInTheDocument()
  })

  it('mostra a tela de recuperacao em vez de tela branca quando um filho lanca erro', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <RootErrorBoundary>
          <Bomb />
        </RootErrorBoundary>,
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Algo deu errado')
      expect(screen.getByText('falha esperada no teste')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })
})
