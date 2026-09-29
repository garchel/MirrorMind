import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'
import { Chip } from './Chip'

describe('Card', () => {
  it('renderiza section por padrao, com o preenchimento do token', () => {
    render(<Card>conteudo</Card>)
    const el = screen.getByText('conteudo')
    expect(el.tagName).toBe('SECTION')
    expect(el.className).toContain('ui-card')
  })

  it('padded={false} remove so o preenchimento', () => {
    render(<Card padded={false}>nu</Card>)
    const cls = screen.getByText('nu').className
    expect(cls).toContain('ui-card--flush')
  })

  it('as muda a tag sem perder a classe', () => {
    render(<Card as="li">item</Card>)
    const el = screen.getByText('item')
    expect(el.tagName).toBe('LI')
    expect(el.className).toContain('ui-card')
  })

  it('title vira aria-label', () => {
    render(<Card title="Progresso">x</Card>)
    expect(screen.getByLabelText('Progresso')).toBeTruthy()
  })

  it('className do contexto vem por ultimo', () => {
    render(<Card className="goal-card">ctx</Card>)
    const cls = screen.getByText('ctx').className
    expect(cls).toBe('ui-card goal-card')
  })
})

describe('Chip', () => {
  it('e um span neutro por padrao', () => {
    render(<Chip>3</Chip>)
    const el = screen.getByText('3')
    expect(el.tagName).toBe('SPAN')
    expect(el.className).toBe('ui-chip ui-chip--neutral')
  })

  it('tone define a variante', () => {
    render(<Chip tone="danger">erro</Chip>)
    expect(screen.getByText('erro').className).toContain('ui-chip--danger')
  })

  it('repassa props nativas e children', () => {
    render(
      <Chip data-testid="c" title="detalhe">
        <strong>7</strong>
      </Chip>,
    )
    const el = screen.getByTestId('c')
    expect(el.querySelector('strong')?.textContent).toBe('7')
  })
})
