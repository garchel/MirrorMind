import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { MarkdownCodeEditor } from './MarkdownCodeEditor'

async function renderLive(value: string, selectionStart = 1) {
  const { container } = render(
    <MarkdownCodeEditor
      documentKey="probe.md"
      livePreview
      onChange={vi.fn()}
      onHistoryChange={vi.fn()}
      onOpenLink={vi.fn()}
      onSessionChange={vi.fn()}
      session={{ selectionStart, selectionEnd: selectionStart, scrollTop: 0 }}
      value={value}
    />,
  )
  const content = container.querySelector('.cm-content')
  if (content) fireEvent.focus(content)
  return container
}

// Linha 3-4 da nota real fotosintese.md: parágrafo terminando em bold + `---`
const PARAGRAPH = 'Processo autotrófico realizado por plantas, algas e cianobactérias para converter energia luminosa em energia química (glicose). Ocorre no **cloroplasto**.'
const NOTE_HEAD = `# Fotossíntese

${PARAGRAPH}
---`

describe('setext + negrito: divisor --- não engrossa a linha acima', () => {
  it('parágrafo terminado em **negrito** + --- não ganha estilo de heading no highlighting', async () => {
    const container = await renderLive(NOTE_HEAD, 0)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const line3 = container.querySelectorAll('.cm-line')[2]
    expect(line3?.textContent).toContain('cloroplasto')
    // O strong do negrito continua strong (classe ͼN do defaultHighlightStyle).
    // O parágrafo NÃO pode ser envolto por um único span de heading: antes da
    // correção, SetextHeading2 aplicava bold+underline à linha INTEIRA.
    const headingSpans = [...line3.querySelectorAll('span')].filter((el) => {
      const cls = el.getAttribute('class') ?? ''
      // ͼ7 é a classe do heading2 no defaultHighlightStyle deste build.
      return cls.split(' ').includes('ͼ7')
    })
    expect(headingSpans.length).toBe(0)
  })

  it('ATX heading (## real) continua com estilo de heading', async () => {
    const container = await renderLive('## Título real\n\nTexto', 0)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const line1 = container.querySelectorAll('.cm-line')[0]
    const headingSpans = [...line1.querySelectorAll('span')].filter((el) => {
      const cls = el.getAttribute('class') ?? ''
      return cls.split(' ').includes('ͼ7')
    })
    expect(headingSpans.length).toBeGreaterThan(0)
  })

  it('negrito no meio do parágrafo + --- : bold continua só na palavra', async () => {
    const container = await renderLive('Frase com **negrito** no meio\n---\nFim', 0)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const line1 = container.querySelectorAll('.cm-line')[0]
    const strongSpans = [...line1.querySelectorAll('span')].filter((el) => {
      const cls = el.getAttribute('class') ?? ''
      return cls.split(' ').some((c) => /^ͼ9$|^ͼ8$/.test(c))
    })
    expect(strongSpans.length).toBeGreaterThan(0)
    expect(strongSpans[0]?.textContent).toBe('negrito')
  })
})
