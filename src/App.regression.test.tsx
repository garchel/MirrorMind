import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, listenMock, onDragDropEventMock, getCurrentWindowMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  onDragDropEventMock: vi.fn(),
  getCurrentWindowMock: vi.fn(() => ({ onDragDropEvent: onDragDropEventMock })),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: getCurrentWindowMock,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

vi.mock('./components/ObsidianPdfEmbed', () => ({
  ObsidianPdfEmbed: ({ relativePath, title, vaultPath }: { relativePath: string; title: string; vaultPath: string }) => (
    <section aria-label={`PDF incorporado: ${title}`} data-relative-path={relativePath} data-vault-path={vaultPath} />
  ),
}))

import App from './App'
import { ReviewAiSettingsProvider } from './features/review/ReviewAiSettingsContext'
import obsidianStudyNote from './fixtures/obsidian-vaults/study-vault/Notas/Quimica.md?raw'

type StoredNote = { name: string; relativePath: string; content: string }

const vault = {
  name: 'Vault de testes',
  path: 'C:\\Vault de testes',
  noteCount: 2,
  notePreviews: [],
  isObsidianVault: false,
  metadata: { isInitialized: true, rootPath: 'C:\\Vault de testes\\.mirmind', missing: [] },
}

function createTauriHarness() {
  const notes = new Map<string, StoredNote>([
    ['inicial.md', { name: 'inicial.md', relativePath: 'inicial.md', content: '---\ndescription: Inicial\nloop: &loop [*loop]\n---\n\n# Inicial\n\nTexto inicial. Veja [[alvo]], volte para [[#Inicial]] e crie [[nova/pagina]].\n\n**Equação Geral**\n\n$$\n6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2\n$$' }],
    ['alvo.md', { name: 'alvo.md', relativePath: 'alvo.md', content: '# Alvo\n\n> [!warning]- **Aviso** *seguro*\n> Conteudo do callout.\n\n> [!note] # Titulo inline\n> Sem heading no cabecalho.\n\n- Item da lista\n  > [!tip] **Dica interna**\n  > Conteudo aninhado.\n\n- Item multinivel\n  > Contexto comum\n  >\n  > > [!example] Exemplo profundo\n  > > Conteudo profundo.\n\n![[inicial]]\n\n![[media/manual.pdf|Manual]]\n\n![[.obsidian/plugins/segredo.pdf|Segredo]]\n\n![Remote](https://example.com/image.png)\n\n<kbd>Ctrl K</kbd><script>danger()</script><a href="https://mirrormind.local/note/%E0%A4%A">URL quebrada</a>' }],
  ])

  invokeMock.mockImplementation(async (command: string, args?: { relativePath?: string; content?: string }) => {
    switch (command) {
      case 'get_recent_vault_preference':
        return { lastVaultPath: null, askBeforeReopen: true }
      case 'select_existing_vault':
        return { ...vault, noteCount: notes.size }
      case 'list_notes':
        return [...notes.values()].map(({ name, relativePath }) => ({ name, relativePath }))
      case 'list_folders':
      case 'list_favorites':
      case 'list_templates':
        return command === 'list_templates' ? [{ id: 'blank', name: 'Em branco', content: '' }] : []
      case 'list_attachments':
        return ['media/manual.pdf']
      case 'list_special_files':
        return {
          files: [
            { name: 'Planejamento.canvas', relativePath: 'Planejamento.canvas', kind: 'canvas' },
            { name: 'Quadro.excalidraw', relativePath: 'desenhos/Quadro.excalidraw', kind: 'excalidraw' },
            { name: 'dados.plugin-cache', relativePath: 'dados.plugin-cache', kind: 'unknown' },
          ],
          truncated: false,
        }
      case 'get_tag_index':
      case 'get_backlinks':
      case 'get_broken_links':
        return []
      case 'get_vault_review_policy_config':
        return {
          revision: 0,
          defaults: {
            firstReviewIntervalDays: 2,
            targetRetention: 0.8,
            priorityWeight: 1,
            minIntervalDays: 1,
            maxIntervalDays: 365,
          },
          tagRules: [],
          updatedAtUnixMs: null,
          affectedNoteCount: 0,
        }
      case 'get_history_status':
        return { canUndo: false, canRedo: false }
      case 'watch_vault':
        return 1
      case 'unwatch_vault':
        return undefined
      case 'read_note': {
        const note = notes.get(args?.relativePath ?? '')
        if (!note) throw new Error(`Nota inexistente: ${args?.relativePath}`)
        return note
      }
      case 'create_note': {
        const relativePath = args?.relativePath ?? ''
        if (notes.has(relativePath)) throw new Error(`Nota ja existe: ${relativePath}`)
        const note = { name: relativePath.split('/').at(-1) ?? relativePath, relativePath, content: `# ${relativePath.replace(/\.md$/i, '')}\n\n` }
        notes.set(relativePath, note)
        return note
      }
      case 'recover_note': {
        const relativePath = args?.relativePath ?? ''
        if (notes.has(relativePath)) throw new Error(`Nota ja existe: ${relativePath}`)
        const note = {
          name: relativePath.split('/').at(-1) ?? relativePath,
          relativePath,
          content: args?.content ?? '',
        }
        notes.set(relativePath, note)
        return note
      }
      case 'save_note': {
        const relativePath = args?.relativePath ?? ''
        const current = notes.get(relativePath)
        if (!current) throw new Error(`Nota inexistente: ${relativePath}`)
        const saved = { ...current, content: args?.content ?? '' }
        notes.set(relativePath, saved)
        return saved
      }
      case 'get_note_review_gaps':
        if (args?.relativePath === 'inicial.md') {
          return [
            { classification: 'forgotten', sourceQuote: 'Texto inicial', sourceStartUtf16: 61, sourceEndUtf16: 74 },
            { classification: 'confused', sourceQuote: 'volte', sourceStartUtf16: 91, sourceEndUtf16: 96 },
          ]
        }
        return []
      case 'get_note_review_units':
        if (args?.relativePath === 'inicial.md') {
          // Unidades alinhadas a paragrafos (como a segmentacao real): a
          // primeira cobre o paragrafo introdutorio; a segunda vai ate o fim
          // da formula em bloco, entao o badge e realocado para depois dela.
          return [
            { sourceStartUtf16: 59, sourceEndUtf16: 96, evaluated: true, inconclusive: false, score: 77, outcome: 'good' },
            { sourceStartUtf16: 96, sourceEndUtf16: 211, evaluated: true, inconclusive: false, score: 55, outcome: 'partial' },
          ]
        }
        return []
      default:
        throw new Error(`Comando Tauri inesperado no teste: ${command}`)
    }
  })

  return { notes }
}

async function openTestVault(user: ReturnType<typeof userEvent.setup>) {
  render(<ReviewAiSettingsProvider><App /></ReviewAiSettingsProvider>)
  await user.click(await screen.findByRole('button', { name: 'Escolher pasta' }))
  await screen.findByRole('button', { name: 'Abrir nota inicial' })
}

describe('Regressao do editor no workspace', () => {
  beforeEach(() => {
    localStorage.clear()
    invokeMock.mockReset()
    listenMock.mockReset()
    listenMock.mockResolvedValue(() => undefined)
    onDragDropEventMock.mockReset()
    onDragDropEventMock.mockResolvedValue(() => undefined)
    getCurrentWindowMock.mockReset()
    getCurrentWindowMock.mockImplementation(() => ({ onDragDropEvent: onDragDropEventMock }))
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('[tags] abre a pagina dedicada pela barra de ferramentas', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir gerenciador de tags' }))

    expect(await screen.findByRole('heading', { name: 'Tags do vault' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar tag' })).toBeInTheDocument()
  })

  it('[metadados] mostra as tags associadas e remove o campo de descricao', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    expect(screen.getByRole('button', { name: 'Tags associadas a nota' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Descricao da nota' })).not.toBeInTheDocument()
  })

  it('[nota nova] salva ao confirmar o titulo com Enter e abre a nota criada', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Nova nota' }))
    const title = await screen.findByRole('textbox', { name: 'Titulo da nova nota' })
    await user.type(title, 'Minha nota de regressao{Enter}')

    await waitFor(() => {
      expect(notes.get('minha-nota-de-regressao.md')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Abrir nota minha-nota-de-regressao' })).toBeInTheDocument()
    })
    expect(invokeMock).toHaveBeenCalledWith('create_note', expect.objectContaining({ relativePath: 'minha-nota-de-regressao.md' }))
    expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({ relativePath: 'minha-nota-de-regressao.md' }))
  })

  it('[atalhos] exibe os atalhos para salvar a nota e alternar o modo de visualizacao', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Ver atalhos' }))

    expect(screen.getByRole('textbox', { name: 'Atalho para salvar nota' })).toHaveValue('Ctrl+S')
    expect(screen.getByRole('textbox', { name: 'Atalho para alternar modo de visualizacao' })).toHaveValue('Ctrl+M')
  })

  it('[atalhos] salva a nota e alterna o modo de visualizacao pelos atalhos configurados', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Edicao' }))
    await user.click(document.querySelector('.cm-content')!)
    await user.type(document.querySelector('.cm-content')!, ' alterado')
    await user.keyboard('{Control>}s{/Control}')

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({ relativePath: 'inicial.md' })))

    await user.keyboard('{Control>}m{/Control}')
    expect(screen.getByRole('radio', { name: 'Leitura' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Control>}m{/Control}')
    expect(screen.getByRole('radio', { name: 'Misto' })).toHaveAttribute('aria-checked', 'true')
  })

  it('[atalhos] alterna o modo pelo atalho Ctrl+M no Misto', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    // Misto e um unico editor continuo (sem blocos por linha) com cursor nativo.
    const editor = document.querySelector('.markdown-mixed .codemirror-markdown-editor')
    expect(editor).not.toBeNull()
    expect(document.querySelectorAll('.markdown-mixed article').length).toBe(0)
    await user.click(editor as HTMLElement)

    await user.keyboard('{Control>}m{/Control}')
    expect(screen.getByRole('radio', { name: 'Edicao' })).toHaveAttribute('aria-checked', 'true')
  })

  it('[atalhos] aplica o atalho personalizado configurado na pagina de atalhos', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Ver atalhos' }))
    const modeShortcutInput = screen.getByRole('textbox', { name: 'Atalho para alternar modo de visualizacao' })
    await user.click(modeShortcutInput)
    await user.keyboard('{Control>}{Alt>}v{/Alt}{/Control}')
    expect(modeShortcutInput).toHaveValue('Ctrl+Alt+V')

    await user.click(screen.getByRole('button', { name: 'Voltar para notas' }))
    await user.keyboard('{Control>}{Alt>}v{/Alt}{/Control}')
    expect(screen.getByRole('radio', { name: 'Edicao' })).toHaveAttribute('aria-checked', 'true')
  })

  it('[modo] alterna entre Edicao, Misto e Leitura pelos botoes segmentados sem perder o painel', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    expect(screen.getByRole('radio', { name: 'Misto' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'Edicao' }))
    expect(screen.getByRole('radio', { name: 'Edicao' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('.editor-content .codemirror-markdown-editor')).not.toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    expect(screen.getByRole('radio', { name: 'Leitura' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('.editor-content .markdown-reading')).not.toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Misto' }))
    expect(screen.getByRole('radio', { name: 'Misto' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('.editor-content .markdown-mixed')).not.toBeNull()

    // Navegacao por setas do radiogroup: direita vai para Leitura, esquerda volta para Misto.
    const control = screen.getByRole('radiogroup', { name: 'Modo de visualizacao da nota' })
    control.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Leitura' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Misto' })).toHaveAttribute('aria-checked', 'true')
  })

  it('[modo misto] e um editor continuo com cursor nativo e sintaxe mascarada', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Misto' }))
    const editor = document.querySelector('.markdown-mixed .codemirror-markdown-editor')
    expect(editor).not.toBeNull()
    // Nenhum bloco por linha, nenhum chip: um unico editor, como no modo Edicao.
    expect(document.querySelectorAll('.markdown-mixed article').length).toBe(0)
    expect(document.querySelector('.markdown-mixed .mixed-caret-word-chip')).toBeNull()

    // Cursor nativo: clicar foca o editor (o caret aparece em qualquer clique).
    const content = document.querySelector('.markdown-mixed .cm-content')
    expect(content).not.toBeNull()
    await user.click(content as HTMLElement)
    await waitFor(() => expect(document.querySelector('.markdown-mixed .cm-editor.cm-focused')).not.toBeNull())

    // Live preview: a sintaxe Markdown e mascarada no texto visivel.
    const visibleText = content?.textContent ?? ''
    expect(visibleText).not.toContain('**')
    expect(visibleText).not.toContain('[[')
    expect(visibleText).toContain('Equação Geral')

    // Matematica multilinha ($$...$$) e renderizada com KaTeX, nao crua.
    expect(document.querySelector('.markdown-mixed .katex')).not.toBeNull()
    expect(visibleText).not.toContain('$$')

    // O frontmatter YAML inicial permanece cru (inclusive os --- delimitadores).
    expect(visibleText).toContain('description: Inicial')
  })

  it('[nota diaria] cria a nota de hoje pela Command Palette e a abre no workspace', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    const today = new Date()
    const dailyPath = `Diarias/${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.md`
    await openTestVault(user)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('textbox', { name: 'Buscar comando' }), 'nota diaria')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(notes.get(dailyPath)).toBeDefined())
    expect(invokeMock).toHaveBeenCalledWith('create_note', expect.objectContaining({ relativePath: dailyPath }))
    expect(screen.getByRole('tab', { name: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.md` })).toBeInTheDocument()
  })

  it('[Markdown] renderiza formulas matematicas em bloco', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Leitura' }))

    const formula = await screen.findByText('6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2', { selector: 'annotation' })
    expect(formula.closest('.katex-display')).not.toBeNull()
    expect(formula.closest('.katex')).not.toBeNull()
  })
  it('[links internos] abre a nota vinculada no modo Leitura', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    // O botao do wikilink e o da lista de backlinks ("Referenciada por") podem
    // coexistir com o mesmo nome; o clique deve mirar o wikilink da nota.
    const alvoButtons = await screen.findAllByRole('button', { name: 'alvo' })
    const wikiLink = alvoButtons.find((button) => button.classList.contains('wiki-link')) ?? alvoButtons[0]
    fireEvent.click(wikiLink)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'alvo.md' })))
    expect(await screen.findByRole('tab', { name: 'alvo.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[contador] mostra o numero de palavras da nota no canto do editor', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    const counter = await screen.findByTestId('note-word-count')
    const match = counter.textContent?.match(/(\d+) palavras/)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThan(0)
  })

  it('[tags] insere uma tag aninhada sem remover os separadores', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir nota inicial' }))
    await user.click(screen.getByRole('radio', { name: 'Edicao' }))
    await user.click(screen.getByRole('button', { name: 'Ferramentas de Markdown' }))
    await user.click(await screen.findByTitle('Inserir tag'))
    const dialog = await screen.findByRole('dialog', { name: 'Inserir tag' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome da tag' }), 'Estudo/Português')
    await user.click(within(dialog).getByRole('button', { name: 'Inserir tag' }))

    expect(document.querySelector('.cm-content')).toHaveTextContent('#estudo/português')
  })

  it('[links internos] cria e abre a nota de um wikilink inexistente', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))

    await user.click(await screen.findByRole('button', { name: 'pagina' }))

    await waitFor(() => expect(notes.has('nova/pagina.md')).toBe(true))
    expect(await screen.findByRole('tab', { name: 'pagina.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[links internos] cria uma nota apenas uma vez em cliques concorrentes', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    const link = await screen.findByRole('button', { name: 'pagina' })

    fireEvent.click(link)
    fireEvent.click(link)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('create_note', expect.objectContaining({ relativePath: 'nova/pagina.md' })))
    expect(invokeMock.mock.calls.filter(([command]) => command === 'create_note')).toHaveLength(1)
  })

  it('[links internos] navega na nota atual sem recarregar o conteudo do disco', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    const readsBeforeClick = invokeMock.mock.calls.filter(([command]) => command === 'read_note').length

    fireEvent.click(await screen.findByRole('button', { name: 'Inicial' }))

    expect(invokeMock.mock.calls.filter(([command]) => command === 'read_note')).toHaveLength(readsBeforeClick)
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('[compatibilidade Obsidian] renderiza callout recolhivel e sanitiza HTML', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir nota alvo' }))
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))

    const calloutTitle = await screen.findByText('Aviso', { selector: 'strong' })
    expect(screen.getByText('seguro', { selector: 'em' })).toBeInTheDocument()
    const details = calloutTitle.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    await user.click(calloutTitle.closest('summary')!)
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Ctrl K').tagName).toBe('KBD')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.queryByText('danger()')).not.toBeInTheDocument()
    expect(screen.getByText('URL quebrada').tagName).toBe('SPAN')

    const nestedCalloutTitle = screen.getByText('Dica interna', { selector: 'strong' })
    const nestedCallout = nestedCalloutTitle.closest('.obsidian-callout')
    expect(nestedCallout).not.toBeNull()
    expect(nestedCallout?.closest('li')).toHaveTextContent('Item da lista')
    expect(nestedCallout).toHaveTextContent('Conteudo aninhado.')

    const inlineTitle = screen.getByText('Titulo inline')
    expect(inlineTitle.closest('.obsidian-callout-title')?.querySelector('h1')).toBeNull()
    const deepCallout = screen.getByText('Exemplo profundo').closest('.obsidian-callout')
    expect(deepCallout?.closest('li')).toHaveTextContent('Item multinivel')
    expect(deepCallout).toHaveTextContent('Conteudo profundo.')
    const embeddedNote = await screen.findByText((_content, element) => element?.tagName === 'P' && Boolean(element.textContent?.includes('Texto inicial. Veja')))
    expect(embeddedNote.closest('.obsidian-note-embed')).not.toBeNull()
    expect(embeddedNote.closest('.obsidian-note-embed')?.closest('p')).toBeNull()
    const pdf = screen.getByRole('region', { name: 'PDF incorporado: Manual' })
    expect(pdf).toHaveAttribute('data-relative-path', 'media/manual.pdf')
    expect(pdf).toHaveAttribute('data-vault-path', 'C:\\Vault de testes')
    expect(screen.queryByRole('region', { name: 'PDF incorporado: Segredo' })).not.toBeInTheDocument()
    expect(screen.getByAltText('Remote')).toHaveAttribute('src', 'https://example.com/image.png')
  })

  it('[compatibilidade Obsidian] informa arquivos especiais sem oferecer edicao', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Ver 3 arquivos com compatibilidade limitada' }))

    const dialog = screen.getByRole('dialog', { name: 'Arquivos com compatibilidade limitada' })
    expect(dialog).toHaveTextContent('Planejamento.canvas')
    expect(dialog).toHaveTextContent('desenhos/Quadro.excalidraw')
    expect(dialog).toHaveTextContent('dados.plugin-cache')
    expect(dialog).toHaveTextContent('preservado sem alteracoes')
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar arquivos especiais' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Arquivos com compatibilidade limitada' })).not.toBeInTheDocument()
  })

  it('[grafo] mostra as conexoes entre notas e abre a nota selecionada', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))

    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()
    expect(screen.getByText('2 notas')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Buscar nota no grafo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorganizar nos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aproximar grafo' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Abrir nota alvo no grafo' }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'alvo.md' })))
    expect(screen.getByRole('tab', { name: 'alvo.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[indexadora] declara a nota e lista automaticamente quem a referencia', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Declarar nota como indexadora' }))

    await waitFor(() => {
      const content = notes.get('inicial.md')?.content ?? ''
      expect(content).toContain('indexadora: true')
      expect(content).toContain('<!-- indexadora -->')
      // alvo.md ja referencia inicial.md (embed ![[inicial]]), entao o link
      // gerado aparece na secao, uma linha por nota.
      expect(content).toContain('[[alvo]]')
    })
  })

  it('[indexadora] desativar remove a flag e a secao gerada', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Declarar nota como indexadora' }))
    await waitFor(() => expect(notes.get('inicial.md')?.content).toContain('indexadora: true'))

    await user.click(screen.getByRole('button', { name: 'Declarar nota como indexadora' }))
    await waitFor(() => {
      const content = notes.get('inicial.md')?.content ?? ''
      expect(content).toContain('indexadora: false')
      expect(content).not.toContain('<!-- indexadora -->')
    })
  })

  it('[autosave] persiste alteracoes da nota apos a pausa de digitacao', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Edicao' }))
    const editor = screen.getByRole('textbox', { name: 'Editor Markdown da nota inicial' })
    await user.click(editor)
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste(' Resumo-atualizado')

    expect(screen.getByText('Alteracoes pendentes')).toBeInTheDocument()

    await waitFor(() => {
      expect(notes.get('inicial.md')?.content).toContain('Resumo-atualizado')
    }, { timeout: 2_000 })
    expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({
      relativePath: 'inicial.md',
      content: expect.stringContaining('Resumo-atualizado'),
    }))
  })

  it('[compatibilidade Obsidian] edita, salva e reabre a fixture pelo fluxo do workspace', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    const marker = 'edicao integrada da matriz Obsidian'
    notes.set('inicial.md', {
      name: 'inicial.md',
      relativePath: 'inicial.md',
      content: obsidianStudyNote,
    })
    localStorage.setItem('mirrormind.auto-save', 'true')
    await openTestVault(user)
    await user.click(screen.getByRole('radio', { name: 'Edicao' }))

    const editor = screen.getByRole('textbox', { name: 'Editor Markdown da nota inicial' })
    await user.click(editor)
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste(`\n\n${marker}`)

    await waitFor(() => {
      expect(notes.get('inicial.md')?.content).toContain(marker)
    }, { timeout: 2_000 })
    const savedContent = notes.get('inicial.md')?.content ?? ''
    expect(savedContent).toContain('# Propriedades que devem sobreviver a qualquer edicao')
    expect(savedContent).toContain('plugin-field: { color: "yellow", pinned: true }')
    expect(savedContent).toContain('<study-plugin data-id="chem-01">preservar este bloco</study-plugin>')
    expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({
      relativePath: 'inicial.md',
      content: savedContent,
    }))

    cleanup()
    invokeMock.mockClear()
    await openTestVault(user)
    await user.click(screen.getByRole('radio', { name: 'Edicao' }))

    expect(screen.getByRole('textbox', { name: 'Editor Markdown da nota inicial' })).toHaveTextContent(marker)
    expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'inicial.md' }))
  })

  it('[frontmatter] cria uma propriedade estruturada pelo editor individual', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    await openTestVault(user)
    expect(screen.getByRole('button', { name: 'Editar propriedade loop' })).toHaveTextContent('[referencia circular]')

    const propertyActions = screen.getByRole('button', { name: 'Ações das propriedades' })
    expect(propertyActions).toHaveAttribute('aria-expanded', 'false')
    await user.click(propertyActions)
    expect(propertyActions).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Nova propriedade' }))
    await user.type(screen.getByLabelText('Nome da propriedade'), 'review')
    await user.type(screen.getByLabelText('Valor YAML'), 'interval: 7{enter}repetitions: 3')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() => {
      expect(notes.get('inicial.md')?.content).toContain('review:\n  interval: 7\n  repetitions: 3')
    }, { timeout: 2_000 })
    expect(screen.getByRole('button', { name: 'Editar propriedade review' })).toBeInTheDocument()
  })

  it('[mudanca externa] preserva e restaura o rascunho de uma nota removida', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    let fileSystemListener: ((event: { payload: { requestId: number; kind: string; paths: string[] } }) => void) | undefined
    listenMock.mockImplementation(async (_eventName, listener) => {
      fileSystemListener = listener
      return () => undefined
    })
    await openTestVault(user)

    const requestId = invokeMock.mock.calls.find(([command]) => command === 'watch_vault')?.[1]?.requestId as number
    notes.delete('inicial.md')
    fileSystemListener?.({ payload: { requestId, kind: 'remove', paths: ['inicial.md'] } })

    const dialog = await screen.findByRole('dialog', { name: 'Nota removida fora do MirrorMind' })
    expect(dialog).toHaveTextContent('Seu rascunho continua preservado')
    await user.click(screen.getByRole('button', { name: 'Restaurar arquivo' }))

    await waitFor(() => expect(notes.get('inicial.md')?.content).toContain('Texto inicial'))
    expect(screen.queryByRole('dialog', { name: 'Nota removida fora do MirrorMind' })).not.toBeInTheDocument()
  })

  it('[mudanca externa] resolve em sequencia varias abas removidas', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    let fileSystemListener: ((event: { payload: { requestId: number; kind: string; paths: string[] } }) => void) | undefined
    listenMock.mockImplementation(async (_eventName, listener) => {
      fileSystemListener = listener
      return () => undefined
    })
    await openTestVault(user)
    await user.click(screen.getByRole('button', { name: 'Abrir nota alvo' }))

    const requestId = invokeMock.mock.calls.find(([command]) => command === 'watch_vault')?.[1]?.requestId as number
    notes.clear()
    fileSystemListener?.({ payload: { requestId, kind: 'remove', paths: ['inicial.md', 'alvo.md'] } })

    expect(await screen.findByRole('dialog', { name: 'Nota removida fora do MirrorMind' })).toHaveTextContent('inicial')
    await user.click(screen.getByRole('button', { name: 'Fechar aba' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Nota removida fora do MirrorMind' })).toHaveTextContent('alvo'))
    await user.click(screen.getByRole('button', { name: 'Fechar aba' }))

    expect(screen.queryByRole('dialog', { name: 'Nota removida fora do MirrorMind' })).not.toBeInTheDocument()
  })

  it('[lacunas] o controle de 3 modos alterna a exibicao das lacunas no modo Leitura', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    localStorage.setItem('mirrormind.review-gap-mode', 'always')
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    const control = screen.getByRole('radiogroup', { name: 'Exibicao das lacunas da ultima revisao' })
    expect(control).toBeInTheDocument()

    // Padrao configurado: sempre visiveis -> article tem has-gap-marks, marca-textos
    // e os badges de pontuacao por paragrafo da ultima revisao.
    const article = document.querySelector('.markdown-reading')
    expect(article?.className).toContain('has-gap-marks')
    expect(article?.querySelectorAll('mark[data-gap]').length).toBeGreaterThan(0)
    expect(article?.querySelectorAll('span.review-unit-score').length).toBeGreaterThan(0)

    // Hover-only: article marca is-gap-hover-only e mantem marks e badges no DOM.
    await user.click(screen.getByRole('radio', { name: 'Lacunas somente no hover' }))
    expect(article?.className).toContain('is-gap-hover-only')
    expect(article?.querySelectorAll('mark[data-gap]').length).toBeGreaterThan(0)
    expect(article?.querySelectorAll('span.review-unit-score').length).toBeGreaterThan(0)

    // Desativado: sem classe de lacunas, sem marks e sem badges.
    await user.click(screen.getByRole('radio', { name: 'Lacunas desativadas' }))
    expect(article?.className).not.toContain('has-gap-marks')
    expect(article?.querySelectorAll('mark[data-gap]').length).toBe(0)
    expect(article?.querySelectorAll('span.review-unit-score').length).toBe(0)
  })

  it('[busca na nota] Ctrl+F abre o campo flutuante com contador e navegacao por setas', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('button', { name: 'Abrir nota inicial' }))

    // A lupa abre o campo flutuante com o cursor dentro dele.
    await user.click(screen.getByRole('button', { name: 'Buscar na nota' }))
    const findInput = await screen.findByRole('textbox', { name: 'Buscar na nota' })
    expect(findInput).toHaveFocus()

    // Ao digitar, o contador mostra 1/N com N total de correspondencias.
    await user.type(findInput, 'Inicial')
    await waitFor(() => {
      expect(document.querySelector('.note-find-count')?.textContent).toBe('1/4')
    })

    // Setas navegam entre as correspondencias e o contador acompanha.
    await user.click(screen.getByRole('button', { name: 'Próxima correspondência' }))
    expect(document.querySelector('.note-find-count')?.textContent).toBe('2/4')
    await user.click(screen.getByRole('button', { name: 'Correspondência anterior' }))
    expect(document.querySelector('.note-find-count')?.textContent).toBe('1/4')

    // Esc fecha o campo e devolve o foco ao editor.
    findInput.focus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Buscar na nota' })).not.toBeInTheDocument())
  })

  it('[busca na nota] Ctrl+F funciona no modo Leitura sem trocar de modo', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('button', { name: 'Abrir nota inicial' }))

    // Muda para Leitura: o conteudo e o article renderizado (sem CodeMirror).
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    expect(document.querySelector('.markdown-reading')).not.toBeNull()

    // Ctrl+F disparado sobre o corpo da nota abre a barra SEM trocar de modo.
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    const findInput = await screen.findByRole('textbox', { name: 'Buscar na nota' })
    expect(findInput).toHaveFocus()
    expect(document.querySelector('.markdown-reading')).not.toBeNull()

    // O contador reflete as correspondencias no DOM renderizado: o frontmatter
    // e a sintaxe nao contam (3 em vez de 4 no texto-fonte).
    await user.type(findInput, 'Inicial')
    await waitFor(() => {
      expect(document.querySelector('.note-find-count')?.textContent).toBe('1/3')
    })

    // Navegacao avanca no DOM do modo Leitura.
    await user.click(screen.getByRole('button', { name: 'Próxima correspondência' }))
    expect(document.querySelector('.note-find-count')?.textContent).toBe('2/3')

    // Esc fecha e o modo Leitura permanece.
    findInput.focus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Buscar na nota' })).not.toBeInTheDocument())
    expect(document.querySelector('.markdown-reading')).not.toBeNull()
  })

  it('[busca na nota] Ctrl+F no modo Edicao abre a barra do app (nao o painel nativo do CodeMirror)', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('button', { name: 'Abrir nota inicial' }))
    await user.click(screen.getByRole('radio', { name: 'Edicao' }))

    // O foco esta dentro do editor (.cm-content): o CodeMirror intercepta o
    // atalho e chama o callback do app em vez do painel nativo de busca.
    const content = document.querySelector('.cm-content')
    expect(content).not.toBeNull()
    fireEvent.keyDown(content!, { key: 'f', ctrlKey: true })
    const findInput = await screen.findByRole('textbox', { name: 'Buscar na nota' })
    expect(findInput).toHaveFocus()
    expect(document.querySelector('.cm-search')).toBeNull()
  })

  it('[popover de formatacao] aparece sobre a selecao, aplica negrito e fecha com Escape', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('button', { name: 'Abrir nota inicial' }))
    await user.click(screen.getByRole('radio', { name: 'Edicao' }))

    // Sem selecao nao ha popover.
    expect(screen.queryByRole('toolbar', { name: 'Formatar seleção' })).not.toBeInTheDocument()

    // Selecao via busca (selectRange imperativo do CodeMirror sobre o 1o match).
    const content = document.querySelector('.cm-content')
    expect(content).not.toBeNull()
    fireEvent.keyDown(content!, { key: 'f', ctrlKey: true })
    const findInput = await screen.findByRole('textbox', { name: 'Buscar na nota' })
    await user.type(findInput, 'Equação')
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Formatar seleção' })).toBeInTheDocument())

    // Negrito envolve o trecho selecionado no texto-fonte.
    await user.click(screen.getByRole('button', { name: 'Negrito (seleção)' }))
    await waitFor(() => expect(document.querySelector('.cm-content')).toHaveTextContent('**Equação**'))

    // Os formatos quimicos tambem estao no popover e aplicam marcacao.
    expect(screen.getByRole('button', { name: 'Subscrito (seleção)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sobrescrito (seleção)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seta de reação (seleção)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seta reversa (seleção)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Subscrito (seleção)' }))
    await waitFor(() => expect(document.querySelector('.cm-content')).toHaveTextContent('$_{'))

    // Escape fecha o popover sem fechar a nota.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Formatar seleção' })).not.toBeInTheDocument())
  })
})
