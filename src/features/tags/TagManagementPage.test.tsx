import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagManagementPage } from './TagManagementPage'

const {
  getConfigMock,
  getTagIndexMock,
  previewMock,
  applyMock,
} = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getTagIndexMock: vi.fn(),
  previewMock: vi.fn(),
  applyMock: vi.fn(),
}))

vi.mock('../review/vaultReviewPolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../review/vaultReviewPolicy')>()
  return {
    ...original,
    getVaultReviewPolicyConfig: getConfigMock,
  }
})

vi.mock('./tagManagement', async (importOriginal) => {
  const original = await importOriginal<typeof import('./tagManagement')>()
  return {
    ...original,
    getTagIndex: getTagIndexMock,
    previewTagManagementChange: previewMock,
    applyTagManagementChange: applyMock,
  }
})

const rule = {
  tag: 'prova',
  autoEnroll: true,
  firstReviewIntervalDays: 1,
  targetRetention: 0.9,
  priorityWeight: 3,
  minIntervalDays: 1,
  maxIntervalDays: 90,
  deadlineAtUnixMs: null,
  preferredMode: null,
}

const config = {
  revision: 3,
  defaults: {
    firstReviewIntervalDays: 2,
    targetRetention: 0.8,
    priorityWeight: 1,
    minIntervalDays: 1,
    maxIntervalDays: 365,
  },
  tagRules: [rule],
  updatedAtUnixMs: null,
  affectedNoteCount: 0,
}

describe('TagManagementPage', () => {
  beforeEach(() => {
    getConfigMock.mockReset().mockResolvedValue(config)
    getTagIndexMock.mockReset().mockResolvedValue([{
      tag: 'prova',
      notePaths: ['materias/biologia.md', 'materias/quimica.md'],
    }])
    previewMock.mockReset().mockResolvedValue({
      affectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      markdownNotePaths: [],
    })
    applyMock.mockReset().mockResolvedValue({
      config: { ...config, revision: 4, affectedNoteCount: 2 },
      affectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      markdownNotePaths: [],
    })
  })

  afterEach(cleanup)

  it('selects a tag and previews every impacted note before editing', async () => {
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    expect(await screen.findByRole('heading', { name: /prova/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Editar/i }))
    const priority = screen.getByLabelText('Prioridade na fila')
    await user.clear(priority)
    await user.type(priority, '4')
    await user.click(screen.getByRole('button', { name: 'Revisar alterações' }))

    expect(await screen.findByRole('dialog', { name: /Salvar alterações em #prova/i })).toBeInTheDocument()
    expect(screen.getByText('materias/biologia.md')).toBeInTheDocument()
    expect(screen.getByText('materias/quimica.md')).toBeInTheDocument()
    expect(applyMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirmar alteração' }))
    await waitFor(() => expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3,
      expectedAffectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      tagRules: [expect.objectContaining({ tag: 'prova', priorityWeight: 4 })],
    })))
  })

  it('asks separately whether deletion should remove the tag from Markdown', async () => {
    const user = userEvent.setup()
    applyMock.mockResolvedValueOnce({
      config: { ...config, revision: 4, tagRules: [], affectedNoteCount: 2 },
      affectedNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
      markdownNotePaths: ['materias/biologia.md', 'materias/quimica.md'],
    })
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /Excluir/i }))
    const removeFromNotes = screen.getByLabelText(/Remover também das notas/i)
    expect(removeFromNotes).not.toBeChecked()
    await user.click(removeFromNotes)
    expect(screen.getByText(/O Markdown das notas abaixo será alterado/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir tag' }))

    await waitFor(() => expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({
      change: {
        currentTag: 'prova',
        nextTag: null,
        removeFromNotes: true,
      },
      tagRules: [],
    })))
  })

  it('lets the tag dictate the inherited review mode', async () => {
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /Editar/i }))
    await user.click(screen.getByRole('radio', { name: /Conversa/i }))
    await user.click(screen.getByRole('button', { name: 'Revisar alterações' }))

    await screen.findByRole('dialog', { name: /Salvar alterações em #prova/i })
    await user.click(screen.getByRole('button', { name: 'Confirmar alteração' }))

    await waitFor(() => expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({
      tagRules: [expect.objectContaining({ tag: 'prova', preferredMode: 'conversation' })],
    })))
  })

  it('creates a configured tag only after a zero-impact confirmation', async () => {
    const user = userEvent.setup()
    previewMock.mockResolvedValueOnce({ affectedNotePaths: [], markdownNotePaths: [] })
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: 'Criar tag' }))
    await user.type(screen.getByLabelText('Nome da tag'), 'Biologia Celular')
    await user.click(screen.getByRole('button', { name: 'Revisar criação' }))

    const dialog = await screen.findByRole('dialog', { name: /Criar #biologia-celular/i })
    expect(dialog).toHaveTextContent('Nenhuma nota existente será alterada')
  })

  it('renders nested tags as a tree: click expands children and shows the tag data', async () => {
    getTagIndexMock.mockResolvedValue([
      { tag: 'concurso', notePaths: ['concursos/edital.md'] },
      { tag: 'concurso/matematica', notePaths: ['concursos/matematica.md'] },
      { tag: 'concurso/matematica/algebra', notePaths: ['concursos/algebra.md'] },
      { tag: 'extras/livros', notePaths: ['extras/leitura.md'] },
    ])
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    // Tag que tambem e pasta: mostra os dados dela (sem a secao de aninhadas).
    expect(await screen.findByRole('heading', { name: 'concurso' })).toBeInTheDocument()
    expect(screen.getByText('Tag selecionada')).toBeInTheDocument()
    expect(screen.getByText('Notas com esta tag')).toBeInTheDocument()
    const noteList = screen.getByRole('region', { name: 'Notas com esta tag' })
    expect(within(noteList).getByText('edital')).toBeInTheDocument()
    expect(within(noteList).getByText('concursos/')).toBeInTheDocument()
    expect(within(noteList).queryByText('algebra')).toBeNull()
    expect(screen.queryByText('Tags abaixo')).toBeNull()

    // Na arvore, a pasta esta recolhida: apenas o no raiz aparece, com o total
    // agregado (3 notas) em vez do proprio (1).
    const tree = screen.getByRole('tree')
    expect(within(tree).queryByRole('button', { name: /matematica/ })).toBeNull()
    expect(within(tree).getByRole('button', { name: /^#concurso · 3 notas$/ })).toBeInTheDocument()

    // Clicar na pasta expande os aninhados (como uma arvore de arquivos).
    await user.click(within(tree).getByRole('button', { name: /^#concurso · 3 notas$/ }))
    expect(await within(tree).findByRole('button', { name: /^#concurso\/matematica · 2 notas$/ })).toBeInTheDocument()

    // Clicar na tag aninhada seleciona-a e mostra os dados dela.
    await user.click(within(tree).getByRole('button', { name: /^#concurso\/matematica · 2 notas$/ }))
    expect(await screen.findByRole('heading', { name: /concurso\/matematica/i })).toBeInTheDocument()
    expect(screen.getByText('Notas com esta tag')).toBeInTheDocument()
    const nestedNoteList = screen.getByRole('region', { name: 'Notas com esta tag' })
    expect(within(nestedNoteList).getByText('matematica')).toBeInTheDocument()
    expect(within(nestedNoteList).getAllByText('concursos/')).toHaveLength(1)

    // Pasta pura (sem tag direta): mostra o chamado de configuracao, sem as
    // secoes de notas aninhadas, e o botao Configurar preenche o nome da tag.
    await user.click(within(tree).getByRole('button', { name: /^#extras · 1 nota$/ }))
    expect(await screen.findByRole('heading', { name: 'extras' })).toBeInTheDocument()
    expect(screen.getByText('Hierarquia de tags')).toBeInTheDocument()
    expect(screen.getByText('Pasta sem regra própria')).toBeInTheDocument()
    expect(screen.getByText(/1 nota em 1 tag aninhada/)).toBeInTheDocument()
    expect(screen.queryByText('Notas nesta hierarquia')).toBeNull()
    expect(screen.queryByText('Tags abaixo')).toBeNull()
    expect(screen.queryByText('extras/leitura.md')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Configurar$/ }))
    expect(await screen.findByLabelText('Nome da tag')).toHaveValue('extras')
  })

  it('warns when deleting a tag that has notes and nested tags', async () => {
    getTagIndexMock.mockResolvedValue([
      { tag: 'concurso', notePaths: ['concursos/edital.md'] },
      { tag: 'concurso/matematica', notePaths: ['concursos/matematica.md'] },
    ])
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /Excluir/i }))
    const dialog = await screen.findByRole('dialog', { name: /Excluir #concurso/i })
    expect(within(dialog).getByText('Notas usam esta tag')).toBeInTheDocument()
    expect(within(dialog).getByText(/1 nota está associada a esta tag/)).toBeInTheDocument()
    expect(within(dialog).getByText('Tags aninhadas')).toBeInTheDocument()
    expect(within(dialog).getByText(/1 tag aninhada abaixo desta tag/)).toBeInTheDocument()
  })

  it('does not show warnings when deleting a tag without notes or nested tags', async () => {
    getTagIndexMock.mockResolvedValue([{ tag: 'nova', notePaths: [] }])
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /Excluir/i }))
    const dialog = await screen.findByRole('dialog', { name: /Excluir #nova/i })
    expect(within(dialog).queryByText('Notas usam esta tag')).toBeNull()
    expect(within(dialog).queryByText('Tags aninhadas')).toBeNull()
  })

  it('lists each note with its name and location', async () => {
    getTagIndexMock.mockResolvedValue([{
      tag: 'programacao',
      notePaths: [
        'Programacao/backend/apis-rest.md',
        'Programacao/frontend/css.md',
      ],
    }])
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    expect(await screen.findByRole('heading', { name: 'programacao' })).toBeInTheDocument()
    // Apenas o nome da nota e a sua localizacao — sem o caminho completo.
    const noteList = screen.getByRole('region', { name: 'Notas com esta tag' })
    expect(within(noteList).getByText('apis-rest')).toBeInTheDocument()
    expect(within(noteList).getByText('css')).toBeInTheDocument()
    expect(within(noteList).getByText('Programacao/backend/')).toBeInTheDocument()
    expect(within(noteList).getByText('Programacao/frontend/')).toBeInTheDocument()
    expect(within(noteList).queryByText('Programacao/backend/apis-rest.md')).toBeNull()
  })

  it('disables creating rules at the 100-rule limit and explains why', async () => {
    getConfigMock.mockResolvedValue({
      ...config,
      tagRules: Array.from({ length: 100 }, (_, index) => ({ ...rule, tag: `tag-${index}` })),
    })
    getTagIndexMock.mockResolvedValue([
      { tag: 'prova', notePaths: ['materias/biologia.md'] },
      { tag: 'extras/livros', notePaths: ['materias/leitura.md'] },
    ])
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    const createButton = await screen.findByRole('button', { name: 'Criar tag' })
    expect(createButton).toBeDisabled()
    expect(screen.getByText(/Limite de 100 regras/i)).toBeInTheDocument()

    // Configurar cria uma regra nova para a tag existente e tambem fica bloqueado.
    await user.click(screen.getByRole('button', { name: /^#extras · 1 nota$/ }))
    expect(await screen.findByRole('button', { name: /^Configurar$/ })).toBeDisabled()
  })

  it('keeps creating rules enabled below the limit', async () => {
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)
    expect(await screen.findByRole('button', { name: 'Criar tag' })).toBeEnabled()
  })

  it('traps focus in the impact dialog and closes it with Escape', async () => {
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('button', { name: /Editar/i }))
    const reviewButton = screen.getByRole('button', { name: 'Revisar alterações' })
    await user.click(reviewButton)

    const dialog = await screen.findByRole('dialog', { name: /Salvar alterações em #prova/i })
    // Foco inicial dentro do dialogo.
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    // Tab e Shift+Tab permanecem dentro do dialogo.
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    // Escape fecha quando a operacao nao esta ocupada e restaura o foco.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Salvar alterações em #prova/i })).toBeNull()
    expect(reviewButton).toHaveFocus()
  })

  it('traps focus in the delete dialog and restores it when closed', async () => {
    const user = userEvent.setup()
    render(<TagManagementPage vaultPath={'C:\\Vault'} />)

    const deleteButton = await screen.findByRole('button', { name: /Excluir/i })
    await user.click(deleteButton)

    const dialog = await screen.findByRole('dialog', { name: /Excluir #prova/i })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Excluir #prova/i })).toBeNull()
    expect(deleteButton).toHaveFocus()
  })
})
