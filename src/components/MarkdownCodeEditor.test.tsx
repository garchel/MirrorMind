import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownCodeEditor } from './MarkdownCodeEditor'

describe('MarkdownCodeEditor', () => {
  it('sincroniza o documento quando a nota ativa muda', () => {
    const onChange = vi.fn()
    const onSessionChange = vi.fn()
    const { container, rerender } = render(
      <MarkdownCodeEditor
        documentKey="inicial.md"
        onChange={onChange}
        onSessionChange={onSessionChange}
        value="# Nota inicial"
      />,
    )

    expect(container.querySelector('.cm-content')).toHaveTextContent('# Nota inicial')

    rerender(
      <MarkdownCodeEditor
        documentKey="outra-nota.md"
        onChange={onChange}
        onSessionChange={onSessionChange}
        value="# Outra nota"
      />,
    )

    expect(container.querySelector('.cm-content')).toHaveTextContent('# Outra nota')
  })
})
