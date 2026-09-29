import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('usa a variante padrao secundaria com densidade md', () => {
    render(<Button>Atualizar</Button>)
    const b = screen.getByRole('button', { name: 'Atualizar' })
    expect(b.className).toContain('ui-button')
    expect(b.className).toContain('ui-button--secondary')
    expect(b.className).toContain('ui-button--md')
    // a classe antiga continua sendo emitida enquanto a migracao roda
    expect(b.className).toContain('secondary-button')
  })

  it('mapeia cada variante para a classe antiga e para a ui-*', () => {
    const { container } = render(
      <Button variant="primary" size="sm">
        Revisar
      </Button>,
    )
    const b = container.querySelector('button')!
    expect(b.className).toContain('primary-button')
    expect(b.className).toContain('ui-button--primary')
    expect(b.className).toContain('ui-button--sm')
  })

  it('danger nao herda a classe secundaria', () => {
    const { container } = render(
      <Button variant="danger" size="xs">
        Apagar
      </Button>,
    )
    const b = container.querySelector('button')!
    expect(b.className).toContain('danger-button')
    expect(b.className).not.toContain('secondary-button')
  })

  it('preserva className de contexto -- o ajuste de 3 classes', () => {
    // Este e o contrato que a skill de worktree compartilhado exige:
    // as 42 regras antigas usam seletor de 2-3 classes e precisam
    // continuar casando, entao o className do chamador tem de chegar
    // intacto no DOM.
    const { container } = render(
      <Button className="history-actions-btn">Desfazer</Button>,
    )
    expect(container.querySelector('button')!.className).toContain(
      'history-actions-btn',
    )
  })

  it('type default e button, para nao submeter form por accident', () => {
    const { container } = render(<Button>Salvar</Button>)
    expect(container.querySelector('button')!.getAttribute('type')).toBe(
      'button',
    )
  })

  it('respeita type explicito', () => {
    const { container } = render(<Button type="submit">Salvar</Button>)
    expect(container.querySelector('button')!.getAttribute('type')).toBe(
      'submit',
    )
  })

  it('propaga disabled e as props nativas', async () => {
    const onClick = vi.fn()
    const { container } = render(
      <Button disabled onClick={onClick} aria-label="Excluir nota">
        X
      </Button>,
    )
    const b = container.querySelector('button')!
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-label', 'Excluir nota')
    await userEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('marca o icone como decorativo', () => {
    const { container } = render(
      <Button icon={<svg data-testid="i" />}>Buscar</Button>,
    )
    const icon = container.querySelector('.ui-button__icon')!
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('redireciona ref', () => {
    let captured: HTMLButtonElement | null = null
    render(
      <Button
        ref={(el) => {
          captured = el
        }}
      >
        Alvo
      </Button>,
    )
    expect(captured).toBeInstanceOf(HTMLButtonElement)
  })
})
