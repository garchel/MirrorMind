import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrontmatterPanelForm } from './FrontmatterPanelForm'

function renderPanel(overrides: Partial<Parameters<typeof FrontmatterPanelForm>[0]> = {}) {
  const onApply = vi.fn().mockReturnValue(null)
  const onApplyTag = vi.fn()
  const onRemoveTag = vi.fn()
  const onOpenBacklink = vi.fn()
  render(
    <FrontmatterPanelForm
      rows={[{ key: 'title', value: 'Fotossíntese' }]}
      tags={['biologia', 'prova']}
      availableTags={['quimica']}
      backlinks={[{ name: 'resumo', relativePath: 'resumo.md' }]}
      brokenLinks={[]}
      onApply={onApply}
      onApplyTag={onApplyTag}
      onRemoveTag={onRemoveTag}
      onOpenBacklink={onOpenBacklink}
      {...overrides}
    />,
  )
  return { onApply, onApplyTag, onOpenBacklink, onRemoveTag }
}

afterEach(cleanup)

describe('FrontmatterPanelForm (painel integrado de propriedades)', () => {
  it('renderiza as secoes de Tags e Propriedades sem o YAML cru', () => {
    renderPanel()
    expect(screen.getByText('Tags')).toBeInTheDocument()
    expect(screen.getByText('Propriedades')).toBeInTheDocument()
    // Badges das tags (mesma implementacao das tags abaixo do titulo).
    const badges = screen.getAllByText(/#biologia|#prova/)
    expect(badges.map((badge) => badge.textContent)).toEqual(['#biologia', '#prova'])
    // A linha do titulo como campos estruturados (sem `---`).
    expect(screen.getByLabelText('Nome da propriedade 1')).toHaveValue('title')
    expect(screen.getByLabelText('Valor YAML da propriedade 1')).toHaveValue('Fotossíntese')
    expect(screen.queryByText('---')).toBeNull()
  })

  it('aplica ao vivo (sem botao Aplicar) as mudancas nas linhas', async () => {
    const { onApply } = renderPanel()
    fireEvent.change(screen.getByLabelText('Valor YAML da propriedade 1'), { target: { value: 'Novo título' } })
    // Debounce de 400ms: a gravacao acontece sozinha, sem botao Aplicar.
    await waitFor(() => expect(onApply).toHaveBeenCalled(), { timeout: 2_000 })
    expect(onApply.mock.calls.at(-1)?.[0]).toEqual([{ key: 'title', value: 'Novo título' }])
  })

  it('adiciona propriedade pelo popover de propriedades comuns (so icones)', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Nova propriedade' }))
    // O popover lista as propriedades comuns so com icones (ex.: Telefone → phone).
    const phoneItem = await screen.findByRole('button', { name: 'Telefone (phone)' })
    expect(phoneItem.textContent).toBe('')
    fireEvent.click(phoneItem)
    const keys = screen.getAllByLabelText(/Nome da propriedade/).map((input) => (input as HTMLInputElement).value)
    expect(keys).toEqual(['title', 'phone'])
  })

  it('aplica ao vivo a remocao de uma linha', async () => {
    const { onApply } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Remover propriedade title' }))
    await waitFor(() => expect(onApply).toHaveBeenCalled(), { timeout: 2_000 })
    expect(onApply.mock.calls.at(-1)?.[0]).toEqual([])
  })

  it('backlink abre a nota referenciada', () => {
    const { onOpenBacklink } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'resumo' }))
    expect(onOpenBacklink).toHaveBeenCalledWith('resumo.md')
  })

  it('links quebrados aparecem compactos com nome curto e alvo cheio no tooltip', () => {
    renderPanel({
      brokenLinks: [
        { target: 'Metas/aprender-system-design/01-entender-sistemas-de-software', displayName: '01-entender-sistemas-de-software' },
        { target: 'anexo-faltante.md', displayName: 'anexo-faltante' },
      ],
    })
    expect(screen.getByText('Links quebrados (2)')).toBeInTheDocument()
    const first = screen.getByText('01-entender-sistemas-de-software')
    // Chip nao clicavel (span) com o alvo completo no tooltip.
    expect(first.tagName).toBe('SPAN')
    expect(first).toHaveAttribute('title', 'Metas/aprender-system-design/01-entender-sistemas-de-software')
    expect(screen.getByText('anexo-faltante')).toBeInTheDocument()
  })

  it('oculta a secao de links quebrados quando nao ha nenhum', () => {
    renderPanel()
    expect(screen.queryByText(/Links quebrados/)).toBeNull()
  })

  it('cria tag com Enter pelo popover de adicionar tag', async () => {
    const { onApplyTag } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tag' }))
    const input = await screen.findByLabelText('Nome da nova tag')
    fireEvent.change(input, { target: { value: 'quimica' } })
    // As sugestoes filtram conforme digita.
    expect(await screen.findByRole('button', { name: '#quimica' })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onApplyTag).toHaveBeenCalledWith('quimica')
  })

  it('aplica tag existente clicando na sugestao', async () => {
    const { onApplyTag } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tag' }))
    const suggestion = await screen.findByRole('button', { name: '#quimica' })
    fireEvent.click(suggestion)
    expect(onApplyTag).toHaveBeenCalledWith('quimica')
  })

  it('remove tag pelo X dentro da badge (visivel no hover)', () => {
    const { onRemoveTag } = renderPanel()
    // O botao de remocao vive DENTRO da badge, a direita do nome.
    const badge = screen.getByText('#biologia')
    const removeButton = screen.getByRole('button', { name: 'Remover tag biologia' })
    expect(badge.contains(removeButton)).toBe(true)
    fireEvent.click(removeButton)
    expect(onRemoveTag).toHaveBeenCalledWith('biologia')
  })
})
