import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Folder } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphFilterSelect } from './GraphFilterSelect'

afterEach(cleanup)

const options = [
  { value: 'Diario', label: 'Diario' },
  { value: 'Projetos/App', label: 'Projetos/App' },
  { value: 'Projetos/Site', label: 'Projetos/Site' },
]

function setup(value = '', onChange = vi.fn()) {
  render(
    <GraphFilterSelect
      label="Filtrar pasta do grafo"
      allLabel="Todas as pastas"
      icon={<Folder size={14} aria-hidden="true" />}
      value={value}
      options={options}
      onChange={onChange}
    />,
  )
  return { onChange }
}

describe('GraphFilterSelect', () => {
  it('mostra o rotulo neutro e abre o menu com todas as opcoes', async () => {
    const user = userEvent.setup()
    setup()

    expect(screen.getByRole('button', { name: 'Filtrar pasta do grafo' })).toHaveTextContent('Todas as pastas')
    await user.click(screen.getByRole('button', { name: 'Filtrar pasta do grafo' }))

    const listbox = screen.getByRole('listbox', { name: 'Filtrar pasta do grafo' })
    expect(within(listbox).getAllByRole('option')).toHaveLength(4)
    expect(screen.getByRole('option', { name: 'Todas as pastas' })).toHaveAttribute('aria-selected', 'true')
  })

  it('filtra pela busca e seleciona a opcao', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    await user.click(screen.getByRole('button', { name: 'Filtrar pasta do grafo' }))
    await user.type(screen.getByLabelText('Buscar em Filtrar pasta do grafo'), 'projetos')

    const listbox = screen.getByRole('listbox', { name: 'Filtrar pasta do grafo' })
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    await user.click(screen.getByRole('option', { name: 'Projetos/App' }))

    expect(onChange).toHaveBeenCalledWith('Projetos/App')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marca a opcao ativa e volta ao neutro', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('Diario')

    expect(screen.getByRole('button', { name: 'Filtrar pasta do grafo' })).toHaveTextContent('Diario')
    await user.click(screen.getByRole('button', { name: 'Filtrar pasta do grafo' }))
    expect(screen.getByRole('option', { name: 'Diario' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('option', { name: 'Todas as pastas' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('navega entre opcoes com as setas', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'Filtrar pasta do grafo' }))
    const search = screen.getByLabelText('Buscar em Filtrar pasta do grafo')
    search.focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('option', { name: 'Todas as pastas' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Diario' })).toHaveFocus()
  })
})
