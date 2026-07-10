import { useEffect, useEffectEvent, useState } from 'react'
import type { ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { BuilderModeControl } from './components/BuilderModeControl'
import {
  DEFAULT_WORKSPACE_SHORTCUTS,
  formatShortcut,
  matchesShortcut,
  type WorkspaceShortcuts,
} from './lib/keyboard-shortcuts'
import type {
  CreateNoteForm,
  CreateVaultForm,
  HistoryStatus,
  NoteDocument,
  NotePreview,
  NoteTreeNode,
  RecentVaultPreference,
  VaultSummary,
} from './lib/vault'
import {
  buildNoteTree,
  buildVaultPathPreview,
  formatNoteTitleAsPath,
  formatVaultNameError,
  getVaultModeLabel,
  parseNoteDocument,
  parseNoteList,
  parseHistoryStatus,
  parseRecentVaultPreference,
  parseVaultSummary,
  suggestVaultName,
} from './lib/vault'
import './App.css'

function App() {
  const [vault, setVault] = useState<VaultSummary | null>(null)
  const [notes, setNotes] = useState<NotePreview[]>([])
  const [activeNote, setActiveNote] = useState<NoteDocument | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [draftContent, setDraftContent] = useState('')
  const [isNewNoteDraft, setIsNewNoteDraft] = useState(false)
  const [draftsByPath, setDraftsByPath] = useState<Record<string, string>>({})
  const [recentVaultPreference, setRecentVaultPreference] =
    useState<RecentVaultPreference | null>(null)
  const [showRecentVaultModal, setShowRecentVaultModal] = useState(false)
  const [skipRecentVaultPrompt, setSkipRecentVaultPrompt] = useState(false)
  const [isSidebarExpanded, setSidebarExpanded] = useState(true)
  const [isBuilderModeEnabled, setBuilderModeEnabled] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const [workspacePage, setWorkspacePage] = useState<'notes' | 'shortcuts' | 'settings'>('notes')
  const [shortcuts, setShortcuts] = useState<WorkspaceShortcuts>(() => {
    try {
      return { ...DEFAULT_WORKSPACE_SHORTCUTS, ...JSON.parse(localStorage.getItem('mirrormind.shortcuts') ?? '{}') }
    } catch {
      return DEFAULT_WORKSPACE_SHORTCUTS
    }
  })
  const [isAutoSaveEnabled, setAutoSaveEnabled] = useState(
    () => localStorage.getItem('mirrormind.auto-save') === 'true',
  )
  const [showNoteSearch, setShowNoteSearch] = useState(false)
  const [noteSearchQuery, setNoteSearchQuery] = useState('')
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({ canUndo: false, canRedo: false })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Escolha um vault existente ou crie um do zero.')
  const [createForm, setCreateForm] = useState<CreateVaultForm>({
    parentPath: '',
    name: suggestVaultName(),
  })
  const [createNoteForm, setCreateNoteForm] = useState<CreateNoteForm>({
    title: '',
  })

  const isDirty = activeNote !== null && draftContent !== activeNote.content
  const handleVaultSelection = useEffectEvent(async (selectedVault: VaultSummary) => {
    await refreshNotes(selectedVault.path)
  })
  const handleWorkspaceShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return
    }

    if (!vault || (!event.ctrlKey && !event.metaKey)) {
      return
    }

    if (event.key.toLowerCase() === 's' && activeNote && isDirty) {
      event.preventDefault()
      void saveActiveNote()
    }

    if (event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        void redoLastCommand()
      } else {
        void undoLastCommand()
      }
    }

    if (matchesShortcut(event, shortcuts.createNote)) {
      event.preventDefault()
      startNewNote()
    }

    if (matchesShortcut(event, shortcuts.openNote)) {
      event.preventDefault()
      setShowNoteSearch(true)
      setNoteSearchQuery('')
    }
  })
  const handleRecentVaultStartup = useEffectEvent(async () => {
    try {
      const preferencePayload = await invoke<unknown>('get_recent_vault_preference')
      const preference = parseRecentVaultPreference(preferencePayload)
      setRecentVaultPreference(preference)

      if (!preference.lastVaultPath) {
        return
      }

      if (preference.askBeforeReopen) {
        setShowRecentVaultModal(true)
        return
      }

      await reopenRecentVault()
    } catch {
      setStatus('Escolha um vault existente ou crie um do zero.')
    }
  })
  const runAutoSave = useEffectEvent(() => {
    void saveActiveNote()
  })

  useEffect(() => {
    if (!vault) {
      setNotes([])
      setActiveNote(null)
      setOpenTabs([])
      setDraftContent('')
      setDraftsByPath({})
      return
    }

    void handleVaultSelection(vault)
  }, [vault])

  useEffect(() => {
    window.addEventListener('keydown', handleWorkspaceShortcut)
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut)
  }, [])

  useEffect(() => {
    void handleRecentVaultStartup()
  }, [])

  useEffect(() => {
    localStorage.setItem('mirrormind.shortcuts', JSON.stringify(shortcuts))
  }, [shortcuts])

  useEffect(() => {
    localStorage.setItem('mirrormind.auto-save', String(isAutoSaveEnabled))
  }, [isAutoSaveEnabled])

  useEffect(() => {
    if (
      isAutoSaveEnabled &&
      activeNote &&
      isDirty &&
      !saving &&
      (!isNewNoteDraft || Boolean(formatNoteTitleAsPath(createNoteForm.title)))
    ) {
      runAutoSave()
    }
  }, [
    activeNote,
    createNoteForm.title,
    draftContent,
    isAutoSaveEnabled,
    isDirty,
    isNewNoteDraft,
    saving,
  ])

  async function chooseExistingVault() {
    setError(null)
    setLoading(true)
    setStatus('Lendo a estrutura do vault selecionado...')

    try {
      const loadedVault = await invoke<unknown>('select_existing_vault')

      if (!loadedVault) {
        setStatus('Selecao cancelada.')
        return
      }

      const parsedVault = parseVaultSummary(loadedVault)
      setVault(parsedVault)
      setStatus(`Vault carregado: ${parsedVault.name}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Nao foi possivel abrir o vault.'
      setVault(null)
      setError(message)
      setStatus('Falha ao abrir o vault.')
    } finally {
      setLoading(false)
    }
  }

  async function reopenRecentVault() {
    setError(null)
    setLoading(true)
    setStatus('Reabrindo o ultimo vault usado...')

    try {
      const vaultPayload = await invoke<unknown>('reopen_recent_vault')
      if (!vaultPayload) {
        setStatus('O ultimo vault nao esta mais disponivel. Escolha outra pasta.')
        return
      }

      const parsedVault = parseVaultSummary(vaultPayload)
      setVault(parsedVault)
      setStatus(`Vault reaberto: ${parsedVault.name}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Nao foi possivel reabrir o ultimo vault.'
      setError(message)
      setStatus('Escolha um vault existente ou crie um do zero.')
    } finally {
      setLoading(false)
    }
  }

  async function updateRecentVaultPromptPreference(askBeforeReopen: boolean) {
    await invoke('set_recent_vault_prompt_preference', { askBeforeReopen })
    setRecentVaultPreference((currentPreference) =>
      currentPreference ? { ...currentPreference, askBeforeReopen } : currentPreference,
    )
  }

  async function confirmRecentVault() {
    try {
      if (skipRecentVaultPrompt) {
        await updateRecentVaultPromptPreference(false)
      }
      setShowRecentVaultModal(false)
      await reopenRecentVault()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel salvar a preferencia.')
    }
  }

  async function dismissRecentVault() {
    try {
      if (skipRecentVaultPrompt) {
        await updateRecentVaultPromptPreference(false)
      }
      setShowRecentVaultModal(false)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel salvar a preferencia.')
    }
  }

  async function chooseVaultParent() {
    setError(null)
    const selected = await invoke<string | null>('select_vault_parent')

    if (!selected) {
      return
    }

    setCreateForm((currentForm) => ({
      ...currentForm,
      parentPath: selected,
    }))
  }

  async function createVault() {
    const nameError = formatVaultNameError(createForm.name)

    if (!createForm.parentPath) {
      setError('Escolha a pasta onde o novo vault sera criado.')
      return
    }

    if (nameError) {
      setError(nameError)
      return
    }

    setError(null)
    setLoading(true)
    setStatus('Criando vault local e preparando metadados do MirrorMind...')

    try {
      const createdVault = await invoke<unknown>('create_vault', {
        parentPath: createForm.parentPath,
        name: createForm.name.trim(),
      })

      const parsedVault = parseVaultSummary(createdVault)
      setVault(parsedVault)
      setStatus(`Vault criado em ${parsedVault.path}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Nao foi possivel criar o vault.'
      setVault(null)
      setError(message)
      setStatus('Falha ao criar o vault.')
    } finally {
      setLoading(false)
    }
  }

  async function initializeMetadata() {
    if (!vault) {
      return
    }

    setError(null)
    setLoading(true)
    setStatus('Inicializando a pasta .mirmind e seus metadados...')

    try {
      const initializedVault = await invoke<unknown>('initialize_vault_metadata', {
        path: vault.path,
      })

      setVault(parseVaultSummary(initializedVault))
      setStatus('Metadados inicializados. Este vault ja pode receber revisoes.')
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel inicializar os metadados.'
      setError(message)
      setStatus('Falha ao preparar o vault para revisoes.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshNotes(vaultPath: string) {
    setLoading(true)
    setError(null)

    try {
      const notePayload = await invoke<unknown>('list_notes', {
        path: vaultPath,
      })
      const nextNotes = parseNoteList(notePayload)
      setNotes(nextNotes)

      if (nextNotes.length === 0) {
        setActiveNote(null)
        setDraftContent('')
        setStatus('Vault carregado. Crie sua primeira nota.')
        return
      }

      const selectedPath = activeNote?.relativePath
      const stillExists = selectedPath
        ? nextNotes.find((note) => note.relativePath === selectedPath)
        : null
      const nextActive = stillExists ?? nextNotes[0]

      await openNote(nextActive.relativePath, vaultPath)
      setStatus(`Workspace pronto com ${nextNotes.length} nota(s).`)
      void refreshHistoryStatus(vaultPath)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Nao foi possivel carregar as notas.'
      setError(message)
      setStatus('Falha ao carregar a lista de notas do vault.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshHistoryStatus(vaultPath: string) {
    const payload = await invoke<unknown>('get_history_status', { path: vaultPath })
    setHistoryStatus(parseHistoryStatus(payload))
  }

  async function undoLastCommand() {
    if (!vault || !historyStatus.canUndo) return
    const payload = await invoke<unknown>('undo_last_command', { path: vault.path })
    setHistoryStatus(parseHistoryStatus(payload))
    await refreshNotes(vault.path)
  }

  async function redoLastCommand() {
    if (!vault || !historyStatus.canRedo) return
    const payload = await invoke<unknown>('redo_last_command', { path: vault.path })
    setHistoryStatus(parseHistoryStatus(payload))
    await refreshNotes(vault.path)
  }

  async function openNote(relativePath: string, vaultPathOverride?: string) {
    const targetVaultPath = vaultPathOverride ?? vault?.path

    if (!targetVaultPath) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const notePayload = await invoke<unknown>('read_note', {
        path: targetVaultPath,
        relativePath,
      })
      const parsedNote = parseNoteDocument(notePayload)
      if (activeNote) {
        setDraftsByPath((currentDrafts) => ({
          ...currentDrafts,
          [activeNote.relativePath]: draftContent,
        }))
      }
      setActiveNote(parsedNote)
      setOpenTabs((currentTabs) =>
        currentTabs.includes(parsedNote.relativePath)
          ? currentTabs
          : [...currentTabs, parsedNote.relativePath],
      )
      setDraftContent(draftsByPath[parsedNote.relativePath] ?? parsedNote.content)
      setStatus(`Editando ${parsedNote.relativePath}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Nao foi possivel abrir a nota.'
      setError(message)
      setStatus('Falha ao abrir a nota selecionada.')
    } finally {
      setLoading(false)
    }
  }

  async function saveActiveNote() {
    if (!vault || !activeNote) {
      return
    }

    if (isNewNoteDraft) {
      const relativePath = formatNoteTitleAsPath(createNoteForm.title)
      if (!relativePath) {
        setError('Defina um titulo valido antes de salvar a nova nota.')
        return
      }

      setSaving(true)
      try {
        const createdPayload = await invoke<unknown>('create_note', { path: vault.path, relativePath })
        const createdNote = parseNoteDocument(createdPayload)
        const savedPayload = await invoke<unknown>('save_note', {
          path: vault.path,
          relativePath: createdNote.relativePath,
          content: draftContent,
        })
        const savedNote = parseNoteDocument(savedPayload)
        setActiveNote(savedNote)
        setOpenTabs((tabs) => tabs.map((tab) => (tab === '__new_note__' ? savedNote.relativePath : tab)))
        setIsNewNoteDraft(false)
        setCreateNoteForm({ title: '' })
        await refreshNotes(vault.path)
      } finally {
        setSaving(false)
      }
      return
    }

    setSaving(true)
    setError(null)
    setStatus(`Salvando ${activeNote.relativePath}...`)

    try {
      const notePayload = await invoke<unknown>('save_note', {
        path: vault.path,
        relativePath: activeNote.relativePath,
        content: draftContent,
      })
      const parsedNote = parseNoteDocument(notePayload)
      setActiveNote(parsedNote)
      setDraftContent(parsedNote.content)
      setDraftsByPath((currentDrafts) => {
        const { [parsedNote.relativePath]: _discardedDraft, ...remainingDrafts } = currentDrafts
        return remainingDrafts
      })
      setStatus(`Nota salva: ${parsedNote.relativePath}`)
      await refreshNotes(vault.path)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Nao foi possivel salvar a nota.'
      setError(message)
      setStatus('Falha ao salvar a nota atual.')
    } finally {
      setSaving(false)
    }
  }

  function startNewNote() {
    setSidebarExpanded(true)
    setWorkspacePage('notes')
    setCreateNoteForm({ title: '' })
    setActiveNote({ name: 'Nova nota', relativePath: '__new_note__', content: '' })
    setOpenTabs((tabs) => (tabs.includes('__new_note__') ? tabs : [...tabs, '__new_note__']))
    setDraftContent('')
    setIsNewNoteDraft(true)
    setStatus('Defina o titulo da nova nota.')
    requestAnimationFrame(() => document.getElementById('note-title-input')?.focus())
  }

  function closeTab(relativePath: string) {
    setOpenTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tabPath) => tabPath !== relativePath)

      if (activeNote?.relativePath === relativePath) {
        const fallbackPath = nextTabs.at(-1)
        if (fallbackPath) {
          void openNote(fallbackPath)
        } else {
          setActiveNote(null)
          setDraftContent('')
        }
      }

      return nextTabs
    })
  }

  function renderTree(nodes: NoteTreeNode[], depth = 0): ReactNode {
    return (
      <ul className="tree-list" data-depth={depth}>
        {nodes.map((node) => (
          <li key={node.id}>
            {node.type === 'folder' ? (
              <details
                className="tree-folder"
                open={expandedFolderIds.has(node.id)}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open
                  setExpandedFolderIds((currentIds) => {
                    const nextIds = new Set(currentIds)
                    if (isOpen) {
                      nextIds.add(node.id)
                    } else {
                      nextIds.delete(node.id)
                    }
                    return nextIds
                  })
                }}
              >
                <summary title={`Pasta ${node.name}`}>
                  <Folder className="tree-icon tree-icon--folder-closed" size={14} strokeWidth={1.5} aria-hidden="true" />
                  <FolderOpen className="tree-icon tree-icon--folder-open" size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span>{node.name}</span>
                </summary>
                {node.children?.length ? renderTree(node.children, depth + 1) : null}
              </details>
            ) : (
              <button
                type="button"
                className={`tree-note${node.path === activeNote?.relativePath ? ' is-active' : ''}`}
                onClick={() => void openNote(node.path)}
                disabled={loading || saving}
                title={`Abrir nota ${node.name}`}
              >
                <span className="tree-icon tree-icon--note" aria-hidden="true">&#128196;</span>
                <span>{node.name.replace(/\.md$/i, '')}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    )
  }

  if (vault) {
    const noteTree = buildNoteTree(notes)
    const matchingNotes = notes.filter((note) =>
      note.name.toLowerCase().includes(noteSearchQuery.trim().toLowerCase()),
    )

    return (
      <main
        className={`workspace-shell${isSidebarExpanded ? ' is-sidebar-expanded' : ' is-sidebar-collapsed'}`}
        data-builder-name="workspace-shell"
      >
        <aside className="workspace-rail" aria-label="Ferramentas do workspace" data-builder-name="workspace-rail">
          <button
            type="button"
            className="rail-button"
            onClick={() => setSidebarExpanded((isExpanded) => !isExpanded)}
            aria-label={isSidebarExpanded ? 'Recolher barra lateral' : 'Expandir barra lateral'}
            aria-expanded={isSidebarExpanded}
            title={isSidebarExpanded ? 'Recolher barra lateral' : 'Expandir barra lateral'}
          >
            <span className="rail-icon" aria-hidden="true">&#9776;</span>
            <span className="rail-label">Menu</span>
          </button>
          <button
            type="button"
            className={`rail-button${workspacePage === 'notes' ? ' is-active' : ''}`}
            onClick={() => setWorkspacePage('notes')}
            aria-label="Voltar para notas"
            title="Notas"
          >
            <span className="rail-icon" aria-hidden="true">&#9998;</span>
            <span className="rail-label">Notas</span>
          </button>
          <button type="button" className="rail-button" onClick={() => void undoLastCommand()} disabled={!historyStatus.canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
            <span className="rail-icon" aria-hidden="true">Undo</span>
            <span className="rail-label">Desfazer</span>
          </button>
          <button type="button" className="rail-button" onClick={() => void redoLastCommand()} disabled={!historyStatus.canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
            <span className="rail-icon" aria-hidden="true">Redo</span>
            <span className="rail-label">Refazer</span>
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => setWorkspacePage('shortcuts')}
            aria-label="Ver atalhos"
            title="Atalhos"
          >
            <span className="rail-icon" aria-hidden="true">&#9000;</span>
            <span className="rail-label">Atalhos</span>
          </button>
          <button
            type="button"
            className="rail-button rail-button--bottom"
            onClick={() => setWorkspacePage('settings')}
            aria-label="Configuracoes"
            title="Configuracoes"
          >
            <span className="rail-icon" aria-hidden="true">&#9881;</span>
            <span className="rail-label">Configuracoes</span>
          </button>
        </aside>
        <header className="workspace-topbar">
          <div>
            <p className="eyebrow">Vault ativo</p>
            <h1 className="workspace-title">{vault.name}</h1>
          </div>
          <div className="workspace-actions">
            {!vault.metadata.isInitialized ? (
              <button
                type="button"
                className="secondary-button"
                onClick={initializeMetadata}
                disabled={loading || saving}
              >
                Inicializar .mirmind
              </button>
            ) : null}
            <button type="button" className="secondary-button" onClick={chooseExistingVault} disabled={loading || saving}>
              Trocar vault
            </button>
          </div>
        </header>

        <div className="status-strip workspace-status" role="status" data-builder-name="workspace-status">
          <span className={`status-dot${loading || saving ? ' is-busy' : ''}`}></span>
          <span>{status}</span>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <section className="workspace-grid">
          <aside className="notes-sidebar" data-builder-name="notes-sidebar">
            <div className="sidebar-block">
              <p className="card-kicker">Overview</p>
              <ul className="sidebar-metrics">
                <li>
                  <span>Notas</span>
                  <strong>{notes.length}</strong>
                </li>
                <li>
                  <span>Modo</span>
                  <strong>{getVaultModeLabel(vault)}</strong>
                </li>
                <li>
                  <span>Metadados</span>
                  <strong>{vault.metadata.isInitialized ? 'Prontos' : 'Pendentes'}</strong>
                </li>
              </ul>
            </div>

            <div className="sidebar-block sidebar-block--stretch">
              <div className="sidebar-section-header">
                <div>
                  <p className="card-kicker">Notas do vault</p>
                  <h2>Navegacao</h2>
                </div>
                <div className="explorer-actions">
                  <button type="button" className="secondary-button" onClick={startNewNote} title="Nova nota" aria-label="Nova nota">
                    <span aria-hidden="true">&#9998;</span>
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setStatus('Criacao de pastas sera adicionada em breve.')} title="Nova pasta" aria-label="Nova pasta">
                    <FolderPlus size={15} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setStatus('As notas estao ordenadas por nome.')} title="Ordenacao" aria-label="Ordenacao">
                    <span aria-hidden="true">&#8645;</span>
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void refreshNotes(vault.path)} disabled={loading || saving} title="Atualizar explorador" aria-label="Atualizar explorador de arquivos">
                    <span className="explorer-refresh-icon" aria-hidden="true">&#10227;</span>
                  </button>
                </div>
              </div>
              <div className="workspace-tree">
                {noteTree.length > 0 ? (
                  renderTree(noteTree)
                ) : (
                  <p className="empty-sidebar-state">
                    Nenhuma nota encontrada. Crie a primeira para abrir o editor.
                  </p>
                )}
              </div>
            </div>
            <footer className="vault-indicator" title={vault.path}>
              <span className="vault-indicator-icon" aria-hidden="true">&#9670;</span>
              <span>{vault.name}</span>
            </footer>
          </aside>

          <section className="editor-surface" data-builder-name="editor-surface">
            {workspacePage === 'notes' ? (
              <>
            <div className="tab-strip" data-builder-name="tab-strip">
              {openTabs.length > 0 ? (
                openTabs.map((tabPath) => {
                  const tabName = tabPath === '__new_note__' ? 'Nova nota' : notes.find((note) => note.relativePath === tabPath)?.name ?? tabPath
                  return (
                    <div
                      key={tabPath}
                      className={`tab-chip${tabPath === activeNote?.relativePath ? ' is-active' : ''}`}
                    >
                      <button
                        type="button"
                        className="tab-select"
                        onClick={() => void openNote(tabPath)}
                        disabled={loading || saving}
                      >
                        {tabName}
                      </button>
                      <button
                        type="button"
                        className="tab-close"
                        onClick={() => closeTab(tabPath)}
                        disabled={loading || saving}
                        aria-label={`Fechar ${tabName}`}
                      >
                        ×
                      </button>
                    </div>
                  )
                })
              ) : (
                <p className="empty-tabs">As notas abertas aparecerao aqui em abas.</p>
              )}
            </div>

            {activeNote ? (
              <>
                <div className="editor-header">
                  <div>
                    <p className="card-kicker">Editando agora</p>
                    {isNewNoteDraft ? (
                      <input
                        id="note-title-input"
                        className="editor-title-input"
                        value={createNoteForm.title}
                        onChange={(event) => setCreateNoteForm({ title: event.target.value })}
                        placeholder="Titulo da nota"
                        aria-label="Titulo da nova nota"
                      />
                    ) : (
                      <h2>{activeNote.name}</h2>
                    )}
                    <p className="editor-path">{activeNote.relativePath}</p>
                  </div>
                  <button
                    type="button"
                    onClick={saveActiveNote}
                    disabled={saving || loading || !isDirty}
                  >
                    {saving ? 'Salvando...' : isDirty ? 'Salvar nota' : 'Nota salva'}
                  </button>
                </div>

                <div className="editor-grid">
                  <label className="editor-panel">
                    <span className="card-kicker">Markdown</span>
                    <textarea
                      value={draftContent}
                      onChange={(event) => {
                        const nextContent = event.target.value
                        setDraftContent(nextContent)
                        if (activeNote) {
                          setDraftsByPath((currentDrafts) => ({
                            ...currentDrafts,
                            [activeNote.relativePath]: nextContent,
                          }))
                        }
                      }}
                      placeholder="Escreva sua nota em Markdown..."
                    />
                  </label>

                  <article className="editor-panel editor-preview">
                    <span className="card-kicker">Leitura rapida</span>
                    <pre>{draftContent || 'O conteudo da nota aparecera aqui enquanto voce escreve.'}</pre>
                  </article>
                </div>
              </>
            ) : (
              <div className="editor-empty-state">
                <p className="card-kicker">Workspace pronto</p>
                <h2>Escolha uma nota ou crie a primeira.</h2>
                <p>
                  Assim que uma nota for aberta, esta area vira o editor principal do vault com
                  salvamento direto em <code>.md</code>.
                </p>
              </div>
            )}
              </>
            ) : workspacePage === 'shortcuts' ? (
              <section className="workspace-page" data-builder-name="shortcuts-page">
                <p className="card-kicker">Atalhos</p>
                <h2>Comandos do workspace</h2>
                <p>Selecione um campo e pressione a nova combinacao de teclas.</p>
                <div className="shortcut-settings">
                  <label>
                    <span>
                      <strong>Criar nova nota</strong>
                      <small>Abre a captura de uma nova nota no explorador.</small>
                    </span>
                    <input
                      value={shortcuts.createNote}
                      onKeyDown={(event) => {
                        event.preventDefault()
                        setShortcuts((current) => ({ ...current, createNote: formatShortcut(event.nativeEvent) }))
                      }}
                      aria-label="Atalho para criar nova nota"
                      readOnly
                    />
                  </label>
                  <label>
                    <span>
                      <strong>Abrir nota existente</strong>
                      <small>Abre a busca rapida de notas do vault.</small>
                    </span>
                    <input
                      value={shortcuts.openNote}
                      onKeyDown={(event) => {
                        event.preventDefault()
                        setShortcuts((current) => ({ ...current, openNote: formatShortcut(event.nativeEvent) }))
                      }}
                      aria-label="Atalho para abrir nota existente"
                      readOnly
                    />
                  </label>
                </div>
                <button type="button" className="secondary-button" onClick={() => setShortcuts(DEFAULT_WORKSPACE_SHORTCUTS)}>
                  Restaurar padroes
                </button>
              </section>
            ) : (
              <section className="workspace-page" data-builder-name="settings-page">
                <p className="card-kicker">Configuracoes</p>
                <h2>Configuracoes do vault</h2>
                <p>Opcoes do vault e do sistema de revisao aparecerao aqui.</p>
                <label className="settings-toggle">
                  <span>
                    <strong>Auto Save</strong>
                    <small>Salva a nota automaticamente a cada alteracao.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={isAutoSaveEnabled}
                    onChange={(event) => setAutoSaveEnabled(event.target.checked)}
                  />
                </label>
              </section>
            )}
          </section>
        </section>
        {showNoteSearch ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal" role="dialog" aria-modal="true" aria-label="Abrir nota existente">
              <input
                autoFocus
                value={noteSearchQuery}
                onChange={(event) => setNoteSearchQuery(event.target.value)}
                placeholder="Digite o nome da nota..."
                aria-label="Pesquisar nota"
              />
              <div className="note-search-results">
                {matchingNotes.map((note) => (
                  <button
                    key={note.relativePath}
                    type="button"
                    onClick={() => {
                      setShowNoteSearch(false)
                      setWorkspacePage('notes')
                      void openNote(note.relativePath)
                    }}
                  >
                    <span>{note.name}</span>
                    <small>{note.relativePath}</small>
                  </button>
                ))}
                {matchingNotes.length === 0 ? <p>Nenhuma nota encontrada.</p> : null}
              </div>
            </section>
          </div>
        ) : null}
        <BuilderModeControl enabled={isBuilderModeEnabled} onEnabledChange={setBuilderModeEnabled} />
      </main>
    )
  }

  return (
    <main className="app-shell vault-selection-shell" data-builder-name="vault-selection-shell">
      <aside className="vault-selection-rail" aria-label="MirrorMind" data-builder-name="vault-selection-rail">
        <span className="vault-selection-mark">MM</span>
        <span className="vault-selection-rail-label">Vaults</span>
      </aside>
      <section className="hero-panel">
        <p className="eyebrow">MirrorMind desktop alpha</p>
        <h1>Vault local, notas em Markdown e base pronta para revisar conhecimento.</h1>
        <p className="hero-copy">
          Esta V1 abre um vault real do computador, entende arquivos Markdown de um vault do
          Obsidian e separa os metadados internos do app em <code>.mirmind/</code>.
        </p>
        <div className="status-strip" role="status">
          <span className={`status-dot${loading ? ' is-busy' : ''}`}></span>
          <span>{status}</span>
        </div>
      </section>

      <section className="vault-grid" data-builder-name="vault-selection-actions">
        <article className="action-card">
          <div className="card-header">
            <span className="card-kicker">Modo 01</span>
            <h2>Abrir vault existente</h2>
          </div>
          <p>
            Selecione uma pasta ja existente no computador. O app vai reconhecer notas
            <code>.md</code> e detectar se o vault ja veio do Obsidian.
          </p>
          <button type="button" onClick={chooseExistingVault} disabled={loading}>
            Escolher pasta
          </button>
        </article>

        <article className="action-card action-card--accent">
          <div className="card-header">
            <span className="card-kicker">Modo 02</span>
            <h2>Criar novo vault</h2>
          </div>
          <p>Crie um vault novo do zero com a pasta de metadados do MirrorMind pronta.</p>
          <label className="field">
            <span>Nome do vault</span>
            <input
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((currentForm) => ({
                  ...currentForm,
                  name: event.target.value,
                }))
              }
              placeholder="Ex.: Vault de Aprendizado"
            />
          </label>
          <div className="field">
            <span>Pasta pai</span>
            <button
              type="button"
              className="secondary-button"
              onClick={chooseVaultParent}
              disabled={loading}
            >
              {createForm.parentPath ? 'Trocar pasta' : 'Escolher pasta pai'}
            </button>
            <small>{buildVaultPathPreview(createForm.parentPath, createForm.name)}</small>
          </div>
          <button type="button" onClick={createVault} disabled={loading}>
            Criar vault
          </button>
        </article>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="vault-panel">
        <div className="panel-header">
          <div>
            <p className="card-kicker">Objetivo da V1</p>
            <h2>Abrir o vault e cair direto no editor.</h2>
          </div>
        </div>

        <p className="empty-state">
          Depois de selecionar uma pasta ou criar um novo vault, o app agora entra na interface de
          notas e salva diretamente em arquivos <code>.md</code>.
        </p>
      </section>

      {showRecentVaultModal && recentVaultPreference?.lastVaultPath ? (
        <div className="recent-vault-backdrop" role="presentation">
          <section
            className="recent-vault-modal"
            data-builder-name="recent-vault-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recent-vault-title"
          >
            <p className="card-kicker">Continuar de onde parou</p>
            <h2 id="recent-vault-title">Usar o ultimo vault?</h2>
            <p>
              O MirrorMind encontrou o vault usado anteriormente em{' '}
              <code>{recentVaultPreference.lastVaultPath}</code>.
            </p>
            <label className="recent-vault-checkbox">
              <input
                type="checkbox"
                checked={skipRecentVaultPrompt}
                onChange={(event) => setSkipRecentVaultPrompt(event.target.checked)}
              />
              <span>Nao perguntar novamente e abrir este vault automaticamente.</span>
            </label>
            <div className="recent-vault-actions">
              <button type="button" className="secondary-button" onClick={() => void dismissRecentVault()}>
                Escolher outro vault
              </button>
              <button type="button" onClick={() => void confirmRecentVault()}>
                Usar este vault
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <BuilderModeControl enabled={isBuilderModeEnabled} onEnabledChange={setBuilderModeEnabled} />
    </main>
  )
}

export default App
