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

  it('renderiza negrito, italico, codigo e riscado nas celulas (como o modo Leitura)', async () => {
    const value = 'Introducao\n\n| Texto | Valor |\n|---|---|\n| **negrito** | *italico* |\n| `codigo` | ~~riscado~~ |'
    const container = await renderLive(value)
    await waitFor(() => expect(table(container)).not.toBeNull())
    // Os marcadores nao aparecem no texto visivel.
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('**')
    expect(content?.textContent).not.toContain('*italico*')
    expect(content?.textContent).not.toContain('`codigo`')
    expect(content?.textContent).not.toContain('~~')
    // As tags de formatacao sao renderizadas dentro das celulas.
    const cells = container.querySelectorAll('.cm-live-table-wrap td')
    expect(cells[0]?.querySelector('strong')?.textContent).toBe('negrito')
    expect(cells[1]?.querySelector('em')?.textContent).toBe('italico')
    expect(cells[2]?.querySelector('code')?.textContent).toBe('codigo')
    expect(cells[3]?.querySelector('del')?.textContent).toBe('riscado')
  })

  it('preserva negrito e matematica em celulas diferentes', async () => {
    const value = 'Introducao\n\n| Conceito | Formula |\n|---|---|\n| **Energia** | $E=mc^2$ |'
    const container = await renderLive(value)
    await waitFor(() => expect(table(container)).not.toBeNull())
    expect(container.querySelector('.cm-live-table-wrap .katex')).not.toBeNull()
    const cells = container.querySelectorAll('.cm-live-table-wrap td')
    expect(cells[0]?.querySelector('strong')?.textContent).toBe('Energia')
    expect(cells[1]?.querySelector('.katex')).not.toBeNull()
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('**')
  })

  it('nao cria italico espurio em textos com asteriscos/sublinhados soltos', async () => {
    const value = 'Introducao\n\n| Operacao | Nome |\n|---|---|\n| 2 * 3 | foo_bar_baz |'
    const container = await renderLive(value)
    await waitFor(() => expect(table(container)).not.toBeNull())
    const cells = container.querySelectorAll('.cm-live-table-wrap td')
    // Sem <em> espurio: * solto com espaco e sublinhado intrapalavra nao
    // viram italico.
    expect(cells[0]?.querySelector('em')).toBeNull()
    expect(cells[1]?.querySelector('em')).toBeNull()
    expect(cells[0]?.textContent).toBe('2 * 3')
    expect(cells[1]?.textContent).toBe('foo_bar_baz')
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

  it('renderiza o divisor --- sem linha em branco antes (setext) como linha grafica', async () => {
    // `---` logo apos um paragrafo e sublinhado de heading setext no parser,
    // mas deve virar a linha grafica do divisor, nao Markdown cru.
    const container = await renderLive('Texto\n---\nMais texto')
    await waitFor(() => expect(container.querySelector('.cm-live-hr')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('---')
  })

  it('renderiza divisor e matematica juntos sem linha em branco (setext + $$)', async () => {
    const container = await renderLive('Texto\n---\n$$E=mc^2$$')
    await waitFor(() => expect(container.querySelector('.cm-live-hr')).not.toBeNull())
    await waitFor(() => expect(container.querySelector('.cm-live-math .katex')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('---')
    expect(content?.textContent).not.toContain('$$')
  })

  it('renderiza heading setext === como titulo de nivel 1 com o marcador oculto', async () => {
    const container = await renderLive('Texto\n===')
    await waitFor(() => expect(container.querySelector('.cm-live-heading.cm-live-h1')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('===')
    expect(content?.textContent).toContain('Texto')
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

  it('mascara blocos de codigo com conteudo em varias linhas sem cruzar quebras de linha', async () => {
    // Regressao: os replaces `hidden` das cercas cruzavam a quebra de linha
    // quando o conteudo comecava na linha seguinte (RangeError do CodeMirror).
    const container = await renderLive('# Titulo\n\n```js\nconst x = 1\nconst y = 2\n```\n\nFim')
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    // O editor continua vivo, com o conteudo preservado e sem a cercas visiveis
    // (o conteudo do bloco permanece cru dentro do pre real do CodeMirror).
    expect(content?.textContent).toContain('const x = 1')
    expect(content?.textContent).toContain('const y = 2')
    expect(content?.textContent).not.toContain('```js')
  })
})
