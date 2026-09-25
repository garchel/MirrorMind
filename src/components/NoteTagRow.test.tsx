import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteTagRow } from './NoteTagRow'

function renderRow(overrides: Partial<Parameters<typeof NoteTagRow>[0]> = {}) {
  const onApplyTag = vi.fn()
  const onRemoveTag = vi.fn()
  render(
    <NoteTagRow
      tags={['biologia', 'prova']}
      availableTags={['quimica']}
      onApplyTag={onApplyTag}
      onRemoveTag={onRemoveTag}
      {...overrides}
    />,
  )
  return { onApplyTag, onRemoveTag }
}

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /Tags da nota/ }))
}

afterEach(cleanup)

describe('NoteTagRow (linha colapsada abaixo do titulo)', () => {
  it('mostra o resumo de uma linha sem titulo de secao nem editor', () => {
    renderRow()
    expect(screen.queryByText('Tags')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Tags da nota: #biologia #prova' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('#biologia #prova')
    // Editor escondido: sem badges interativas nem adicionar.
    expect(screen.queryByRole('button', { name: 'Adicionar tag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remover tag biologia' })).not.toBeInTheDocument()
  })

  it('anuncia os nomes no rotulo acessivel, sem pílula de contagem', () => {
    renderRow()
    // Nomes visiveis e no nome acessivel; sem pill redundante.
    expect(screen.getByRole('button', { name: 'Tags da nota: #biologia #prova' })).toBeInTheDocument()
    expect(document.querySelector('.note-tags-count')).toBeNull()
  })

  it('resume com +N alem das duas primeiras (e anuncia o resto)', () => {
    renderRow({ tags: ['a', 'b', 'c', 'd'] })
    expect(screen.getByRole('button', { name: 'Tags da nota: #a #b e mais 2' })).toHaveTextContent('#a #b +2')
  })

  it('vazio mostra fantasma discreto que expande', () => {
    renderRow({ tags: [] })
    const toggle = screen.getByRole('button', { name: 'Tags da nota' })
    expect(toggle).toHaveTextContent('Tags')
    expand()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Adicionar tag' })).toBeInTheDocument()
  })

  it('expande para badges e recolhe de volta', () => {
    renderRow()
    expand()
    expect(screen.getByRole('button', { name: 'Adicionar tag' })).toBeInTheDocument()
    expect(screen.getByText('#biologia')).toBeInTheDocument()
    // Aberto, o toggle encurta (badges assumem os nomes, sem duplicar).
    expect(screen.getByRole('button', { name: 'Tags da nota' })).toHaveTextContent('Tags')
    expand()
    expect(screen.queryByRole('button', { name: 'Adicionar tag' })).not.toBeInTheDocument()
  })

  it('cria tag com Enter pelo popover de adicionar tag', async () => {
    const { onApplyTag } = renderRow()
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tag' }))
    const input = await screen.findByLabelText('Nome da nova tag')
    fireEvent.change(input, { target: { value: 'quimica' } })
    // As sugestoes filtram conforme digita.
    expect(await screen.findByRole('button', { name: '#quimica' })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onApplyTag).toHaveBeenCalledWith('quimica')
  })

  it('aplica tag existente clicando na sugestao', async () => {
    const { onApplyTag } = renderRow()
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tag' }))
    const suggestion = await screen.findByRole('button', { name: '#quimica' })
    fireEvent.click(suggestion)
    expect(onApplyTag).toHaveBeenCalledWith('quimica')
  })

  it('remove tag pelo X dentro da badge (visivel no hover)', () => {
    const { onRemoveTag } = renderRow()
    expand()
    // O botao de remocao vive DENTRO da badge, a direita do nome.
    const badge = screen.getByText('#biologia')
    const removeButton = screen.getByRole('button', { name: 'Remover tag biologia' })
    expect(badge.contains(removeButton)).toBe(true)
    fireEvent.click(removeButton)
    expect(onRemoveTag).toHaveBeenCalledWith('biologia')
  })
})
