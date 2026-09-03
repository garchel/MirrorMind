import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, listenMock, onDragDropEventMock, getCurrentWindowMock } = vi.hoisted(() => {
  // Janela mockada o suficiente para o App (drag-and-drop nativo) e a barra de
  // titulo customizada (minimizar/maximizar/restaurar/fechar + estado max).
  const windowMock = () => ({
    onDragDropEvent: onDragDropEventMock,
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => undefined),
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  })
  return {
    invokeMock: vi.fn(),
    listenMock: vi.fn(),
    onDragDropEventMock: vi.fn(),
    getCurrentWindowMock: vi.fn(windowMock),
  }
})

// Diagnosticos opcionais do inventario: quando definidos, o mock de
// scan_vault_inventory os inclui no payload (banner de leitura parcial).
let inventoryDiagnostics: unknown = undefined
/** Regras de tag do vault para o onboarding de perfil de revisao (o default e
 *  sem regras; testes do fluxo de adocao definem os tres perfis padrao). */
let vaultReviewTagRules: Array<Record<string, unknown>> = []

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

// O grafo 3D depende de WebGL (ausente no jsdom). O mock expoe o callback de
// foco para os testes abrirem o painel do no (drawer) sem renderizar Three.js,
// e responde ao pedido de exportacao com uma cena projetada ficticia.
vi.mock('./components/NoteGraph3D', async () => {
  const { useEffect } = await import('react')
  return {
    NoteGraph3D: ({
      nodes,
      onFocus,
      exportRequest,
      onGraphExport,
    }: {
      nodes: Array<{ name: string; relativePath: string }>
      onFocus: (path: string) => void
      exportRequest?: { id: number; format: 'svg' | 'png'; scale: number } | null
      onGraphExport?: (requestId: number, scene: unknown) => void
    }) => {
      useEffect(() => {
        if (exportRequest && onGraphExport) {
          onGraphExport(exportRequest.id, {
            width: 800,
            height: 600,
            nodes: nodes.map((node) => ({
              path: node.relativePath,
              x: 120,
              y: 120,
              radius: 6,
              color: '#82b7f2',
              label: node.name.replace(/\.md$/i, ''),
            })),
            links: [],
          })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [exportRequest])
      return (
        <div>
          {nodes.map((node) => (
            <button key={node.relativePath} type="button" onClick={() => onFocus(node.relativePath)}>
              Focar {node.relativePath.replace(/\.md$/i, '')} no 3D
            </button>
          ))}
        </div>
      )
    },
  }
})

import App from './App'
import { isNodeInViewport } from './lib/graphCulling'
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

function createTauriHarness(
  extraNotes: StoredNote[] = [],
  reviewStates: Record<string, unknown> = {},
) {
  const notes = new Map<string, StoredNote>([
    ['inicial.md', { name: 'inicial.md', relativePath: 'inicial.md', content: '---\ndescription: Inicial\nloop: &loop [*loop]\n---\n\n# Inicial\n\nTexto inicial. Veja [[alvo]], volte para [[#Inicial]] e crie [[nova/página]].\n\n**Equação Geral**\n\n$$\n6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Luz, Clorofila}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2\n$$' }],
    ['alvo.md', { name: 'alvo.md', relativePath: 'alvo.md', content: '# Alvo\n\n> [!warning]- **Aviso** *seguro*\n> Conteúdo do callout.\n\n> [!note] # Título inline\n> Sem heading no cabeçalho.\n\n- Item da lista\n  > [!tip] **Dica interna**\n  > Conteúdo aninhado.\n\n- Item multinivel\n  > Contexto comum\n  >\n  > > [!example] Exemplo profundo\n  > > Conteúdo profundo.\n\n![[inicial]]\n\n![[media/manual.pdf|Manual]]\n\n![[.obsidian/plugins/segredo.pdf|Segredo]]\n\n![Remote](https://example.com/image.png)\n\n<kbd>Ctrl K</kbd><script>danger()</script><a href="https://mirrormind.local/note/%E0%A4%A">URL quebrada</a>' }],
    ...extraNotes.map((note) => [note.relativePath, note] as const),
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
      case 'scan_vault_inventory':
        // Varredura unificada: uma unica passagem entrega o inventario completo.
        return {
          notes: [...notes.values()].map(({ name, relativePath }) => ({ name, relativePath })),
          folders: [],
          attachments: ['media/manual.pdf'],
          specialFiles: {
            files: [
              { name: 'Planejamento.canvas', relativePath: 'Planejamento.canvas', kind: 'canvas' },
              { name: 'Quadro.excalidraw', relativePath: 'desenhos/Quadro.excalidraw', kind: 'excalidraw' },
              { name: 'dados.plugin-cache', relativePath: 'dados.plugin-cache', kind: 'unknown' },
            ],
            truncated: false,
          },
          ...(inventoryDiagnostics !== undefined ? { diagnostics: inventoryDiagnostics } : {}),
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
          tagRules: vaultReviewTagRules,
          segmentation: { maxWholeNoteWords: 800 },
          updatedAtUnixMs: null,
          affectedNoteCount: 0,
        }
      case 'get_note_review_state':
        return reviewStates[args?.relativePath ?? ''] ?? null
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
      case 'read_vault_notes': {
        return [...notes.values()]
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
      case 'audit_note_structure':
        if (args?.relativePath === 'inicial.md') {
          return {
            noteWords: 40,
            unitCount: 2,
            findings: [
              {
                code: 'orphanPreamble',
                severity: 'info',
                message: 'Os paragrafos antes do primeiro título formam um preambulo sem rotulo de secao.',
                suggestion: 'De um título ao preambulo (ex.: ## Introducao) para ele virar uma secao nomeada na revisão.',
                sourceQuote: 'Texto inicial.',
                sourceStartUtf16: 59,
                sourceEndUtf16: 96,
                edit: { kind: 'insertHeadingBefore', startUtf16: 59, endUtf16: null, insert: '## Introducao\n\n', ops: null },
              },
            ],
          }
        }
        return { noteWords: 0, unitCount: 1, findings: [] }
      case 'verify_note_facts':
        if (args?.relativePath === 'inicial.md') {
          return {
            outcome: 'valid',
            sourceHash: 'sha256:teste',
            report: {
              overallSummary: '1 confirmada, 1 divergente, 1 incerta.',
              findings: [
                {
                  claim: 'A agua ferve a 100 graus ao nivel do mar.',
                  status: 'confirmed',
                  reason: 'Ponto de ebulicao padrao da agua ao nivel do mar.',
                  source: 'Termodinamica basica',
                  quote: 'A agua ferve a 100 graus.',
                },
                {
                  claim: 'A Terra e plana.',
                  status: 'divergent',
                  reason: 'Evidencia amplamente estabelecida da esfericidade.',
                  source: 'Geodesia',
                  quote: 'A Terra e plana.',
                },
                {
                  claim: 'O resultado pode variar.',
                  status: 'uncertain',
                  reason: 'Sem fonte amplamente estabelecida disponivel.',
                  source: null,
                  quote: 'O resultado pode variar.',
                },
              ],
            },
          }
        }
        return {
          outcome: 'invalid',
          sourceHash: 'sha256:teste',
          message: 'Sem afirmacoes factuais identificadas.',
          rawResponse: null,
          validationErrors: ['Nenhuma afirmacao factual encontrada.'],
        }
      case 'read_special_vault_file': {
        const relativePath = args?.relativePath ?? ''
        const payload = relativePath === 'Planejamento.canvas'
          ? { nodes: [{ id: 'a', type: 'text', text: 'No do canvas' }, { id: 'b', type: 'file', label: 'nota.md' }], edges: [] }
          : { type: 'excalidraw', elements: [{ type: 'text' }] }
        return Array.from(new TextEncoder().encode(JSON.stringify(payload)))
      }
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
    inventoryDiagnostics = undefined
    vaultReviewTagRules = []
    invokeMock.mockReset()
    listenMock.mockReset()
    listenMock.mockResolvedValue(() => undefined)
    onDragDropEventMock.mockReset()
    onDragDropEventMock.mockResolvedValue(() => undefined)
    getCurrentWindowMock.mockReset()
    getCurrentWindowMock.mockImplementation(() => ({
      onDragDropEvent: onDragDropEventMock,
      isMaximized: vi.fn(async () => false),
      onResized: vi.fn(async () => () => undefined),
      minimize: vi.fn(async () => undefined),
      toggleMaximize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    }))
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    // O drawer (vaul) chama setPointerCapture/releasePointerCapture no alvo do
    // evento ao pressionar; sem isso o clique em botao dentro do drawer lanca
    // um erro nao tratado no jsdom e o onClick nunca dispara.
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    // O grafo mede a superficie com ResizeObserver para a renderizacao
    // seletiva; o jsdom nao implementa, entao o mock entrega um tamanho fixo
    // quando a superficie 2D e observada (o corte so ativa acima do limite).
    class MockResizeObserver {
      private readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe() {
        this.callback(
          [{ contentRect: { width: 800, height: 600, x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: MockResizeObserver })
    // Exportacao do grafo: o download cria um Blob URL e clica em um <a>
    // invisivel; o jsdom nao implementa Blob URLs, entao registramos mocks.
    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:grafo-mock') })
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:grafo-mock')
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('[tags] abre a página dedicada pela barra de ferramentas', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir gerenciador de tags' }))

    expect(await screen.findByRole('heading', { name: 'Tags do vault' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar tag' })).toBeInTheDocument()
  })

  it('[diagnostico] exibe o aviso de leitura parcial e permite fecha-lo', async () => {
    const user = userEvent.setup()
    inventoryDiagnostics = {
      unreadableDirectories: ['legado'],
      unreadableFiles: [{ relativePath: 'quebrada.md', reason: 'notUtf8' }],
      renameRecoveryConflicts: ['conflito.md'],
    }
    createTauriHarness()
    await openTestVault(user)

    expect(await screen.findByText(/Leitura parcial do vault/)).toBeInTheDocument()
    expect(screen.getByText(/1 pasta ilegivel/)).toBeInTheDocument()
    expect(screen.getByText(/1 arquivo nao legivel/)).toBeInTheDocument()
    expect(screen.getByText(/1 conflito de renomeacao interrompida/)).toBeInTheDocument()
    expect(screen.getByText('Arquivo: quebrada.md')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fechar aviso de leitura parcial' }))
    expect(screen.queryByText(/Leitura parcial do vault/)).not.toBeInTheDocument()
  })

  it('[diagnostico] não exibe aviso quando o inventario esta saudavel', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await waitFor(() =>
      expect(screen.queryByText(/Leitura parcial do vault/)).not.toBeInTheDocument(),
    )
  })

  it('[metadados] mostra as tags associadas no menu integrado e remove o campo de descricao', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    // As tags vivem no menu integrado (arrow down + botao "+" da secao Tags):
    // o botao so existe com o menu aberto.
    expect(screen.queryByRole('button', { name: 'Adicionar tag' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Expandir propriedades da nota/ }))
    expect(screen.getByRole('button', { name: 'Adicionar tag' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Descricao da nota' })).not.toBeInTheDocument()
  })

  it('[auditoria estrutural] abre o painel, lista achados e aplica a sugestão no rascunho', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Auditoria estrutural da nota' }))

    expect(await screen.findByText('Os paragrafos antes do primeiro título formam um preambulo sem rotulo de secao.')).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('audit_note_structure', expect.objectContaining({ relativePath: 'inicial.md' }))

    await user.click(screen.getByRole('button', { name: 'Aplicar no rascunho' }))
    expect(screen.getByText('Aplicado no rascunho')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Edicao' }))
    expect(screen.getByRole('textbox', { name: 'Editor Markdown da nota inicial' })).toHaveTextContent('## Introducao')
  })

  it('[verificação factual] abre o painel, lista os achados e não altera a nota', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Verificar fatos da nota' }))

    expect(await screen.findByText('1 confirmada, 1 divergente, 1 incerta.')).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('verify_note_facts', expect.objectContaining({ relativePath: 'inicial.md' }))
    expect(screen.getByText('A agua ferve a 100 graus ao nivel do mar.')).toBeInTheDocument()
    expect(screen.getByText('A Terra e plana.')).toBeInTheDocument()
    expect(screen.getByText('Fonte: Termodinamica basica')).toBeInTheDocument()
    expect(screen.getByText('Divergente')).toBeInTheDocument()
    expect(screen.getByText('Incerto')).toBeInTheDocument()
  })

  it('[avaliação] adotar um perfil no popover salva a tag na nota imediatamente', async () => {
    const user = userEvent.setup()
    vaultReviewTagRules = [
      { tag: 'revisao/prova', autoEnroll: true, firstReviewIntervalDays: 1, targetRetention: 0.9, priorityWeight: 3, minIntervalDays: 1, maxIntervalDays: 90, deadlineAtUnixMs: null },
      { tag: 'revisao/manter', autoEnroll: true, firstReviewIntervalDays: 2, targetRetention: 0.8, priorityWeight: 2, minIntervalDays: 1, maxIntervalDays: 365, deadlineAtUnixMs: null },
      { tag: 'revisao/leve', autoEnroll: true, firstReviewIntervalDays: 7, targetRetention: 0.7, priorityWeight: 1, minIntervalDays: 3, maxIntervalDays: 730, deadlineAtUnixMs: null },
    ]
    const { notes } = createTauriHarness(
      [{ name: 'perfil.md', relativePath: 'perfil.md', content: '# Perfil\n\nPonto um.\n\nPonto dois.\n\nPonto tres.' }],
      {
        'perfil.md': {
          noteId: 'note-perfil',
          relativePath: 'perfil.md',
          contentHash: 'sha256:conteúdo-avaliado',
          readiness: 'ready',
          assessedAtUnixMs: 1_720_000_000_000,
          report: null,
          enrolled: false,
          preferredMode: 'exam',
          schedulingStatus: 'notScheduled',
          firstReviewAtUnixMs: null,
          nextReviewAtUnixMs: null,
          deadlineRetentionAtRisk: false,
          recoveredFromBackup: false,
        },
      },
    )
    await openTestVault(user)

    await user.click(await screen.findByRole('button', { name: 'Abrir nota perfil' }))
    await user.click(screen.getByRole('button', { name: 'Avaliação e revisão da nota' }))
    expect(await screen.findByText('Adotar perfil de revisão?')).toBeInTheDocument()

    // Adotar o perfil salva a nota imediatamente (nao fica no rascunho): a
    // tag vai para o arquivo e o backend ativa a politica/agendamento dela.
    await user.click(screen.getByRole('button', { name: /Equilibrada/ }))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({
        relativePath: 'perfil.md',
        content: expect.stringContaining('revisao/manter'),
      }))
    })
    expect(notes.get('perfil.md')?.content).toContain('revisao/manter')
  })

  it('[metadados] adicionar uma tag pelo painel de propriedades salva a nota na hora (não suja o rascunho)', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: /Expandir propriedades da nota/ }))
    await user.click(screen.getByRole('button', { name: 'Adicionar tag' }))
    const input = await screen.findByLabelText('Nome da nova tag')
    await user.type(input, 'quimica{Enter}')

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({
        relativePath: 'inicial.md',
        content: expect.stringContaining('quimica'),
      }))
    })
    expect(notes.get('inicial.md')?.content).toContain('quimica')
  })

  it('[nota nova] salva ao confirmar o título com Enter e abre a nota criada', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Nova nota' }))
    const title = await screen.findByRole('textbox', { name: 'Título da nova nota' })
    await user.type(title, 'Minha nota de regressao{Enter}')

    await waitFor(() => {
      expect(notes.get('minha-nota-de-regressao.md')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Abrir nota minha-nota-de-regressao' })).toBeInTheDocument()
    })
    expect(invokeMock).toHaveBeenCalledWith('create_note', expect.objectContaining({ relativePath: 'minha-nota-de-regressao.md' }))
    expect(invokeMock).toHaveBeenCalledWith('save_note', expect.objectContaining({ relativePath: 'minha-nota-de-regressao.md' }))
  })

  it('[atalhos] exibe os atalhos para salvar a nota e alternar o modo de visualização', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Configurações' }))
    await user.click(screen.getByRole('button', { name: 'Atalhos' }))

    expect(screen.getByRole('textbox', { name: 'Atalho para salvar nota' })).toHaveValue('Ctrl+S')
    expect(screen.getByRole('textbox', { name: 'Atalho para alternar modo de visualização' })).toHaveValue('Ctrl+M')
  })

  it('[atalhos] salva a nota e alterna o modo de visualização pelos atalhos configurados', async () => {
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

  it('[atalhos] aplica o atalho personalizado configurado na página de atalhos', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Configurações' }))
    await user.click(screen.getByRole('button', { name: 'Atalhos' }))
    const modeShortcutInput = screen.getByRole('textbox', { name: 'Atalho para alternar modo de visualização' })
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
    expect(document.querySelector('.editor-content .markdown-reading-engine')).not.toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Misto' }))
    expect(screen.getByRole('radio', { name: 'Misto' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('.editor-content .markdown-mixed')).not.toBeNull()

    // Navegacao por setas do radiogroup: direita vai para Leitura, esquerda volta para Misto.
    const control = screen.getByRole('radiogroup', { name: 'Modo de visualização da nota' })
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

    // O frontmatter YAML inicial NAO fica no topo: o bloco e ocultado no
    // documento. O resumo e a edicao estruturada ficam na barra inferior do
    // header, expandida pelo arrow down (o YAML cru nunca e exibido).
    expect(visibleText).not.toContain('description: Inicial')
    expect(document.querySelector('.markdown-mixed .cm-live-frontmatter-hidden')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: /Expandir propriedades da nota/ }))
    await waitFor(() => expect(document.querySelector('.frontmatter-menu-panel')).not.toBeNull())
    const expandedText = document.querySelector('.markdown-mixed .cm-content')?.textContent ?? ''
    expect(expandedText).not.toContain('description: Inicial')
    // As propriedades aparecem como campos estruturados do painel.
    const panelKeys = [...document.querySelectorAll('.frontmatter-panel-key')].map((input) => (input as HTMLInputElement).value)
    expect(panelKeys).toContain('description')
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

    // O motor unico renderiza a matematica com o widget KaTeX (`.cm-live-math`).
    await waitFor(() => expect(document.querySelector('.markdown-reading-engine .cm-live-math-display .katex-display')).not.toBeNull())
    expect(document.querySelector('.markdown-reading-engine .cm-live-math-display .katex-display .katex')).not.toBeNull()
  })
  it('[links internos] abre a nota vinculada no modo Leitura', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    // O widget de link do motor unico tem role=link (nao e um <button>).
    const wikiLink = await screen.findByRole('link', { name: 'alvo' })
    fireEvent.click(wikiLink)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'alvo.md' })))
    expect(await screen.findByRole('tab', { name: 'alvo.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[contador] mostra o número de palavras da nota no canto do editor', async () => {
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

    await user.click(await screen.findByRole('link', { name: 'nova/página' }))

    await waitFor(() => expect(notes.has('nova/página.md')).toBe(true))
    expect(await screen.findByRole('tab', { name: 'página.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[links internos] cria uma nota apenas uma vez em cliques concorrentes', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    const link = await screen.findByRole('link', { name: 'nova/página' })

    fireEvent.click(link)
    fireEvent.click(link)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('create_note', expect.objectContaining({ relativePath: 'nova/página.md' })))
    expect(invokeMock.mock.calls.filter(([command]) => command === 'create_note')).toHaveLength(1)
  })

  it('[links internos] navega na nota atual sem recarregar o conteúdo do disco', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    const readsBeforeClick = invokeMock.mock.calls.filter(([command]) => command === 'read_note').length

    // `[[#Inicial]]` sem caminho aponta para a nota atual e rola ate o titulo.
    fireEvent.click(await screen.findByRole('link', { name: '#Inicial' }))

    expect(invokeMock.mock.calls.filter(([command]) => command === 'read_note')).toHaveLength(readsBeforeClick)
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('[compatibilidade Obsidian] renderiza callout recolhivel e sanitiza HTML', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir nota alvo' }))
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))

    // Callout com fold: <details> recolhido por padrao; o titulo do motor
    // unico renderiza o inline (**Aviso** -> <strong>, *seguro* -> <em>).
    const calloutTitle = await screen.findByText('Aviso', { selector: 'strong' })
    expect(screen.getByText('seguro', { selector: 'em' })).toBeInTheDocument()
    const details = calloutTitle.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    await user.click(calloutTitle.closest('summary')!)
    expect(details).toHaveAttribute('open')

    // HTML inline sanitizado: <kbd> permitido, <script> removido por inteiro e
    // o <a> (href https, nao javascript:/data:) permanece como ancora.
    expect(screen.getByText('Ctrl K').tagName).toBe('KBD')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.queryByText('danger()')).not.toBeInTheDocument()
    expect(screen.getByText('URL quebrada').tagName).toBe('A')

    // Callout aninhado dentro de lista: o widget renderiza o ObsidianCallout.
    const nestedCalloutTitle = screen.getByText('Dica interna', { selector: 'strong' })
    const nestedCallout = nestedCalloutTitle.closest('.obsidian-callout')
    expect(nestedCallout).not.toBeNull()
    expect(nestedCallout).toHaveTextContent('Conteúdo aninhado.')

    // Titulo com # permanece texto (sem heading no cabecalho do callout).
    const inlineTitle = screen.getByText('# Título inline')
    expect(inlineTitle.closest('.obsidian-callout-title')?.querySelector('h1')).toBeNull()
    const deepCallout = screen.getByText('Exemplo profundo').closest('.obsidian-callout')
    expect(deepCallout).not.toBeNull()
    expect(deepCallout).toHaveTextContent('Conteúdo profundo.')

    // Embed de nota: widget de bloco com editor aninhado do mesmo motor
    // (o caminho `![[inicial]]` e normalizado para inicial.md).
    const embeddedNote = await screen.findByText((_content, element) => element?.classList?.contains('cm-line') === true && Boolean(element.textContent?.includes('Texto inicial. Veja')))
    expect(embeddedNote.closest('.cm-live-embed')).not.toBeNull()

    // PDF incorporado: o widget reutiliza o ObsidianPdfEmbed (mockado no
    // harness com os mesmos atributos do classico). Arquivos .obsidian nao
    // sao incorporados.
    const pdf = screen.getByRole('region', { name: 'PDF incorporado: Manual' })
    expect(pdf).toHaveAttribute('data-relative-path', 'media/manual.pdf')
    expect(pdf).toHaveAttribute('data-vault-path', 'C:\\Vault de testes')
    expect(screen.queryByRole('region', { name: 'PDF incorporado: Segredo' })).not.toBeInTheDocument()

    // Imagem remota.
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
    expect(dialog).toHaveTextContent('preservado sem alterações')
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

  it('[grafo] cria uma conexao pelo painel do no, anexando o wikilink e salvando', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness([
      { name: 'terceira.md', relativePath: 'terceira.md', content: '# Terceira\n\nNota isolada.' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

    // O painel do no e o drawer do grafo 3D; o mock do NoteGraph3D expoe o
    // callback de foco para abri-lo no teste.
    await user.click(screen.getByRole('radio', { name: '3D' }))
    await user.click(await screen.findByRole('button', { name: 'Focar alvo no 3D' }))
    await user.click(screen.getByRole('button', { name: 'Criar conexao' }))

    const dialog = screen.getByRole('dialog', { name: 'Criar conexao no grafo' })
    // inicial.md ja e alvo de alvo.md (embed ![[inicial]]): nao aparece.
    expect(within(dialog).queryByRole('button', { name: 'inicial' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'terceira' }))

    await waitFor(() => expect(notes.get('alvo.md')?.content).toContain('[[terceira]]'))
    expect(notes.get('alvo.md')?.content).toMatch(/^# Alvo[\s\S]*\n\n\[\[terceira\]\]\n$/)
    expect(screen.queryByRole('dialog', { name: 'Criar conexao no grafo' })).not.toBeInTheDocument()
  })

  it('[grafo] conectar a nota ativa preserva o rascunho não salvo junto com o link', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness([
      { name: 'terceira.md', relativePath: 'terceira.md', content: '# Terceira\n\nNota isolada.' },
    ])
    await openTestVault(user)

    // Cria um rascunho nao salvo na nota ativa (inicial.md) no editor misto.
    await user.click(screen.getByRole('radio', { name: 'Misto' }))
    const editorContent = document.querySelector('.markdown-mixed .cm-content') as HTMLElement
    await user.click(editorContent)
    await waitFor(() => expect(document.querySelector('.markdown-mixed .cm-editor.cm-focused')).not.toBeNull())
    // Paste de um unico bloco: digitar caractere a caractere no CodeMirror
    // perde teclas alternadas no jsdom, mas o paste e um unico input event.
    await user.click(editorContent)
    await user.paste(' com rascunho')
    await waitFor(() => expect(editorContent.textContent).toContain('com rascunho'))

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '3D' }))
    await user.click(await screen.findByRole('button', { name: 'Focar inicial no 3D' }))
    await user.click(screen.getByRole('button', { name: 'Criar conexao' }))

    const dialog = screen.getByRole('dialog', { name: 'Criar conexao no grafo' })
    await user.click(within(dialog).getByRole('button', { name: 'terceira' }))

    await waitFor(() => {
      const content = notes.get('inicial.md')?.content ?? ''
      expect(content).toContain('com rascunho')
      expect(content).toContain('[[terceira]]')
    })
  })

  it('[grafo] filtra por busca e lista apenas notas não conectadas', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'terceira.md', relativePath: 'terceira.md', content: '# Terceira\n\nNota isolada.' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Buscar nota no grafo' }), 'alvo')
    expect(screen.getByRole('button', { name: 'Abrir nota alvo no grafo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir nota inicial no grafo' })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Buscar nota no grafo' }))
    await user.click(screen.getByRole('button', { name: 'Configurações do grafo' }))
    await user.click(await screen.findByRole('checkbox', { name: /Somente notas não conectadas/ }))

    expect(screen.getByText('1 notas não conectadas')).toBeInTheDocument()
    const orphanPanel = screen.getByRole('region', { name: 'Notas não conectadas' })
    expect(within(orphanPanel).getByRole('button', { name: 'Conectar' })).toBeInTheDocument()
    expect(within(orphanPanel).getByRole('button', { name: 'Revelar' })).toBeInTheDocument()
  })

  it('[grafo] conecta uma nota isolada pela lista de não conectadas', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness([
      { name: 'terceira.md', relativePath: 'terceira.md', content: '# Terceira\n\nNota isolada.' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Configurações do grafo' }))
    await user.click(await screen.findByRole('checkbox', { name: /Somente notas não conectadas/ }))

    const orphanPanel = screen.getByRole('region', { name: 'Notas não conectadas' })
    await user.click(within(orphanPanel).getByRole('button', { name: 'Conectar' }))
    const dialog = screen.getByRole('dialog', { name: 'Criar conexao no grafo' })
    await user.click(within(dialog).getByRole('button', { name: 'alvo' }))

    await waitFor(() => expect(notes.get('terceira.md')?.content).toContain('[[alvo]]'))
    await waitFor(() => expect(screen.getByText('0 notas não conectadas')).toBeInTheDocument())
  })

  it('[grafo] revela uma nota orfa no explorador expandindo as pastas ancestrais', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'anotada.md', relativePath: 'pasta/anotada.md', content: '# Anotada\n\nNota em pasta.' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Configurações do grafo' }))
    await user.click(await screen.findByRole('checkbox', { name: /Somente notas não conectadas/ }))

    const orphanPanel = screen.getByRole('region', { name: 'Notas não conectadas' })
    await user.click(within(orphanPanel).getByRole('button', { name: 'Revelar' }))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'anotada.md' })).toHaveAttribute('aria-selected', 'true'))
    expect(document.querySelector('.tree-folder')?.hasAttribute('open')).toBe(true)
    expect(document.querySelector('.tree-note.is-active')).toHaveTextContent('anotada')
  })

  it('[grafo] grafo local por profundidade inclui vizinhos ate N saltos e informa o limite', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'quarta.md', relativePath: 'quarta.md', content: '# Quarta\n\nVeja [[alvo]].' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

    // Local com 1 salto a partir da nota ativa (inicial): inicial e alvo apenas.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Modo do grafo' }), 'local')
    expect(screen.getByRole('button', { name: 'Abrir nota alvo no grafo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir nota quarta no grafo' })).not.toBeInTheDocument()
    expect(screen.getByText(/Grafo local limitado: 1 nota esta alem de 1 salto/)).toBeInTheDocument()

    // 2 saltos: quarta entra e o aviso de limite desaparece.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Profundidade do grafo local' }), '2')
    expect(screen.getByRole('button', { name: 'Abrir nota quarta no grafo' })).toBeInTheDocument()
    expect(screen.queryByText(/Grafo local limitado/)).not.toBeInTheDocument()
  })

  it('[grafo] agrupa por pasta com legenda de cores e persiste a preferência', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'quimica.md', relativePath: 'Notas/quimica.md', content: '# Quimica\n\nMateria de ciencia.' },
      { name: 'fisica.md', relativePath: 'Notas/fisica.md', content: '# Fisica\n\nOutra materia.' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

    // Sem agrupamento: nenhuma legenda.
    expect(screen.queryByLabelText('Legenda das pastas do grafo')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Configurações do grafo' }))
    const groupToggle = await screen.findByRole('checkbox', { name: 'Agrupar por pasta' })
    await user.click(groupToggle)

    // Legenda com a raiz primeiro e a pasta em ordem alfabetica, com contagem.
    const legend = await screen.findByLabelText('Legenda das pastas do grafo')
    const rows = within(legend).getAllByText(/^(Raiz|Notas)$/)
    expect(rows.map((row) => row.textContent)).toEqual(['Raiz', 'Notas'])
    const notasRow = within(legend).getByText('Notas').closest('.graph-group-legend-row') as HTMLElement
    expect(within(notasRow).getByText('2')).toBeInTheDocument() // Notas: 2 notas

    // O toggle e persistido por Vault (localStorage).
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('mirrormind.graph.C:\\Vault de testes') ?? '{}')
      expect(stored.groupByFolder).toBe(true)
    })
  })

  it('[bases] lista notas com as propriedades do frontmatter como colunas, ordena, filtra e abre a nota', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'quimica.md', relativePath: 'Notas/quimica.md', content: '---\nárea: Ciencia\nnivel: 2\ntags:\n  - estudo\n  - prova\n---\n\n# Quimica' },
      { name: 'fisica.md', relativePath: 'Notas/fisica.md', content: '---\nárea: Ciencia\nnivel: 1\n---\n\n# Fisica' },
      { name: 'diario.md', relativePath: 'Diarios/diario.md', content: '---\nárea: Pessoal\n---\n\n# Diario' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir tabela de notas' }))
    expect(await screen.findByRole('heading', { name: 'Tabela de notas' })).toBeInTheDocument()

    // Colunas dinamicas: nome + propriedades na ordem de primeira aparicao
    // (inicial.md vem antes e contribui description e loop).
    const table = await screen.findByRole('region', { name: 'Tabela de notas' })
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual(['Nota', 'description', 'loop', 'área', 'nivel', 'tags'])
    expect(within(table).getByText('quimica')).toBeInTheDocument()
    // Duas notas de Ciencia (quimica e fisica) mais nenhuma outra.
    expect(within(table).getAllByText('Ciencia')).toHaveLength(2)
    expect(within(table).getByText('estudo, prova')).toBeInTheDocument()

    // Ordena pela coluna nivel (ascendente: fisica 1, quimica 2; sem valor no fim).
    await user.click(screen.getByRole('button', { name: /Ordenar por nivel/ }))
    const rows = within(table).getAllByRole('row')
    // Cabeçalho + 5 linhas: a de menor nivel vem logo apos o cabecalho.
    expect(within(rows[1]).getByText('fisica')).toBeInTheDocument()
    expect(within(rows[2]).getByText('quimica')).toBeInTheDocument()

    // Filtro por valor de propriedade.
    await user.type(screen.getByRole('searchbox', { name: 'Filtrar linhas da tabela' }), 'pessoal')
    expect(await within(table).findByText('diario')).toBeInTheDocument()
    expect(within(table).queryByText('quimica')).not.toBeInTheDocument()

    // Abrir a nota pela linha: o workspace volta para a nota e a aba fica ativa.
    await user.click(within(table).getByText('diario'))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'Diarios/diario.md' })))
    expect(screen.getByRole('tab', { name: 'diario.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('[grafo] agrupa por tag com tag principal e cores configuraveis persistidas por Vault', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'quimica.md', relativePath: 'Notas/quimica.md', content: '---\ntags: [quimica, projeto]\n---\n\n# Quimica' },
      { name: 'fisica.md', relativePath: 'Notas/fisica.md', content: '---\ntags: [fisica, projeto]\n---\n\n# Fisica' },
      { name: 'diario.md', relativePath: 'Diarios/diario.md', content: '---\ntags: [diario]\n---\n\n# Diario' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Configurações do grafo' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Agrupar por tag' }))

    // Legenda com a primeira tag de cada nota, em ordem alfabetica
    // (o extrator ordena as tags; quimica = projeto primeiro).
    const legend = await screen.findByLabelText('Legenda das tags do grafo')
    const names = within(legend).getAllByText(/^(Sem tag|#.+)$/)
    expect(names.map((name) => name.textContent)).toEqual(['Sem tag', '#diario', '#fisica', '#projeto'])
    const projetoRow = within(legend).getByText('#projeto').closest('.graph-group-legend-row') as HTMLElement
    expect(within(projetoRow).getByText('1')).toBeInTheDocument() // projeto: so a nota quimica

    // Tag principal: ao escolher 'quimica', a nota quimica sai de #projeto
    // (e o grupo #projeto desaparece, pois so tinha essa nota).
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tag principal do agrupamento por tag' }), 'quimica')
    const grouped = await within(legend).findAllByText(/^#(projeto|diario|fisica|quimica)$/)
    expect(grouped.map((name) => name.textContent)).toEqual(['#diario', '#fisica', '#quimica'])
    expect(within(legend).queryByText('#projeto')).not.toBeInTheDocument()
    const quimicaRow = within(legend).getByText('#quimica').closest('.graph-group-legend-row') as HTMLElement
    expect(within(quimicaRow).getByText('1')).toBeInTheDocument() // quimica: so a nota quimica

    // Cor configuravel: muda a cor do grupo #quimica e verifica o swatch.
    const colorInput = within(screen.getByLabelText('Cores dos grupos')).getByLabelText('Cor do grupo #quimica')
    fireEvent.change(colorInput, { target: { value: '#ff00ff' } })
    await waitFor(() => {
      const swatch = quimicaRow.querySelector('.graph-group-legend-swatch') as HTMLElement
      expect(swatch).toHaveStyle({ background: '#ff00ff' })
    })

    // Preferencias persistidas por Vault (localStorage), incluindo a cor.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('mirrormind.graph.C:\\Vault de testes') ?? '{}')
      expect(stored.groupByTag).toBe(true)
      expect(stored.primaryTag).toBe('quimica')
      expect(stored.colorOverrides).toMatchObject({ quimica: '#ff00ff' })
    })
  })

  it('[grafo] persiste o layout por Vault e restaura as posicoes salvas', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    // Layout salvo anteriormente PARA ESTE Vault (posicoes customizadas).
    localStorage.setItem('mirrormind.graph.C:\\Vault de testes', JSON.stringify({
      positions: { 'inicial.md': { x: 24, y: 68 }, 'alvo.md': { x: 132, y: 156 } },
      viewport: { scale: 1, x: 0, y: 0 },
    }))
    // Outro Vault com o proprio layout: nao pode vazar para este.
    localStorage.setItem('mirrormind.graph.C:\\Outro Vault', JSON.stringify({
      positions: { 'outra.md': { x: 99, y: 99 } },
    }))
    // Congela o rAF: a simulacao ambiente do 2D nao sobrescreve as posicoes
    // restauradas durante o teste (o assert e sobre a restauracao, nao a fisica).
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    try {
      await openTestVault(user)
      await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
      expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

      // Os nos renderizam exatamente nas posicoes salvas para este Vault
      // (posicoes em unidades do mundo 0-200, renderizadas em % da superficie).
      expect(screen.getByRole('button', { name: 'Abrir nota inicial no grafo' })).toHaveStyle({ left: '12%', top: '34%' })
      expect(screen.getByRole('button', { name: 'Abrir nota alvo no grafo' })).toHaveStyle({ left: '66%', top: '78%' })

      // O layout e re-gravado sob a chave do Vault atual e o de outro Vault
      // permanece intocado (chave por Vault).
      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('mirrormind.graph.C:\\Vault de testes') ?? '{}')
        expect(stored.positions?.['inicial.md']).toBeDefined()
        expect(stored.positions?.['alvo.md']).toBeDefined()
      })
      expect(JSON.parse(localStorage.getItem('mirrormind.graph.C:\\Outro Vault') ?? '{}').positions).toEqual({ 'outra.md': { x: 99, y: 99 } })
    } finally {
      raf.mockRestore()
    }
  })

  // O ambiente do grafo 2D roda num Web Worker; o jsdom nao tem Worker, entao
  // instalamos um fake para exercitar o caminho do worker (onde acontecia o
  // bug: ao assentar, o transform px residual somava ao left % que o React
  // escreve a cada render e os nos se desprendiam das arestas, espalhados).
  // Verifica que, apos o ambient-settled, os nos ficam SO em left/top %.
  it('[grafo] após a simulacao ambiente do worker assentar, os nos não ficam com transform px residual', async () => {
    const user = userEvent.setup()
    createTauriHarness()

    type WorkerMessage = { type: string; requestId: number; positions?: Record<string, { x: number; y: number }> }
    type FakeWorkerInstance = {
      onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
      postMessage: ReturnType<typeof vi.fn>
    }
    const workers: FakeWorkerInstance[] = []
    class FakeWorker {
      onmessage: FakeWorkerInstance['onmessage'] = null
      onerror: (() => void) | null = null
      postMessage = vi.fn()
      terminate = vi.fn()
      constructor() {
        workers.push(this as unknown as FakeWorkerInstance)
      }
    }
    vi.stubGlobal('Worker', FakeWorker)
    // O worker posiciona por transform px somente com o tamanho da superficie
    // conhecido; o jsdom devolve clientWidth/Height = 0, entao mockamos.
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
    try {
      await openTestVault(user)
      await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
      await screen.findByRole('heading', { name: 'Grafo das notas' })

      // O worker recebe o ambient-start (big bang ao abrir o grafo).
      await waitFor(() => expect(workers).toHaveLength(1))
      const ambientStart = workers[0].postMessage.mock.calls
        .map((call) => call[0] as WorkerMessage)
        .find((message) => message.type === 'ambient-start')
      expect(ambientStart).toBeDefined()
      const { requestId } = ambientStart!

      const inicialNode = screen.getByRole('button', { name: 'Abrir nota inicial no grafo' })
      const alvoNode = screen.getByRole('button', { name: 'Abrir nota alvo no grafo' })

      // Um passo do worker: posiciona por left 0 + transform px (caminho com
      // tamanho de superficie conhecido). Posicoes em unidades do mundo 0-200:
      // 20/200 da superficie 800px = 80px.
      const stepPositions = { 'inicial.md': { x: 40, y: 60 }, 'alvo.md': { x: 140, y: 160 } }
      workers[0].onmessage?.({ data: { type: 'ambient-step', requestId, positions: stepPositions } } as unknown as MessageEvent<WorkerMessage>)
      expect(inicialNode.style.left).toBe('0px')
      expect(inicialNode.style.transform).toContain('translate(160px, 180px)')

      // Assentou: persiste o layout e zera o requestId — o React passa a
      // posicionar por left/top % e o transform px residual precisa sumir
      // (era ele que desprendia os nos das arestas).
      workers[0].onmessage?.({ data: { type: 'ambient-settled', requestId, positions: stepPositions } } as unknown as MessageEvent<WorkerMessage>)
      await waitFor(() => {
        expect(inicialNode).toHaveStyle({ left: '20%', top: '30%' })
      })
      expect(inicialNode.style.transform).toBe('')
      expect(alvoNode).toHaveStyle({ left: '70%', top: '80%' })
      expect(alvoNode.style.transform).toBe('')
    } finally {
      vi.unstubAllGlobals()
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
      }
    }
  })

  // Arrastar um no que NAO e o mais conectado nao pode teleportar o hub (no
  // com mais conexoes) para o ponto da soltura: o no arrastado permanece onde
  // foi solto e os vizinhos assentam ao redor dele.
  it('[grafo] arrastar um no não-hub não teleporta o hub para o ponto da soltura', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'hub.md', relativePath: 'hub.md', content: '# Hub\n\nVeja [[inicial]] e [[leaf]].' },
      { name: 'leaf.md', relativePath: 'leaf.md', content: '# Leaf\n\nVeja [[hub]].' },
    ])
    // Layout inicial deterministico: hub com mais conexoes (liga inicial e
    // leaf), leaf liga apenas ao hub. O viewport salvo (escala 1, sem pan)
    // evita o auto-fit ao abrir, mantendo a conversao cursor->mundo exata.
    localStorage.setItem('mirrormind.graph.C:\\Vault de testes', JSON.stringify({
      positions: { 'hub.md': { x: 100, y: 100 }, 'leaf.md': { x: 150, y: 100 } },
      viewport: { scale: 1, x: 0, y: 0 },
    }))
    // Controle dos frames da fisica: o rAF nao roda sozinho (o jsdom nao
    // avanca frames); o teste bombeia frames manualmente e controla o relogio
    // (performance.now) para a simulacao ambiente e o assentamento assentarem.
    const rafCallbacks: FrameRequestCallback[] = []
    let nowMs = 0
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    const cancelRaf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const performanceNow = vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    // Captura o timeout de 120ms que iniciaria a simulacao ambiente (big bang)
    // ao abrir o grafo e o cancela antes do arrasto: o teste controla a
    // fisica apenas pelo rAF bombeado manualmente, entao o ambiente nao
    // interfere nas posicoes do hub.
    const originalSetTimeout = window.setTimeout.bind(window)
    const pendingTimeouts: number[] = []
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number) => {
      // Mantem o comportamento normal (waitFor/userEvent dependem de
      // setTimeout), mas expoe o id para o teste cancelar o timeout do
      // ambiente (big bang) antes do arrasto.
      const id = originalSetTimeout(handler, timeout)
      pendingTimeouts.push(id as unknown as number)
      return id as unknown as number
    }) as unknown as typeof window.setTimeout)
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const pumpFrames = (count: number) => {
      for (let frame = 0; frame < count; frame += 1) {
        const callback = rafCallbacks.shift()
        if (!callback) break
        nowMs += 16
        callback(nowMs)
      }
    }
    // Durante a simulacao ativa (coast), as posicoes sao escritas no DOM por
    // transform translate(px); ao assentar, o React re-renderiza com
    // left/top %. Le a posicao atual de um no em ambos os formatos.
    const nodeWorldPx = (element: HTMLElement) => {
      const transform = element.style.transform
      if (transform && transform !== 'none') {
        const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(transform)
        if (match) return { x: Number(match[1]), y: Number(match[2]) }
      }
      return { x: (parseFloat(element.style.left) / 100) * 800, y: (parseFloat(element.style.top) / 100) * 600 }
    }
    try {
      await openTestVault(user)
      await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
      expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

      // A simulacao ambiente (big bang) fica CONGELADA (setTimeout cancelado
      // e nenhum frame bombeado antes do arrasto): os nos permanecem nas
      // posicoes salvas acima, tornando o baseline deterministico.
      const hubNode = await screen.findByRole('button', { name: 'Abrir nota hub no grafo' })
      const leafNode = screen.getByRole('button', { name: 'Abrir nota leaf no grafo' })
      const hubBaseline = nodeWorldPx(hubNode)
      const leafBaseline = nodeWorldPx(leafNode)
      for (const id of pendingTimeouts) window.clearTimeout(id)
      pendingTimeouts.length = 0
      rafCallbacks.length = 0

      // Arrasta o no leaf (nao-hub) para outro ponto da superficie e solta.
      fireEvent.pointerDown(leafNode, { pointerId: 1, clientX: 150, clientY: 100 })
      fireEvent.pointerMove(leafNode, { pointerId: 1, clientX: 150, clientY: 200 })
      pumpFrames(5)
      fireEvent.pointerUp(leafNode, { pointerId: 1, clientX: 150, clientY: 200 })
      // Assentamento pos-soltura: bombeia frames ate o loop parar (o layout
      // final e persistido em graphNodeOverrides e o React re-renderiza).
      pumpFrames(1000)

      await waitFor(() => {
        const hubAfter = nodeWorldPx(hubNode)
        const leafAfter = nodeWorldPx(leafNode)
        // O arrasto efetivamente moveu o no leaf para outro ponto.
        expect(Math.hypot(leafAfter.x - leafBaseline.x, leafAfter.y - leafBaseline.y)).toBeGreaterThan(50)
        // O hub NAO e reposicionado para o ponto da soltura: fica longe do no
        // arrastado (era o teleporte do bug, que os sobrepunha exatamente).
        expect(Math.hypot(hubAfter.x - leafAfter.x, hubAfter.y - leafAfter.y)).toBeGreaterThan(30)
        // E o hub nao abandonou a regiao onde estava: mudanca bem menor que o
        // movimento do no arrastado (sem teleporte para o drop).
        expect(Math.hypot(hubAfter.x - hubBaseline.x, hubAfter.y - hubBaseline.y)).toBeLessThan(
          Math.hypot(leafAfter.x - leafBaseline.x, leafAfter.y - leafBaseline.y),
        )
      })
    } finally {
      raf.mockRestore()
      cancelRaf.mockRestore()
      performanceNow.mockRestore()
      setTimeoutSpy.mockRestore()
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
      }
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('[grafo] renderiza todas as notas de um vault grande com a contagem correta', async () => {
    const user = userEvent.setup()
    const extraNotes = Array.from({ length: 60 }, (_, index) => {
      const name = `nota-${String(index).padStart(2, '0')}.md`
      return { name, relativePath: `pastas/${name}`, content: `# Nota ${index}\n\nConteúdo ${index}.\n\n[[inicial]]` }
    })
    createTauriHarness(extraNotes)
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

    expect(screen.getByText('62 notas')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Abrir nota .* no grafo$/ })).toHaveLength(62)
  })

  // Timeout proprio: a leitura dos 92 notas do segundo lote leva 500ms e o
  // harness completo (abertura de vault + grafo) passa de 5s em maquinas
  // lentas, estourando o timeout padrao sem falha de logica.
  it('[grafo] le o vault com a leitura unificada e reutiliza o cache ao abrir', async () => {
    const user = userEvent.setup()
    const extraNotes = Array.from({ length: 240 }, (_, index) => {
      const name = `nota-${String(index).padStart(3, '0')}.md`
      return { name, relativePath: `pastas/${name}`, content: `# Nota ${index}\n\nConteúdo ${index}.` }
    })
    createTauriHarness(extraNotes)
    await openTestVault(user)

    // A indexacao em segundo plano leu tudo em UMA chamada unificada; aguarda
    // ela concluir para o cache de conteudos estar populado.
    const vaultPath = 'C:\\Vault de testes'
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_vault_notes', expect.objectContaining({ path: vaultPath })))
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    const unifiedReadsBeforeOpen = invokeMock.mock.calls.filter(([command]) => command === 'read_vault_notes').length

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()
    expect(screen.getByText('242 notas')).toBeInTheDocument()
    // O grafo REUTILIZOU o cache da indexacao: abrir o grafo nao releu NADA
    // (nem a leitura unificada, nem read_note por nota).
    expect(invokeMock.mock.calls.filter(([command]) => command === 'read_vault_notes')).toHaveLength(unifiedReadsBeforeOpen)
    // Nenhum read_note por nota no carregamento em massa: a leitura unificada
    // substituiu as N chamadas por nota (as pastas/ so apareceriam nesse fluxo).
    const bulkNoteReads = invokeMock.mock.calls.filter(([command, args]) =>
      command === 'read_note'
      && typeof (args as { relativePath?: string } | undefined)?.relativePath === 'string'
      && (args as { relativePath?: string }).relativePath!.startsWith('pastas/'),
    )
    expect(bulkNoteReads).toHaveLength(0)
  }, 30_000)

  it('[grafo] resume a renderizacao acima do limite com aviso e contagem parcial', async () => {
    const user = userEvent.setup()
    const extraNotes = Array.from({ length: 60 }, (_, index) => {
      const name = `nota-${String(index).padStart(2, '0')}.md`
      return { name, relativePath: `pastas/${name}`, content: `# Nota ${index}\n\nConteúdo ${index}.` }
    })
    createTauriHarness(extraNotes)
    // Limite valido (>= 50) abaixo do total de 62 nos: a renderizacao e cortada.
    localStorage.setItem('mirrormind.graph2d.render-limit', '50')
    // Posicoes espalhadas + viewport deslocado: apenas parte dos 62 nos cai
    // no viewport 800x600 (entregue pelo ResizeObserver mockado).
    const allPaths = ['inicial.md', 'alvo.md', ...extraNotes.map((note) => note.relativePath)]
    const positions: Record<string, { x: number; y: number }> = {}
    allPaths.forEach((path, index) => {
      positions[path] = path === 'inicial.md' ? { x: 50, y: 50 } : { x: (index * 37) % 100, y: 50 }
    })
    const viewport = { scale: 2, x: -500, y: -100 }
    localStorage.setItem('mirrormind.graph.C:\\Vault de testes', JSON.stringify({ positions, viewport }))
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    try {
      await openTestVault(user)
      await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
      expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

      const expected = allPaths.filter((path) => isNodeInViewport(positions[path], viewport, { width: 800, height: 600 })).length
      expect(expected).toBeGreaterThan(0)
      expect(expected).toBeLessThan(allPaths.length)
      expect(screen.getByText(`${expected} de 62 notas`)).toBeInTheDocument()
      const warning = screen.getByText(/Grafo resumido/)
      expect(warning.textContent).toMatch(/exibindo \d+ de 62 nos no viewport \(limite de 50\)/)
      expect(screen.getAllByRole('button', { name: /^Abrir nota .* no grafo$/ })).toHaveLength(expected)
    } finally {
      raf.mockRestore()
    }
  })

  it('[grafo] sem resumo quando o limite cobre o total', async () => {
    const user = userEvent.setup()
    const extraNotes = Array.from({ length: 60 }, (_, index) => {
      const name = `nota-${String(index).padStart(2, '0')}.md`
      return { name, relativePath: `pastas/${name}`, content: `# Nota ${index}\n\nConteúdo ${index}.` }
    })
    createTauriHarness(extraNotes)
    localStorage.setItem('mirrormind.graph2d.render-limit', '500')
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    try {
      await openTestVault(user)
      await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
      expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

      expect(screen.getByText('62 notas')).toBeInTheDocument()
      expect(screen.queryByText(/Grafo resumido/)).not.toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /^Abrir nota .* no grafo$/ })).toHaveLength(62)
    } finally {
      raf.mockRestore()
    }
  })

  it('[grafo] exporta o grafo 2D como SVG e como PNG com resolução escolhida', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'quimica.md', relativePath: 'Notas/quimica.md', content: '# Quimica\n\nVeja [[alvo]].' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    // SVG: download disparado com nome .svg.
    await user.click(screen.getByRole('button', { name: 'Exportar grafo' }))
    await user.click(await screen.findByRole('button', { name: 'Exportar grafo como SVG' }))
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    const svgAnchor = clickSpy.mock.instances.at(-1) as HTMLAnchorElement
    expect(svgAnchor.download).toMatch(/\.svg$/)
    expect(URL.createObjectURL).toHaveBeenCalled()

    // PNG com resolucao 2x: sem canvas no jsdom, cai no fallback sem download.
    await user.click(screen.getByRole('button', { name: 'Exportar grafo' }))
    const scaleSelect = await screen.findByRole('combobox', { name: 'Resolução do PNG exportado' })
    await user.selectOptions(scaleSelect, '2')
    await user.click(screen.getByRole('button', { name: 'Exportar grafo como PNG' }))
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    expect(clickSpy).toHaveBeenCalledTimes(1) // apenas o SVG
  })

  it('[grafo] exporta a cena 3D projetada como SVG pelo pedido ao componente', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir grafo das notas' }))
    expect(await screen.findByRole('heading', { name: 'Grafo das notas' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '3D' }))

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await user.click(screen.getByRole('button', { name: 'Exportar grafo' }))
    await user.click(await screen.findByRole('button', { name: 'Exportar grafo como SVG' }))

    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    const svgAnchor = clickSpy.mock.instances.at(-1) as HTMLAnchorElement
    expect(svgAnchor.download).toMatch(/\.svg$/)
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

  it('[autosave] persiste alterações da nota após a pausa de digitacao', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Edicao' }))
    const editor = screen.getByRole('textbox', { name: 'Editor Markdown da nota inicial' })
    await user.click(editor)
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste(' Resumo-atualizado')

    expect(screen.getByText('Alterações pendentes')).toBeInTheDocument()

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

  it('[frontmatter] cria uma propriedade estruturada pelo painel integrado (sem YAML cru)', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    await openTestVault(user)

    // O arrow down da barra inferior do header abre o menu integrado — nunca
    // mostra o YAML cru (o bloco fica oculto no documento).
    const arrowDown = await screen.findByRole('button', { name: /Expandir propriedades da nota/ })
    await user.click(arrowDown)
    await waitFor(() => expect(document.querySelector('.frontmatter-panel')).not.toBeNull())
    expect(document.querySelector('.cm-content')?.textContent ?? '').not.toContain('title:')

    // Nova propriedade "review" com valor YAML multilinha (objeto aninhado),
    // adicionada pelo popover de propriedades comuns (telefone → phone) e
    // digitada livremente. A gravacao e ao vivo (sem botao Aplicar).
    await user.click(screen.getByRole('button', { name: 'Nova propriedade' }))
    await user.click(await screen.findByRole('button', { name: /Telefone/ }))
    const keyInputs = screen.getAllByLabelText(/Nome da propriedade/)
    await user.clear(keyInputs[keyInputs.length - 1]!)
    await user.type(keyInputs[keyInputs.length - 1]!, 'review')
    const valueInputs = screen.getAllByLabelText(/Valor YAML/)
    await user.type(valueInputs[valueInputs.length - 1]!, 'interval: 7{enter}repetitions: 3')

    await waitFor(() => {
      expect(notes.get('inicial.md')?.content).toContain('review:\n  interval: 7\n  repetitions: 3')
    }, { timeout: 3_000 })
  })

  it('[frontmatter] arrow down do cabeçalho abre o painel integrado com as tags da nota', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    // Nota com tags no frontmatter: o painel deve mostra-las na secao de Tags
    // (mesma implementacao das tags abaixo do titulo).
    notes.set('inicial.md', {
      name: 'inicial.md',
      relativePath: 'inicial.md',
      content: '---\ntitle: Inicial\ntags:\n  - biologia\n  - prova\n---\n\n# Inicial\n\nTexto inicial.',
    })
    await openTestVault(user)

    // Sem YAML cru no topo: o painel abre pelo arrow down do cabecalho.
    expect(document.querySelector('.cm-content')?.textContent ?? '').not.toContain('title:')
    const arrowDown = screen.getByRole('button', { name: 'Expandir propriedades da nota' })
    expect(arrowDown).toHaveAttribute('aria-expanded', 'false')
    await user.click(arrowDown)
    await waitFor(() => expect(document.querySelector('.frontmatter-panel')).not.toBeNull())
    expect(arrowDown).toHaveAttribute('aria-expanded', 'true')

    // Secao de Tags: badges das tags do frontmatter (como abaixo do titulo),
    // e a propriedade `tags` NAO vira uma linha crua do formulario.
    const tagBadges = [...document.querySelectorAll('.frontmatter-panel-tag-row .ui-badge')].map((badge) => badge.textContent)
    expect(tagBadges).toEqual(['#biologia', '#prova'])
    const panelKeys = [...document.querySelectorAll('.frontmatter-panel-key')].map((input) => (input as HTMLInputElement).value)
    expect(panelKeys).toContain('title')
    expect(panelKeys).not.toContain('tags')

    // Arrow down novamente recolhe o painel (o YAML continua oculto no doc).
    await user.click(arrowDown)
    await waitFor(() => expect(document.querySelector('.frontmatter-panel')).toBeNull())
    expect(document.querySelector('.cm-live-frontmatter-hidden')).not.toBeNull()
  })

  it('[frontmatter] remove uma tag pelo X dentro da badge e grava ao vivo', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    localStorage.setItem('mirrormind.auto-save', 'true')
    notes.set('inicial.md', {
      name: 'inicial.md',
      relativePath: 'inicial.md',
      content: '---\ntitle: Inicial\ntags:\n  - biologia\n  - prova\n---\n\n# Inicial\n\nTexto inicial.',
    })
    await openTestVault(user)

    const arrowDown = await screen.findByRole('button', { name: 'Expandir propriedades da nota' })
    await user.click(arrowDown)
    await waitFor(() => expect(document.querySelector('.frontmatter-panel')).not.toBeNull())

    // O X vive DENTRO da badge (a direita do nome); clicar remove a tag da
    // nota (gravacao ao vivo, sem YAML cru em lugar nenhum).
    const badge = await screen.findByText('#biologia')
    const removeButton = await screen.findByRole('button', { name: 'Remover tag biologia' })
    expect(badge.contains(removeButton)).toBe(true)
    await user.click(removeButton)

    await waitFor(() => {
      expect(notes.get('inicial.md')?.content).toContain('tags:\n  - prova')
      expect(notes.get('inicial.md')?.content).not.toContain('biologia')
    }, { timeout: 3_000 })
    expect(document.querySelector('.cm-content')?.textContent ?? '').not.toContain('biologia')
  })

  it('[mudanca externa] preserva e restaura o rascunho de uma nota removida', async () => {
    const user = userEvent.setup()
    const { notes } = createTauriHarness()
    let fileSystemListener: ((event: { payload: { requestId: number; kind: string; paths: string[] } }) => void) | undefined
    listenMock.mockImplementation(async (eventName, listener) => {
      if (eventName === 'vault-file-system-change') fileSystemListener = listener
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
    listenMock.mockImplementation(async (eventName, listener) => {
      if (eventName === 'vault-file-system-change') fileSystemListener = listener
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
    const control = screen.getByRole('radiogroup', { name: 'Exibição das lacunas da última revisão' })
    expect(control).toBeInTheDocument()

    // Padrao configurado: sempre visiveis -> a secao do motor unico tem
    // has-gap-marks, as decoracoes de lacuna (.cm-live-gap) e os badges de
    // pontuacao por paragrafo da ultima revisao.
    const section = document.querySelector('.markdown-reading-engine')
    expect(section?.className).toContain('has-gap-marks')
    await waitFor(() => expect(section?.querySelectorAll('.cm-live-gap').length).toBeGreaterThan(0))
    expect(section?.querySelectorAll('.review-unit-score').length).toBeGreaterThan(0)

    // Hover-only: a secao marca is-gap-hover-only e mantem marcas e badges no DOM.
    await user.click(screen.getByRole('radio', { name: 'Lacunas somente no hover' }))
    expect(section?.className).toContain('is-gap-hover-only')
    expect(section?.querySelectorAll('.cm-live-gap').length).toBeGreaterThan(0)
    expect(section?.querySelectorAll('.review-unit-score').length).toBeGreaterThan(0)

    // Desativado: sem classe de lacunas, sem marcas e sem badges.
    await user.click(screen.getByRole('radio', { name: 'Lacunas desativadas' }))
    expect(section?.className).not.toContain('has-gap-marks')
    expect(section?.querySelectorAll('.cm-live-gap').length).toBe(0)
    expect(section?.querySelectorAll('.review-unit-score').length).toBe(0)
  })

  it('[lacunas] o modo Leitura (motor unico) e o proprio Misto read-only com as lacunas', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    localStorage.setItem('mirrormind.review-gap-mode', 'always')
    await openTestVault(user)

    await user.click(screen.getByRole('radio', { name: 'Leitura' }))

    // O Leitura agora e o proprio Misto read-only: secao do motor unico com o
    // editor CodeMirror (nao o article ReactMarkdown do classico) e as
    // decoracoes (marca no texto + badge de pontuacao) com os mesmos dados
    // do classico (get_note_review_gaps/get_note_review_units da inicial.md).
    const engineSection = document.querySelector('.markdown-reading-engine')
    expect(engineSection?.querySelector('.codemirror-markdown-editor')).not.toBeNull()
    expect(engineSection?.className).toContain('has-gap-marks')
    await waitFor(() => expect(engineSection?.querySelectorAll('.cm-live-gap').length).toBeGreaterThan(0))
    expect(engineSection?.querySelectorAll('.review-unit-score').length).toBeGreaterThan(0)
  })

  it('[busca na nota] Ctrl+F abre o campo flutuante com contador e navegação por setas', async () => {
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

    // Muda para Leitura: o conteudo e o motor unico read-only (CodeMirror,
    // sem o article ReactMarkdown do classico).
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))
    expect(document.querySelector('.markdown-reading-engine')).not.toBeNull()

    // Ctrl+F disparado sobre o corpo da nota abre a barra SEM trocar de modo.
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    const findInput = await screen.findByRole('textbox', { name: 'Buscar na nota' })
    expect(findInput).toHaveFocus()
    expect(document.querySelector('.markdown-reading-engine')).not.toBeNull()

    // O contador reflete as correspondencias no DOM renderizado: o frontmatter
    // nao esta no doc do Leitura (noteBody) e a sintaxe nao conta (3 em vez
    // de 4 no texto-fonte com frontmatter).
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
    expect(document.querySelector('.markdown-reading-engine')).not.toBeNull()
  })

  it('[busca na nota] Ctrl+F no modo Edicao abre a barra do app (não o painel nativo do CodeMirror)', async () => {
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

  it('[popover de formatacao] aparece sobre a seleção, aplica negrito e fecha com Escape', async () => {
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

  it('[aparência] alterna o tema escuro, aplica no documento e persiste a preferência', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(await screen.findByRole('heading', { name: 'Configurações do vault' })).toBeInTheDocument()

    // Menu lateral navega entre as sessoes (destaque acompanha o clique).
    const nav = screen.getByRole('navigation', { name: 'Seções das configurações' })
    expect(within(nav).getByRole('button', { name: 'Revisão' })).toBeInTheDocument()
    await user.click(within(nav).getByRole('button', { name: 'Revisão' }))
    expect(within(nav).getByRole('button', { name: 'Revisão' })).toHaveAttribute('aria-current', 'true')

    // Padrao claro; muda para Escuro e o atributo do documento acompanha.
    expect(document.documentElement.dataset.theme).toBe('light')
    await user.click(screen.getByRole('radio', { name: 'Escuro' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    await waitFor(() => expect(localStorage.getItem('mirrormind.appearance.theme')).toBe('dark'))

    // Fonte e historico sao configuraveis e persistidos (fireEvent para
    // evitar a disputa entre o clamp por tecla e o valor digitado).
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tamanho da fonte do editor e da leitura' }), { target: { value: '19' } })
    await waitFor(() => expect(localStorage.getItem('mirrormind.appearance.font-size')).toBe('19'))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Limite do histórico de desfazer e refazer' }), { target: { value: '250' } })
    await waitFor(() => expect(localStorage.getItem('mirrormind.appearance.history-limit')).toBe('250'))

    // Volta para Claro e o atributo acompanha de novo.
    await user.click(screen.getByRole('radio', { name: 'Claro' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })

  it('[aparência] renderiza blocos Dataview e Tasks somente leitura no modo Leitura', async () => {
    const user = userEvent.setup()
    createTauriHarness([
      { name: 'blocos.md', relativePath: 'blocos.md', content: '# Blocos\n\n```dataview\nTABLE título FROM #estudo\n```\n\n```tasks\n- [ ] Tarefa pendente\n- [x] Tarefa feita\n```' },
    ])
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: 'Abrir nota blocos' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_note', expect.objectContaining({ relativePath: 'blocos.md' })))
    await user.click(screen.getByRole('radio', { name: 'Leitura' }))

    // Dataview: card somente leitura com a consulta preservada.
    expect(await screen.findByRole('region', { name: 'Bloco Dataview' })).toBeInTheDocument()
    expect(screen.getByText('TABLE título FROM #estudo')).toBeInTheDocument()

    // Tasks: lista de tarefas com o estado dos checkboxes e texto.
    const tasksCard = screen.getByRole('region', { name: 'Bloco Tasks' })
    expect(within(tasksCard).getByText('Tarefa pendente')).toBeInTheDocument()
    expect(within(tasksCard).getByText('Tarefa feita')).toBeInTheDocument()

    // A fonte da nota nunca e alterada pela visualizacao: o codigo cru do
    // bloco (com os marcadores de tarefa) permanece no pre do card.
    expect(within(tasksCard).getByText(/- \[ \] Tarefa pendente/)).toBeInTheDocument()
    expect(within(tasksCard).getByText(/- \[x\] Tarefa feita/)).toBeInTheDocument()
  })

  it('[aparência] visualiza Canvas pela lista de arquivos especiais sem editar', async () => {
    const user = userEvent.setup()
    createTauriHarness()
    await openTestVault(user)

    await user.click(screen.getByRole('button', { name: /Ver .* arquivos com compatibilidade limitada/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Arquivos com compatibilidade limitada' })

    await user.click(within(dialog).getByRole('button', { name: 'Visualizar Planejamento.canvas' }))
    const viewer = await screen.findByRole('dialog', { name: 'Visualizar Planejamento.canvas' })
    expect(within(viewer).getByText('No do canvas')).toBeInTheDocument()
    expect(within(viewer).getByText('nota.md')).toBeInTheDocument()
    // O dialogo de lista continua fechado por cima do visualizador.
    expect(within(viewer).getByText(/somente leitura/)).toBeInTheDocument()

    await user.click(within(viewer).getByRole('button', { name: 'Fechar visualização do arquivo especial' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Visualizar Planejamento.canvas' })).not.toBeInTheDocument())
  })
})
