import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, listenMock, onDragDropEventMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  onDragDropEventMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onDragDropEvent: onDragDropEventMock }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

vi.mock('./components/ObsidianPdfEmbed', () => ({
  ObsidianPdfEmbed: ({ relativePath, title, vaultPath }: { relativePath: string; title: string; vaultPath: string }) => (
    <section aria-label={`PDF incorporado: ${title}`} data-relative-path={relativePath} data-vault-path={vaultPath} />
  ),
}))

import App from './App'
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
    ['inicial.md', { name: 'inicial.md', relativePath: 'inicial.md', content: '---\ndescription: Inicial\nloop: &loop [*loop]\n---\n\n# Inicial\n\nTexto inicial. Veja [[alvo]], volte para [[#Inicial]] e crie [[nova/pagina]].' }],
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
      default:
        throw new Error(`Comando Tauri inesperado no teste: ${command}`)
    }
  })

  return { notes }
}

async function openTestVault(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
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

  it('[links internos] abre a nota vinculada no modo Leitura', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'read')
    fireEvent.click(await screen.findByRole('button', { name: 'alvo' }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'alvo.md' })))
    await screen.findByText('Editando alvo.md')
    expect(await screen.findByRole('tab', { name: 'alvo.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[tags] insere uma tag aninhada sem remover os separadores', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir nota inicial' }))
    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'edit')
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
    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'read')

    await user.click(await screen.findByRole('button', { name: 'pagina' }))

    await waitFor(() => expect(notes.has('nova/pagina.md')).toBe(true))
    expect(await screen.findByRole('tab', { name: 'pagina.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[links internos] cria uma nota apenas uma vez em cliques concorrentes', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'read')
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
    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'read')
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
    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'read')

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

  it('[autosave] persiste alteracoes da nota apos a pausa de digitacao', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    await openTestVault(user)

    const description = screen.getByRole('textbox', { name: 'Descricao da nota' })
    await user.clear(description)
    await user.type(description, 'Resumo-atualizado')
    expect(description).toHaveValue('Resumo-atualizado')
    expect(screen.getByText('Alteracoes pendentes')).toBeInTheDocument()

    await waitFor(() => {
      expect(notes.get('inicial.md')?.content).toContain('description: Resumo-atualizado')
    }, { timeout: 2_000 })
    expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({
      relativePath: 'inicial.md',
      content: expect.stringContaining('description: Resumo-atualizado'),
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
    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'edit')

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
    await user.selectOptions(screen.getByLabelText('Modo de visualizacao da nota'), 'edit')

    expect(screen.getByRole('textbox', { name: 'Editor Markdown da nota inicial' })).toHaveTextContent(marker)
    expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'inicial.md' }))
  })

  it('[frontmatter] cria uma propriedade estruturada pelo editor individual', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    await openTestVault(user)
    expect(screen.getByRole('button', { name: 'Editar propriedade loop' })).toHaveTextContent('[referencia circular]')

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
})
