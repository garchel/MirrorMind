import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'
import { Badge } from './badge'

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

describe('Badge', () => {
  it('e um chip neutro por padrao', () => {
    render(<Badge>3</Badge>)
    const el = screen.getByText('3')
    expect(el.tagName).toBe('SPAN')
    expect(el.className).toBe('ui-chip ui-chip--neutral')
  })

  it('tone define a variante', () => {
    render(<Badge tone="danger">erro</Badge>)
    expect(screen.getByText('erro').className).toContain('ui-chip--danger')
  })

  it('o variant legado continua emitindo a classe antiga do ui.css', () => {
    // o NoteTagRow depende de ui-badge-secondary; sem isso a badge de
    // tag perde fundo e cor.
    render(<Badge variant="secondary">#tag</Badge>)
    const cls = screen.getByText('#tag').className
    expect(cls).toContain('ui-badge')
    expect(cls).toContain('ui-badge-secondary')
  })

  it('o variant legado nao emite nenhuma classe ui-chip', () => {
    // As duas bases divergem em 11 propriedades e tem a mesma
    // especificidade: emitir as duas seria depender da ordem do bundle.
    render(<Badge variant="destructive">falhou</Badge>)
    const cls = screen.getByText('falhou').className
    expect(cls).toContain('ui-badge-destructive')
    expect(cls).not.toContain('ui-chip')
  })

  it('tone tem precedencia sobre variant', () => {
    render(
      <Badge tone="accent" variant="secondary">
       nota
      </Badge>,
    )
    const cls = screen.getByText('nota').className
    expect(cls).toContain('ui-chip--accent')
    expect(cls).not.toContain('ui-badge')
  })

  it('repassa props nativas e children', () => {
    render(
      <Badge data-testid="c" title="detalhe">
        <strong>7</strong>
      </Badge>,
    )
    const el = screen.getByTestId('c')
    expect(el.querySelector('strong')?.textContent).toBe('7')
  })
})

describe('Badge — o consumidor real', () => {
  it('NoteTagRow com variant="secondary" emite exatamente as classes antigas', () => {
    // Este e o unico uso de <Badge> no app. Se a classe antiga sumir,
    // a badge de tag perde fundo, cor e borda sem nenhum teste falhar
    // — o CSS nao e testado.
    render(
      <Badge variant="secondary" className="frontmatter-panel-tag-badge">
        #regressao-visual
      </Badge>,
    )
    const cls = screen.getByText('#regressao-visual').className
    expect(cls).toContain('ui-badge')
    expect(cls).toContain('ui-badge-secondary')
    expect(cls).toContain('frontmatter-panel-tag-badge')
    expect(cls).not.toContain('ui-chip')
  })
})
