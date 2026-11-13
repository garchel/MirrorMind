import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewPriorityControl } from './ReviewPriorityControl'
import { describePrioritySource, priorityLevelFor } from './reviewPriorityLevels'

afterEach(cleanup)

describe('priorityLevelFor', () => {
  it('mapeia os pesos do motor para os tres degraus', () => {
    expect(priorityLevelFor(1).label).toBe('Normal')
    expect(priorityLevelFor(2).label).toBe('Alta')
    expect(priorityLevelFor(3).label).toBe('Urgente')
  })

  it('leva peso fora da faixa ao degrau mais proximo', () => {
    // 0,1 e o valor que o stepper antigo deixava salvo; 2,7 vem de uma
    // politica herdada. Nenhum dos dois vira "Normal"/"Alta" por engano.
    expect(priorityLevelFor(0.1).label).toBe('Normal')
    expect(priorityLevelFor(2.7).label).toBe('Urgente')
    expect(priorityLevelFor(100).label).toBe('Urgente')
    expect(priorityLevelFor(1.4).label).toBe('Normal')
    expect(priorityLevelFor(1.6).label).toBe('Alta')
  })
})

describe('describePrioritySource', () => {
  it('diz de onde veio o peso', () => {
    expect(describePrioritySource({ kind: 'tag', sourceId: 'revisao/prova' }))
      .toBe('Herdada da tag #revisao/prova')
    expect(describePrioritySource({ kind: 'activeDeadlineTag', sourceId: 'prova-bio' }))
      .toBe('Herdada da tag #prova-bio')
    expect(describePrioritySource({ kind: 'note', sourceId: null })).toBe('Definida nesta nota')
    expect(describePrioritySource({ kind: 'vaultDefault', sourceId: null })).toBe('Padrão do vault')
  })

  it('nao inventa origem quando nao ha dado', () => {
    expect(describePrioritySource(null)).toBeNull()
  })
})

describe('ReviewPriorityControl', () => {
  it('mostra a origem do peso e avisa que a tag continua valendo para as outras', async () => {
    const user = userEvent.setup()
    render(
      <ReviewPriorityControl
        weight={3}
        noteTitle="ATP"
        source={{ kind: 'tag', sourceId: 'revisao/prova' }}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Prioridade de ATP/ }))

    expect(await screen.findByText('Herdada da tag #revisao/prova')).toBeInTheDocument()
    expect(screen.getByText(/a tag continua valendo para as outras/)).toBeInTheDocument()
  })

  it('mostra o degrau atual e abre as tres opcoes com o efeito de cada uma', async () => {
    const user = userEvent.setup()
    render(<ReviewPriorityControl weight={2} noteTitle="ATP" onChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Prioridade de ATP: Alta' })
    expect(trigger).toHaveTextContent('Alta')

    await user.click(trigger)

    const opcoes = await screen.findAllByRole('menuitemradio')
    expect(opcoes).toHaveLength(3)
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual([
      expect.stringContaining('Normal'),
      expect.stringContaining('Alta'),
      expect.stringContaining('Urgente'),
    ])
    expect(screen.getByRole('menuitemradio', { name: /Alta/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /Normal/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Entra na fila pelo atraso, como as demais.')).toBeInTheDocument()
    expect(screen.getByText('Vale só para esta nota.')).toBeInTheDocument()
  })

  it('escolher outro nivel grava o peso daquele nivel', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ReviewPriorityControl weight={1} noteTitle="ATP" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Prioridade de ATP: Normal' }))
    await user.click(await screen.findByRole('menuitemradio', { name: /Urgente/ }))

    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('escolher o nivel que ja esta ativo nao regrava nada', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ReviewPriorityControl weight={2} noteTitle="ATP" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Prioridade de ATP: Alta' }))
    await user.click(await screen.findByRole('menuitemradio', { name: /Alta/ }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('peso fracionario mostra o degrau mais proximo e guarda o valor exato no title', () => {
    render(<ReviewPriorityControl weight={2.7} noteTitle="ATP" onChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Prioridade de ATP: Urgente (peso 2,7)' })
    expect(trigger).toHaveAttribute('title', 'Prioridade: Urgente (peso 2,7)')
  })

  it('fica desabilitado enquanto grava', () => {
    render(<ReviewPriorityControl weight={1} noteTitle="ATP" busy onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Prioridade de ATP/ })).toBeDisabled()
  })

  it('abre o menu no teclado e move o foco com as setas', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ReviewPriorityControl weight={1} noteTitle="ATP" onChange={onChange} />)

    await user.tab()
    await user.keyboard('{Enter}')

    // O foco comeca no nivel atual (Normal) e desce para Alta.
    const normal = await screen.findByRole('menuitemradio', { name: /Normal/ })
    expect(normal).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /Alta/ })).toHaveFocus()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /Normal/ })).toHaveFocus() // deu a volta

    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitemradio', { name: /Urgente/ })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(3)
  })
})
