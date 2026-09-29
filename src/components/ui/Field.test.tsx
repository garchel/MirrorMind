import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Field } from './Field'

describe('Field', () => {
  it('renderiza input por padrao, com densidade xs', () => {
    render(<Field placeholder="Buscar" />)
    const el = screen.getByPlaceholderText('Buscar')
    expect(el.tagName).toBe('INPUT')
    expect(el.className).toContain('ui-field')
    expect(el.className).toContain('ui-field--xs')
  })

  it('as="select" renderiza select e repassa as opcoes', () => {
    render(
      <Field as="select" label="Tema">
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
      </Field>,
    )
    const el = screen.getByLabelText('Tema') as HTMLSelectElement
    expect(el.tagName).toBe('SELECT')
    expect(el.options).toHaveLength(2)
  })

  it('as="textarea" ganha a classe de altura propria', () => {
    render(<Field as="textarea" label="Nota" />)
    const el = screen.getByLabelText('Nota') as HTMLTextAreaElement
    expect(el.tagName).toBe('TEXTAREA')
    expect(el.className).toContain('ui-field--textarea')
    expect(el.className).toContain('ui-field--xs')
  })

  it('size="sm" troca a densidade', () => {
    render(<Field size="sm" label="Contagem" />)
    expect(screen.getByLabelText('Contagem').className).toContain('ui-field--sm')
  })

  it('className do contexto vem depois das classes do componente', () => {
    render(<Field label="Base" className="settings-select" />)
    const cls = screen.getByLabelText('Base').className
    expect(cls).toBe('ui-field ui-field--xs settings-select')
    expect(cls.indexOf('ui-field--xs')).toBeLessThan(cls.indexOf('settings-select'))
  })

  it('label vira aria-label e nao sobrescreve um aria-label existente', () => {
    const { rerender } = render(<Field label="Do componente" />)
    expect(screen.getByLabelText('Do componente')).toBeTruthy()
    rerender(<Field aria-label="Do chamador" />)
    expect(screen.getByLabelText('Do chamador')).toBeTruthy()
  })

  it('repassa props nativas: value, onChange, disabled, type, maxLength', async () => {
    const onChange = vi.fn()
    render(
      <Field
        type="number"
        value={7}
        onChange={onChange}
        disabled
        maxLength={3}
        label="Numero"
      />,
    )
    const el = screen.getByLabelText('Numero') as HTMLInputElement
    expect(el.value).toBe('7')
    expect(el.disabled).toBe(true)
    expect(el.maxLength).toBe(3)
    expect(el.type).toBe('number')
  })

  it('onChange dispara', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLInputElement>()
    render(<Field ref={ref} label="Nome" defaultValue="" />)
    await user.type(screen.getByLabelText('Nome'), 'a')
    expect(ref.current).toBeTruthy()
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('a')
  })

  it('forwardRef aponta para o elemento real', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Field ref={ref} label="Ancorado" />)
    expect(ref.current?.tagName).toBe('INPUT')
  })
})
