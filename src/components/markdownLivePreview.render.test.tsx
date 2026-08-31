import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownCodeEditor } from './MarkdownCodeEditor'
import { markdownLivePreview } from './markdownLivePreview'
import type { LinkTarget, ReviewGapData } from './markdownLivePreview'

// O ObsidianPdfEmbed usa pdfjs + IPC real; nos testes do widget de PDF ele e
// substituido por um marcador simples.
vi.mock('./ObsidianPdfEmbed', () => ({
  ObsidianPdfEmbed: () => <div className="pdf-embed-mock">PDF mock</div>,
}))

async function renderReadOnly(value: string, onOpenLink?: (target: LinkTarget) => void, resolveAssetUrl?: (relativePath: string) => string | undefined, getEmbedContent?: (relativePath: string) => Promise<string>, vaultPath?: string, onChange?: () => void, reviewGapData?: ReviewGapData | null) {
  const { container } = render(
    <MarkdownCodeEditor
      documentKey="readonly.md"
      livePreview
      readOnly
      onChange={onChange ?? vi.fn()}
      onHistoryChange={vi.fn()}
      onOpenLink={onOpenLink ?? vi.fn()}
      onSessionChange={vi.fn()}
      resolveAssetUrl={resolveAssetUrl}
      getEmbedContent={getEmbedContent}
      vaultPath={vaultPath}
      reviewGapData={reviewGapData}
      session={{ selectionStart: 0, selectionEnd: 0, scrollTop: 0 }}
      value={value}
    />,
  )
  return container
}

async function renderLive(value: string, selectionStart = 1, onChange?: () => void, onOpenLink?: (target: LinkTarget) => void, resolveAssetUrl?: (relativePath: string) => string | undefined, getEmbedContent?: (relativePath: string) => Promise<string>, vaultPath?: string, reviewGapData?: ReviewGapData | null) {
  const { container } = render(
    <MarkdownCodeEditor
      documentKey="live.md"
      livePreview
      onChange={onChange ?? vi.fn()}
      onHistoryChange={vi.fn()}
      onOpenLink={onOpenLink ?? vi.fn()}
      onSessionChange={vi.fn()}
      resolveAssetUrl={resolveAssetUrl}
      getEmbedContent={getEmbedContent}
      vaultPath={vaultPath}
      reviewGapData={reviewGapData}
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

  it('renderiza negrito, italico, código e riscado nas celulas (como o modo Leitura)', async () => {
    const value = 'Introducao\n\n| Texto | Valor |\n|---|---|\n| **negrito** | *italico* |\n| `código` | ~~riscado~~ |'
    const container = await renderLive(value)
    await waitFor(() => expect(table(container)).not.toBeNull())
    // Os marcadores nao aparecem no texto visivel.
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('**')
    expect(content?.textContent).not.toContain('*italico*')
    expect(content?.textContent).not.toContain('`código`')
    expect(content?.textContent).not.toContain('~~')
    // As tags de formatacao sao renderizadas dentro das celulas.
    const cells = container.querySelectorAll('.cm-live-table-wrap td')
    expect(cells[0]?.querySelector('strong')?.textContent).toBe('negrito')
    expect(cells[1]?.querySelector('em')?.textContent).toBe('italico')
    expect(cells[2]?.querySelector('code')?.textContent).toBe('código')
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

  it('não cria italico espurio em textos com asteriscos/sublinhados soltos', async () => {
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

  it('não revela o Markdown cru com o cursor dentro da tabela', async () => {
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

  it('links viram widgets clicaveis com a mascara ativa (cursor longe)', async () => {
    const onOpenLink = vi.fn()
    const container = await renderLive('Veja [[fotosintese]] e [site](https://exemplo.com/x).', 0, undefined, onOpenLink)
    await waitFor(() => expect(container.querySelectorAll('.cm-live-link-widget').length).toBe(2))
    const [wiki, link] = container.querySelectorAll<HTMLElement>('.cm-live-link-widget')
    // O widget mostra o texto interno (sem marcadores).
    expect(wiki.textContent).toBe('fotosintese')
    expect(link.textContent).toBe('site')
    fireEvent.click(wiki)
    expect(onOpenLink).toHaveBeenCalledWith({ kind: 'note', path: 'fotosintese', fragment: undefined })
    fireEvent.click(link)
    expect(onOpenLink).toHaveBeenCalledWith({ kind: 'url', href: 'https://exemplo.com/x' })
  })

  it('wikilink com alias e fragmento navegam para a nota certa', async () => {
    const onOpenLink = vi.fn()
    const container = await renderLive('Veja [[Programacao/notas|minha nota]] e [[fotosintese#Equação]]', 0, undefined, onOpenLink)
    await waitFor(() => expect(container.querySelectorAll('.cm-live-link-widget').length).toBe(2))
    const widgets = container.querySelectorAll<HTMLElement>('.cm-live-link-widget')
    fireEvent.click(widgets[0])
    expect(onOpenLink).toHaveBeenCalledWith({ kind: 'note', path: 'Programacao/notas', fragment: undefined })
    fireEvent.click(widgets[1])
    expect(onOpenLink).toHaveBeenCalledWith({ kind: 'note', path: 'fotosintese', fragment: 'Equação' })
  })

  it('link interno (prefixo mirrormind.local) vira nota', async () => {
    const onOpenLink = vi.fn()
    const container = await renderLive('Abra [Nota](https://mirrormind.local/note/pasta/nota)', 0, undefined, onOpenLink)
    await waitFor(() => expect(container.querySelector('.cm-live-link-widget')).not.toBeNull())
    fireEvent.click(container.querySelector('.cm-live-link-widget')!)
    expect(onOpenLink).toHaveBeenCalledWith({ kind: 'note', path: 'pasta/nota', fragment: undefined })
  })

  it('cursor perto do link revela o Markdown cru (sem widget clicável)', async () => {
    const onOpenLink = vi.fn()
    const container = await renderLive('Veja [[fotosintese]]', 7, undefined, onOpenLink)
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('[[')
    })
    expect(container.querySelectorAll('.cm-live-link-widget').length).toBe(0)
  })

  it('modo leitura (readOnly): sem caret/editacao e sem revelar Markdown cru', async () => {
    const container = await renderReadOnly('# Título\n\n**palavra** e [[fotosintese]]')
    await waitFor(() => expect(container.querySelector('.cm-live-link-widget')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    // Nao editavel (contenteditable=false) e nada de Markdown cru visivel.
    expect(content?.getAttribute('contenteditable')).not.toBe('true')
    expect(content?.textContent).not.toContain('#')
    expect(content?.textContent).not.toContain('**')
    expect(content?.textContent).not.toContain('[[')
    // Nao ha caret: o editor nao ganha foco ao clicar (nada revela).
    fireEvent.focus(content!)
    fireEvent.click(content!)
    expect(content?.textContent).not.toContain('**')
  })

  it('modo leitura (readOnly): links continuam clicaveis', async () => {
    const onOpenLink = vi.fn()
    const container = await renderReadOnly('Veja [[fotosintese]]', onOpenLink)
    await waitFor(() => expect(container.querySelector('.cm-live-link-widget')).not.toBeNull())
    fireEvent.click(container.querySelector('.cm-live-link-widget')!)
    expect(onOpenLink).toHaveBeenCalledWith({ kind: 'note', path: 'fotosintese', fragment: undefined })
  })

  it('imagem markdown ![alt](url) vira um <img> com a URL remota', async () => {
    const container = await renderLive('Veja ![cloroplasto](https://exemplo.com/img.png).')
    await waitFor(() => expect(container.querySelector('.cm-live-image')).not.toBeNull())
    const img = container.querySelector<HTMLImageElement>('.cm-live-image')!
    expect(img.src).toBe('https://exemplo.com/img.png')
    expect(img.alt).toBe('cloroplasto')
    // O Markdown cru nao aparece no texto visivel.
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('![')
  })

  it('embed Obsidian ![[arquivo.png]] vira <img> resolvido pelo vault', async () => {
    const resolveAssetUrl = vi.fn((relativePath: string) => `asset://${relativePath}`)
    const container = await renderLive('Veja ![[imagem.png]] aqui.', 0, undefined, undefined, resolveAssetUrl)
    await waitFor(() => expect(container.querySelector('.cm-live-image')).not.toBeNull())
    const img = container.querySelector<HTMLImageElement>('.cm-live-image')!
    expect(resolveAssetUrl).toHaveBeenCalledWith('imagem.png')
    expect(img.src).toBe('asset://imagem.png')
  })

  it('embed Obsidian com caminho e legenda resolve o caminho certo', async () => {
    const resolveAssetUrl = vi.fn((relativePath: string) => `asset://${relativePath}`)
    const container = await renderLive('Figura: ![[pasta/imagem.png|legenda]]', 0, undefined, undefined, resolveAssetUrl)
    await waitFor(() => expect(container.querySelector('.cm-live-image')).not.toBeNull())
    const img = container.querySelector<HTMLImageElement>('.cm-live-image')!
    expect(resolveAssetUrl).toHaveBeenCalledWith('pasta/imagem.png')
    expect(img.src).toBe('asset://pasta/imagem.png')
    expect(img.alt).toBe('legenda')
  })

  it('cursor perto da imagem revela o Markdown cru (sem widget)', async () => {
    const container = await renderLive('Veja ![cloroplasto](https://exemplo.com/img.png).', 6)
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('![')
    })
    expect(container.querySelectorAll('.cm-live-image').length).toBe(0)
  })

  it('modo leitura (readOnly): tabela sem grips e sem edicao de celula', async () => {
    const container = await renderReadOnly('Introducao\n\n| A | B |\n|---|---|\n| 1 | 2 |')
    await waitFor(() => expect(container.querySelector('.cm-live-table-wrap table')).not.toBeNull())
    // Sem alcas de redimensionamento e a celula nao entra em modo de edicao.
    expect(container.querySelectorAll('.cm-live-table-grip').length).toBe(0)
    const cell = container.querySelector('tbody td') as HTMLElement
    fireEvent.mouseDown(cell)
    fireEvent.focusIn(cell)
    expect(cell.dataset.raw).not.toBe('true')
    expect(cell.getAttribute('contenteditable')).not.toBe('true')
  })

  it('ao abrir a nota (sem foco), a primeira linha não fica em Markdown cru', async () => {
    // Regressao: o caret padrao (posicao 0) nao pode revelar a primeira linha
    // enquanto o usuario nao interage com o editor — nem negrito nem titulo.
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="abertura.md"
        livePreview
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        session={{ selectionStart: 0, selectionEnd: 0, scrollTop: 0 }}
        value={'# Título\n\n**palavra**\n---\n\ndepois'}
      />,
    )
    await waitFor(() => expect(container.querySelector('.cm-live-hr')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    // Nada de Markdown cru visivel: sem #, sem **, sem ---.
    expect(content?.textContent).not.toContain('#')
    expect(content?.textContent).not.toContain('**')
    expect(content?.textContent).not.toContain('---')
    // A formatacao esta aplicada: titulo mascarado e negrito somente na palavra.
    const strong = container.querySelectorAll('.cm-live-strong')
    expect(strong.length).toBe(1)
    expect(strong[0]?.textContent).toBe('palavra')
  })

  it('o divisor --- abaixo de uma linha com negrito não grifa a linha inteira (sem foco)', async () => {
    // Bug relatado: com `---` abaixo de uma linha que termina em **palavra**,
    // a linha inteira ficava em Markdown cru (grifada) ao abrir. Com o caret
    // padrao e sem foco, so a palavra recebe o negrito e o --- vira divisor.
    const { container } = render(
      <MarkdownCodeEditor
        documentKey="abertura2.md"
        livePreview
        onChange={vi.fn()}
        onHistoryChange={vi.fn()}
        onSessionChange={vi.fn()}
        session={{ selectionStart: 0, selectionEnd: 0, scrollTop: 0 }}
        value={'**palavra**\n---\n\ndepois'}
      />,
    )
    await waitFor(() => expect(container.querySelector('.cm-live-hr')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('**')
    const strong = container.querySelectorAll('.cm-live-strong')
    expect(strong.length).toBe(1)
    expect(strong[0]?.textContent).toBe('palavra')
  })

  it('revela o Markdown cru apenas quando o editor esta focado (caret no token)', async () => {
    // Com foco e caret sobre a palavra, o Markdown cru aparece; sem foco (blur),
    // a formatacao volta — mesmo com o caret na mesma posicao.
    const container = await renderLive('**palavra**\n\ndepois', 4)
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('**')
    })
    // Blur: a nota volta a ficar 100% formatada.
    fireEvent.blur(container.querySelector('.cm-content')!)
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).not.toContain('**')
    })
    const strong = container.querySelectorAll('.cm-live-strong')
    expect(strong.length).toBe(1)
    expect(strong[0]?.textContent).toBe('palavra')
  })

  it('renderiza divisor e matematica juntos sem linha em branco (setext + $$)', async () => {
    const container = await renderLive('Texto\n---\n$$E=mc^2$$')
    await waitFor(() => expect(container.querySelector('.cm-live-hr')).not.toBeNull())
    await waitFor(() => expect(container.querySelector('.cm-live-math .katex')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('---')
    expect(content?.textContent).not.toContain('$$')
  })

  it('renderiza heading setext === como título de nivel 1 com o marcador oculto', async () => {
    const container = await renderLive('Texto\n===')
    await waitFor(() => expect(container.querySelector('.cm-live-heading.cm-live-h1')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).not.toContain('===')
    expect(content?.textContent).toContain('Texto')
  })

  it('não revela elementos de linhas vizinhas quando o cursor esta em linha em branco', async () => {
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
    // Pipes ocultos; o frontmatter NAO fica no topo (bloco oculto).
    expect(content?.textContent).not.toContain('| Formula | Valor |')
    expect(content?.textContent).not.toContain('description: Tabela')
    expect(container.querySelector('.cm-live-frontmatter-hidden')).not.toBeNull()
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

  it('mascara a tabela exata do relatorio (cabeçalho com espacos e subescritos)', async () => {
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

  it('não renderiza a linha de delimitadores nem celulas fantasma', async () => {
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

  it('preserva foco e conteúdo da celula em edicao (updateDOM não redesenha)', async () => {
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

  it('arrastar a borda direita não reduz abaixo de 1 coluna', async () => {
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

  it('mascara blocos de código com conteúdo em varias linhas sem cruzar quebras de linha', async () => {
    // Regressao: os replaces `hidden` das cercas cruzavam a quebra de linha
    // quando o conteudo comecava na linha seguinte (RangeError do CodeMirror).
    const container = await renderLive('# Título\n\n```js\nconst x = 1\nconst y = 2\n```\n\nFim')
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const content = container.querySelector('.cm-content')
    // O editor continua vivo, com o conteudo preservado e sem a cercas visiveis
    // (o conteudo do bloco permanece cru dentro do pre real do CodeMirror).
    expect(content?.textContent).toContain('const x = 1')
    expect(content?.textContent).toContain('const y = 2')
    expect(content?.textContent).not.toContain('```js')
  })
})

describe('markdownLivePreview embeds (jsdom)', () => {
  it('renderiza o embed de nota ![[nota]] com o corpo formatado (editor aninhado)', async () => {
    const getEmbedContent = vi.fn(async () => 'Corpo da **nota** incorporada.\n\n- item 1\n- item 2')
    const container = await renderLive('Intro\n\n![[fotosintese]]\n\nFim', 0, undefined, undefined, undefined, getEmbedContent)
    await waitFor(() => expect(container.querySelector('.cm-live-embed-note .cm-editor')).not.toBeNull())
    // A sintaxe crua nunca aparece; o corpo formatado sim (negrito mascarado).
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('![[fotosintese]]')
    const embedContent = container.querySelector('.cm-live-embed-note .cm-content')?.textContent ?? ''
    expect(embedContent).toContain('Corpo da nota incorporada.')
    expect(embedContent).toContain('item 2')
    // Negrito mascarado como marca (cm-live-strong), sem o `**` cru.
    expect(container.querySelector('.cm-live-embed-note .cm-live-strong')?.textContent).toBe('nota')
    // O caminho e normalizado com .md (como o Leitura).
    expect(getEmbedContent).toHaveBeenCalledWith('fotosintese.md')
  })

  it('aplica o fragmento #secao ao corpo incorporado', async () => {
    const getEmbedContent = vi.fn(async () => 'Tudo antes.\n\n## Seção Alvo\n\nConteúdo do alvo.\n\n## Outra\n\nDepois.')
    const container = await renderLive('![[fotosintese#Seção Alvo]]', 0, undefined, undefined, undefined, getEmbedContent)
    await waitFor(() => expect(container.querySelector('.cm-live-embed-note .cm-editor')).not.toBeNull())
    const embedContent = container.querySelector('.cm-live-embed-note .cm-content')?.textContent ?? ''
    expect(embedContent).toContain('Conteúdo do alvo.')
    expect(embedContent).not.toContain('Tudo antes.')
    expect(embedContent).not.toContain('Depois.')
  })

  it('nota incorporada ausente mostra a mensagem de erro', async () => {
    const getEmbedContent = vi.fn(async () => { throw new Error('não encontrada') })
    const container = await renderLive('![[não-existe]]', 0, undefined, undefined, undefined, getEmbedContent)
    await waitFor(() => expect(container.querySelector('.cm-live-embed-status.is-missing')).not.toBeNull())
    expect(container.querySelector('.cm-live-embed-status.is-missing')?.textContent).toContain('não foi encontrada')
  })

  it('embed de imagem ![[arquivo.png]] continua sendo imagem (não embed de nota)', async () => {
    const getEmbedContent = vi.fn()
    const container = await renderLive('Veja ![[figura.png]]', 0, undefined, undefined, undefined, getEmbedContent)
    await waitFor(() => expect(container.querySelector('.cm-live-image')).not.toBeNull())
    expect(container.querySelector('.cm-live-embed')).toBeNull()
    expect(getEmbedContent).not.toHaveBeenCalled()
  })

  it('profundidade no limite mostra a mensagem de limite sem buscar conteúdo', async () => {
    const getEmbedContent = vi.fn(async () => 'Corpo')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const view = new EditorView({
      state: EditorState.create({
        doc: '![[fotosintese]]',
        extensions: [markdownLivePreview({ getEmbedContent, maxEmbedDepth: 0 })],
      }),
      parent: host,
    })
    await waitFor(() => expect(host.querySelector('.cm-live-embed-limited')).not.toBeNull())
    expect(getEmbedContent).not.toHaveBeenCalled()
    expect(host.querySelector('.cm-live-embed-limited')?.textContent).toContain('Limite de notas incorporadas')
    view.destroy()
    host.remove()
  })

  it('renderiza o embed de PDF via ObsidianPdfEmbed', async () => {
    const container = await renderLive('![[material.pdf]]', 0, undefined, undefined, undefined, undefined, '/vault/raiz')
    await waitFor(() => expect(container.querySelector('.cm-live-embed-pdf')).not.toBeNull())
    expect(container.querySelector('.pdf-embed-mock')).not.toBeNull()
  })

  it('embed renderiza também em modo read-only (spike do Leitura)', async () => {
    const getEmbedContent = vi.fn(async () => 'Corpo read-only **forte**.')
    const container = await renderReadOnly('![[fotosintese]]', undefined, undefined, getEmbedContent)
    await waitFor(() => expect(container.querySelector('.cm-live-embed-note .cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-embed-note .cm-content')?.textContent).toContain('Corpo read-only forte.')
  })
})

describe('markdownLivePreview callouts (jsdom)', () => {
  it('renderiza o callout > [!tipo] como bloco com conteúdo formatado', async () => {
    const container = await renderLive('> [!note]\n> Conteúdo da **nota** com *ênfase*.\n>\n> Mais uma linha.')
    await waitFor(() => expect(container.querySelector('.cm-live-callout .obsidian-callout')).not.toBeNull())
    const callout = container.querySelector('.cm-live-callout .obsidian-callout')
    expect(callout?.getAttribute('data-callout')).toBe('note')
    // Nenhum marcador `>` visivel no editor externo.
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('> [!note]')
    // O conteudo vira um editor aninhado com o mesmo motor (negrito mascarado).
    await waitFor(() => expect(container.querySelector('.cm-live-callout .cm-editor')).not.toBeNull())
    const body = container.querySelector('.cm-live-callout .cm-content')?.textContent ?? ''
    expect(body).toContain('Conteúdo da nota com ênfase.')
    expect(container.querySelector('.cm-live-callout .cm-live-strong')?.textContent).toBe('nota')
  })

  it('fold: [!tipo]- colapsa por padrao e [!tipo]+ expande', async () => {
    const container = await renderLive('> [!tip]-\n> conteúdo\n\n---\n\n> [!warning]+\n> outro')
    await waitFor(() => expect(container.querySelectorAll('.cm-live-callout .obsidian-callout').length).toBe(2))
    const callouts = container.querySelectorAll('.cm-live-callout .obsidian-callout')
    expect(callouts[0].tagName.toLowerCase()).toBe('details')
    expect((callouts[0] as HTMLDetailsElement).open).toBe(false)
    expect(callouts[1].tagName.toLowerCase()).toBe('details')
    expect((callouts[1] as HTMLDetailsElement).open).toBe(true)
  })

  it('título customizado aparece no cabeçalho do callout', async () => {
    const container = await renderLive('> [!warning] Cuidado ao abrir')
    await waitFor(() => expect(container.querySelector('.cm-live-callout .obsidian-callout[data-callout="warning"]')).not.toBeNull())
    expect(container.querySelector('.cm-live-callout .obsidian-callout-title')?.textContent).toContain('Cuidado ao abrir')
  })

  it('citacao normal continua sendo citacao (sem virar callout)', async () => {
    // Caret longe da citacao (texto antes) para a mascara de citacao ativar.
    const container = await renderLive('Intro\n\n> Texto citado normal.\n> Outra linha.')
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.obsidian-callout')).toBeNull()
    expect(container.querySelector('.cm-live-callout')).toBeNull()
    // A citacao permanece com a mascara de citacao do Misto.
    expect(container.querySelector('.cm-live-quote')).not.toBeNull()
  })

  it('callout renderiza também em modo read-only (spike do Leitura)', async () => {
    const container = await renderReadOnly('> [!info]\n> Conteúdo read-only.')
    await waitFor(() => expect(container.querySelector('.cm-live-callout .obsidian-callout[data-callout="info"]')).not.toBeNull())
    expect(container.querySelector('.cm-live-callout .cm-content')?.textContent).toContain('Conteúdo read-only.')
  })

  it('tabela dentro de callout renderiza no editor aninhado', async () => {
    const container = await renderLive('> [!example]\n> | A | B |\n> |---|---|\n> | 1 | 2 |')
    await waitFor(() => expect(container.querySelector('.cm-live-callout .cm-live-table-wrap table')).not.toBeNull())
    expect(container.querySelector('.cm-live-callout tbody td')?.textContent).toBe('1')
  })

  it('embed de nota dentro de callout renderiza no editor aninhado', async () => {
    const getEmbedContent = vi.fn(async () => 'Corpo do embed **interno**.')
    const container = await renderLive('> [!note]\n> veja ![[fotosintese]]', 0, undefined, undefined, undefined, getEmbedContent)
    await waitFor(() => expect(container.querySelector('.cm-live-callout .cm-live-embed-note .cm-editor')).not.toBeNull())
    expect(getEmbedContent).toHaveBeenCalledWith('fotosintese.md')
  })
})

describe('markdownLivePreview checkbox alternavel (jsdom)', () => {
  it('clique no checkbox alterna [ ] <-> [x] no documento', async () => {
    const onChange = vi.fn()
    // Caret longe do marcador (fim da linha) para o widget de checkbox aparecer.
    const container = await renderLive('- [ ] pendente', '- [ ] pendente'.length, onChange)
    await waitFor(() => expect(container.querySelector('.cm-live-checkbox')).not.toBeNull())
    fireEvent.mouseDown(container.querySelector('.cm-live-checkbox') as HTMLElement)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(value).toContain('- [x] pendente')
  })

  it('alterna de marcado para desmarcado e preserva o texto da linha', async () => {
    const onChange = vi.fn()
    const source = '- [x] feita com **detalhe**'
    const container = await renderLive(source, source.length, onChange)
    await waitFor(() => expect(container.querySelector('.cm-live-checkbox.is-checked')).not.toBeNull())
    fireEvent.mouseDown(container.querySelector('.cm-live-checkbox') as HTMLElement)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(value).toBe('- [ ] feita com **detalhe**')
  })

  it('espaco no checkbox com foco também alterna (teclado)', async () => {
    const onChange = vi.fn()
    const source = '- [ ] via teclado'
    const container = await renderLive(source, source.length, onChange)
    await waitFor(() => expect(container.querySelector('.cm-live-checkbox')).not.toBeNull())
    const checkbox = container.querySelector('.cm-live-checkbox') as HTMLElement
    checkbox.focus()
    fireEvent.keyDown(checkbox, { key: ' ' })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0] as string).toContain('- [x] via teclado')
  })

  it('em modo read-only o clique também alterna (paridade com o Leitura)', async () => {
    const onChange = vi.fn()
    const container = await renderReadOnly('- [x] no leitura', undefined, undefined, undefined, undefined, onChange)
    await waitFor(() => expect(container.querySelector('.cm-live-checkbox.is-checked')).not.toBeNull())
    fireEvent.mouseDown(container.querySelector('.cm-live-checkbox') as HTMLElement)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0] as string).toContain('- [ ] no leitura')
  })
})

describe('markdownLivePreview frontmatter oculto (jsdom)', () => {
  const NOTE = '---\ntitle: Fotossíntese\ntags: [biologia, prova]\n---\n\n# Conteúdo'

  it('por padrao o frontmatter e ocultado (YAML nunca aparece no topo)', async () => {
    const container = await renderLive(NOTE, NOTE.length)
    await waitFor(() => expect(container.querySelector('.cm-live-frontmatter-hidden')).not.toBeNull())
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).not.toContain('title: Fotossíntese')
    expect(content).not.toContain('tags: [biologia, prova]')
    expect(content).toContain('Conteúdo')
  })

  it('nota sem frontmatter não oculta nada (conteúdo intacto)', async () => {
    const container = await renderLive('# Título\n\nConteúdo', 0)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-frontmatter-hidden')).toBeNull()
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).toContain('# Título')
  })

  it('em modo read-only o frontmatter também fica oculto', async () => {
    const container = await renderReadOnly(NOTE)
    await waitFor(() => expect(container.querySelector('.cm-live-frontmatter-hidden')).not.toBeNull())
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).not.toContain('title: Fotossíntese')
    expect(content).not.toContain('tags: [biologia, prova]')
  })
})

describe('markdownLivePreview HTML sanitizado (jsdom)', () => {
  it('renderiza HTML inline sanitizado (mark, kbd) sem o código cru', async () => {
    const container = await renderLive('Texto com <mark>destaque</mark> e <kbd>Ctrl+S</kbd>.', 5)
    await waitFor(() => expect(container.querySelector('.cm-live-html mark')).not.toBeNull())
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).toContain('Texto com destaque e Ctrl+S.')
    expect(content).not.toContain('<mark>')
    expect(content).not.toContain('</mark>')
    expect(container.querySelector('.cm-live-html mark')?.textContent).toBe('destaque')
  })

  it('remove script por inteiro e desembrulha tags desconhecidas', async () => {
    const container = await renderLive('Olá <script>alert(1)</script> <foo>texto</foo> fim', 2)
    await waitFor(() => expect(container.querySelector('.cm-live-html')).not.toBeNull())
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).toContain('Olá')
    expect(content).toContain('texto fim')
    expect(content).not.toContain('alert(1)')
    expect(content).not.toContain('<script>')
    expect(content).not.toContain('<foo>')
  })

  it('remove atributos perigosos (javascript:, onclick)', async () => {
    // Caret longe do elemento (na palavra inicial) para o widget aparecer.
    const container = await renderLive('Veja <a href="javascript:alert(1)" onclick="x()">link</a> aqui', 2)
    await waitFor(() => expect(container.querySelector('.cm-live-html a')).not.toBeNull())
    const anchor = container.querySelector('.cm-live-html a') as HTMLAnchorElement
    expect(anchor.textContent).toBe('link')
    expect(anchor.getAttribute('href')).toBeNull()
    expect(anchor.getAttribute('onclick')).toBeNull()
  })

  it('bloco HTML multilinha permanece cru (limite do plugin de view)', async () => {
    const container = await renderLive('<div>\nlinha1\nlinha2\n</div>')
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-html')).toBeNull()
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).toContain('<div>')
    expect(content).toContain('linha2')
  })

  it('cursor perto do HTML inline revela o código cru', async () => {
    const container = await renderLive('Texto <mark>x</mark> fim', 9)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-html')).toBeNull()
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).toContain('<mark>x</mark>')
  })

  it('renderiza sanitizado também em modo read-only (spike do Leitura)', async () => {
    const container = await renderReadOnly('Texto <mark>destaque</mark>.')
    await waitFor(() => expect(container.querySelector('.cm-live-html mark')).not.toBeNull())
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('<mark>')
  })
})

describe('markdownLivePreview blocos de plugin (jsdom)', () => {
  it('renderiza o bloco dataview como ObsidianPluginBlock com a fonte crua', async () => {
    const container = await renderLive('Intro\n\n```dataview\nTABLE título FROM #estudo\n```\n\nFim')
    await waitFor(() => expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block')).not.toBeNull())
    // Cabecalho + linguagem + fonte crua preservada.
    expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block-title')?.textContent).toBe('Bloco Dataview')
    expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block-language')?.textContent).toBe('dataview')
    expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block-source')?.textContent).toContain('TABLE título FROM #estudo')
    // As cercas nao aparecem no editor externo.
    const content = container.querySelector('.cm-content')?.textContent ?? ''
    expect(content).not.toContain('```dataview')
  })

  it('bloco tasks lista as tarefas com o estado dos checkboxes', async () => {
    const container = await renderLive('Intro\n\n```tasks\n- [ ] Tarefa pendente\n- [x] Tarefa feita\n```')
    await waitFor(() => expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block.is-tasks')).not.toBeNull())
    const items = container.querySelectorAll('.cm-live-plugin-block .obsidian-plugin-block-tasks li')
    expect(items.length).toBe(2)
    expect(items[0].textContent).toContain('Tarefa pendente')
    expect(items[0].querySelector('.obsidian-plugin-block-check')?.textContent).toBe('○')
    expect(items[1].textContent).toContain('Tarefa feita')
    expect(items[1].querySelector('.obsidian-plugin-block-check')?.textContent).toBe('✓')
  })

  it('dataviewjs mostra o aviso de seguranca e a fonte crua (nunca executa)', async () => {
    const container = await renderLive('Intro\n\n```dataviewjs\nconsole.log(1)\n```')
    await waitFor(() => expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block.is-dataviewjs')).not.toBeNull())
    expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block-title')?.textContent).toBe('Bloco Dataview JS')
    expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block-warning')?.textContent).toContain('não é executado')
    expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block-source')?.textContent).toContain('console.log(1)')
  })

  it('fence de linguagem normal continua sendo bloco de código (não vira plugin)', async () => {
    const container = await renderLive('Intro\n\n```python\nprint("oi")\n```\n\nFim')
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.obsidian-plugin-block')).toBeNull()
    expect(container.querySelector('.cm-live-plugin-block')).toBeNull()
    // O conteudo da fence continua visivel com a mascara de codigo.
    expect(container.querySelector('.cm-content')?.textContent).toContain('print("oi")')
  })

  it('a sintaxe NUNCA e revelada com o cursor perto (bloco real, como a tabela)', async () => {
    const source = 'Intro\n\n```tasks\n- [ ] pendente\n```'
    // Caret dentro das linhas cobertas pelo bloco.
    const container = await renderLive(source, source.length)
    await waitFor(() => expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block')).not.toBeNull())
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('```tasks')
  })

  it('bloco de plugin dentro de callout renderiza no editor aninhado', async () => {
    const container = await renderLive('> [!note]\n> ```dataview\n> LIST FROM #estudo\n> ```')
    await waitFor(() => expect(container.querySelector('.cm-live-callout .cm-live-plugin-block .obsidian-plugin-block')).not.toBeNull())
    expect(container.querySelector('.cm-live-callout .cm-live-plugin-block .obsidian-plugin-block-source')?.textContent).toContain('LIST FROM #estudo')
  })

  it('renderiza também em modo read-only (spike do Leitura)', async () => {
    const container = await renderReadOnly('Intro\n\n```dataview\nTABLE título\n```')
    await waitFor(() => expect(container.querySelector('.cm-live-plugin-block .obsidian-plugin-block')).not.toBeNull())
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('```dataview')
  })
})

describe('markdownLivePreview lacunas da revisão (jsdom)', () => {
  // Nota completa (com frontmatter) e corpo (noteBody, como o spike usa).
  const frontmatter = '---\ntitle: X\n---\n'
  const body = '# Fotossíntese\n\nA clorofila absorve luz.\n\nOutro parágrafo.'
  const fullNote = frontmatter + body
  const bodyOffset = frontmatter.length

  function gapData(overrides?: Partial<ReviewGapData>): ReviewGapData {
    return {
      gaps: [{
        classification: 'forgotten',
        sourceStartUtf16: fullNote.indexOf('clorofila'),
        sourceEndUtf16: fullNote.indexOf('clorofila') + 'clorofila'.length,
        sourceQuote: 'clorofila',
      }],
      units: [{
        sourceStartUtf16: fullNote.indexOf('A clorofila absorve luz.'),
        sourceEndUtf16: fullNote.indexOf('A clorofila absorve luz.') + 'A clorofila absorve luz.'.length,
        evaluated: true,
        inconclusive: false,
        score: 72,
        outcome: 'good',
      }],
      enabled: true,
      bodyOffset,
      ...overrides,
    }
  }

  it('marca a lacuna forgotten no texto exato (spike: doc sem frontmatter + bodyOffset)', async () => {
    const container = await renderReadOnly(body, undefined, undefined, undefined, undefined, undefined, gapData())
    await waitFor(() => expect(container.querySelector('.cm-live-gap.is-forgotten')).not.toBeNull())
    const mark = container.querySelector('.cm-live-gap.is-forgotten')
    expect(mark?.textContent).toBe('clorofila')
    // Badge de pontuacao da unidade no fim do paragrafo.
    expect(container.querySelector('.review-unit-score.is-good')?.textContent).toBe('72')
  })

  it('lacuna confused usa a classe is-confused', async () => {
    const data = gapData({ gaps: [{
      classification: 'confused',
      sourceStartUtf16: fullNote.indexOf('clorofila'),
      sourceEndUtf16: fullNote.indexOf('clorofila') + 'clorofila'.length,
      sourceQuote: 'clorofila',
    }] })
    const container = await renderReadOnly(body, undefined, undefined, undefined, undefined, undefined, data)
    await waitFor(() => expect(container.querySelector('.cm-live-gap.is-confused')).not.toBeNull())
    expect(container.querySelector('.cm-live-gap.is-confused')?.textContent).toBe('clorofila')
  })

  it('enabled=false não aplica marcas nem badges', async () => {
    const container = await renderReadOnly(body, undefined, undefined, undefined, undefined, undefined, gapData({ enabled: false }))
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-gap')).toBeNull()
    expect(container.querySelector('.review-unit-score')).toBeNull()
  })

  it('doc com frontmatter (modo Misto): offsets diretos, sem deslocamento', async () => {
    const container = await renderLive(fullNote + '\n\nFim', 0, undefined, undefined, undefined, undefined, undefined, gapData())
    await waitFor(() => expect(container.querySelector('.cm-live-gap.is-forgotten')).not.toBeNull())
    expect(container.querySelector('.cm-live-gap.is-forgotten')?.textContent).toBe('clorofila')
  })

  it('badge não avaliado e inconclusivo aparecem com os rotulos do classico', async () => {
    const data = gapData({
      gaps: [],
      units: [
        {
          sourceStartUtf16: fullNote.indexOf('A clorofila absorve luz.'),
          sourceEndUtf16: fullNote.indexOf('A clorofila absorve luz.') + 'A clorofila absorve luz.'.length,
          evaluated: false,
          inconclusive: false,
          score: 0,
          outcome: 'good',
        },
        {
          sourceStartUtf16: fullNote.indexOf('Outro parágrafo.'),
          sourceEndUtf16: fullNote.indexOf('Outro parágrafo.') + 'Outro parágrafo.'.length,
          evaluated: false,
          inconclusive: true,
          score: 0,
          outcome: 'good',
        },
      ],
    })
    const container = await renderReadOnly(body, undefined, undefined, undefined, undefined, undefined, data)
    await waitFor(() => expect(container.querySelector('.review-unit-score.is-not-evaluated')).not.toBeNull())
    expect(container.querySelector('.review-unit-score.is-not-evaluated')?.textContent).toBe('não avaliado')
    expect(container.querySelector('.review-unit-score.is-inconclusive')?.textContent).toBe('inconclusivo')
  })

  it('lacuna dentro de fence de código e pulada', async () => {
    const fenced = '# Título\n\n```\nclorofila\n```\n\nFim'
    const full = frontmatter + fenced
    const data = gapData({
      gaps: [{
        classification: 'forgotten',
        sourceStartUtf16: full.indexOf('clorofila'),
        sourceEndUtf16: full.indexOf('clorofila') + 'clorofila'.length,
        sourceQuote: 'clorofila',
      }],
      units: [],
    })
    const container = await renderReadOnly(fenced, undefined, undefined, undefined, undefined, undefined, data)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-gap')).toBeNull()
  })

  it('lacuna multilinha e pulada (paridade com o classico)', async () => {
    const multi = '# Título\n\nA clorofila\nabsorve luz.'
    const full = frontmatter + multi
    const data = gapData({
      gaps: [{
        classification: 'forgotten',
        sourceStartUtf16: full.indexOf('clorofila'),
        sourceEndUtf16: full.indexOf('luz') + 'luz'.length,
        sourceQuote: 'clorofila\nabsorve',
      }],
      units: [],
    })
    const container = await renderReadOnly(multi, undefined, undefined, undefined, undefined, undefined, data)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-gap')).toBeNull()
  })

  it('lacuna dentro de tabela (bloco substituido) e pulada', async () => {
    const tabled = '# Título\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nFim'
    const full = frontmatter + tabled
    const data = gapData({
      gaps: [{
        classification: 'forgotten',
        sourceStartUtf16: full.indexOf('| 1 |'),
        sourceEndUtf16: full.indexOf('| 1 |') + 5,
        sourceQuote: '| 1 |',
      }],
      units: [],
    })
    const container = await renderReadOnly(tabled, undefined, undefined, undefined, undefined, undefined, data)
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(container.querySelector('.cm-live-gap')).toBeNull()
  })
})
