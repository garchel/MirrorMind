import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DevControls, type DevGraph2dSettings } from './DevControls'

const forcas: DevGraph2dSettings = {
  repulsionStrength: 1400,
  setRepulsionStrength: vi.fn(),
  linkStiffness: 1,
  setLinkStiffness: vi.fn(),
  velocityDecay: 0.4,
  setVelocityDecay: vi.fn(),
  linkDistance: 250,
  setLinkDistance: vi.fn(),
  centerForce: 0.1,
  setCenterForce: vi.fn(),
  collideRadius: 15,
  setCollideRadius: vi.fn(),
  collideStrength: 0.5,
  setCollideStrength: vi.fn(),
  dragAlpha: 0.3,
  setDragAlpha: vi.fn(),
  recentroSeconds: 10,
  setRecentroSeconds: vi.fn(),
  minEdgeLength: 0,
  setMinEdgeLength: vi.fn(),
  maxEdgeLength: 50,
  setMaxEdgeLength: vi.fn(),
  labelZoom: 0,
  setLabelZoom: vi.fn(),
  renderLimit: 800,
  setRenderLimit: vi.fn(),
  reset: vi.fn(),
}

// O projeto roda vitest sem `globals`: a limpeza do DOM entre testes nao e
// automatica e o segundo `render` acumula com o primeiro.
afterEach(cleanup)

describe('DevControls', () => {
  it('liga e desliga os nomes amigaveis pelo switch', async () => {
    const user = userEvent.setup()
    const onEnabledChange = vi.fn()
    render(<DevControls enabled={false} onEnabledChange={onEnabledChange} />)

    await user.click(screen.getByRole('checkbox', { name: /Friendly Names/i }))
    expect(onEnabledChange).toHaveBeenCalledWith(true)
  })

  it('abre o painel com as forcas do grafo 2D', async () => {
    const user = userEvent.setup()
    render(
      <DevControls
        enabled={false}
        onEnabledChange={vi.fn()}
        graph2d={forcas}
        updateNumberSetting={(raw, current, min, max) => {
          const n = Number(raw)
          return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : current
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Controles de desenvolvimento do grafo' }))

    expect(await screen.findByText('Controles de desenvolvimento')).toBeInTheDocument()
    expect(screen.getByText('Grafo 2D — forças')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Força de repulsão dos nós no grafo 2D' })).toHaveValue(1400)
    expect(screen.getByRole('button', { name: /Padrões do 2D/ })).toBeInTheDocument()
  })

  it('escrever uma forca passa pelo clamp e chega no setter', async () => {
    const user = userEvent.setup()
    const setRepulsionStrength = vi.fn()

    // Campo controlado: sem estado local, cada tecla volta ao valor da prop e o
    // digito seguinte cai em cima do numero antigo.
    function Harness() {
      const [valor, setValor] = useState(1400)
      return (
        <DevControls
          enabled
          onEnabledChange={vi.fn()}
          graph2d={{
            ...forcas,
            repulsionStrength: valor,
            setRepulsionStrength: (proximo) => { setValor(proximo); setRepulsionStrength(proximo) },
          }}
          updateNumberSetting={(raw, current, min, max) => {
            const n = Number(raw)
            if (raw.trim() === '' || !Number.isFinite(n)) return current
            return Math.min(max, Math.max(min, n))
          }}
        />
      )
    }

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Controles de desenvolvimento do grafo' }))
    const campo = await screen.findByRole('spinbutton', { name: 'Força de repulsão dos nós no grafo 2D' })
    // Digitar tecla a tecla nao funciona aqui: `clear()` passa por onChange('')
    // e o clamp devolve o valor atual, entao o campo nunca esvazia e o numero
    // novo gruda no antigo. O que interessa e o caminho evento -> clamp ->
    // setter, medido com um change direto.
    fireEvent.change(campo, { target: { value: '900' } })
    expect(setRepulsionStrength).toHaveBeenLastCalledWith(900)
    expect(campo).toHaveValue(900)
  })

  it('sem as forcas (antes do vault) nao oferece o painel', () => {
    render(<DevControls enabled={false} onEnabledChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Controles de desenvolvimento do grafo' })).not.toBeInTheDocument()
  })
})
