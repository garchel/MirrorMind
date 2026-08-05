import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownCodeEditor } from './MarkdownCodeEditor'

async function renderLive(value: string, selectionStart = 1, onChange?: () => void) {
  const { container } = render(
    <MarkdownCodeEditor
      documentKey="live.md"
      livePreview
      onChange={onChange ?? vi.fn()}
      onHistoryChange={vi.fn()}
      onSessionChange={vi.fn()}
      session={{ selectionStart, selectionEnd: selectionStart, scrollTop: 0 }}
      value={value}
    />,
  )
  const content = container.querySelector('.cm-content')!
  fireEvent.focus(content)
  return container
}

function table(container: HTMLElement) {
  return container.querySelector('.cm-live-table-wrap table')
}

describe('markdownLivePreview render (jsdom)', () => {
  it('renderiza a tabela como um <table> real, igual ao modo Leitura', async () => {
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |')
    await waitFor(() => expect(table(container)).not.toBeNull())
    const content = container.querySelector('.cm-content')
    // Nenhum pipe visivel e a linha de delimitadores nao e renderizada.
    expect(content?.textContent).not.toContain('|')
    expect(content?.textContent).not.toContain('---')
    // Estrutura identica ao modo Leitura: thead/th + tbody/td.
    expect(container.querySelectorAll('thead th').length).toBe(2)
    expect(container.querySelectorAll('tbody td').length).toBe(2)
    expect(container.querySelector('thead th')?.textContent).toBe('A')
    expect(container.querySelector('tbody td')?.textContent).toBe('1')
  })

  it('nao revela o Markdown cru com o cursor dentro da tabela', async () => {
    // Cursor na posicao da celula "1" (dentro da tabela).
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 33)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('|')
    expect(container.querySelectorAll('thead th').length).toBe(2)
  })

  it('renderiza matematica com KaTeX (widget presente no DOM)', async () => {
    const container = await renderLive('Introducao\n\n$$E=mc^2$$')
    await waitFor(() => expect(container.querySelector('.cm-live-math .katex')).not.toBeNull())
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('$$')
  })

  it('nao revela elementos de linhas vizinhas quando o cursor esta em linha em branco', async () => {
    // Cursor na linha em branco (posicao 12): nem o negrito acima nem o abaixo
    // podem ir para Markdown cru — so elementos na MESMA linha do cursor.
    const container = await renderLive('**negrito**\n\n**outro**', 12)
    await waitFor(() => expect(container.querySelectorAll('.cm-live-strong').length).toBe(2))
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('**')
  })

  it('mascara tabela com frontmatter e matematica nas celulas (nota realista)', async () => {
    const value = '---\ndescription: Tabela\n---\n\n| Formula | Valor |\n|---|---|\n| $E=mc^2$ | 42 |'
    const container = await renderLive(value)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const content = container.querySelector('.cm-content')
    // Pipes ocultos; o frontmatter permanece cru.
    expect(content?.textContent).not.toContain('| Formula | Valor |')
    expect(content?.textContent).toContain('description: Tabela')
    expect(container.querySelectorAll('thead th').length).toBe(2)
    // A matematica dentro da celula e renderizada por KaTeX.
    expect(container.querySelector('.cm-live-table-wrap .katex')).not.toBeNull()
  })

  it('mascara tabela sem pipes externos e com alinhamento', async () => {
    const value = 'Introducao\n\na | b\n---|---\n1 | 2\n\n| x | y |\n| :--- | ---: |\n| 3 | 4 |'
    const container = await renderLive(value)
    await waitFor(() => expect(container.querySelectorAll('.cm-live-table-wrap table').length).toBe(2))
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('|')
    expect(container.querySelectorAll('thead th').length).toBe(4)
  })

  it('mascara a tabela exata do relatorio (cabecalho com espacos e subescritos)', async () => {
    const value = '**Resumo Comparativo**\n\n| Etapa | Local no Cloroplasto | Entra | Sai |\n| :--- | :--- | :--- | :--- |\n| Fase Clara | Tilacoides | H₂O, Luz | O₂, ATP, NADPH |\n| Fase Escura | Estroma | CO₂, ATP, NADPH | Glicose |'
    const container = await renderLive(value)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const content = container.querySelector('.cm-content')
    // Tabela 100% grafica: sem pipes e sem delimitadores visiveis.
    expect(content?.textContent).not.toContain('|')
    expect(content?.textContent).not.toContain('---')
    expect(container.querySelectorAll('thead th').length).toBe(4)
    expect(container.querySelectorAll('tbody td').length).toBe(8)
    // Subescritos Unicode preservados.
    expect(content?.textContent).toContain('H₂O, Luz')
  })

  it('nao renderiza a linha de delimitadores nem celulas fantasma', async () => {
    const container = await renderLive('Introducao\n\n| A |\n|---|\n| 1 |')
    await waitFor(() => expect(table(container)).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('|')
    expect(content?.textContent).not.toContain('---')
    expect(container.querySelectorAll('thead th').length).toBe(1)
    expect(container.querySelectorAll('tbody td').length).toBe(1)
  })

  it('editar uma celula atualiza o documento (sincronizacao de volta)', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    // Clica na celula "1" e digita "X".
    const cell = container.querySelector('tbody td')!
    fireEvent.mouseDown(cell)
    fireEvent.focusIn(cell)
    cell.textContent = 'X'
    fireEvent.input(cell, { bubbles: true })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    // A tabela permanece grafica (sem pipes) apos a edicao.
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('|')
  })

  it('preserva foco e conteudo da celula em edicao (updateDOM nao redesenha)', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const cell = container.querySelector('tbody td') as HTMLElement
    fireEvent.mouseDown(cell)
    fireEvent.focusIn(cell)
    cell.focus()
    // Digita "X": a transacao gera um novo spec/TableWidget, mas o updateDOM
    // deve reutilizar o MESMO no DOM e preservar a celula em edicao (texto + raw).
    cell.textContent = 'X'
    fireEvent.input(cell, { bubbles: true })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    await waitFor(() => expect(cell.dataset.raw).toBe('true'))
    expect(cell.textContent).toBe('X')
    // Mesma referencia de no: o widget NAO foi redesenhado (senao o
    // querySelector retornaria um no novo e a celula perderia a edicao).
    expect(container.querySelector('tbody td')).toBe(cell)
    // A celula vizinha sincroniza sem redesenhar a tabela inteira.
    expect(container.querySelectorAll('tbody td').length).toBe(2)
  })

  it('navega entre celulas com Tab e Enter', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const first = container.querySelector('tbody td')!
    fireEvent.mouseDown(first)
    fireEvent.focusIn(first)
    // Tab move para a segunda celula da mesma linha.
    fireEvent.keyDown(first, { key: 'Tab', bubbles: true })
    // Enter adiciona uma linha NOVA (2 linhas x 2 colunas = 4 celulas), sem
    // fundir com a linha anterior.
    const second = container.querySelectorAll('tbody td')[1]
    fireEvent.keyDown(second, { key: 'Enter', bubbles: true })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('tbody td').length).toBe(4)
    expect(container.querySelectorAll('thead th').length).toBe(2)
  })

  it('renderiza as alcas de redimensionamento nas bordas e no canto', async () => {
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |')
    await waitFor(() => expect(table(container)).not.toBeNull())
    expect(container.querySelector('.cm-live-table-grip[data-grip="row"]')).not.toBeNull()
    expect(container.querySelector('.cm-live-table-grip[data-grip="col"]')).not.toBeNull()
    expect(container.querySelector('.cm-live-table-grip[data-grip="corner"]')).not.toBeNull()
  })

  it('arrastar a borda inferior para fora adiciona uma linha', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const grip = container.querySelector('.cm-live-table-grip[data-grip="row"]') as HTMLElement
    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 100, clientY: 124 }) // +1 linha (24px)
    fireEvent.mouseUp(window)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('tbody tr').length).toBe(2)
    expect(container.querySelectorAll('thead th').length).toBe(2)
    // O markdown ganhou uma linha de tabela com 2 celulas vazias.
    const value = onChange.mock.calls.at(-1)?.[0] as string
    const lastTableLine = value.split('\n').filter((line) => line.includes('|')).at(-1)
    expect(lastTableLine).toMatch(/^\|\s+\|\s+\|$/)
  })

  it('arrastar a borda inferior para dentro remove linhas (minimo de 1)', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const grip = container.querySelector('.cm-live-table-grip[data-grip="row"]') as HTMLElement
    // Remove 2 linhas, mas clampa no minimo de 1 linha.
    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 100, clientY: 52 })
    fireEvent.mouseUp(window)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('tbody tr').length).toBe(1)
    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(value).toContain('| 1 | 2 |')
    expect(value).not.toContain('| 3 | 4 |')
  })

  it('arrastar a borda direita adiciona uma coluna (incluindo delimitador)', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const grip = container.querySelector('.cm-live-table-grip[data-grip="col"]') as HTMLElement
    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 180, clientY: 100 }) // +1 coluna (80px)
    fireEvent.mouseUp(window)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('thead th').length).toBe(3)
    expect(container.querySelectorAll('tbody td').length).toBe(3)
    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(value).toContain('| A | B |  |')
    expect(value).toContain('|---|---| --- |')
  })

  it('arrastar a borda direita para dentro remove colunas (minimo de 1)', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const grip = container.querySelector('.cm-live-table-grip[data-grip="col"]') as HTMLElement
    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 100 }) // -1 coluna
    fireEvent.mouseUp(window)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('thead th').length).toBe(2)
    expect(container.querySelectorAll('tbody td').length).toBe(2)
  })

  it('arrastar o canto adiciona linhas e colunas ao mesmo tempo', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const grip = container.querySelector('.cm-live-table-grip[data-grip="corner"]') as HTMLElement
    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 180, clientY: 124 }) // +1 coluna e +1 linha
    fireEvent.mouseUp(window)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('thead th').length).toBe(3)
    expect(container.querySelectorAll('tbody tr').length).toBe(2)
    expect(container.querySelectorAll('tbody td').length).toBe(6)
  })

  it('arrastar o canto para dentro remove linhas e colunas ao mesmo tempo', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const grip = container.querySelector('.cm-live-table-grip[data-grip="corner"]') as HTMLElement
    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 76 }) // -1 coluna e -1 linha
    fireEvent.mouseUp(window)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('thead th').length).toBe(2)
    expect(container.querySelectorAll('tbody tr').length).toBe(1)
    expect(container.querySelectorAll('tbody td').length).toBe(2)
  })

  it('arrastar a borda direita nao reduz abaixo de 1 coluna', async () => {
    const onChange = vi.fn()
    const container = await renderLive('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |', 1, onChange)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const grip = container.querySelector('.cm-live-table-grip[data-grip="col"]') as HTMLElement
    // -2 colunas de uma vez: clampa no minimo de 1.
    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: -60, clientY: 100 })
    fireEvent.mouseUp(window)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(container.querySelectorAll('thead th').length).toBe(1)
    expect(container.querySelectorAll('tbody td').length).toBe(1)
    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(value).toContain('| A |')
  })
})
