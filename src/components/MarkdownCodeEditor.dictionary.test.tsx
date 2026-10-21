import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownCodeEditor } from './MarkdownCodeEditor'
import type { DictionaryEntry } from '../features/dictionary/dictionarySchema'

function entry(term: string, concept: string): DictionaryEntry {
  return { term, concept, createdAtUnixMs: 0, updatedAtUnixMs: 0 }
}

/**
 * O hover do dicionario, testado no editor de verdade.
 *
 * Nao basta testar a funcao que acha o termo: o que importa e que o
 * **editor** marca a palavra e avisa o hover. Um teste que so exercita a
 * funcao passaria mesmo com a extensao nao instalada no editor.
 */
describe('hover do dicionario no editor', () => {
  it('marca a palavra registrada no texto', async () => {
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        value="O rubisco fixa o carbono."
        dictionaryEntries={[entry('rubisco', 'Enzima que fixa carbono.')]}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-dictionary-word')).toBeTruthy()
    })
    expect(container.querySelector('.cm-dictionary-word')?.textContent).toBe('rubisco')
  })

  it('nao marca palavra que nao esta registrada', async () => {
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        value="O rubisco fixa o carbono."
        dictionaryEntries={[entry('outra-palavra', 'Sem relacao.')]}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeTruthy()
    })
    expect(container.querySelector('.cm-dictionary-word')).toBeNull()
  })

  it('marca ignorando caixa e acentos', async () => {
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        value="A Glicólise ocorre aqui."
        dictionaryEntries={[entry('glicólise', 'Quebra da glicose.')]}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-dictionary-word')).toBeTruthy()
    })
    expect(container.querySelector('.cm-dictionary-word')?.textContent).toBe('Glicólise')
  })

  it('nao marca o termo dentro de outra palavra', async () => {
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        value="um partnership no court"
        dictionaryEntries={[entry('art', 'A arte.')]}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeTruthy()
    })
    expect(container.querySelector('.cm-dictionary-word')).toBeNull()
  })

  it('marca um termo de varias palavras', async () => {
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        value="A glicólise aeróbica ocorre."
        dictionaryEntries={[entry('glicólise aeróbica', 'Quebra da glicose em condicoes de ausencia de oxygenio.')]}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-dictionary-word')).toBeTruthy()
    })
    expect(container.querySelector('.cm-dictionary-word')?.textContent).toBe('glicólise aeróbica')
  })

  it('atualiza as marcas quando o dicionario muda', async () => {
    const { container, rerender } = render(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        value="O rubisco fixa o carbono."
        dictionaryEntries={[]}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeTruthy()
    })
    expect(container.querySelector('.cm-dictionary-word')).toBeNull()

    rerender(
      <MarkdownCodeEditor
        documentKey="nota.md"
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        ariaLabel="Editor da nota"
        value="O rubisco fixa o carbono."
        dictionaryEntries={[entry('rubisco', 'Enzima que fixa carbono.')]}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-dictionary-word')).toBeTruthy()
    })
  })
})
