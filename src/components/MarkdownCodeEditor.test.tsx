import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownCodeEditor } from './MarkdownCodeEditor'
import { getMarkdownAutocompleteResult } from '../lib/markdown-autocomplete'
import type { MarkdownCodeEditorHandle } from './MarkdownCodeEditor'

describe('MarkdownCodeEditor', () => {
  it('configura o corretor ortografico no campo editavel', () => {
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        spellCheck={false}
        value="Texto"
      />,
    )

    expect(container.querySelector('.cm-content')).toHaveAttribute('spellcheck', 'false')
    expect(container.querySelector('.cm-content')).toHaveAttribute('aria-label', 'Editor da nota')
  })

  it('sincroniza o documento quando a nota ativa muda', () => {
    const onChange = vi.fn()
    const onSessionChange = vi.fn()
    const { container, rerender } = render(
      <MarkdownCodeEditor
        documentKey="inicial.md"
        onChange={onChange}
        onHistoryChange={vi.fn()}
        onSessionChange={onSessionChange}
        value="# Nota inicial"
      />,
    )

    expect(container.querySelector('.cm-content')).toHaveTextContent('# Nota inicial')

    rerender(
      <MarkdownCodeEditor
        documentKey="outra-nota.md"
        onChange={onChange}
        onHistoryChange={vi.fn()}
        onSessionChange={onSessionChange}
        value="# Outra nota"
      />,
    )

    expect(container.querySelector('.cm-content')).toHaveTextContent('# Outra nota')
  })

  it('restaura cursor e selecao da nota ao montar o editor', () => {
    const editorRef = createRef<MarkdownCodeEditorHandle>()
    render(
      <MarkdownCodeEditor
        ref={editorRef}
        documentKey="cursor.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        session={{ selectionStart: 2, selectionEnd: 5, scrollTop: 0 }}
        value="abcdef"
      />,
    )

    expect(editorRef.current?.getSelection()).toEqual({
      value: 'abcdef',
      selectionStart: 2,
      selectionEnd: 5,
    })
  })

  it('mantem historicos separados para cada nota aberta', async () => {
    const user = userEvent.setup()
    const editorRef = createRef<MarkdownCodeEditorHandle>()
    const onChange = vi.fn()
    const { container, rerender } = render(
      <MarkdownCodeEditor
        ref={editorRef}
        documentKey="primeira.md"
        onChange={onChange}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        value="Primeira"
      />,
    )

    await user.click(container.querySelector('.cm-content')!)
    await user.keyboard(' nota')
    expect(editorRef.current?.undo()).toBe(true)
    expect(container.querySelector('.cm-content')).toHaveTextContent('Primeira')

    rerender(
      <MarkdownCodeEditor
        ref={editorRef}
        documentKey="segunda.md"
        onChange={onChange}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        value="Segunda"
      />,
    )
    await user.click(container.querySelector('.cm-content')!)
    await user.keyboard(' nota')

    rerender(
      <MarkdownCodeEditor
        ref={editorRef}
        documentKey="primeira.md"
        onChange={onChange}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        value="Primeira"
      />,
    )
    expect(editorRef.current?.redo()).toBe(true)
    expect(container.querySelector('.cm-content')).toHaveTextContent('notaPrimeira')
  })

  it('restaura o historico compartilhado quando um bloco misto volta a montar', async () => {
    const user = userEvent.setup()
    const stateCache = new Map()
    const editorRef = createRef<MarkdownCodeEditorHandle>()
    const firstRender = render(
      <MarkdownCodeEditor
        ref={editorRef}
        documentKey="nota.md::mixed-block::0"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        stateCache={stateCache}
        value="Bloco"
      />,
    )

    await user.click(firstRender.container.querySelector('.cm-content')!)
    await user.keyboard(' novo')
    firstRender.unmount()

    const secondRender = render(
      <MarkdownCodeEditor
        ref={editorRef}
        documentKey="nota.md::mixed-block::0"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        stateCache={stateCache}
        value=" novoBloco"
      />,
    )

    expect(editorRef.current?.undo()).toBe(true)
    expect(secondRender.container.querySelector('.cm-content')).toHaveTextContent('Bloco')
  })

  it('aplica atalhos de Markdown no documento ativo', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="atalhos.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        value="Texto"
      />,
    )

    const content = container.querySelector('.cm-content')!
    await user.click(content)
    await user.keyboard('{Control>}a{/Control}{Control>}b{/Control}')
    expect(content).toHaveTextContent('**Texto**')

    await user.keyboard('{Control>}a{/Control}{Control>}{Shift>}8{/Shift}{/Control}')
    expect(content).toHaveTextContent('- **Texto**')
  })

  it('duplica e exclui linhas com os atalhos nativos do editor', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="linhas.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        value="Primeira\nSegunda"
      />,
    )

    const content = container.querySelector('.cm-content')!
    await user.click(content)
    await user.keyboard('{Control>}a{/Control}{Shift>}{Alt>}{ArrowDown}{/Alt}{/Shift}')
    expect(content.textContent?.match(/Primeira/g)).toHaveLength(2)
    expect(content.textContent?.match(/Segunda/g)).toHaveLength(2)

    await user.keyboard('{Control>}a{/Control}{Shift>}{Control>}k{/Control}{/Shift}')
    expect(content).toHaveTextContent('')
  })

  it('resolve sugestoes de notas, tags, anexos e comandos', () => {
    const data = { attachments: ['attachments/curso/diagrama.png'], notePaths: ['projetos/plano.md'], tags: ['revisao'] }

    expect(getMarkdownAutocompleteResult('[[pla', 5, data)?.options[0].label).toBe('projetos/plano')
    expect(getMarkdownAutocompleteResult('#rev', 4, data)?.options[0].label).toBe('revisao')
    expect(getMarkdownAutocompleteResult('![[dia', 6, data)?.options[0].label).toBe('attachments/curso/diagrama.png')
    expect(getMarkdownAutocompleteResult('/tab', 4, data)?.options[0].label).toBe('/tabela')
  })

  it('abre o painel de busca ao receber uma solicitacao externa', async () => {
    const { rerender } = render(
      <MarkdownCodeEditor
        documentKey="busca.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        searchRequestId={0}
        value="Texto para buscar"
      />,
    )

    rerender(
      <MarkdownCodeEditor
        documentKey="busca.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        searchRequestId={1}
        value="Texto para buscar"
      />,
    )

    await waitFor(() => expect(document.querySelector('.cm-search')).toBeInTheDocument())
  })
})
