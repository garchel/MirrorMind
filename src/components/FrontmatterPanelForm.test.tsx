import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrontmatterPanelForm } from './FrontmatterPanelForm'

function renderPanel(overrides: Partial<Parameters<typeof FrontmatterPanelForm>[0]> = {}) {
  const onApply = vi.fn().mockReturnValue(null)
  const onOpenBacklink = vi.fn()
  render(
    <FrontmatterPanelForm
      rows={[{ key: 'title', value: 'Fotossíntese' }]}
      backlinks={[{ name: 'resumo', relativePath: 'resumo.md' }]}
      brokenLinks={[]}
      onApply={onApply}
      onOpenBacklink={onOpenBacklink}
      {...overrides}
    />,
  )
  return { onApply, onOpenBacklink }
}

afterEach(cleanup)

describe('FrontmatterPanelForm (painel integrado de propriedades)', () => {
  it('renderiza a secao de Propriedades sem o YAML cru (Tags moram no header)', () => {
    renderPanel()
    expect(screen.queryByText('Tags')).toBeNull()
    expect(screen.getByText('Propriedades')).toBeInTheDocument()
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

  it('links pendentes aparecem compactos com nome curto e alvo cheio no tooltip', () => {
    renderPanel({
      brokenLinks: [
        { target: 'Metas/aprender-system-design/01-entender-sistemas-de-software', displayName: '01-entender-sistemas-de-software' },
        { target: 'anexo-faltante.md', displayName: 'anexo-faltante' },
      ],
    })
    expect(screen.getByText('Links pendentes (2)')).toBeInTheDocument()
    const first = screen.getByText('01-entender-sistemas-de-software')
    // Chip nao clicavel (span) com o alvo completo no tooltip.
    expect(first.tagName).toBe('SPAN')
    expect(first).toHaveAttribute('title', 'Metas/aprender-system-design/01-entender-sistemas-de-software')
    expect(screen.getByText('anexo-faltante')).toBeInTheDocument()
  })

  it('oculta a secao de links pendentes quando nao ha nenhum', () => {
    renderPanel()
    expect(screen.queryByText(/Links pendentes/)).toBeNull()
  })

  it('acordeons de links recolhem e expandem o conteudo', () => {
    renderPanel({
      brokenLinks: [{ target: 'anexo-faltante.md', displayName: 'anexo-faltante' }],
    })
    const backlinksToggle = screen.getByRole('button', { name: /Referenciada por \(1\)/ })
    const brokenToggle = screen.getByRole('button', { name: /Links pendentes \(1\)/ })
    expect(backlinksToggle).toHaveAttribute('aria-expanded', 'true')
    expect(brokenToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(backlinksToggle)
    expect(screen.queryByRole('button', { name: 'resumo' })).not.toBeInTheDocument()
    expect(backlinksToggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(brokenToggle)
    expect(screen.queryByText('anexo-faltante')).not.toBeInTheDocument()
    fireEvent.click(brokenToggle)
    expect(screen.getByText('anexo-faltante')).toBeInTheDocument()
  })

  it('mostra observacoes em linguagem simples e oculta a secao sem notas', () => {
    const { unmount } = render(
      <FrontmatterPanelForm
        rows={[]}
        backlinks={[]}
        brokenLinks={[]}
        compatibilityNotes={['Partes em HTML aparecem simplificadas na leitura, mas o texto original continua intacto no arquivo.']}
        onApply={vi.fn().mockReturnValue(null)}
        onOpenBacklink={vi.fn()}
      />,
    )
    expect(screen.getByText('Observações')).toBeInTheDocument()
    expect(screen.getByText(/texto original continua intacto/)).toBeInTheDocument()
    unmount()
    renderPanel()
    expect(screen.queryByText('Observações')).toBeNull()
  })
})
