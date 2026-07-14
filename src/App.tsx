import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { EditorState } from '@codemirror/state'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Bold, CheckSquare, ChevronDown, Code2, Eye, Filter, Folder, FolderInput, FolderOpen, FolderPlus, GripHorizontal, Hash, Heading1, Heading2, Heading3, Italic, Link, List, ListFilter, ListOrdered, Minus, PanelLeft, PanelTop, Paperclip, Pencil, Plus, Quote, Redo2, RefreshCw, RotateCcw, Search, Star, Table2, TextCursorInput, TextQuote, Trash2, Undo2, X } from 'lucide-react'
import { BsLayoutSidebarInset, BsLayoutSidebarInsetReverse } from 'react-icons/bs'
import { CiStickyNote } from 'react-icons/ci'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BuilderModeControl } from './components/BuilderModeControl'
import { MarkdownCodeEditor } from './components/MarkdownCodeEditor'
import type { MarkdownCodeEditorHandle, MarkdownEditorHistoryStatus, MarkdownEditorSession } from './components/MarkdownCodeEditor'
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
  formatDailyNotePath,
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
import { extractMarkdownTags, formatMarkdownSelection, getMarkdownBody, getMarkdownDescription, getMarkdownFrontmatterProperties, getMarkdownFrontmatterSource, getMarkdownPreviewText, parseFrontmatterPropertiesInput, renderWikiLinksAsMarkdown, replaceMarkdownBody, setMarkdownDescription, setMarkdownFrontmatterProperties, splitMarkdownBlocks, toggleChecklistAtLine, transformMarkdownTable, type FrontmatterValue, type MarkdownFormat, type MarkdownTableAction } from './lib/markdown'

type TrashItem = {
  id: string
  originalRelativePath: string
  trashedName: string
  itemType: 'note' | 'folder'
  deletedAtDay: number
}

type Attachment = {
  name: string
  relativePath: string
  isImage: boolean
}

type Backlink = {
  name: string
  relativePath: string
}

type BrokenLink = {
  target: string
  sourceName: string
  sourceRelativePath: string
}

type WikiLinkPreview = {
  relativePath: string
  title: string
  summary: string
}

type ExternalNoteConflict = {
  externalNote: NoteDocument
  localContent: string
}

type ReadingFont = 'sans' | 'serif' | 'mono'
type ReadingWidth = 'compact' | 'comfortable' | 'wide'

type TagSummary = {
  tag: string
  notePaths: string[]
}
type NoteSearchResult = { name: string; relativePath: string; excerpt: string }
type NoteTemplate = { id: string; name: string; content: string }
type PaletteCommand = { id: string; label: string; description: string; disabled?: boolean }
type ExplorerContextMenu = {
  x: number
  y: number
  target: { path: string; name: string; type: 'note' | 'folder' }
}

const AUTO_SAVE_DELAY_MS = 650

function formatTrashDate(day: number) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(day * 86_400_000))
}

function findMarkdownCaretOffset(markdown: string, renderedText: string, renderedOffset: number) {
  const targetOffset = Math.max(0, Math.min(renderedOffset, renderedText.length))
  const firstVisibleCharacter = renderedText[0]
  let markdownOffset = targetOffset === 0 && firstVisibleCharacter
    ? Math.max(0, markdown.indexOf(firstVisibleCharacter))
    : 0

  for (let index = 0; index < targetOffset; index += 1) {
    const nextMatch = markdown.indexOf(renderedText[index], markdownOffset)
    if (nextMatch === -1) return markdownOffset
    markdownOffset = nextMatch + 1
  }

  return markdownOffset
}

function mixedEditorDocumentKey(relativePath: string, blockIndex: number) {
  return `${relativePath}::mixed-block::${blockIndex}`
}

function App() {
  const [vault, setVault] = useState<VaultSummary | null>(null)
  const [notes, setNotes] = useState<NotePreview[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [activeNote, setActiveNote] = useState<NoteDocument | null>(null)
  const [isInlineTitleEditing, setInlineTitleEditing] = useState(false)
  const [inlineTitle, setInlineTitle] = useState('')
  const [isFrontmatterEditorOpen, setFrontmatterEditorOpen] = useState(false)
  const [frontmatterDraft, setFrontmatterDraft] = useState('')
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [draftContent, setDraftContent] = useState('')
  const [isNewNoteDraft, setIsNewNoteDraft] = useState(false)
  const [editorMode, setEditorMode] = useState<'mixed' | 'edit' | 'read'>('mixed')
  const [markdownHistoryStatus, setMarkdownHistoryStatus] = useState<MarkdownEditorHistoryStatus>({ canUndo: false, canRedo: false })
  const [editorSessionsByPath, setEditorSessionsByPath] = useState<Record<string, MarkdownEditorSession>>({})
  const [isMarkdownToolsOpen, setMarkdownToolsOpen] = useState(false)
  const [markdownToolsOrientation, setMarkdownToolsOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  const [markdownToolsPosition, setMarkdownToolsPosition] = useState({ x: 24, y: 24 })
  const [mixedFocusedBlock, setMixedFocusedBlock] = useState<number | null>(null)
  const [searchRequestId, setSearchRequestId] = useState(0)
  const markdownCodeEditorRef = useRef<MarkdownCodeEditorHandle | null>(null)
  const tagFilterDropdownRef = useRef<HTMLDivElement | null>(null)
  const suppressNoteClickRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const activeNoteRef = useRef<NoteDocument | null>(null)
  const draftContentRef = useRef('')
  const markdownEditorStateCacheRef = useRef(new Map<string, EditorState>())
  const markdownToolsRef = useRef<HTMLDivElement | null>(null)
  const editorContentRef = useRef<HTMLDivElement | null>(null)
  const wikiLinkPreviewCacheRef = useRef(new Map<string, WikiLinkPreview>())
  const hoveredWikiLinkPathRef = useRef<string | null>(null)
  const inlineTitleRenameQueueRef = useRef<Promise<void>>(Promise.resolve())
  const inlineTitleRenamePathRef = useRef<string | null>(null)
  const [draftsByPath, setDraftsByPath] = useState<Record<string, string>>({})
  const [recentVaultPreference, setRecentVaultPreference] =
    useState<RecentVaultPreference | null>(null)
  const [showRecentVaultModal, setShowRecentVaultModal] = useState(false)
  const [skipRecentVaultPrompt, setSkipRecentVaultPrompt] = useState(false)
  const [isSidebarExpanded, setSidebarExpanded] = useState(true)
  const [isExplorerExpanded, setExplorerExpanded] = useState(true)
  const [isBuilderModeEnabled, setBuilderModeEnabled] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const [draggedNotePath, setDraggedNotePath] = useState<string | null>(null)
  const [dropFolderPath, setDropFolderPath] = useState<string | null>(null)
  const [justReleasedDrag, setJustReleasedDrag] = useState(false)
  const [workspacePage, setWorkspacePage] = useState<'notes' | 'shortcuts' | 'settings' | 'trash'>('notes')
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
  const [noteHoverColor, setNoteHoverColor] = useState(
    () => localStorage.getItem('mirrormind.note-hover-color') ?? '#171716',
  )
  const [tabHoverColor, setTabHoverColor] = useState(
    () => localStorage.getItem('mirrormind.tab-hover-color') ?? '#171716',
  )
  const [tabHoverTextColor, setTabHoverTextColor] = useState(
    () => localStorage.getItem('mirrormind.tab-hover-text-color') ?? '#fbfaf6',
  )
  const [readingFont, setReadingFont] = useState<ReadingFont>(
    () => (localStorage.getItem('mirrormind.reading-font') as ReadingFont | null) ?? 'sans',
  )
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>(
    () => (localStorage.getItem('mirrormind.reading-width') as ReadingWidth | null) ?? 'comfortable',
  )
  const [isReadingLineWrapEnabled, setReadingLineWrapEnabled] = useState(
    () => localStorage.getItem('mirrormind.reading-line-wrap') !== 'false',
  )
  const [isSpellCheckEnabled, setSpellCheckEnabled] = useState(
    () => localStorage.getItem('mirrormind.spell-check') !== 'false',
  )
  const [skipSoftDeleteConfirmation, setSkipSoftDeleteConfirmation] = useState(
    () => localStorage.getItem('mirrormind.skip-soft-delete-confirmation') === 'true',
  )
  const [showNoteSearch, setShowNoteSearch] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [noteSearchQuery, setNoteSearchQuery] = useState('')
  const [noteSearchResults, setNoteSearchResults] = useState<NoteSearchResult[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank')
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string; type: 'note' | 'folder' } | null>(null)
  const [renameName, setRenameName] = useState('')
  const [moveTarget, setMoveTarget] = useState<{ path: string; name: string; type: 'note' | 'folder' } | null>(null)
  const [moveDestination, setMoveDestination] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string; type: 'note' | 'folder' } | null>(null)
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<TrashItem | null>(null)
  const [trashItems, setTrashItems] = useState<TrashItem[]>([])
  const [backlinks, setBacklinks] = useState<Backlink[]>([])
  const [brokenLinks, setBrokenLinks] = useState<BrokenLink[]>([])
  const [wikiLinkPreview, setWikiLinkPreview] = useState<WikiLinkPreview | null>(null)
  const [externalNoteConflict, setExternalNoteConflict] = useState<ExternalNoteConflict | null>(null)
  const [showNoteLinkDialog, setShowNoteLinkDialog] = useState(false)
  const [noteLinkQuery, setNoteLinkQuery] = useState('')
  const [tagIndex, setTagIndex] = useState<TagSummary[]>([])
  const [attachments, setAttachments] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagFilterQuery, setTagFilterQuery] = useState('')
  const [showTagFilterDialog, setShowTagFilterDialog] = useState(false)
  const [showTagFilterDropdown, setShowTagFilterDropdown] = useState(false)
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenu | null>(null)
  const [showTagDialog, setShowTagDialog] = useState(false)
  const [tagName, setTagName] = useState('')
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({ canUndo: false, canRedo: false })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle')
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
  const noteDescription = getMarkdownDescription(draftContent)
  const frontmatterProperties = getMarkdownFrontmatterProperties(draftContent)
  const visibleFrontmatterProperties = Object.entries(frontmatterProperties).filter(([key]) => key !== 'description')
  const noteBody = getMarkdownBody(draftContent)
  const canUndoActiveEditor = editorMode === 'edit'
    ? markdownHistoryStatus.canUndo
    : editorMode === 'mixed'
      ? markdownHistoryStatus.canUndo
      : historyStatus.canUndo
  const canRedoActiveEditor = editorMode === 'edit'
    ? markdownHistoryStatus.canRedo
    : editorMode === 'mixed'
      ? markdownHistoryStatus.canRedo
      : historyStatus.canRedo
  const readingStyle = {
    '--reading-font': readingFont === 'serif' ? 'Georgia, serif' : readingFont === 'mono' ? 'var(--mono)' : 'var(--sans)',
    '--reading-max-width': readingWidth === 'compact' ? '640px' : readingWidth === 'wide' ? '1040px' : '820px',
  } as CSSProperties
  const handleVaultSelection = useEffectEvent(async (selectedVault: VaultSummary) => {
    await refreshNotes(selectedVault.path)
  })
  const handleWorkspaceShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (vault && matchesShortcut(event, shortcuts.openCommandPalette)) {
      event.preventDefault()
      setCommandQuery('')
      setShowCommandPalette(true)
      return
    }
    if (vault && matchesShortcut(event, shortcuts.openTagFilter)) {
      event.preventDefault()
      setShowTagFilterDialog(true)
      return
    }
    if (event.target instanceof HTMLElement && event.target.closest('.cm-content')) {
      return
    }

    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      if (event.target instanceof HTMLTextAreaElement && (event.ctrlKey || event.metaKey)) {
        const format = event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : null
        if (format) {
          event.preventDefault()
          applyMarkdownFormat(format)
        }
      }
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
    void saveActiveNote(true)
  })
  const handleNativeAttachmentDrop = useEffectEvent((sourcePath: string) => {
    void importAttachmentFromPath(sourcePath)
  })
  const checkExternalNoteChange = useEffectEvent(async () => {
    if (!vault || isNewNoteDraft || saveInFlightRef.current || externalNoteConflict) return
    const currentNote = activeNoteRef.current
    if (!currentNote) return

    try {
      const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath: currentNote.relativePath })
      const externalNote = parseNoteDocument(payload)
      if (externalNote.content === currentNote.content || activeNoteRef.current?.relativePath !== currentNote.relativePath) return

      if (draftContentRef.current === currentNote.content) {
        setActiveNote(externalNote)
        setDraftContent(externalNote.content)
        setDraftsByPath((drafts) => {
          const { [currentNote.relativePath]: _discardedDraft, ...remainingDrafts } = drafts
          return remainingDrafts
        })
        void loadBacklinks(externalNote.relativePath, vault.path)
        void loadBrokenLinks(externalNote.relativePath, vault.path)
        setStatus(`Nota atualizada a partir de uma alteracao externa: ${externalNote.relativePath}`)
        return
      }

      setExternalNoteConflict({ externalNote, localContent: draftContentRef.current })
    } catch {
      // The note may be temporarily unavailable while another application writes it.
    }
  })

  useEffect(() => {
    if (!vault) {
      setNotes([])
      setFolders([])
      setActiveNote(null)
      setOpenTabs([])
      setDraftContent('')
      setDraftsByPath({})
      setBacklinks([])
      setBrokenLinks([])
      setWikiLinkPreview(null)
      setExternalNoteConflict(null)
      setTagIndex([])
      setAttachments([])
      setSelectedTags([])
      setTagFilterQuery('')
      return
    }

    void handleVaultSelection(vault)
  }, [vault])

  useEffect(() => {
    window.addEventListener('keydown', handleWorkspaceShortcut)
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut)
  }, [])

  useEffect(() => {
    if (!showTagFilterDropdown) return
    const closeDropdown = (event: globalThis.MouseEvent) => {
      if (tagFilterDropdownRef.current && !tagFilterDropdownRef.current.contains(event.target as Node)) {
        setShowTagFilterDropdown(false)
      }
    }
    window.addEventListener('mousedown', closeDropdown)
    return () => window.removeEventListener('mousedown', closeDropdown)
  }, [showTagFilterDropdown])

  useEffect(() => {
    if (!showNoteSearch || !vault || !noteSearchQuery.trim()) {
      setNoteSearchResults([])
      return
    }
    const timeout = window.setTimeout(() => {
      void invoke<NoteSearchResult[]>('search_notes', { path: vault.path, query: noteSearchQuery })
        .then(setNoteSearchResults)
        .catch(() => setNoteSearchResults([]))
    }, 150)
    return () => window.clearTimeout(timeout)
  }, [noteSearchQuery, showNoteSearch, vault])

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
    localStorage.setItem('mirrormind.note-hover-color', noteHoverColor)
  }, [noteHoverColor])

  useEffect(() => {
    localStorage.setItem('mirrormind.tab-hover-color', tabHoverColor)
  }, [tabHoverColor])

  useEffect(() => {
    localStorage.setItem('mirrormind.tab-hover-text-color', tabHoverTextColor)
  }, [tabHoverTextColor])

  useEffect(() => {
    localStorage.setItem('mirrormind.reading-font', readingFont)
  }, [readingFont])

  useEffect(() => {
    localStorage.setItem('mirrormind.reading-width', readingWidth)
  }, [readingWidth])

  useEffect(() => {
    localStorage.setItem('mirrormind.reading-line-wrap', String(isReadingLineWrapEnabled))
  }, [isReadingLineWrapEnabled])

  useEffect(() => {
    localStorage.setItem('mirrormind.spell-check', String(isSpellCheckEnabled))
  }, [isSpellCheckEnabled])

  useEffect(() => {
    localStorage.setItem('mirrormind.skip-soft-delete-confirmation', String(skipSoftDeleteConfirmation))
  }, [skipSoftDeleteConfirmation])

  useEffect(() => {
    if (activeNote) {
      setDraftsByPath((currentDrafts) => ({ ...currentDrafts, [activeNote.relativePath]: draftContent }))
    }
  }, [activeNote, draftContent])

  useEffect(() => {
    activeNoteRef.current = activeNote
    draftContentRef.current = draftContent
  }, [activeNote, draftContent])

  useEffect(() => {
    setExternalNoteConflict(null)
  }, [activeNote?.relativePath])

  useEffect(() => {
    if (!vault || !activeNote || isNewNoteDraft) return
    const interval = window.setInterval(() => void checkExternalNoteChange(), 2_500)
    return () => window.clearInterval(interval)
  }, [activeNote, isNewNoteDraft, vault])

  useEffect(() => {
    const canAutoSave = isAutoSaveEnabled
      && activeNote
      && isDirty
      && !saving
      && (!isNewNoteDraft || Boolean(formatNoteTitleAsPath(createNoteForm.title)))

    if (!canAutoSave) {
      if (!isAutoSaveEnabled || !activeNote) setAutoSaveState('idle')
      return
    }

    setAutoSaveState('pending')
    const timeout = window.setTimeout(() => runAutoSave(), AUTO_SAVE_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [
    activeNote,
    createNoteForm.title,
    draftContent,
    isAutoSaveEnabled,
    isDirty,
    isNewNoteDraft,
    saving,
  ])

  useEffect(() => {
    markdownEditorStateCacheRef.current.clear()
    setMarkdownHistoryStatus({ canUndo: false, canRedo: false })
  }, [vault?.path])

  useEffect(() => {
    if (editorMode === 'read') setMarkdownToolsOpen(false)
  }, [editorMode])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop' || editorMode === 'read' || !vault) return
      const editor = editorContentRef.current
      if (!editor) return
      const bounds = editor.getBoundingClientRect()
      const { x, y } = event.payload.position
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return
      const sourcePath = event.payload.paths[0]
      if (sourcePath) handleNativeAttachmentDrop(sourcePath)
    }).then((stop) => { unlisten = stop }).catch(() => undefined)
    return () => unlisten?.()
  }, [editorMode, vault])

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

  async function refreshNotes(vaultPath: string, preferredPath?: string) {
    setLoading(true)
    setError(null)

    try {
      const notePayload = await invoke<unknown>('list_notes', {
        path: vaultPath,
      })
      const nextNotes = parseNoteList(notePayload)
      const nextFolders = await invoke<string[]>('list_folders', { path: vaultPath })
      const nextTagIndex = await invoke<TagSummary[]>('get_tag_index', { path: vaultPath })
      const nextAttachments = await invoke<string[]>('list_attachments', { path: vaultPath })
      const nextFavorites = await invoke<string[]>('list_favorites', { path: vaultPath })
      const nextTemplates = await invoke<NoteTemplate[]>('list_templates', { path: vaultPath })
      setNotes(nextNotes)
      setFolders(nextFolders)
      setTagIndex(nextTagIndex)
      setAttachments(nextAttachments)
      setFavorites(nextFavorites)
      setTemplates(nextTemplates)

      if (nextNotes.length === 0) {
        setActiveNote(null)
        setDraftContent('')
        setStatus('Vault carregado. Crie sua primeira nota.')
        return
      }

      const selectedPath = preferredPath ?? activeNote?.relativePath
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
    if (editorMode !== 'read' && markdownCodeEditorRef.current?.undo()) return
    if (!vault || !historyStatus.canUndo) return
    const payload = await invoke<unknown>('undo_last_command', { path: vault.path })
    setHistoryStatus(parseHistoryStatus(payload))
    await refreshNotes(vault.path)
  }

  async function toggleNoteFavorite(relativePath: string) {
    if (!vault) return
    const nextFavorites = await invoke<string[]>('toggle_favorite', { path: vault.path, relativePath })
    setFavorites(nextFavorites)
  }

  async function toggleActiveFavorite() {
    if (!activeNote || isNewNoteDraft) return
    await toggleNoteFavorite(activeNote.relativePath)
  }

  function runPaletteCommand(command: PaletteCommand) {
    setShowCommandPalette(false)
    if (command.id === 'new-note') startNewNote()
    if (command.id === 'daily-note') void openDailyNote()
    if (command.id === 'open-note') { setShowNoteSearch(true); setNoteSearchQuery('') }
    if (command.id === 'search-content') { setShowNoteSearch(true); setNoteSearchQuery('') }
    if (command.id === 'filter-tags') setShowTagFilterDialog(true)
    if (command.id === 'settings') setWorkspacePage('settings')
    if (command.id === 'shortcuts') setWorkspacePage('shortcuts')
    if (command.id === 'favorite') void toggleActiveFavorite()
    if (command.id === 'undo') void undoLastCommand()
    if (command.id === 'redo') void redoLastCommand()
  }

  async function redoLastCommand() {
    if (editorMode !== 'read' && markdownCodeEditorRef.current?.redo()) return
    if (!vault || !historyStatus.canRedo) return
    const payload = await invoke<unknown>('redo_last_command', { path: vault.path })
    setHistoryStatus(parseHistoryStatus(payload))
    await refreshNotes(vault.path)
  }

  async function createFolder() {
    if (!vault || !folderName.trim()) return
    setLoading(true)
    try {
      await invoke('create_folder', { path: vault.path, relativePath: folderName.trim() })
      setFolderName('')
      setShowFolderDialog(false)
      setStatus('Pasta criada.')
      await refreshNotes(vault.path)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel criar a pasta.')
    } finally {
      setLoading(false)
    }
  }

  function startRename(path: string, name: string, type: 'note' | 'folder') {
    setRenameTarget({ path, name, type })
    setRenameName(type === 'note' ? name.replace(/\.md$/i, '') : name)
  }

  async function renameVaultItem() {
    if (!vault || !renameTarget || !renameName.trim()) return
    const target = renameTarget
    const newBaseName = renameName.trim().replace(/\.md$/i, '')
    const parentPath = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/') + 1) : ''
    const destinationPath = `${parentPath}${newBaseName}${target.type === 'note' ? '.md' : ''}`
    const remapPath = (currentPath: string) => {
      if (target.type === 'folder' && currentPath.startsWith(`${target.path}/`)) {
        return `${destinationPath}${currentPath.slice(target.path.length)}`
      }
      return currentPath === target.path ? destinationPath : currentPath
    }

    setLoading(true)
    try {
      await invoke('rename_vault_item', {
        path: vault.path,
        relativePath: target.path,
        newName: newBaseName,
        itemType: target.type,
      })
      setOpenTabs((tabs) => tabs.map(remapPath))
      setDraftsByPath((drafts) => Object.fromEntries(Object.entries(drafts).map(([path, content]) => [remapPath(path), content])))
      setExpandedFolderIds((currentIds) => new Set([...currentIds].map(remapPath)))
      setActiveNote((currentNote) => currentNote
        ? { ...currentNote, relativePath: remapPath(currentNote.relativePath), name: target.type === 'note' && currentNote.relativePath === target.path ? destinationPath.split('/').at(-1) ?? currentNote.name : currentNote.name }
        : currentNote)
      setRenameTarget(null)
      setRenameName('')
      setStatus(`${target.type === 'note' ? 'Nota' : 'Pasta'} renomeada.`)
      await refreshNotes(vault.path, remapPath(activeNote?.relativePath ?? ''))
      if (target.type === 'note' && activeNote?.relativePath === target.path) {
        void loadBrokenLinks(destinationPath, vault.path)
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel renomear o item.')
    } finally {
      setLoading(false)
    }
  }

  function startInlineTitleRename() {
    if (!activeNote || isNewNoteDraft) return
    inlineTitleRenamePathRef.current = activeNote.relativePath
    setInlineTitle(activeNote.name.replace(/\.md$/i, ''))
    setInlineTitleEditing(true)
  }

  function renameActiveNoteFromTitle(nextTitle: string) {
    if (!vault || !activeNote || isNewNoteDraft) return

    const newBaseName = nextTitle.trim().replace(/\.md$/i, '')
    if (!newBaseName) return

    const vaultPath = vault.path
    inlineTitleRenameQueueRef.current = inlineTitleRenameQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const sourcePath = inlineTitleRenamePathRef.current
        if (!sourcePath) return

        const parentPath = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : ''
        const destinationPath = `${parentPath}${newBaseName}.md`
        if (sourcePath === destinationPath) return

        try {
          await invoke('rename_vault_item', {
            path: vaultPath,
            relativePath: sourcePath,
            newName: newBaseName,
            itemType: 'note',
          })
          inlineTitleRenamePathRef.current = destinationPath
          const destinationName = destinationPath.split('/').at(-1) ?? `${newBaseName}.md`
          const remapPath = (path: string) => path === sourcePath ? destinationPath : path

          setNotes((currentNotes) => currentNotes.map((note) => (
            note.relativePath === sourcePath ? { ...note, relativePath: destinationPath, name: destinationName } : note
          )))
          setOpenTabs((currentTabs) => currentTabs.map(remapPath))
          setDraftsByPath((currentDrafts) => Object.fromEntries(
            Object.entries(currentDrafts).map(([path, content]) => [remapPath(path), content]),
          ))
          setFavorites((currentFavorites) => currentFavorites.map(remapPath))
          setActiveNote((currentNote) => currentNote?.relativePath === sourcePath
            ? { ...currentNote, relativePath: destinationPath, name: destinationName }
            : currentNote)
          setError(null)
          setStatus(`Nota renomeada para ${destinationName.replace(/\.md$/i, '')}.`)
          void loadBrokenLinks(destinationPath, vaultPath)
          void refreshHistoryStatus(vaultPath)
        } catch (caughtError) {
          setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel renomear a nota.')
        }
      })
  }

  function startMove(path: string, name: string, type: 'note' | 'folder') {
    setMoveTarget({ path, name, type })
    setMoveDestination('')
  }

  async function moveVaultItem() {
    if (!vault || !moveTarget) return
    const target = moveTarget
    const sourceName = target.path.split('/').at(-1) ?? target.name
    const destinationPath = moveDestination.trim()
      ? `${moveDestination.trim().replace(/[\\/]+$/, '')}/${sourceName}`
      : sourceName
    const remapPath = (currentPath: string) => {
      if (target.type === 'folder' && currentPath.startsWith(`${target.path}/`)) {
        return `${destinationPath}${currentPath.slice(target.path.length)}`
      }
      return currentPath === target.path ? destinationPath : currentPath
    }

    setLoading(true)
    try {
      await invoke('move_vault_item', {
        path: vault.path,
        relativePath: target.path,
        destinationFolder: moveDestination.trim(),
        itemType: target.type,
      })
      setOpenTabs((tabs) => tabs.map(remapPath))
      setDraftsByPath((drafts) => Object.fromEntries(Object.entries(drafts).map(([path, content]) => [remapPath(path), content])))
      setExpandedFolderIds((currentIds) => new Set([...currentIds].map(remapPath)))
      setActiveNote((currentNote) => currentNote ? { ...currentNote, relativePath: remapPath(currentNote.relativePath) } : currentNote)
      setMoveTarget(null)
      setMoveDestination('')
      setStatus(`${target.type === 'note' ? 'Nota' : 'Pasta'} movida.`)
      await refreshNotes(vault.path, remapPath(activeNote?.relativePath ?? ''))
      if (target.type === 'note' && activeNote?.relativePath === target.path) {
        void loadBrokenLinks(destinationPath, vault.path)
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel mover o item.')
    } finally {
      setLoading(false)
    }
  }

  async function moveDraggedNote(relativePath: string, destinationFolder: string) {
    if (!vault || relativePath.startsWith(`${destinationFolder}/`)) return
    const name = relativePath.split('/').at(-1) ?? relativePath
    const destinationPath = destinationFolder ? `${destinationFolder}/${name}` : name
    setLoading(true)
    try {
      await invoke('move_vault_item', { path: vault.path, relativePath, destinationFolder, itemType: 'note' })
      setOpenTabs((tabs) => tabs.map((path) => path === relativePath ? destinationPath : path))
      setDraftsByPath((drafts) => Object.fromEntries(Object.entries(drafts).map(([path, content]) => [path === relativePath ? destinationPath : path, content])))
      setActiveNote((note) => note?.relativePath === relativePath ? { ...note, relativePath: destinationPath } : note)
      setStatus('Nota movida por arrastar e soltar.')
      await refreshNotes(vault.path, activeNote?.relativePath === relativePath ? destinationPath : undefined)
      if (activeNote?.relativePath === relativePath) {
        void loadBrokenLinks(destinationPath, vault.path)
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel mover a nota.')
    } finally {
      setLoading(false)
      setDraggedNotePath(null)
      setDropFolderPath(null)
    }
  }

  function beginNotePointerDrag(event: ReactPointerEvent<HTMLButtonElement>, relativePath: string) {
    if (event.button !== 0 || loading || saving) return
    const startX = event.clientX
    const startY = event.clientY
    let dragging = false
    const move = (moveEvent: PointerEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 5) {
        dragging = true
        setDraggedNotePath(relativePath)
      }
      if (!dragging) return
      const folder = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>('[data-drop-folder]')
      setDropFolderPath(folder?.dataset.dropFolder ?? null)
    }
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!dragging) return
      suppressNoteClickRef.current = true
      const folder = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest<HTMLElement>('[data-drop-folder]')
      const destination = folder?.dataset.dropFolder
      if (destination !== undefined) void moveDraggedNote(relativePath, destination)
      else { setDraggedNotePath(null); setDropFolderPath(null) }
      setJustReleasedDrag(true)
      window.setTimeout(() => setJustReleasedDrag(false), 200)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function allowNoteDrop(event: DragEvent<HTMLElement>, folderPath: string) {
    const hasNotePayload = Array.from(event.dataTransfer.types).includes('application/x-mirrormind-note') || Array.from(event.dataTransfer.types).includes('text/plain')
    if (!hasNotePayload) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropFolderPath(folderPath)
  }

  function dropNoteInFolder(event: DragEvent<HTMLElement>, folderPath: string) {
    event.preventDefault()
    event.stopPropagation()
    const source = draggedNotePath ?? event.dataTransfer.getData('application/x-mirrormind-note')
    if (source) void moveDraggedNote(source, folderPath)
  }

  async function openTrashPage() {
    if (!vault) return
    setLoading(true)
    try {
      const items = await invoke<TrashItem[]>('list_trash', { path: vault.path })
      setTrashItems(items)
      setWorkspacePage('trash')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel abrir a lixeira.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteVaultItem(targetOverride?: { path: string; name: string; type: 'note' | 'folder' }) {
    if (!vault || (!deleteTarget && !targetOverride)) return
    const target = targetOverride ?? deleteTarget
    if (!target) return
    const isDeletedPath = (currentPath: string) => currentPath === target.path || (target.type === 'folder' && currentPath.startsWith(`${target.path}/`))
    setLoading(true)
    try {
      await invoke('delete_vault_item', { path: vault.path, relativePath: target.path, itemType: target.type })
      setOpenTabs((tabs) => tabs.filter((path) => !isDeletedPath(path)))
      setDraftsByPath((drafts) => Object.fromEntries(Object.entries(drafts).filter(([path]) => !isDeletedPath(path))))
      if (activeNote && isDeletedPath(activeNote.relativePath)) {
        setActiveNote(null)
        setDraftContent('')
      }
      setDeleteTarget(null)
      setStatus(`${target.type === 'note' ? 'Nota' : 'Pasta'} movida para a lixeira.`)
      await refreshNotes(vault.path, '')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel excluir o item.')
    } finally {
      setLoading(false)
    }
  }

  async function restoreTrashItem(id: string) {
    if (!vault) return
    setLoading(true)
    try {
      await invoke('restore_trash_item', { path: vault.path, id })
      setTrashItems((items) => items.filter((item) => item.id !== id))
      setStatus('Item restaurado no local original.')
      await refreshNotes(vault.path)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel restaurar o item.')
    } finally {
      setLoading(false)
    }
  }

  async function permanentlyDeleteTrashItem() {
    if (!vault || !permanentDeleteTarget) return
    const target = permanentDeleteTarget
    setLoading(true)
    try {
      await invoke('permanently_delete_trash_item', { path: vault.path, id: target.id })
      setTrashItems((items) => items.filter((item) => item.id !== target.id))
      setPermanentDeleteTarget(null)
      setStatus('Item excluido permanentemente da lixeira.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel excluir o item permanentemente.')
    } finally {
      setLoading(false)
    }
  }

  function requestDelete(target: { path: string; name: string; type: 'note' | 'folder' }) {
    if (skipSoftDeleteConfirmation) {
      void deleteVaultItem(target)
      return
    }
    setDeleteTarget(target)
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
      void loadBacklinks(parsedNote.relativePath, targetVaultPath)
      void loadBrokenLinks(parsedNote.relativePath, targetVaultPath)
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

  async function loadBacklinks(relativePath: string, vaultPath: string) {
    try {
      const items = await invoke<Backlink[]>('get_backlinks', { path: vaultPath, relativePath })
      setBacklinks(items)
    } catch {
      setBacklinks([])
    }
  }

  async function loadBrokenLinks(relativePath: string, vaultPath: string) {
    try {
      const items = await invoke<BrokenLink[]>('get_broken_links', { path: vaultPath })
      setBrokenLinks(items.filter((link) => link.sourceRelativePath === relativePath))
    } catch {
      setBrokenLinks([])
    }
  }

  async function saveActiveNote(isAutomatic = false) {
    if (!vault || !activeNote || saveInFlightRef.current) {
      return
    }
    saveInFlightRef.current = true
    const notePath = activeNote.relativePath
    const contentToSave = draftContent

    if (isNewNoteDraft) {
      const relativePath = formatNoteTitleAsPath(createNoteForm.title)
      if (!relativePath) {
        setError('Defina um titulo valido antes de salvar a nova nota.')
        saveInFlightRef.current = false
        return
      }

      setSaving(true)
      try {
        const createdPayload = await invoke<unknown>('create_note', { path: vault.path, relativePath })
        const createdNote = parseNoteDocument(createdPayload)
        const savedPayload = await invoke<unknown>('save_note', {
          path: vault.path,
          relativePath: createdNote.relativePath,
          content: contentToSave,
        })
        const savedNote = parseNoteDocument(savedPayload)
        setActiveNote(savedNote)
        setOpenTabs((tabs) => tabs.map((tab) => (tab === '__new_note__' ? savedNote.relativePath : tab)))
        setIsNewNoteDraft(false)
        setCreateNoteForm({ title: '' })
        await refreshNotes(vault.path)
      } finally {
        saveInFlightRef.current = false
        setSaving(false)
        if (isAutomatic) setAutoSaveState('saved')
      }
      return
    }

    setSaving(true)
    if (isAutomatic) setAutoSaveState('saving')
    setError(null)
    setStatus(`Salvando ${notePath}...`)

    try {
      const latestPayload = await invoke<unknown>('read_note', {
        path: vault.path,
        relativePath: notePath,
      })
      const latestNote = parseNoteDocument(latestPayload)
      if (latestNote.content !== activeNote.content) {
        setExternalNoteConflict({ externalNote: latestNote, localContent: contentToSave })
        setStatus('Alteracao externa detectada antes de salvar. Escolha qual versao manter.')
        return
      }

      const notePayload = await invoke<unknown>('save_note', {
        path: vault.path,
        relativePath: notePath,
        content: contentToSave,
      })
      const parsedNote = parseNoteDocument(notePayload)
      const hasNewerDraft = draftContentRef.current !== contentToSave
      const isStillActive = activeNoteRef.current?.relativePath === notePath
      if (isStillActive) setActiveNote(parsedNote)
      if (!hasNewerDraft) {
        setDraftsByPath((currentDrafts) => {
          const { [parsedNote.relativePath]: _discardedDraft, ...remainingDrafts } = currentDrafts
          return remainingDrafts
        })
      }
      if (isStillActive) setStatus(`Nota salva: ${parsedNote.relativePath}`)
      void loadBacklinks(parsedNote.relativePath, vault.path)
      void loadBrokenLinks(parsedNote.relativePath, vault.path)
      void refreshHistoryStatus(vault.path)
      void invoke<TagSummary[]>('get_tag_index', { path: vault.path })
        .then(setTagIndex)
        .catch(() => undefined)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Nao foi possivel salvar a nota.'
      setError(message)
      setStatus('Falha ao salvar a nota atual.')
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
      if (isAutomatic) setAutoSaveState(draftContentRef.current === contentToSave ? 'saved' : 'pending')
    }
  }

  function loadExternalNoteVersion() {
    if (!externalNoteConflict) return
    const { externalNote } = externalNoteConflict
    markdownEditorStateCacheRef.current.delete(externalNote.relativePath)
    setEditorSessionsByPath((sessions) => {
      const { [externalNote.relativePath]: _discardedSession, ...remainingSessions } = sessions
      return remainingSessions
    })
    setActiveNote(externalNote)
    setDraftContent(externalNote.content)
    setDraftsByPath((drafts) => {
      const { [externalNote.relativePath]: _discardedDraft, ...remainingDrafts } = drafts
      return remainingDrafts
    })
    setExternalNoteConflict(null)
    setStatus(`Alteracao externa carregada: ${externalNote.relativePath}`)
  }

  function keepLocalNoteVersion() {
    if (!externalNoteConflict) return
    const { externalNote, localContent } = externalNoteConflict
    setActiveNote(externalNote)
    setDraftContent(localContent)
    setDraftsByPath((drafts) => ({ ...drafts, [externalNote.relativePath]: localContent }))
    setExternalNoteConflict(null)
    setStatus('Rascunho local mantido. Salve a nota para aplicar sua versao.')
  }

  function startNewNote() {
    setSidebarExpanded(true)
    setWorkspacePage('notes')
    setCreateNoteForm({ title: '' })
    setSelectedTemplateId('blank')
    setMarkdownHistoryStatus({ canUndo: false, canRedo: false })
    setActiveNote({ name: 'Nova nota', relativePath: '__new_note__', content: '' })
    setOpenTabs((tabs) => (tabs.includes('__new_note__') ? tabs : [...tabs, '__new_note__']))
    setDraftContent('')
    setIsNewNoteDraft(true)
    setStatus('Defina o titulo da nova nota.')
    requestAnimationFrame(() => document.getElementById('note-title-input')?.focus())
  }

  async function openDailyNote() {
    if (!vault) return

    const relativePath = formatDailyNotePath(new Date())
    let created = false
    setLoading(true)
    setError(null)

    try {
      try {
        await invoke('read_note', { path: vault.path, relativePath })
      } catch {
        try {
          await invoke('create_note', { path: vault.path, relativePath })
          created = true
        } catch {
          // Another request may have created today's note after the initial read.
          await invoke('read_note', { path: vault.path, relativePath })
        }
      }

      setWorkspacePage('notes')
      await refreshNotes(vault.path, relativePath)
      setStatus(created ? `Nota diaria criada: ${relativePath}` : `Nota diaria aberta: ${relativePath}`)
    } catch (caughtError) {
      const message = caughtError instanceof Error
        ? caughtError.message
        : 'Nao foi possivel abrir a nota diaria.'
      setError(message)
      setStatus('Falha ao abrir a nota diaria.')
    } finally {
      setLoading(false)
    }
  }

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    setDraftContent(templates.find((template) => template.id === templateId)?.content ?? '')
  }

  function getActiveEditorSelection() {
    if (editorMode !== 'read') return markdownCodeEditorRef.current?.getSelection() ?? null
    return null
  }

  function focusActiveEditor() {
    markdownCodeEditorRef.current?.focus()
  }

  function openNoteSearch() {
    if (editorMode === 'mixed') {
      setMixedFocusedBlock(null)
      setEditorMode('edit')
    }
    setSearchRequestId((requestId) => requestId + 1)
  }

  function applyMarkdownFormat(format: MarkdownFormat) {
    const selection = getActiveEditorSelection()
    if (!selection) return

    if (editorMode === 'mixed') {
      if (mixedFocusedBlock === null) return
      setDraftContent((currentContent) => {
        const blocks = splitMarkdownBlocks(getMarkdownBody(currentContent))
        const block = blocks[mixedFocusedBlock] ?? ''
        blocks[mixedFocusedBlock] = formatMarkdownSelection(block, selection.selectionStart, selection.selectionEnd, format)
        return replaceMarkdownBody(currentContent, blocks.join('\n\n'))
      })
    } else {
      setDraftContent((currentContent) => formatMarkdownSelection(currentContent, selection.selectionStart, selection.selectionEnd, format))
    }
    requestAnimationFrame(focusActiveEditor)
  }

  function replaceEditorSelection(replacement: string) {
    const selection = getActiveEditorSelection()
    if (!selection) return

    const { selectionStart, selectionEnd } = selection
    if (editorMode === 'mixed') {
      if (mixedFocusedBlock === null) return
      setDraftContent((currentContent) => {
        const blocks = splitMarkdownBlocks(getMarkdownBody(currentContent))
        const block = blocks[mixedFocusedBlock] ?? ''
        blocks[mixedFocusedBlock] = `${block.slice(0, selectionStart)}${replacement}${block.slice(selectionEnd)}`
        return replaceMarkdownBody(currentContent, blocks.join('\n\n'))
      })
    } else {
      setDraftContent((currentContent) => `${currentContent.slice(0, selectionStart)}${replacement}${currentContent.slice(selectionEnd)}`)
    }
    requestAnimationFrame(focusActiveEditor)
  }

  function preserveEditorSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
  }

  function updateNoteDescription(description: string) {
    setDraftContent((currentContent) => setMarkdownDescription(currentContent, description))
  }

  function formatFrontmatterPropertyValue(value: FrontmatterValue) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value === null) return 'null'
    return JSON.stringify(value)
  }

  function openFrontmatterEditor() {
    setFrontmatterDraft(getMarkdownFrontmatterSource(draftContent))
    setFrontmatterError(null)
    setFrontmatterEditorOpen(true)
  }

  function saveFrontmatterProperties() {
    const parsed = parseFrontmatterPropertiesInput(frontmatterDraft)
    if (parsed.error || !parsed.properties) {
      setFrontmatterError(parsed.error ?? 'Propriedades invalidas.')
      return
    }
      setDraftContent((currentContent) => setMarkdownFrontmatterProperties(currentContent, parsed.properties))
    setFrontmatterEditorOpen(false)
  }

  function startMixedBlockEditing(event: MouseEvent<HTMLElement>, index: number, block: string) {
    const clickRange = document.caretRangeFromPoint?.(event.clientX, event.clientY)
    let renderedOffset = 0

    if (clickRange && event.currentTarget.contains(clickRange.startContainer)) {
      const leadingRange = clickRange.cloneRange()
      leadingRange.selectNodeContents(event.currentTarget)
      leadingRange.setEnd(clickRange.startContainer, clickRange.startOffset)
      renderedOffset = leadingRange.toString().length
    }

    if (!activeNote) return
    const documentKey = mixedEditorDocumentKey(activeNote.relativePath, index)
    const selectionStart = findMarkdownCaretOffset(block, event.currentTarget.textContent ?? '', renderedOffset)
    setEditorSessionsByPath((currentSessions) => currentSessions[documentKey]
      ? currentSessions
      : {
          ...currentSessions,
          [documentKey]: { selectionStart, selectionEnd: selectionStart, scrollTop: 0 },
        })
    setMixedFocusedBlock(index)
  }

  function selectMarkdownTool(format: MarkdownFormat) {
    applyMarkdownFormat(format)
  }

  function applyMarkdownTableAction(action: MarkdownTableAction) {
    const selection = getActiveEditorSelection()
    if (!selection) return

    if (editorMode === 'mixed') {
      if (mixedFocusedBlock === null) return
      setDraftContent((currentContent) => {
        const blocks = splitMarkdownBlocks(getMarkdownBody(currentContent))
        blocks[mixedFocusedBlock] = transformMarkdownTable(blocks[mixedFocusedBlock] ?? '', selection.selectionStart, action)
        return replaceMarkdownBody(currentContent, blocks.join('\n\n'))
      })
    } else {
      setDraftContent((currentContent) => transformMarkdownTable(currentContent, selection.selectionStart, action))
    }
    requestAnimationFrame(focusActiveEditor)
  }

  function clampMarkdownToolsPosition(position: { x: number; y: number }) {
    const content = editorContentRef.current
    const toolbar = markdownToolsRef.current
    if (!content || !toolbar) return position
    return {
      x: Math.max(0, Math.min(position.x, Math.max(0, content.clientWidth - toolbar.offsetWidth))),
      y: Math.max(0, Math.min(position.y, Math.max(0, content.clientHeight - toolbar.offsetHeight))),
    }
  }

  function startMarkdownToolsDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    const toolbar = markdownToolsRef.current
    const content = editorContentRef.current
    if (!toolbar || !content) return

    event.preventDefault()
    const startPosition = markdownToolsPosition
    const startX = event.clientX
    const startY = event.clientY
    const move = (moveEvent: PointerEvent) => {
      setMarkdownToolsPosition(clampMarkdownToolsPosition({
        x: startPosition.x + moveEvent.clientX - startX,
        y: startPosition.y + moveEvent.clientY - startY,
      }))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function toggleMarkdownToolsOrientation() {
    setMarkdownToolsOrientation((currentOrientation) => (
      currentOrientation === 'horizontal' ? 'vertical' : 'horizontal'
    ))
    requestAnimationFrame(() => {
      setMarkdownToolsPosition((position) => clampMarkdownToolsPosition(position))
    })
  }

  async function importAttachmentFromPath(sourcePath: string) {
    if (!vault || editorMode === 'read') return
    const selection = getActiveEditorSelection()
    if (!selection) return
    setLoading(true)
    try {
      const attachment = await invoke<Attachment>('import_attachment', {
        path: vault.path,
        sourcePath,
        noteRelativePath: isNewNoteDraft ? '' : activeNote?.relativePath ?? '',
      })
      const selected = selection.value.slice(selection.selectionStart, selection.selectionEnd)
      const label = selected || attachment.name
      const markup = attachment.isImage ? `![${label}](${attachment.relativePath})` : `[${label}](${attachment.relativePath})`
      const leadingBreak = selection.selectionStart > 0 && !selection.value.slice(0, selection.selectionStart).endsWith('\n\n') ? '\n\n' : ''
      replaceEditorSelection(`${leadingBreak}${markup}`)
      setAttachments((currentAttachments) => currentAttachments.includes(attachment.relativePath)
        ? currentAttachments
        : [...currentAttachments, attachment.relativePath].sort())
      setStatus(`Anexo inserido: ${attachment.name}`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel anexar o arquivo.')
    } finally {
      setLoading(false)
    }
  }

  async function insertAttachment() {
    if (!vault || editorMode === 'read') return
    const sourcePath = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Arquivos', extensions: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'md', 'pdf', 'png', 'svg', 'txt', 'webp'] }],
    })
    if (!sourcePath || Array.isArray(sourcePath)) return
    await importAttachmentFromPath(sourcePath)
  }

  async function showWikiLinkPreview(relativePath: string) {
    if (!vault) return
    hoveredWikiLinkPathRef.current = relativePath
    const cacheKey = `${vault.path}::${relativePath}`
    const cachedPreview = wikiLinkPreviewCacheRef.current.get(cacheKey)
    if (cachedPreview) {
      setWikiLinkPreview(cachedPreview)
      return
    }

    try {
      const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath })
      const note = parseNoteDocument(payload)
      const preview = {
        relativePath,
        title: note.name.replace(/\.md$/i, ''),
        summary: getMarkdownPreviewText(note.content),
      }
      wikiLinkPreviewCacheRef.current.set(cacheKey, preview)
      if (hoveredWikiLinkPathRef.current === relativePath) setWikiLinkPreview(preview)
    } catch {
      if (hoveredWikiLinkPathRef.current === relativePath) setWikiLinkPreview(null)
    }
  }

  function hideWikiLinkPreview(relativePath: string) {
    if (hoveredWikiLinkPathRef.current !== relativePath) return
    hoveredWikiLinkPathRef.current = null
    setWikiLinkPreview(null)
  }

  function renderMarkdown(content: string, onToggleChecklist?: (lineNumber: number) => void) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const internalPrefix = 'https://mirrormind.local/note/'
            if (href?.startsWith(internalPrefix)) {
              const relativePath = decodeURIComponent(href.slice(internalPrefix.length))
              const preview = wikiLinkPreview?.relativePath === relativePath ? wikiLinkPreview : null
              return (
                <span className="wiki-link-preview-anchor" onMouseEnter={() => void showWikiLinkPreview(relativePath)} onMouseLeave={() => hideWikiLinkPreview(relativePath)}>
                  <button type="button" className="wiki-link" onClick={() => void openNote(relativePath)}>{children}</button>
                  {preview ? (
                    <span className="wiki-link-preview" role="tooltip">
                      <strong>{preview.title}</strong>
                      <small>{preview.summary || 'Esta nota ainda nao possui conteudo.'}</small>
                    </span>
                  ) : null}
                </span>
              )
            }
            return <a href={href}>{children}</a>
          },
          img: ({ src, alt }) => {
            const isVaultAttachment = src?.startsWith('attachments/') && !src.includes('..')
            const assetUrl = isVaultAttachment && vault
              ? convertFileSrc(`${vault.path}${vault.path.includes('\\') ? '\\' : '/'}${src}`)
              : src
            return <img src={assetUrl} alt={alt ?? ''} />
          },
          input: ({ checked, node, ...inputProps }) => {
            if (inputProps.type !== 'checkbox') return <input {...inputProps} />
            const lineNumber = node?.position?.start.line
            return <input {...inputProps} type="checkbox" checked={Boolean(checked)} onChange={() => {
              if (lineNumber) onToggleChecklist?.(lineNumber)
            }} />
          },
        }}
      >
        {renderWikiLinksAsMarkdown(content)}
      </ReactMarkdown>
    )
  }

  function insertInternalLink(note: NotePreview) {
    const selection = getActiveEditorSelection()
    if (!selection) return
    const selected = selection.value.slice(selection.selectionStart, selection.selectionEnd)
    const target = note.relativePath.replace(/\.md$/i, '')
    const markup = selected ? `[[${target}|${selected}]]` : `[[${target}]]`
    replaceEditorSelection(markup)
    setShowNoteLinkDialog(false)
    setNoteLinkQuery('')
  }

  function insertTag() {
    const selection = getActiveEditorSelection()
    const normalizedTag = tagName.trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]/gu, '').toLowerCase()
    if (!selection || !normalizedTag) return
    const prefix = selection.selectionStart > 0 && !/\s$/.test(selection.value.slice(0, selection.selectionStart)) ? ' ' : ''
    replaceEditorSelection(`${prefix}#${normalizedTag}`)
    setShowTagDialog(false)
    setTagName('')
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

  function setTruncatedLabelTooltip(event: MouseEvent<HTMLElement>, label: string) {
    const labelElement = event.currentTarget.querySelector<HTMLElement>('.tree-item-label')
    event.currentTarget.title = labelElement && labelElement.scrollWidth > labelElement.clientWidth ? label : ''
  }

  function openExplorerContextMenu(event: MouseEvent<HTMLElement>, target: ExplorerContextMenu['target']) {
    event.preventDefault()
    event.stopPropagation()
    setExplorerContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 152),
      target,
    })
  }

  function renderTree(nodes: NoteTreeNode[], depth = 0): ReactNode {
    return (
      <ul className="tree-list" data-depth={depth}>
        {nodes.map((node) => (
          <li key={node.id}>
            {node.type === 'folder' ? (
              <div className="tree-item-row" data-drop-folder={node.path}>
                <details
                  className={`tree-folder${dropFolderPath === node.path ? ' is-drop-target' : ''}`}
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
                  onDragOver={(event) => allowNoteDrop(event, node.path)}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropFolderPath(null) }}
                  onDrop={(event) => dropNoteInFolder(event, node.path)}
                >
                  <summary aria-label={`Pasta ${node.name}`} onMouseEnter={(event) => setTruncatedLabelTooltip(event, node.name)} onContextMenu={(event) => openExplorerContextMenu(event, { path: node.path, name: node.name, type: 'folder' })} onDragEnter={(event) => allowNoteDrop(event, node.path)} onDragOver={(event) => allowNoteDrop(event, node.path)} onDrop={(event) => dropNoteInFolder(event, node.path)}>
                    <Folder className="tree-icon tree-icon--folder-closed" size={14} strokeWidth={1.5} aria-hidden="true" />
                    <FolderOpen className="tree-icon tree-icon--folder-open" size={14} strokeWidth={1.5} aria-hidden="true" />
                    <span className="tree-item-label">{node.name}</span>
                  </summary>
                  {node.children?.length ? renderTree(node.children, depth + 1) : null}
                </details>
              </div>
            ) : (
              <div className="tree-item-row">
                <button
                  type="button"
                  className={`tree-note${node.path === activeNote?.relativePath ? ' is-active' : ''}${draggedNotePath === node.path ? ' is-dragging' : ''}`}
                  draggable={false}
                  onPointerDown={(event) => beginNotePointerDrag(event, node.path)}
                  onClick={() => { if (suppressNoteClickRef.current) { suppressNoteClickRef.current = false; return } void openNote(node.path) }}
                  onMouseEnter={(event) => setTruncatedLabelTooltip(event, node.name.replace(/\.md$/i, ''))}
                  onContextMenu={(event) => openExplorerContextMenu(event, { path: node.path, name: node.name, type: 'note' })}
                  disabled={loading || saving}
                  aria-label={`Abrir nota ${node.name.replace(/\.md$/i, '')}`}
                >
                  <span className="tree-icon tree-icon--note" aria-hidden="true"><CiStickyNote size={15} strokeWidth={1.3} /></span>
                  <span className="tree-item-label">{node.name.replace(/\.md$/i, '')}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    )
  }

  if (vault) {
    const filteredNotes = selectedTags.length > 0
      ? notes.filter((note) => selectedTags.every((tag) => tagIndex.find((entry) => entry.tag === tag)?.notePaths.includes(note.relativePath)))
      : notes
    const visibleFolders = selectedTags.length > 0
      ? folders.filter((folder) => filteredNotes.some((note) => note.relativePath.startsWith(`${folder}/`)))
      : folders
    const noteTree = buildNoteTree(filteredNotes, visibleFolders)
    const linkableNotes = notes.filter((note) =>
      note.relativePath !== activeNote?.relativePath && note.relativePath.toLowerCase().includes(noteLinkQuery.trim().toLowerCase()),
    )
    const activeTags = extractMarkdownTags(draftContent)
    const markdownAutocompleteData = {
      attachments,
      notePaths: notes.map((note) => note.relativePath),
      tags: tagIndex.map((entry) => entry.tag),
    }
    const favoriteNotes = notes.filter((note) => favorites.includes(note.relativePath))
    const matchingTagSuggestions = tagIndex.filter((entry) =>
      !selectedTags.includes(entry.tag) && entry.tag.includes(tagFilterQuery.trim().replace(/^#/, '').toLowerCase()),
    )
    const paletteCommands: PaletteCommand[] = [
      { id: 'new-note', label: 'Criar nova nota', description: 'Abre uma nova nota com foco no titulo.' },
      { id: 'daily-note', label: 'Abrir nota diaria', description: 'Cria ou abre a nota de hoje em Diarias.' },
      { id: 'open-note', label: 'Abrir nota', description: 'Pesquisa notas por nome, conteudo ou tags.' },
      { id: 'filter-tags', label: 'Filtrar por tags', description: 'Abre o filtro completo de tags.' },
      { id: 'favorite', label: favorites.includes(activeNote?.relativePath ?? '') ? 'Remover dos favoritos' : 'Adicionar aos favoritos', description: 'Fixa ou remove a nota atual.', disabled: !activeNote || isNewNoteDraft },
      { id: 'undo', label: 'Desfazer', description: 'Reverte a ultima alteracao da nota ou do vault.', disabled: !canUndoActiveEditor },
      { id: 'redo', label: 'Refazer', description: 'Refaz a ultima alteracao da nota ou do vault.', disabled: !canRedoActiveEditor },
      { id: 'settings', label: 'Abrir configuracoes', description: 'Vai para as configuracoes do workspace.' },
      { id: 'shortcuts', label: 'Abrir atalhos', description: 'Configura atalhos do workspace.' },
    ]
    const matchingCommands = paletteCommands.filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(commandQuery.trim().toLowerCase()))
    const moveDestinationOptions = ['', ...folders].filter((folder) =>
      !moveTarget || moveTarget.type === 'note' || (folder !== moveTarget.path && !folder.startsWith(`${moveTarget.path}/`)),
    )

    return (
      <main
        className={`workspace-shell${isSidebarExpanded ? ' is-sidebar-expanded' : ' is-sidebar-collapsed'}${isExplorerExpanded ? ' is-explorer-expanded' : ' is-explorer-collapsed'}${draggedNotePath ? ' is-note-dragging' : ''}${justReleasedDrag ? ' is-note-released' : ''}`}
        style={{
          '--note-hover-color': noteHoverColor,
          '--tab-hover-color': tabHoverColor,
          '--tab-hover-text-color': tabHoverTextColor,
        } as CSSProperties}
        data-builder-name="workspace-shell"
      >
        <a className="skip-link" href="#workspace-content">Pular para o conteudo da nota</a>
        <aside className="workspace-rail" aria-label="Ferramentas do workspace" data-builder-name="workspace-rail">
          <button
            type="button"
            className="rail-button"
            onClick={() => setSidebarExpanded((isExpanded) => !isExpanded)}
            aria-label={isSidebarExpanded ? 'Recolher barra lateral' : 'Expandir barra lateral'}
            aria-expanded={isSidebarExpanded}
            title={isSidebarExpanded ? 'Recolher barra lateral' : 'Expandir barra lateral'}
          >
            {isSidebarExpanded ? <BsLayoutSidebarInsetReverse size={17} aria-hidden="true" /> : <BsLayoutSidebarInset size={17} aria-hidden="true" />}
            <span className="rail-label rail-label--menu">Menu</span>
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
            className={`rail-button${workspacePage === 'trash' ? ' is-active' : ''}`}
            onClick={() => void openTrashPage()}
            aria-label="Abrir lixeira"
            title="Lixeira"
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
            <span className="rail-label">Lixeira</span>
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

        {error ? <p className="error-banner" role="alert">{error}</p> : null}

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
              <div className="sidebar-section-header" data-builder-name="vault-explorer-header">
                <div className="explorer-title-row">
                  <p className="card-kicker">Notas do vault</p>
                  <button type="button" className="secondary-button explorer-collapse-button" onClick={() => setExplorerExpanded((isExpanded) => !isExpanded)} title={isExplorerExpanded ? 'Recolher explorador' : 'Expandir explorador'} aria-label={isExplorerExpanded ? 'Recolher explorador' : 'Expandir explorador'} aria-expanded={isExplorerExpanded}>
                    {isExplorerExpanded ? <BsLayoutSidebarInsetReverse size={15} aria-hidden="true" /> : <BsLayoutSidebarInset size={15} aria-hidden="true" />}
                  </button>
                </div>
                <div className="explorer-navigation-row">
                  <h2>Navegacao</h2>
                  <div className="explorer-actions">
                  <button type="button" className="secondary-button" onClick={startNewNote} title="Nova nota" aria-label="Nova nota">
                    <span aria-hidden="true">&#9998;</span>
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setShowFolderDialog(true)} title="Nova pasta" aria-label="Nova pasta">
                    <FolderPlus size={15} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setStatus('As notas estao ordenadas por nome.')} title="Ordenacao" aria-label="Ordenacao">
                    <span aria-hidden="true">&#8645;</span>
                  </button>
                  <div className="explorer-filter-control" ref={tagFilterDropdownRef}>
                    <button type="button" className="secondary-button" onClick={() => setShowTagFilterDropdown((open) => !open)} title="Filtrar tags (Ctrl+Shift+F)" aria-label="Filtrar por tags" aria-expanded={showTagFilterDropdown}>
                      {selectedTags.length > 0 ? <ListFilter size={15} strokeWidth={1.5} aria-hidden="true" /> : <Filter size={15} strokeWidth={1.5} aria-hidden="true" />}
                    </button>
                    {showTagFilterDropdown ? (
                      <div className="tag-filter-dropdown" role="dialog" aria-label="Filtro rapido de tags">
                        <div className="tag-filter-selection">
                          {selectedTags.map((tag) => (
                            <button key={tag} type="button" className="tag-filter-chip" onClick={() => setSelectedTags((tags) => tags.filter((item) => item !== tag))}>#{tag} <X size={11} aria-hidden="true" /></button>
                          ))}
                          <input autoFocus value={tagFilterQuery} onChange={(event) => setTagFilterQuery(event.target.value)} placeholder="Buscar tag" aria-label="Buscar tags" />
                        </div>
                        <div className="tag-filter-suggestions">
                          {matchingTagSuggestions.slice(0, 6).map((entry) => <button key={entry.tag} type="button" onClick={() => { setSelectedTags((tags) => [...tags, entry.tag]); setTagFilterQuery('') }}>#{entry.tag} <small>{entry.notePaths.length}</small></button>)}
                          {matchingTagSuggestions.length === 0 ? <p>{tagFilterQuery.trim() ? 'Nenhuma tag encontrada.' : 'Digite para buscar tags.'}</p> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  </div>
                </div>
              </div>
              <div className="workspace-tree">
                <div className={`vault-file-tree${dropFolderPath === '' ? ' is-root-drop-target' : ''}`} data-builder-name="vault-file-tree" data-drop-folder="">
                  {favoriteNotes.length > 0 ? <div className="favorite-notes"><span>Fixadas</span>{favoriteNotes.map((note) => <button key={note.relativePath} type="button" onClick={() => void openNote(note.relativePath)}><Star size={12} fill="currentColor" aria-hidden="true" />{note.name.replace(/\.md$/i, '')}</button>)}</div> : null}
                  {noteTree.length > 0 ? (
                    renderTree(noteTree)
                  ) : (
                    <p className="empty-sidebar-state">
                      Nenhuma nota encontrada. Crie a primeira para abrir o editor.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <footer className="vault-indicator" title={vault.path}>
              <span className="vault-indicator-icon" aria-hidden="true">&#9670;</span>
              <span>{vault.name}</span>
              <button type="button" className="secondary-button vault-refresh-button" onClick={() => void refreshNotes(vault.path)} disabled={loading || saving} title="Atualizar explorador" aria-label="Atualizar explorador de arquivos">
                <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </footer>
          </aside>

          <section id="workspace-content" className="editor-surface" role="region" aria-label="Conteudo do workspace" tabIndex={-1} data-builder-name="workspace-content-panel">
            {workspacePage === 'notes' ? (
              <>
            <div className="tab-strip" role="tablist" aria-label="Notas abertas" data-builder-name="tab-strip">
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
                        role="tab"
                        aria-selected={tabPath === activeNote?.relativePath}
                        aria-controls="note-editor"
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
                        <X size={14} strokeWidth={1.7} aria-hidden="true" />
                        ×
                      </button>
                    </div>
                  )
                })
              ) : (
                <p className="empty-tabs">As notas abertas aparecerao aqui em abas.</p>
              )}
              <button type="button" className="new-tab-button" onClick={startNewNote} disabled={loading || saving} title="Nova nota na raiz do vault" aria-label="Nova nota na raiz do vault">
                <Plus size={16} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </div>

            {activeNote ? (
              <>
                <div className="editor-header">
                  <div>
                    {isNewNoteDraft ? (
                      <>
                      <input
                        id="note-title-input"
                        className="editor-title-input"
                        value={createNoteForm.title}
                        onChange={(event) => setCreateNoteForm({ title: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !saving && !loading && formatNoteTitleAsPath(createNoteForm.title)) {
                            event.preventDefault()
                            void saveActiveNote()
                          }
                        }}
                        placeholder="Titulo da nota"
                        aria-label="Titulo da nova nota"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <select value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)} aria-label="Template da nota">
                        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                      </select>
                      </>
                    ) : isInlineTitleEditing ? (
                      <input
                        className="editor-title-input"
                        value={inlineTitle}
                        onChange={(event) => {
                          const nextTitle = event.target.value
                          setInlineTitle(nextTitle)
                          renameActiveNoteFromTitle(nextTitle)
                        }}
                        onBlur={() => setInlineTitleEditing(false)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                          if (event.key === 'Escape') {
                            setInlineTitle(activeNote.name.replace(/\.md$/i, ''))
                            event.currentTarget.blur()
                          }
                        }}
                        aria-label="Renomear nota"
                        autoComplete="off"
                        autoFocus
                        spellCheck={false}
                      />
                    ) : (
                      <button type="button" className="editor-title-button" onClick={startInlineTitleRename} title="Clique para renomear a nota">
                        {activeNote.name.replace(/\.md$/i, '')}
                      </button>
                    )}
                    <label className="note-description-field">
                      <input
                        value={noteDescription}
                        onChange={(event) => updateNoteDescription(event.target.value)}
                        placeholder="Descricao da nota"
                        aria-label="Descricao da nota"
                      />
                    </label>
                    <div className="note-properties" aria-label="Propriedades da nota">
                      {visibleFrontmatterProperties.map(([key, value]) => <span key={key}><strong>{key}</strong> {formatFrontmatterPropertyValue(value)}</span>)}
                      <button type="button" className="secondary-button" onClick={openFrontmatterEditor}>Propriedades</button>
                    </div>
                    {isFrontmatterEditorOpen ? (
                      <div className="frontmatter-editor">
                        <label htmlFor="frontmatter-properties">Propriedades YAML</label>
                        <textarea id="frontmatter-properties" value={frontmatterDraft} onChange={(event) => setFrontmatterDraft(event.target.value)} placeholder={'source: livro\ntags:\n  - estudo\nreview:\n  interval: 7'} spellCheck={false} />
                        <small>Use YAML completo: valores, listas, objetos e estruturas aninhadas sao preservados.</small>
                        {frontmatterError ? <p className="field-error">{frontmatterError}</p> : null}
                        <div>
                          <button type="button" className="secondary-button" onClick={() => setFrontmatterEditorOpen(false)}>Cancelar</button>
                          <button type="button" onClick={saveFrontmatterProperties}>Aplicar</button>
                        </div>
                      </div>
                    ) : null}
                    {activeTags.length > 0 ? (
                      <div className="note-tag-list" aria-label="Tags da nota">
                        {activeTags.map((tag) => <span key={tag}>#{tag}</span>)}
                      </div>
                    ) : null}
                    {!isNewNoteDraft && backlinks.length > 0 ? (
                      <div className="backlink-list" aria-label="Backlinks">
                        <span>Referenciada por</span>
                        {backlinks.map((backlink) => (
                          <button key={backlink.relativePath} type="button" onClick={() => void openNote(backlink.relativePath)}>{backlink.name.replace(/\.md$/i, '')}</button>
                        ))}
                      </div>
                    ) : null}
                    {!isNewNoteDraft && brokenLinks.length > 0 ? (
                      <div className="backlink-list broken-link-list" aria-label="Links quebrados">
                        <span>Links quebrados</span>
                        {brokenLinks.map((link) => <code key={link.target}>{`[[${link.target.replace(/\.md$/i, '')}]]`}</code>)}
                      </div>
                    ) : null}
                  </div>
                  <div className="editor-actions">
                    <div className="history-actions" aria-label="Historico de edicao">
                      <button type="button" className="secondary-button" onMouseDown={preserveEditorSelection} onClick={() => void undoLastCommand()} disabled={!canUndoActiveEditor || loading || saving} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Undo2 size={15} strokeWidth={1.5} aria-hidden="true" /></button>
                      <button type="button" className="secondary-button" onMouseDown={preserveEditorSelection} onClick={() => void redoLastCommand()} disabled={!canRedoActiveEditor || loading || saving} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><Redo2 size={15} strokeWidth={1.5} aria-hidden="true" /></button>
                    </div>
                    {isAutoSaveEnabled && !isNewNoteDraft ? (
                      <span className={`autosave-indicator is-${autoSaveState}`} aria-live="polite">
                        {autoSaveState === 'pending' ? 'Alteracoes pendentes' : autoSaveState === 'saving' ? 'Salvando...' : autoSaveState === 'saved' ? 'Salvo' : 'Auto Save'}
                      </span>
                    ) : null}
                    {!isNewNoteDraft ? <button type="button" className={`secondary-button favorite-button${favorites.includes(activeNote.relativePath) ? ' is-active' : ''}`} onClick={() => void toggleActiveFavorite()} title="Fixar nota" aria-label="Fixar nota"><Star size={15} fill={favorites.includes(activeNote.relativePath) ? 'currentColor' : 'none'} aria-hidden="true" /></button> : null}
                    <label className="editor-mode-control" title="Escolha como o Markdown sera exibido: Misto mostra a edicao no bloco ativo, Edicao mostra o Markdown e Leitura mostra a nota formatada.">
                      <Eye size={15} strokeWidth={1.5} aria-hidden="true" />
                      <select value={editorMode} onChange={(event) => setEditorMode(event.target.value as typeof editorMode)} aria-label="Modo de visualizacao da nota">
                        <option value="mixed">Misto</option>
                        <option value="edit">Edicao</option>
                        <option value="read">Leitura</option>
                      </select>
                    </label>
                    {editorMode !== 'read' ? (
                      <button type="button" className="secondary-button" onClick={openNoteSearch} title="Buscar e substituir (Ctrl+F)" aria-label="Buscar e substituir"><Search size={15} strokeWidth={1.5} aria-hidden="true" /></button>
                    ) : null}
                    {editorMode !== 'read' ? (
                      <button
                        type="button"
                        className={`secondary-button markdown-tools-toggle${isMarkdownToolsOpen ? ' is-active' : ''}`}
                        onClick={() => setMarkdownToolsOpen((isOpen) => !isOpen)}
                        title="Ferramentas de Markdown"
                        aria-label="Ferramentas de Markdown"
                        aria-expanded={isMarkdownToolsOpen}
                      >
                        <TextCursorInput size={15} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <button type="button" className="editor-disclosure-button" aria-disabled="true" tabIndex={-1} title="Ações adicionais do editor (em breve)" aria-label="Ações adicionais do editor, em breve">
                    <ChevronDown size={16} strokeWidth={1.7} aria-hidden="true" />
                  </button>
                </div>

                <div id="note-editor" className="editor-content" ref={editorContentRef}>
                {editorMode === 'edit' ? (
                  <MarkdownCodeEditor
                    ref={markdownCodeEditorRef}
                    ariaLabel={`Editor Markdown da nota ${activeNote.name.replace(/\.md$/i, '')}`}
                    documentKey={activeNote.relativePath}
                    spellCheck={isSpellCheckEnabled}
                    stateCache={markdownEditorStateCacheRef.current}
                    autocompleteData={markdownAutocompleteData}
                    searchRequestId={searchRequestId}
                    value={draftContent}
                    onHistoryChange={setMarkdownHistoryStatus}
                    session={editorSessionsByPath[activeNote.relativePath]}
                    onChange={setDraftContent}
                    onSessionChange={(session) => {
                      setEditorSessionsByPath((currentSessions) => ({
                        ...currentSessions,
                        [activeNote.relativePath]: session,
                      }))
                    }}
                  />
                ) : editorMode === 'read' ? (
                  <article className={`markdown-reading${isReadingLineWrapEnabled ? '' : ' is-line-wrap-disabled'}`} style={readingStyle}>{renderMarkdown(noteBody, (lineNumber) => setDraftContent((currentContent) => replaceMarkdownBody(currentContent, toggleChecklistAtLine(noteBody, lineNumber))))}</article>
                ) : (
                  <section className="markdown-mixed">
                    {(splitMarkdownBlocks(noteBody).length ? splitMarkdownBlocks(noteBody) : ['']).map((block, index, blocks) =>
                      mixedFocusedBlock === index ? (
                        <MarkdownCodeEditor
                          key={index}
                          ref={markdownCodeEditorRef}
                          ariaLabel={`Editor Markdown, bloco ${index + 1} da nota ${activeNote.name.replace(/\.md$/i, '')}`}
                          autoFocus
                          documentKey={mixedEditorDocumentKey(activeNote.relativePath, index)}
                          spellCheck={isSpellCheckEnabled}
                          stateCache={markdownEditorStateCacheRef.current}
                          autocompleteData={markdownAutocompleteData}
                          onSearchRequest={openNoteSearch}
                          value={block}
                          onChange={(value) => setDraftContent((currentContent) => replaceMarkdownBody(currentContent, blocks.map((item, itemIndex) => itemIndex === index ? value : item).join('\n\n')))}
                          onHistoryChange={setMarkdownHistoryStatus}
                          onSessionChange={(session) => {
                            const documentKey = mixedEditorDocumentKey(activeNote.relativePath, index)
                            setEditorSessionsByPath((currentSessions) => ({
                              ...currentSessions,
                              [documentKey]: session,
                            }))
                          }}
                          session={editorSessionsByPath[mixedEditorDocumentKey(activeNote.relativePath, index)]}
                          onBlur={() => {
                            setMixedFocusedBlock(null)
                            setMarkdownHistoryStatus({ canUndo: false, canRedo: false })
                          }}
                        />
                      ) : (
                        <article key={index} onClick={(event) => startMixedBlockEditing(event, index, block)}>
                          {renderMarkdown(block, (lineNumber) => setDraftContent((currentContent) => {
                            const blocks = splitMarkdownBlocks(getMarkdownBody(currentContent))
                            blocks[index] = toggleChecklistAtLine(block, lineNumber)
                            return replaceMarkdownBody(currentContent, blocks.join('\n\n'))
                          }))}
                        </article>
                      ),
                    )}
                  </section>
                )}
                {isMarkdownToolsOpen && editorMode !== 'read' ? (
                  <div
                    ref={markdownToolsRef}
                    className={`floating-markdown-toolbar is-${markdownToolsOrientation}`}
                    role="toolbar"
                    aria-label="Ferramentas de Markdown"
                    style={{ left: markdownToolsPosition.x, top: markdownToolsPosition.y }}
                  >
                    <button type="button" className="markdown-tools-drag-handle" onPointerDown={startMarkdownToolsDrag} title="Arrastar ferramentas" aria-label="Arrastar ferramentas">
                      <GripHorizontal size={15} strokeWidth={1.7} aria-hidden="true" />
                    </button>
                    <button type="button" className="markdown-tools-orientation" onClick={toggleMarkdownToolsOrientation} title={markdownToolsOrientation === 'horizontal' ? 'Usar barra vertical' : 'Usar barra horizontal'} aria-label={markdownToolsOrientation === 'horizontal' ? 'Usar barra vertical' : 'Usar barra horizontal'}>
                      {markdownToolsOrientation === 'horizontal' ? <PanelLeft size={15} strokeWidth={1.5} aria-hidden="true" /> : <PanelTop size={15} strokeWidth={1.5} aria-hidden="true" />}
                    </button>
                    <div className="markdown-toolbar-group" aria-label="Titulos">
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('heading1')} title="Titulo 1"><Heading1 size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('heading2')} title="Titulo 2"><Heading2 size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('heading3')} title="Titulo 3"><Heading3 size={16} /></button>
                    </div>
                    <div className="markdown-toolbar-group" aria-label="Texto">
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('bold')} title="Negrito (Ctrl+B)"><Bold size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('italic')} title="Italico (Ctrl+I)"><Italic size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('link')} title="Link"><Link size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('quote')} title="Citacao"><TextQuote size={16} /></button>
                    </div>
                    <div className="markdown-toolbar-group" aria-label="Listas">
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('list')} title="Lista"><List size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('orderedList')} title="Lista numerada"><ListOrdered size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('checklist')} title="Checklist"><CheckSquare size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('table')} title="Inserir tabela"><Table2 size={16} /></button>
                    </div>
                    <div className="markdown-toolbar-group" aria-label="Tabela">
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('addRow')} title="Adicionar linha a tabela" aria-label="Adicionar linha a tabela"><Plus size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('removeRow')} title="Remover linha da tabela" aria-label="Remover linha da tabela"><Minus size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('addColumn')} title="Adicionar coluna a tabela" aria-label="Adicionar coluna a tabela"><Plus size={14} /><Table2 size={13} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('removeColumn')} title="Remover coluna da tabela" aria-label="Remover coluna da tabela"><Minus size={14} /><Table2 size={13} /></button>
                    </div>
                    <div className="markdown-toolbar-group" aria-label="Blocos">
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('code')} title="Codigo inline"><Code2 size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('codeBlock')} title="Bloco de codigo"><Quote size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('divider')} title="Divisor"><Minus size={16} /></button>
                    </div>
                    <div className="markdown-toolbar-group" aria-label="Insercao">
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => void insertAttachment()} title="Anexar arquivo"><Paperclip size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => setShowNoteLinkDialog(true)} title="Inserir link para nota"><Link size={16} /></button>
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => setShowTagDialog(true)} title="Inserir tag"><Hash size={16} /></button>
                    </div>
                  </div>
                ) : null}
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
                  <label>
                    <span>
                      <strong>Abrir filtro de tags</strong>
                      <small>Abre o filtro completo de tags do explorador.</small>
                    </span>
                    <input
                      value={shortcuts.openTagFilter}
                      onKeyDown={(event) => {
                        event.preventDefault()
                        setShortcuts((current) => ({ ...current, openTagFilter: formatShortcut(event.nativeEvent) }))
                      }}
                      aria-label="Atalho para abrir filtro de tags"
                      readOnly
                    />
                  </label>
                  <label>
                    <span>
                      <strong>Abrir Command Palette</strong>
                      <small>Abre a busca de comandos do workspace.</small>
                    </span>
                    <input
                      value={shortcuts.openCommandPalette}
                      onKeyDown={(event) => {
                        event.preventDefault()
                        setShortcuts((current) => ({ ...current, openCommandPalette: formatShortcut(event.nativeEvent) }))
                      }}
                      aria-label="Atalho para abrir Command Palette"
                      readOnly
                    />
                  </label>
                </div>
                <button type="button" className="secondary-button" onClick={() => setShortcuts(DEFAULT_WORKSPACE_SHORTCUTS)}>
                  Restaurar padroes
                </button>
              </section>
            ) : workspacePage === 'trash' ? (
              <section className="workspace-page trash-page" data-builder-name="trash-page">
                <p className="card-kicker">Lixeira</p>
                <h2>Arquivos excluidos</h2>
                <p>Arquivos na lixeira sao excluidos permanentemente apos 30 dias.</p>
                <div className="trash-table-wrap" data-builder-name="trash-files">
                  <table>
                    <thead>
                      <tr><th>Arquivo</th><th>Tipo</th><th>Excluido em</th><th>Acoes</th></tr>
                    </thead>
                    <tbody>
                      {trashItems.length === 0 ? <tr><td colSpan={4}>A lixeira esta vazia.</td></tr> : trashItems.map((item) => (
                        <tr key={item.id}>
                          <td title={item.originalRelativePath}>{item.originalRelativePath.replace(/\.md$/i, '')}</td>
                          <td>{item.itemType === 'folder' ? 'Pasta' : 'Nota'}</td>
                          <td>{formatTrashDate(item.deletedAtDay)}</td>
                          <td>
                            <div className="trash-table-actions">
                              <button type="button" className="secondary-button" onClick={() => void restoreTrashItem(item.id)} disabled={loading} title="Restaurar item" aria-label="Restaurar item"><RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" /></button>
                              <button type="button" className="secondary-button danger-button" onClick={() => setPermanentDeleteTarget(item)} disabled={loading} title="Excluir permanentemente" aria-label="Excluir permanentemente"><Trash2 size={14} strokeWidth={1.5} aria-hidden="true" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="workspace-page" data-builder-name="settings-page">
                <p className="card-kicker">Configuracoes</p>
                <h2>Configuracoes do vault</h2>
                <p>Personalize a escrita, a leitura e o comportamento do workspace.</p>
                <label className="settings-toggle">
                  <span>
                    <strong>Auto Save</strong>
                    <small>Salva apos uma breve pausa na digitacao, sem interromper a edicao.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={isAutoSaveEnabled}
                    onChange={(event) => setAutoSaveEnabled(event.target.checked)}
                  />
                </label>
                <label className="settings-toggle">
                  <span>
                    <strong>Cor do hover das notas</strong>
                    <small>Define a cor de fundo ao passar o mouse sobre uma nota no explorador.</small>
                  </span>
                  <input
                    type="color"
                    value={noteHoverColor}
                    onChange={(event) => setNoteHoverColor(event.target.value)}
                    aria-label="Cor do hover das notas"
                  />
                </label>
                <label className="settings-toggle">
                  <span>
                    <strong>Cor do hover das abas</strong>
                    <small>Define a cor de fundo ao passar o mouse por uma aba aberta.</small>
                  </span>
                  <input
                    type="color"
                    value={tabHoverColor}
                    onChange={(event) => setTabHoverColor(event.target.value)}
                    aria-label="Cor do hover das abas"
                  />
                </label>
                <label className="settings-toggle">
                  <span>
                    <strong>Cor do texto no hover das abas</strong>
                    <small>Define a cor do titulo e do icone de fechar enquanto uma aba esta em hover.</small>
                  </span>
                  <input
                    type="color"
                    value={tabHoverTextColor}
                    onChange={(event) => setTabHoverTextColor(event.target.value)}
                    aria-label="Cor do texto no hover das abas"
                  />
                </label>
                <div className="settings-section" aria-labelledby="reading-preferences-title">
                  <p className="card-kicker" id="reading-preferences-title">Leitura</p>
                  <label className="settings-toggle">
                    <span>
                      <strong>Fonte de leitura</strong>
                      <small>Aplica a familia tipografica escolhida no modo Leitura.</small>
                    </span>
                    <select className="settings-select" value={readingFont} onChange={(event) => setReadingFont(event.target.value as ReadingFont)} aria-label="Fonte de leitura">
                      <option value="sans">Sans serif</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Monoespacada</option>
                    </select>
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Largura da leitura</strong>
                      <small>Controla a medida da coluna de conteudo no modo Leitura.</small>
                    </span>
                    <select className="settings-select" value={readingWidth} onChange={(event) => setReadingWidth(event.target.value as ReadingWidth)} aria-label="Largura da leitura">
                      <option value="compact">Compacta</option>
                      <option value="comfortable">Confortavel</option>
                      <option value="wide">Ampla</option>
                    </select>
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Quebra de linha</strong>
                      <small>Desative para manter linhas longas em uma unica linha no modo Leitura.</small>
                    </span>
                    <input type="checkbox" checked={isReadingLineWrapEnabled} onChange={(event) => setReadingLineWrapEnabled(event.target.checked)} />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Corretor ortografico</strong>
                      <small>Usa o corretor nativo do sistema nos modos Edicao e Misto.</small>
                    </span>
                    <input type="checkbox" checked={isSpellCheckEnabled} onChange={(event) => setSpellCheckEnabled(event.target.checked)} />
                  </label>
                </div>
              </section>
            )}
          </section>
          </section>
        {explorerContextMenu ? (
            <div className="explorer-context-menu-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExplorerContextMenu(null) }} onContextMenu={(event) => event.preventDefault()}>
              <div className="explorer-context-menu" role="menu" aria-label={`Acoes para ${explorerContextMenu.target.name}`} style={{ left: explorerContextMenu.x, top: explorerContextMenu.y }}>
                {explorerContextMenu.target.type === 'note' ? (
                  <button type="button" role="menuitem" onClick={() => { void toggleNoteFavorite(explorerContextMenu.target.path); setExplorerContextMenu(null) }}>
                    <Star size={14} strokeWidth={1.5} fill={favorites.includes(explorerContextMenu.target.path) ? 'currentColor' : 'none'} aria-hidden="true" />
                    {favorites.includes(explorerContextMenu.target.path) ? 'Remover dos favoritos' : 'Favoritar nota'}
                  </button>
                ) : (
                  <button type="button" role="menuitem" onClick={() => { startMove(explorerContextMenu.target.path, explorerContextMenu.target.name, 'folder'); setExplorerContextMenu(null) }}>
                    <FolderInput size={14} strokeWidth={1.5} aria-hidden="true" />
                    Mover pasta
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { startRename(explorerContextMenu.target.path, explorerContextMenu.target.name, explorerContextMenu.target.type); setExplorerContextMenu(null) }}>
                  <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
                  Renomear
                </button>
                <button type="button" role="menuitem" className="is-danger" onClick={() => { requestDelete(explorerContextMenu.target); setExplorerContextMenu(null) }}>
                  <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                  Enviar para lixeira
                </button>
              </div>
            </div>
          ) : null}
        {externalNoteConflict ? (
          <div className="note-search-backdrop external-change-backdrop" role="presentation">
            <section className="note-search-modal external-change-modal" role="dialog" aria-modal="true" aria-label="Alteracao externa detectada">
              <div className="move-item-heading">
                <strong>Alteracao externa detectada</strong>
                <span>A nota <b>{externalNoteConflict.externalNote.name.replace(/\.md$/i, '')}</b> foi modificada fora do MirrorMind enquanto voce tinha um rascunho local.</span>
              </div>
              <p>Escolha qual versao deve permanecer no editor. Nenhuma versao sera sobrescrita automaticamente.</p>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={loadExternalNoteVersion}>Carregar arquivo externo</button>
                <button type="button" onClick={keepLocalNoteVersion}>Manter meu rascunho</button>
              </div>
            </section>
          </div>
        ) : null}
        {showCommandPalette ? (
          <div className="note-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCommandPalette(false) }}>
            <section className="note-search-modal command-palette" role="dialog" aria-modal="true" aria-label="Command Palette">
              <input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setShowCommandPalette(false); if (event.key === 'Enter' && matchingCommands[0] && !matchingCommands[0].disabled) runPaletteCommand(matchingCommands[0]) }} placeholder="Digite um comando..." aria-label="Buscar comando" />
              <div className="command-palette-results">
                {matchingCommands.map((command) => <button key={command.id} type="button" disabled={command.disabled} onClick={() => runPaletteCommand(command)}><span>{command.label}</span><small>{command.description}</small></button>)}
                {matchingCommands.length === 0 ? <p>Nenhum comando encontrado.</p> : null}
              </div>
              <div className="folder-dialog-actions"><span className="command-palette-hint">Ctrl+K para abrir</span><button type="button" className="secondary-button" onClick={() => setShowCommandPalette(false)}>Fechar</button></div>
            </section>
          </div>
        ) : null}
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
                {noteSearchResults.map((note) => (
                  <button
                    key={note.relativePath}
                    type="button"
                    onClick={() => {
                      setShowNoteSearch(false)
                      setWorkspacePage('notes')
                      void openNote(note.relativePath)
                    }}
                  >
                    <span>{note.name.replace(/\.md$/i, '')}</span>
                    <small>{note.relativePath}</small>
                    <small>{note.excerpt}</small>
                  </button>
                ))}
                {noteSearchQuery.trim() && noteSearchResults.length === 0 ? <p>Nenhuma nota encontrada.</p> : null}
              </div>
            </section>
          </div>
        ) : null}
        {showTagFilterDialog ? (
          <div className="note-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTagFilterDialog(false) }}>
            <section className="note-search-modal tag-filter-modal" role="dialog" aria-modal="true" aria-label="Filtrar notas por tags">
              <div className="move-item-heading">
                <strong>Filtrar por tags</strong>
                <span>As notas precisam conter todas as tags selecionadas.</span>
                <button type="button" className="modal-close-button" onClick={() => setShowTagFilterDialog(false)} aria-label="Fechar filtro"><X size={15} aria-hidden="true" /></button>
              </div>
              <div className="tag-filter" aria-label="Filtro de tags">
                <div className="tag-filter-selection">
                  {selectedTags.map((tag) => (
                    <button key={tag} type="button" className="tag-filter-chip" onClick={() => setSelectedTags((tags) => tags.filter((item) => item !== tag))} title={`Remover #${tag}`}>
                      #{tag} <X size={11} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  ))}
                  <input autoFocus value={tagFilterQuery} onChange={(event) => setTagFilterQuery(event.target.value)} placeholder={selectedTags.length ? 'Adicionar tag' : 'Digite uma tag'} aria-label="Buscar tags" />
                </div>
                <div className="tag-filter-suggestions">
                  {matchingTagSuggestions.slice(0, 8).map((entry) => (
                    <button key={entry.tag} type="button" onClick={() => { setSelectedTags((tags) => [...tags, entry.tag]); setTagFilterQuery('') }}>
                      #{entry.tag} <small>{entry.notePaths.length}</small>
                    </button>
                  ))}
                  {matchingTagSuggestions.length === 0 ? <p>{tagFilterQuery.trim() ? 'Nenhuma tag encontrada.' : 'Digite para buscar tags.'}</p> : null}
                </div>
              </div>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => { setSelectedTags([]); setTagFilterQuery('') }}>Limpar</button>
                <button type="button" onClick={() => setShowTagFilterDialog(false)}>Aplicar filtro</button>
              </div>
            </section>
          </div>
        ) : null}
        {showNoteLinkDialog ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal" role="dialog" aria-modal="true" aria-label="Inserir link para nota">
              <input autoFocus value={noteLinkQuery} onChange={(event) => setNoteLinkQuery(event.target.value)} placeholder="Buscar nota para vincular" aria-label="Buscar nota" />
              <div className="note-search-results">
                {linkableNotes.map((note) => (
                  <button key={note.relativePath} type="button" onClick={() => insertInternalLink(note)}>{note.relativePath.replace(/\.md$/i, '')}</button>
                ))}
                {linkableNotes.length === 0 ? <p>Nenhuma outra nota encontrada.</p> : null}
              </div>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setShowNoteLinkDialog(false)}>Cancelar</button>
              </div>
            </section>
          </div>
        ) : null}
        {showTagDialog ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal" role="dialog" aria-modal="true" aria-label="Inserir tag">
              <input autoFocus value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') insertTag() }} placeholder="Nome da tag" aria-label="Nome da tag" />
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setShowTagDialog(false)}>Cancelar</button>
                <button type="button" onClick={insertTag} disabled={!tagName.trim()}>Inserir tag</button>
              </div>
            </section>
          </div>
        ) : null}
        {showFolderDialog ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal" role="dialog" aria-modal="true" aria-label="Criar pasta">
              <input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder() }} placeholder="Nome ou caminho da pasta" aria-label="Nome da pasta" />
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setShowFolderDialog(false)}>Cancelar</button>
                <button type="button" onClick={() => void createFolder()} disabled={!folderName.trim() || loading}>Criar pasta</button>
              </div>
            </section>
          </div>
        ) : null}
        {renameTarget ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal" role="dialog" aria-modal="true" aria-label={`Renomear ${renameTarget.type === 'note' ? 'nota' : 'pasta'}`}>
              <input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameVaultItem() }} placeholder="Novo nome" aria-label="Novo nome" />
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setRenameTarget(null)}>Cancelar</button>
                <button type="button" onClick={() => void renameVaultItem()} disabled={!renameName.trim() || loading}>Renomear</button>
              </div>
            </section>
          </div>
        ) : null}
        {moveTarget ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal move-item-modal" role="dialog" aria-modal="true" aria-label={`Mover ${moveTarget.type === 'note' ? 'nota' : 'pasta'}`}>
              <div className="move-item-heading">
                <strong>Mover {moveTarget.type === 'note' ? 'nota' : 'pasta'}: {moveTarget.name.replace(/\.md$/i, '')}</strong>
                <span>Escolha a pasta de destino.</span>
              </div>
              <input value={moveDestination} onChange={(event) => setMoveDestination(event.target.value)} placeholder="Raiz do vault ou caminho da pasta" aria-label="Pasta de destino" />
              <div className="move-destination-list" aria-label="Pastas do vault">
                {moveDestinationOptions.map((folder) => (
                  <button key={folder || '__root__'} type="button" className={moveDestination === folder ? 'is-selected' : ''} onClick={() => setMoveDestination(folder)}>
                    <Folder size={14} strokeWidth={1.5} aria-hidden="true" />
                    {folder || 'Raiz do vault'}
                  </button>
                ))}
              </div>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setMoveTarget(null)}>Cancelar</button>
                <button type="button" onClick={() => void moveVaultItem()} disabled={loading}>Mover</button>
              </div>
            </section>
          </div>
        ) : null}
        {deleteTarget ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal delete-item-modal" role="dialog" aria-modal="true" aria-label={`Excluir ${deleteTarget.type === 'note' ? 'nota' : 'pasta'}`}>
              <div className="move-item-heading">
                <strong>Enviar para a lixeira?</strong>
                <span>{deleteTarget.type === 'folder' ? `A pasta "${deleteTarget.name}" e todo o seu conteudo serao movidos para a lixeira.` : `A nota "${deleteTarget.name.replace(/\.md$/i, '')}" sera movida para a lixeira.`}</span>
              </div>
              <label className="delete-confirmation-preference">
                <input type="checkbox" checked={skipSoftDeleteConfirmation} onChange={(event) => setSkipSoftDeleteConfirmation(event.target.checked)} />
                Nao mostrar esta confirmacao novamente
              </label>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)}>Cancelar</button>
                <button type="button" className="danger-button" onClick={() => void deleteVaultItem()} disabled={loading}>Mover para lixeira</button>
              </div>
            </section>
          </div>
        ) : null}
        {permanentDeleteTarget ? (
          <div className="note-search-backdrop" role="presentation">
            <section className="note-search-modal delete-item-modal" role="dialog" aria-modal="true" aria-label="Excluir permanentemente da lixeira">
              <div className="move-item-heading">
                <strong>Excluir permanentemente?</strong>
                <span>{permanentDeleteTarget.itemType === 'folder' ? `A pasta "${permanentDeleteTarget.originalRelativePath}" e todo o seu conteudo serao removidos definitivamente.` : `A nota "${permanentDeleteTarget.originalRelativePath.replace(/\.md$/i, '')}" sera removida definitivamente e nao podera ser restaurada.`}</span>
              </div>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setPermanentDeleteTarget(null)}>Cancelar</button>
                <button type="button" className="danger-button" onClick={() => void permanentlyDeleteTrashItem()} disabled={loading}>Excluir permanentemente</button>
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
