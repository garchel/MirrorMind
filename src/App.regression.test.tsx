import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, onDragDropEventMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  onDragDropEventMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onDragDropEvent: onDragDropEventMock }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import App from './App'

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
    ['inicial.md', { name: 'inicial.md', relativePath: 'inicial.md', content: '---\ndescription: Inicial\n---\n\n# Inicial\n\nTexto inicial. Veja [[alvo]].' }],
    ['alvo.md', { name: 'alvo.md', relativePath: 'alvo.md', content: '# Alvo\n\nConteudo da nota alvo.' }],
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
      case 'list_attachments':
      case 'list_favorites':
      case 'list_templates':
        return command === 'list_templates' ? [{ id: 'blank', name: 'Em branco', content: '' }] : []
      case 'get_tag_index':
      case 'get_backlinks':
      case 'get_broken_links':
        return []
      case 'get_history_status':
        return { canUndo: false, canRedo: false }
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
    onDragDropEventMock.mockReset()
    onDragDropEventMock.mockResolvedValue(() => undefined)
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
})
