import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BasesPage } from './BasesPage'

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

/** Notas com frontmatter: colunas esperadas = Nota, tags, area, nivel, ano. */
const notes = [
  {
    name: 'quimica.md',
    relativePath: 'Notas/quimica.md',
    content: '---\ntags:\n  - estudo\n  - prova\narea: Ciencia\nnivel: 2\n---\n\n# Quimica\n',
  },
  {
    name: '2026.md',
    relativePath: 'Diarios/2026.md',
    content: '---\ntags:\n  - diario\nano: 2026\n---\n\n# Diario 2026\n',
  },
  {
    name: 'raiz.md',
    relativePath: 'raiz.md',
    content: '---\narea: Pessoal\n---\n\n# Raiz\n',
  },
]

const STORAGE_KEY = 'mirrormind.bases.columns.C:/vault'

beforeEach(() => {
  localStorage.clear()
  invokeMock.mockReset()
  listenMock.mockReset()
  listenMock.mockImplementation(() => Promise.resolve(() => {}))
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'read_vault_notes') return notes
    throw new Error(`Comando inesperado no mock: ${command}`)
  })
})

afterEach(cleanup)

function renderPage() {
  return render(
    <BasesPage
      vaultPath="C:/vault"
      notePreviews={notes.map(({ name, relativePath }) => ({ name, relativePath }))}
      onOpenNote={vi.fn()}
    />,
  )
}

async function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Escolher colunas da tabela' }))
  // A lista de colunas vive dentro do popover (portalado).
  return screen.findByRole('group', { name: 'Colunas da tabela' })
}

function tableHeaders(): string[] {
  const table = screen.getByRole('table')
  return within(table).getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '')
}

describe('BasesPage (Tabela)', () => {
  it('renderiza a tabela com todas as colunas por padrao e o novo nome', async () => {
    renderPage()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Tabela de notas')).toBeInTheDocument()
    expect(tableHeaders()).toEqual(['Nota', 'tags', 'area', 'nivel', 'ano'])
    // 1 linha de cabecalho + 3 notas.
    expect(screen.getAllByRole('row')).toHaveLength(4)
  })

  it('o seletor de colunas lista as propriedades e a coluna Nota fica fixa', async () => {
    renderPage()
    await screen.findByRole('table')
    const picker = await openPicker()
    const labels = within(picker).getAllByText(/tags|area|nivel|ano/)
    expect(labels.map((label) => label.textContent)).toEqual(['tags', 'area', 'nivel', 'ano'])
    // A linha "Nota" existe e esta bloqueada (sempre visivel).
    expect(within(picker).getByText('Nota')).toBeInTheDocument()
    expect(within(picker).getByText('Nota').closest('[aria-disabled="true"]')).not.toBeNull()
  })

  it('oferece as mesmas propriedades comuns do menu do header (arrow down)', async () => {
    renderPage()
    await screen.findByRole('table')
    const picker = await openPicker()
    // Nenhuma nota tem `phone`, mas a opcao existe (como no menu do header).
    const phone = within(picker).getByRole('button', { name: 'Telefone (phone)' })
    expect(phone).toHaveAttribute('aria-pressed', 'false')
    // Rotulo amigavel + chave crua visiveis na linha.
    expect(within(phone).getByText('Telefone')).toBeInTheDocument()
    expect(within(phone).getByText('phone')).toBeInTheDocument()
  })

  it('desmarcar uma propriedade esconde a coluna e persiste no localStorage', async () => {
    renderPage()
    await screen.findByRole('table')
    const picker = await openPicker()
    fireEvent.click(within(picker).getByRole('button', { name: 'Tags (tags)' }))

    await waitFor(() => expect(tableHeaders()).toEqual(['Nota', 'area', 'nivel', 'ano']))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['area', 'nivel', 'ano']))
    // O cabecalho continua ordenando pelas colunas restantes.
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: /Ordenar por ano/ }))
    expect(tableHeaders()).toEqual(['Nota', 'area', 'nivel', 'ano'])
  })

  it('marcar uma propriedade comum sem valor em nenhuma nota adiciona a coluna vazia', async () => {
    renderPage()
    await screen.findByRole('table')
    const picker = await openPicker()
    fireEvent.click(within(picker).getByRole('button', { name: 'Telefone (phone)' }))

    await waitFor(() => expect(tableHeaders()).toContain('phone'))
    // A coluna nova fica no fim (depois das propriedades das notas) e as
    // celulas aparecem vazias (dash).
    expect(tableHeaders()).toEqual(['Nota', 'tags', 'area', 'nivel', 'ano', 'phone'])
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['tags', 'area', 'nivel', 'ano', 'phone']))
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('restaurar padrao devolve todas as colunas e limpa o localStorage', async () => {
    renderPage()
    await screen.findByRole('table')
    const picker = await openPicker()
    fireEvent.click(within(picker).getByRole('button', { name: 'area' }))
    await waitFor(() => expect(tableHeaders()).not.toContain('área'))

    fireEvent.click(screen.getByRole('button', { name: /Restaurar padrão/ }))
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull())
    expect(tableHeaders()).toEqual(['Nota', 'tags', 'area', 'nivel', 'ano'])
  })

  it('respeita a escolha salva ao remontar (por vault)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['ano']))
    renderPage()
    await screen.findByRole('table')
    expect(tableHeaders()).toEqual(['Nota', 'ano'])
  })

  it('ignora chaves salvas que não existem mais (propriedade removida das notas)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['ano', 'inexistente']))
    renderPage()
    await screen.findByRole('table')
    expect(tableHeaders()).toEqual(['Nota', 'ano'])
  })
})
