import { lazy, Suspense, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { EditorState } from '@codemirror/state'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { invoke, isTauriRuntime } from './lib/tauri'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ArrowLeft, ArrowRight, Bold, BookMarked, BookOpenCheck, CheckCircle2, CheckSquare, ChevronDown, ChevronUp, ClipboardList, Code2, Download, ExternalLink, Eye, EyeOff, FileWarning, Filter, Folder, FolderInput, FolderOpen, FolderPlus, GripHorizontal, Hash, Heading1, Heading2, Heading3, Highlighter, Info, Italic, LayoutDashboard, Link, Link2, List, ListFilter, ListOrdered, Minus, MonitorSmartphone, Network, Orbit, Palette, PanelLeft, PanelTop, Paperclip, Pencil, Plus, Quote, Redo2, RefreshCw, RotateCcw, Search, Settings, Sigma, SlidersHorizontal, Sparkles, Star, Strikethrough, Subscript, Superscript, Table2, TextCursorInput, TextQuote, Trash2, Undo2, X, Zap } from 'lucide-react'
import { BsLayoutSidebarInset, BsLayoutSidebarInsetReverse } from 'react-icons/bs'
import { CiStickyNote } from 'react-icons/ci'
import 'katex/dist/katex.min.css'
import { BuilderModeControl } from './components/BuilderModeControl'
import { MarkdownCodeEditor } from './components/MarkdownCodeEditor'
import { TitleBar, TitleBarBrand } from './components/TitleBar'
import type { FrontmatterPanelData, FrontmatterRow, LinkTarget } from './components/markdownLivePreview'
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from './components/ui/drawer'
import { NoteReadinessControl, type ReviewStartInfo } from './features/review/NoteReadinessControl'
import { applyStructuralAuditEdit } from './features/review/structuralAuditApply'
import { NoteReviewPolicyControl } from './features/review/NoteReviewPolicyControl'
import type { ExpiredDeadlineItem, UpcomingDeadlineItem } from './features/review/reviewDashboard'
import { auditNoteStructure, verifyNoteFacts, type FactCheckAttempt, type StructuralAudit } from './features/review/ai'
import { useReviewAiSettings } from './features/review/ReviewAiSettingsContext'
import { getNoteReviewGaps, type NoteReviewGap } from './features/review/noteReviewGaps'
import { getNoteReviewUnits, type NoteReviewUnit } from './features/review/noteReviewUnits'
import { getDueReviewQueue, type DueReviewItem } from './features/review/reviewQueue'
import { ReviewAiSettings } from './features/review/ReviewAiSettings'
import { ReviewNotificationSettings } from './features/review/ReviewNotificationSettings'
import { checkReviewNotifications, type ReviewNotificationCheck } from './features/review/reviewNotifications'
import { localDayStartUnixMs } from './features/review/reviewDashboard'
import { SegmentationSettings } from './features/review/SegmentationSettings'
import { VaultReviewPolicySettings } from './features/review/VaultReviewPolicySettings'
import { useAppUpdater } from './lib/useAppUpdater'
import { useEscapeToClose } from './lib/escapeStack'
import { UpdateBanner } from './components/UpdateBanner'

import { canApplyInventoryIncrementally, createVaultScanCoordinator, diffVaultNotePaths, enqueueVaultFileSystemChange, isVaultWatcherEventForRequest, type ScopedVaultFileSystemChange } from './lib/vaultWatcher'
import { findTextMatches } from './lib/findMatches'
import { findReadMatches, type ReadFindMatch } from './lib/readFind'
import { applyWikilinkEdit, buildWikilinkIndex, getWikilinkBacklinks, getWikilinkTargets, removeWikilinkEntry } from './lib/wikilinkIndex'
import { isIndexadora, removeIndexadoraSection, setIndexadoraFlag, syncIndexadoraSection } from './lib/indexadora'
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
  SpecialVaultFile,
  VaultFileSystemChange,
  VaultSummary,
} from './lib/vault'
import {
  buildNoteTree,
  buildVaultPathPreview,
  formatDailyNotePath,
  formatNoteTitleAsPath,
  formatVaultNameError,
  getVaultModeLabel,
  isVaultPathAffected,
  normalizeRecoveredNotePath,
  parseNoteDocument,
  parseNoteDocumentList,
  parseHistoryStatus,
  parseRecentVaultPreference,
  parseVaultInventory,
  parseVaultSummary,
  remapVaultPath,
  hasScanDiagnostics,
  scanDiagnosticsSummary,
  suggestVaultName,
  type ScanDiagnostics,
} from './lib/vault'
import './App.css'
import { appendWikilinkToContent, countMarkdownWords, detectUnsupportedMarkdownFeatures, extractMarkdownTags, extractObsidianWikiLinks, formatMarkdownSelection, getMarkdownBody, getMarkdownFrontmatterProperties, getMarkdownFrontmatterPropertySource, getMarkdownPreviewText, normalizeMarkdownTag, removeMarkdownFrontmatterProperty, replaceMarkdownBody, resolveObsidianWikiLinkPath, setMarkdownFrontmatterPropertySource, transformMarkdownTable, type MarkdownFormat, type MarkdownTableAction } from './lib/markdown'
import { FrontmatterPanelForm } from './components/FrontmatterPanelForm'
import { nextPopoverShiftX } from './lib/selectionPopover'
import {
  accumulateObsidianForces2D,
  graph2dLineTransform,
  GRAPH_2D_BOUNDS,
  GRAPH_2D_WORLD_CENTER,
  GRAPH_2D_WORLD_SIZE,
  OBSIDIAN_PHYSICS_2D,
  type NoteGraphLayoutLink,
} from './lib/noteGraphLayout'
import { buildGraph2dGroupCentersForGroups, buildGraphGroups, buildGroupMaps } from './lib/graphGrouping'
import { GRAPH_RENDER_LIMIT_DEFAULT, selectRenderedGraphDocuments } from './lib/graphCulling'
import { TagIndex } from './lib/tagIndex'
import { SpecialFileViewer } from './components/SpecialFileViewer'
import {
  clampFontSize,
  clampHistoryLimit,
  effectiveThemeMode,
  fontFamilyCss,
  normalizeFontFamily,
  normalizeThemeMode,
  FONT_FAMILIES,
  MAX_FONT_SIZE,
  MAX_HISTORY_LIMIT,
  MIN_FONT_SIZE,
  MIN_HISTORY_LIMIT,
  THEME_MODES,
  DEFAULT_FONT_SIZE,
  DEFAULT_HISTORY_LIMIT,
  type EditorFontFamily,
  type ThemeMode,
} from './lib/appearance'
import { buildGraphSvg, downloadPng, downloadSvg, graphNodeExportColor } from './lib/graphExport'
import type { Graph3DExportRequest, Graph3DExportScene } from './components/NoteGraph3D'

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

let nextVaultWatcherRequestId = 1

const SPECIAL_FILE_LABELS: Record<SpecialVaultFile['kind'], string> = {
  canvas: 'Canvas',
  excalidraw: 'Excalidraw',
  unknown: 'Formato desconhecido',
}

const SPECIAL_FILE_LIMITATIONS: Record<SpecialVaultFile['kind'], string> = {
  canvas: 'O Canvas ainda não possui visualizador no MirrorMind.',
  excalidraw: 'O desenho Excalidraw ainda não possui editor no MirrorMind.',
  unknown: 'Este formato não possui visualização ou edição no MirrorMind.',
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

type ExternalNoteConflict = {
  externalNote: NoteDocument
  localContent: string
}

type ExternalRemovedNote = {
  relativePath: string
  content: string
  wasActive: boolean
}

type ReadingFont = 'sans' | 'serif' | 'mono'
type ReadingWidth = 'compact' | 'comfortable' | 'wide'
type ReviewGapMode = 'always' | 'hover' | 'off'

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

type GraphDocument = Pick<NoteDocument, 'name' | 'relativePath' | 'content'>
type NoteGraphLink = { source: string; target: string }
type GraphPosition = { x: number; y: number }
type GraphViewport = { scale: number; x: number; y: number }
type GraphMode = 'global' | 'local'

/** Estado da fisica continua do grafo 2D no modelo do Obsidian: o no arrastado
 * e o UNICO ponto fixado (pinned) e todo o grafo visivel flui pelas mesmas
 * forcas — molas das arestas, repulsao 1/d² e center force com zona morta —
 * com resfriamento alpha ate assentar. Ao soltar, a simulacao continua (hub
 * fixo no ponto da soltura) ate parar. Uma simulacao AMBIENTE roda ao abrir
 * o grafo (big bang: nos juntos no centro se espalham) e no botao Reorganizar.
 * Tudo roda num rAF enquanto houver arrasto, assentamento ou ambiente ativo. */
type Graph2DPhysics = {
  positions: Map<string, GraphPosition>
  /** Arestas entre os nos visiveis (molas), usadas por drag/coast/ambient.
   * Ja em forma de objeto para o loop nao alocar arrays por frame. */
  edges: NoteGraphLayoutLink[]
  /** Tamanho em px da superficie capturado no inicio da simulacao (para
   * converter as posicoes % em transform translate px — composicao GPU, sem
   * forcar layout a cada frame). */
  surfaceSize: { width: number; height: number } | null
  drag: {
    anchor: string
    /** Todos os nos visiveis menos o ancora (fluem pelas forcas). */
    paths: string[]
    velocities: Map<string, GraphPosition>
    draggedTarget: GraphPosition
    /** Ultima posicao do alvo processada (para detectar cursor parado e
     * "dormir" o loop — 60fps desnecessarios com o arrasto imovel). */
    lastTarget: GraphPosition
    startX: number
    startY: number
    moved: boolean
    /** Bounds da superficie capturados no inicio do arrasto (para nao chamar
     * getBoundingClientRect a cada pointermove, que forca layout sincrono). */
    bounds: { left: number; top: number; width: number; height: number } | null
  } | null
  /** Assentamento pos-arrasto: o no que foi arrastado fica FIXO no ponto da
   * soltura e o restante do grafo visivel assenta com alpha decaindo. */
  coast: {
    hub: string
    paths: string[]
    velocities: Map<string, GraphPosition>
    startedAt: number
    alpha: number
  } | null
  /** Simulacao ambiente (big bang): todos os nos visiveis partem do centro
   * com pequena perturbacao e se espalham pelas forcas ate assentar. */
  ambient: {
    paths: string[]
    velocities: Map<string, GraphPosition>
    startedAt: number
    alpha: number
  } | null
}

function buildNoteGraphLinks(documents: GraphDocument[], availablePaths: string[]) {
  return documents.flatMap((document) => {
    const targets = new Set<string>()
    for (const link of extractObsidianWikiLinks(document.content)) {
      const targetPath = resolveObsidianWikiLinkPath(link.path, document.relativePath, availablePaths)
      if (targetPath !== document.relativePath && documents.some((candidate) => candidate.relativePath === targetPath)) targets.add(targetPath)
    }
    return [...targets].map((target) => ({ source: document.relativePath, target }))
  })
}

/** Converte os backlinks do indice em memoria no formato da aba (nome + caminho). */
function resolveBacklinksFromIndex(snapshot: ReturnType<typeof buildWikilinkIndex>, relativePath: string, namesByPath?: Map<string, string>) {
  return getWikilinkBacklinks(snapshot, relativePath).map((path) => ({
    name: namesByPath?.get(path) ?? path.split('/').at(-1) ?? path,
    relativePath: path,
  }))
}

/** Converte um indice de wikilinks em memoria nas arestas do grafo (com cache por versao). */
function buildNoteGraphLinksFromIndex(snapshot: ReturnType<typeof buildWikilinkIndex>, documents: GraphDocument[]) {
  const documentsByPath = new Set(documents.map((document) => document.relativePath))
  const links: NoteGraphLink[] = []
  for (const document of documents) {
    for (const target of getWikilinkTargets(snapshot, document.relativePath)) {
      if (target !== document.relativePath && documentsByPath.has(target)) links.push({ source: document.relativePath, target })
    }
  }
  return links
}

/** Atualiza um numero de configuracao: campo vazio mantem o valor atual,
 * valores invalidos sao ignorados e o resultado e limitado a [min, max]. */
function updateNumberSetting(raw: string, current: number, min: number, max: number) {
  if (raw.trim() === '') return current
  const next = Number(raw)
  return Number.isFinite(next) ? Math.max(min, Math.min(max, next)) : current
}

const AUTO_SAVE_DELAY_MS = 650

/** Sessoes da pagina de Configuracoes, na ordem do menu lateral. */
const SETTINGS_SECTIONS = [
  { id: 'aparencia', label: 'Aparência', icon: Palette },
  { id: 'workspace', label: 'Workspace', icon: SlidersHorizontal },
  { id: 'leitura', label: 'Leitura', icon: BookOpenCheck },
  { id: 'grafo3d', label: 'Grafo 3D', icon: Orbit },
  { id: 'grafo2d', label: 'Grafo 2D', icon: Network },
  { id: 'revisao', label: 'Revisão', icon: ClipboardList },
  { id: 'aplicativo', label: 'Aplicativo', icon: MonitorSmartphone },
] as const
// three.js e pesado (~600 KB): carregado sob demanda, apenas quando o usuario
// abre o modo 3D do grafo pela primeira vez.
const NoteGraph3D = lazy(() => import('./components/NoteGraph3D').then((module) => ({ default: module.NoteGraph3D })))

// Paginas secundarias (revisao e tags) sao carregadas sob demanda: o codigo
// (e as dependencias exclusivas de cada pagina) so entra no bundle inicial
// quando o usuario navega ate elas.
const ReviewDashboardPage = lazy(() => import('./features/review/ReviewDashboardPage').then((module) => ({ default: module.ReviewDashboardPage })))
const ReviewQueuePage = lazy(() => import('./features/review/ReviewQueuePage').then((module) => ({ default: module.ReviewQueuePage })))
const ReviewReportsPage = lazy(() => import('./features/review/ReviewReportsPage').then((module) => ({ default: module.ReviewReportsPage })))
const ReviewSessionPage = lazy(() => import('./features/review/ReviewSessionPage').then((module) => ({ default: module.ReviewSessionPage })))
const TagManagementPage = lazy(() => import('./features/tags/TagManagementPage').then((module) => ({ default: module.TagManagementPage })))
const BasesPage = lazy(() => import('./features/bases/BasesPage').then((module) => ({ default: module.BasesPage })))

const LIMITED_MARKDOWN_FEATURE_LABELS: Record<string, string> = {
  html: 'HTML sanitizado',
  'obsidian-comment': 'comentario Obsidian',
  'plugin-block': 'bloco de plugin',
  'plugin-inline': 'sintaxe inline de plugin',
}

function formatTrashDate(day: number) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(day * 86_400_000))
}

/** Recuperacao do cursor do WebView2/Windows: apos mudancas de composicao
 * (trocar de pagina, entrar no editor — o I-beam, montar o canvas WebGL do
 * grafo), o Chromium as vezes deixa o cursor do SO preso renderizado branco
 * (perde a parte preta e fica invisivel no tema claro). Forcar uma mudanca
 * de cursor por um instante faz o compositor redesenhar o cursor nativo — o
 * mesmo mecanismo do workaround classico de "minimizar/restaurar" a janela.
 * `durationMs` curto (30-40ms) para nao piscar o cursor. */
function nudgeCursor(durationMs = 40) {
  const style = document.createElement('style')
  style.textContent = '* { cursor: auto !important; }'
  document.head.appendChild(style)
  window.setTimeout(() => style.remove(), durationMs)
}

function App() {
  const { provider: reviewProvider } = useReviewAiSettings()
  const [vault, setVault] = useState<VaultSummary | null>(null)
  const [notes, setNotes] = useState<NotePreview[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [activeNote, setActiveNote] = useState<NoteDocument | null>(null)
  const [isInlineTitleEditing, setInlineTitleEditing] = useState(false)
  const [inlineTitle, setInlineTitle] = useState('')
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [draftContent, setDraftContent] = useState('')
  const [isNewNoteDraft, setIsNewNoteDraft] = useState(false)
  const [editorMode, setEditorMode] = useState<'mixed' | 'edit' | 'read'>('mixed')
  const [markdownHistoryStatus, setMarkdownHistoryStatus] = useState<MarkdownEditorHistoryStatus>({ canUndo: false, canRedo: false })
  const [editorSessionsByPath, setEditorSessionsByPath] = useState<Record<string, MarkdownEditorSession>>({})
  // Popover de formatacao da selecao: posicao (relativa ao painel de conteudo),
  // direcao de abertura (acima/abaixo da linha do cursor da selecao) e shiftX
  // (correcao horizontal para o popover inteiro ficar dentro do painel).
  const [selectionPopover, setSelectionPopover] = useState<{ flip: boolean; shiftX: number; x: number; y: number } | null>(null)
  /** Painel integrado de propriedades (frontmatter): aberto pelo arrow down do
   * cabecalho; sincronizado com o editor via `onFrontmatterExpandedChange`. */
  const [frontmatterPanelOpen, setFrontmatterPanelOpen] = useState(false)
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null)
  const [isMarkdownToolsOpen, setMarkdownToolsOpen] = useState(false)
  const [markdownToolsOrientation, setMarkdownToolsOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  const [markdownToolsPosition, setMarkdownToolsPosition] = useState({ x: 24, y: 24 })
  const [noteFindOpen, setNoteFindOpen] = useState(false)
  const [noteFindQuery, setNoteFindQuery] = useState('')
  const [noteFindIndex, setNoteFindIndex] = useState(0)
  // Busca no modo Leitura: correspondencias calculadas sobre o DOM renderizado
  // (nao ha editor CodeMirror para destacar). O total vira estado para o
  // contador da barra; os matches ficam em ref (sem rerender por navegacao).
  const [readFindTotal, setReadFindTotal] = useState(0)
  const readFindMatchesRef = useRef<ReadFindMatch[]>([])
  const markdownCodeEditorRef = useRef<MarkdownCodeEditorHandle | null>(null)
  const noteFindInputRef = useRef<HTMLInputElement | null>(null)
  const panelScrollRef = useRef<Record<string, number>>({})
  const lastEditorPathRef = useRef<string | null>(null)
  const editorPanelRef = useRef<HTMLElement | null>(null)
  const tagFilterDropdownRef = useRef<HTMLDivElement | null>(null)
  const suppressNoteClickRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const activeNoteRef = useRef<NoteDocument | null>(null)
  const notesRef = useRef<NotePreview[]>([])
  const foldersRef = useRef<string[]>([])
  const specialFilesRef = useRef<SpecialVaultFile[]>([])
  const specialFilesTruncatedRef = useRef(false)
  const openTabsRef = useRef<string[]>([])
  const draftsByPathRef = useRef<Record<string, string>>({})
  const draftContentRef = useRef('')
  const markdownEditorStateCacheRef = useRef(new Map<string, EditorState>())
  const markdownToolsRef = useRef<HTMLDivElement | null>(null)
  const editorContentRef = useRef<HTMLDivElement | null>(null)
  const graphSurfaceRef = useRef<HTMLDivElement | null>(null)
  const graphPanRef = useRef<{ x: number; y: number; viewport: GraphViewport } | null>(null)
  const graphNodeDragRef = useRef<string | null>(null)
  const graphSkipNodeClickRef = useRef(false)
  const graphPhysicsRef = useRef<Graph2DPhysics | null>(null)
  const graphPhysicsFrameRef = useRef<number | null>(null)
  const graphPhysicsLastTimeRef = useRef<number | null>(null)
  // Worker de layout: simula o ambiente 2D fora da thread de interface. O
  // requestId distingue simulacoes; as posicoes recebidas alimentam o DOM e
  // sao a fonte "viva" para um arrasto comecar de onde os nos estão.
  const graphPhysicsWorkerRef = useRef<Worker | null>(null)
  const graphWorkerAmbientIdRef = useRef(0)
  const graphWorkerPositionsRef = useRef<Map<string, GraphPosition> | null>(null)
  const graphSurfaceSizeRef = useRef<{ width: number; height: number } | null>(null)
  // Centros dos grupos por pasta (percentuais 0-100) para a mola de grupo da
  // fisica 2D; atualizado a cada render com os nos visiveis atuais.
  const graphGroupCentersRef = useRef<Map<string, GraphPosition> | null>(null)
  const graphLoadRequestRef = useRef(0)
  const openingWikiLinkPathsRef = useRef(new Set<string>())
  const inlineTitleRenameQueueRef = useRef<Promise<void>>(Promise.resolve())
  const inlineTitleRenamePathRef = useRef<string | null>(null)
  const vaultChangeQueueRef = useRef<VaultFileSystemChange[]>([])
  const vaultChangeDebounceRef = useRef<number | null>(null)
  const activeVaultWatcherRequestRef = useRef(0)
  const activeVaultPathRef = useRef<string | null>(null)
  const externalVaultScanCoordinatorRef = useRef<ReturnType<typeof createVaultScanCoordinator> | null>(null)
  activeVaultPathRef.current = vault?.path ?? null
  const externalRemovedNoteQueueRef = useRef<ExternalRemovedNote[]>([])
  const [draftsByPath, setDraftsByPath] = useState<Record<string, string>>({})
  const [recentVaultPreference, setRecentVaultPreference] =
    useState<RecentVaultPreference | null>(null)
  const [showRecentVaultModal, setShowRecentVaultModal] = useState(false)
  const [skipRecentVaultPrompt, setSkipRecentVaultPrompt] = useState(false)
  const [isSidebarExpanded, setSidebarExpanded] = useState(true)
  const [isBuilderModeEnabled, setBuilderModeEnabled] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const [draggedNotePath, setDraggedNotePath] = useState<string | null>(null)
  const [dropFolderPath, setDropFolderPath] = useState<string | null>(null)
  const [justReleasedDrag, setJustReleasedDrag] = useState(false)
  const [workspacePage, setWorkspacePage] = useState<'notes' | 'review' | 'dashboard' | 'reports' | 'tags' | 'bases' | 'graph' | 'shortcuts' | 'settings' | 'trash'>('notes')
  // O explorador de arquivos colapsa fora da pagina de notas para dar espaco
  // ao conteudo da pagina; ao voltar para notas, expande de volta. Sem botao
  // manual — o estado e derivado da pagina atual.
  const isExplorerExpanded = workspacePage === 'notes'

  // Recuperacao do cursor na troca de pagina: a Tabela tem colunas
  // fixas/sticky e o grafo monta um canvas WebGL — mudancas de composicao
  // que disparam o cursor branco/invisivel do WebView2/Windows.
  useEffect(() => {
    nudgeCursor()
  }, [workspacePage])

  // Entrar na superficie do editor (explorador -> editor) troca o cursor para
  // o I-beam — outro gatilho conhecido do cursor branco. Reemite o cursor ao
  // entrar, via delegacao (a superficie e recriada quando um vault abre).
  useEffect(() => {
    let insideSurface = false
    const onMouseOver = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.workspace-shell .editor-surface') && !insideSurface) {
        insideSurface = true
        nudgeCursor(30)
      }
    }
    const onMouseOut = (event: globalThis.MouseEvent) => {
      const target = event.target
      const related = event.relatedTarget
      if (!(target instanceof Element)) return
      if (
        target.closest('.workspace-shell .editor-surface') &&
        !(related instanceof Element && related.closest('.workspace-shell .editor-surface'))
      ) {
        insideSurface = false
      }
    }
    document.addEventListener('mouseover', onMouseOver, { passive: true })
    document.addEventListener('mouseout', onMouseOut, { passive: true })
    return () => {
      document.removeEventListener('mouseover', onMouseOver)
      document.removeEventListener('mouseout', onMouseOut)
    }
  }, [])
  const [activeReviewItem, setActiveReviewItem] = useState<DueReviewItem | null>(null)
  const [reviewMenuOpen, setReviewMenuOpen] = useState(false)
  // Quando o relatorio de prontidao esta aberto, ele substitui TODO o conteudo
  // do popover (cabecalho e politica inclusos); o botao de voltar o fecha.
  const [reviewReportOpen, setReviewReportOpen] = useState(false)
  // Auditoria estrutural deterministica (sem IA): achados + sugestoes aplicaveis
  // uma a uma no rascunho do editor.
  const [structuralAuditOpen, setStructuralAuditOpen] = useState(false)
  const [structuralAudit, setStructuralAudit] = useState<StructuralAudit | null>(null)
  const [structuralAuditLoading, setStructuralAuditLoading] = useState(false)
  const [structuralAuditError, setStructuralAuditError] = useState<string | null>(null)
  const [structuralAuditAppliedIndex, setStructuralAuditAppliedIndex] = useState<number | null>(null)
  // Verificacao factual opcional: operacao separada da avaliacao de memoria,
  // informativa, sem alterar a nota nem as pontuacoes.
  const [factCheckOpen, setFactCheckOpen] = useState(false)
  const [factCheck, setFactCheck] = useState<FactCheckAttempt | null>(null)
  const [factCheckLoading, setFactCheckLoading] = useState(false)
  const [factCheckError, setFactCheckError] = useState<string | null>(null)
  const [notificationLastCheck, setNotificationLastCheck] = useState<ReviewNotificationCheck | null>(null)
  const [reviewGaps, setReviewGaps] = useState<NoteReviewGap[]>([])
  const [reviewUnits, setReviewUnits] = useState<NoteReviewUnit[]>([])
  const [reviewGapMode, setReviewGapMode] = useState<ReviewGapMode>(
    () => (localStorage.getItem('mirrormind.review-gap-mode') as ReviewGapMode | null) ?? 'hover',
  )
  const [graphDocuments, setGraphDocuments] = useState<GraphDocument[]>([])
  // Indice de tags em memoria: cada nota extrai suas tags uma vez por versao do
  // conteudo e o resultado e reutilizado no grafo (filtro e lista de tags),
  // evitando reprocessar o YAML de todas as notas a cada renderizacao.
  const graphTagIndexRef = useRef(new TagIndex())
  // Indice de wikilinks em memoria. E construido quando o grafo abre e passa a
  // ser atualizado incrementalmente (applyWikilinkEdit) a cada salvamento,
  // evitando reextrair e re-resolver os links de todas as notas.
  const graphWikilinkIndexRef = useRef<ReturnType<typeof buildWikilinkIndex> | null>(null)
  const graphWikilinkIndex = graphWikilinkIndexRef.current
  // Indice de tags sincronizado quando o conjunto de documentos muda (nao a
  // cada render): extrai tags somente das notas cujo conteudo mudou e mantem a
  // lista de tags do grafo e o filtro O(1) por nota durante a renderizacao.
  const graphTagIndex = useMemo(() => {
    const index = graphTagIndexRef.current
    index.sync(graphDocuments)
    return index
  }, [graphDocuments])
  // Indice do Vault inteiro, construido em segundo plano ao abrir o Vault e
  // atualizado incrementalmente (save/rename/exclusao). Alimenta a aba de
  // backlinks e o ranqueamento do autocomplete sem depender do grafo aberto.
  const vaultWikilinkIndexRef = useRef<ReturnType<typeof buildWikilinkIndex> | null>(null)
  const vaultWikilinkIndexLoadedPathRef = useRef<string | null>(null)
  const vaultWikilinkIndexRequestRef = useRef(0)
  // Cache dos CONTEUDOS de todas as notas do Vault, populado pela leitura
  // unificada (`read_vault_notes`) da indexacao em segundo plano. O grafo
  // reutiliza esse cache quando fresco (mesmo Vault e mesmo conjunto de notas),
  // evitando a releitura duplicada ao abrir o grafo; entradas sao atualizadas
  // em salvamentos e o cache e descartado em rename/move/exclusao, troca de
  // Vault e mudanca estrutural vinda do watcher.
  const vaultNoteContentsRef = useRef<{
    vaultPath: string
    documents: Map<string, GraphDocument>
  } | null>(null)
  // Atualiza o cache de conteudos com o estado salvo de UMA nota (mesma fonte
  // dos indices em memoria, para o grafo refletir edicoes sem re-leitura).
  function updateVaultNoteContents(relativePath: string, name: string, content: string) {
    const cached = vaultNoteContentsRef.current
    if (!cached) return
    cached.documents.set(relativePath, { relativePath, name, content })
  }
  // Nota: o indicador de indexacao em segundo plano foi removido junto com a
  // faixa de status do canto inferior direito; o indice continua sendo
  // construido por buildVaultWikilinkIndex sem feedback visual dedicado.
  const [isGraphLoading, setGraphLoading] = useState(false)
  // Progresso do carregamento em lotes (null = sem leitura em andamento).
  const [graphLoadProgress, setGraphLoadProgress] = useState<number | null>(null)
  const [graphNodeOverrides, setGraphNodeOverrides] = useState<Record<string, GraphPosition>>({})
  const [graphViewport, setGraphViewport] = useState<GraphViewport>({ scale: 1, x: 0, y: 0 })
  // Renderizacao seletiva: limite de nos desenhados por cena (acima dele, so
  // o viewport + contexto e renderizado) e tamanho da superficie medido.
  const [graphRenderLimit, setGraphRenderLimit] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph2d.render-limit'))
    return Number.isFinite(value) && value >= 50 ? Math.round(value) : GRAPH_RENDER_LIMIT_DEFAULT
  })
  const [graphSurfaceSize, setGraphSurfaceSize] = useState<{ width: number; height: number } | null>(null)
  const [graphMode3d, setGraphMode3d] = useState(false)
  const [graph3dLayoutVersion, setGraph3dLayoutVersion] = useState(0)
  const [graphQuery, setGraphQuery] = useState('')
  const [graphFolder, setGraphFolder] = useState('')
  const [graphTag, setGraphTag] = useState('')
  const [showGraphOrphans, setShowGraphOrphans] = useState(true)
  const [showOnlyGraphOrphans, setShowOnlyGraphOrphans] = useState(false)
  const [graphHideAllNames, setGraphHideAllNames] = useState(false)
  const [graphGroupByFolder, setGraphGroupByFolder] = useState(false)
  const [graphGroupByTag, setGraphGroupByTag] = useState(false)
  // Tag principal opcional do agrupamento por tag (desempate de notas com
  // varias tags) e overrides de cor por grupo, ambos persistidos por Vault.
  const [graphPrimaryTag, setGraphPrimaryTag] = useState('')
  const [graphColorOverrides, setGraphColorOverrides] = useState<Record<string, string>>({})
  const [graphExportOpen, setGraphExportOpen] = useState(false)
  const [graphExportScale, setGraphExportScale] = useState(2)
  const [graphExportRequest, setGraphExportRequest] = useState<Graph3DExportRequest | null>(null)
  const graphExportRequestIdRef = useRef(0)
  // Configuracoes do grafo 3D (tamanho/orbita/arestas), persistidas por vault.
  const [graph3dNodeSize, setGraph3dNodeSize] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph3d.node-size'))
    return Number.isFinite(value) && value > 0 ? value : 0.55
  })
  const [graph3dNodeSpacing, setGraph3dNodeSpacing] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph3d.node-spacing'))
    return Number.isFinite(value) && value > 0 ? value : 8
  })
  const [graph3dOrbitSpeed, setGraph3dOrbitSpeed] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph3d.orbit-speed'))
    return Number.isFinite(value) && value > 0 ? value : 1
  })
  const [graph3dMaxEdgeLength, setGraph3dMaxEdgeLength] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph3d.max-edge-length'))
    return Number.isFinite(value) && value > 0 ? value : 14
  })
  const [graph3dMinEdgeLength, setGraph3dMinEdgeLength] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph3d.min-edge-length'))
    return Number.isFinite(value) && value >= 0 ? value : 2.5
  })
  const [graph3dDegreeGrowth, setGraph3dDegreeGrowth] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph3d.degree-growth'))
    return Number.isFinite(value) && value >= 0 ? value : 0.13
  })
  // Configuracoes de FORCAS do grafo 2D (constantes do modelo Obsidian:
  // repulsao 1/d², rigidez da mola, amortecimento, distancia do link e forca
  // central), persistidas por vault e editaveis no popover de configuracoes do
  // header do grafo (e na pagina de Configuracoes).
  const [graph2dRepulsionStrength, setGraph2dRepulsionStrength] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph2d.repulsion-strength'))
    return Number.isFinite(value) && value >= 0 ? value : 2000
  })
  const [graph2dLinkStiffness, setGraph2dLinkStiffness] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph2d.link-stiffness'))
    return Number.isFinite(value) && value > 0 ? value : 4.0
  })
  const [graph2dVelocityDecay, setGraph2dVelocityDecay] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph2d.velocity-decay'))
    return Number.isFinite(value) && value >= 0 ? value : 0.4
  })
  const [graph2dLinkDistance, setGraph2dLinkDistance] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph2d.link-distance'))
    return Number.isFinite(value) && value > 0 ? value : 30
  })
  const [graph2dCenterForce, setGraph2dCenterForce] = useState(() => {
    const value = Number(localStorage.getItem('mirrormind.graph2d.center-force'))
    return Number.isFinite(value) && value >= 0 ? value : 100
  })
  // Espelho das configuracoes do grafo 2D para o loop rAF da fisica (lido em
  // tempo real sem recriar o closure). Posicoes transitorias da simulacao:
  // arrasto/assentamento rodam sem persistir nada; apenas o layout final ao
  // parar e gravado em graphNodeOverrides.
  const graphPhysicsSettingsRef = useRef({
    repulsionStrength: graph2dRepulsionStrength,
    linkStiffness: graph2dLinkStiffness,
    velocityDecay: graph2dVelocityDecay,
    linkDistance: graph2dLinkDistance,
    centerForce: graph2dCenterForce,
  })
  // Elementos DOM dos nos/arestas 2D: o loop da fisica escreve as posicoes
  // DIRETAMENTE no DOM (imperativo) a cada frame, sem re-renderizar o React
  // (o App inteiro, incluindo a arvore do explorador, renderizar a 60fps era a
  // causa das travadinhas). A fonte de verdade das posicoes durante a
  // simulacao e o proprio mapa vivo em graphPhysicsRef; a renderizacao le
  // dele para nunca mostrar posicoes antigas.
  const graph2dNodeElementsRef = useRef(new Map<string, HTMLButtonElement>())
  const graph2dLinkElementsRef = useRef(new Map<string, SVGLineElement>())
  // Ultimos valores escritos nas arestas (para pular escritas redundantes).
  const graph2dLinkLastValuesRef = useRef(new WeakMap<SVGLineElement, string>())

  useEffect(() => {
    graphPhysicsSettingsRef.current = {
      repulsionStrength: graph2dRepulsionStrength,
      linkStiffness: graph2dLinkStiffness,
      velocityDecay: graph2dVelocityDecay,
      linkDistance: graph2dLinkDistance,
      centerForce: graph2dCenterForce,
    }
  })

  // Fora da superficie 2D (outra pagina ou modo 3D), para a fisica e limpa as
  // posicoes transitorias para nao atualizar estado de um grafo desmontado.
  useEffect(() => {
    if (workspacePage === 'graph' && !graphMode3d) return
    if (graphPhysicsFrameRef.current !== null) {
      cancelAnimationFrame(graphPhysicsFrameRef.current)
      graphPhysicsFrameRef.current = null
    }
    graphPhysicsRef.current = null
    graphPhysicsLastTimeRef.current = null
    stopGraph2dWorkerAmbient()
    setGraphHoverPath(null)
  }, [graphMode3d, workspacePage])
  // Header flutuante do grafo com opacidade variavel: aparece com o mouse e
  // some apos alguns segundos de inatividade (imersao).
  const [graphUiVisible, setGraphUiVisible] = useState(true)
  const graphUiHideTimerRef = useRef<number | null>(null)
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false)
  const graphSettingsOpenRef = useRef(false)

  function pokeGraphUi() {
    setGraphUiVisible(true)
    if (graphUiHideTimerRef.current !== null) window.clearTimeout(graphUiHideTimerRef.current)
    graphUiHideTimerRef.current = window.setTimeout(() => {
      // Nao esconde a UI no meio de um arrasto (evita re-render do React
      // durante a animacao) nem com o popover de configuracoes aberto.
      if (!graphSettingsOpenRef.current && !graphNodeDragRef.current) setGraphUiVisible(false)
    }, 2600)
  }

  function setGraphSettingsOpenSynced(open: boolean) {
    graphSettingsOpenRef.current = open
    setGraphSettingsOpen(open)
    if (open) {
      setGraphUiVisible(true)
      if (graphUiHideTimerRef.current !== null) window.clearTimeout(graphUiHideTimerRef.current)
    } else {
      pokeGraphUi()
    }
  }

  useEffect(() => () => {
    if (graphUiHideTimerRef.current !== null) window.clearTimeout(graphUiHideTimerRef.current)
  }, [])
  const [focusedGraphPath, setFocusedGraphPath] = useState<string | null>(null)
  // No do grafo 2D sob o mouse: destaca suas arestas e esmaece os demais.
  const [graphHoverPath, setGraphHoverPath] = useState<string | null>(null)
  const [graphDetailOpen, setGraphDetailOpen] = useState(false)
  const [graphMode, setGraphMode] = useState<GraphMode>('global')
  const [graphLocalDepth, setGraphLocalDepth] = useState(1)
  const [shortcuts, setShortcuts] = useState<WorkspaceShortcuts>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mirrormind.shortcuts') ?? '{}') as Partial<WorkspaceShortcuts>
      // Migracao: o antigo padrao de tres teclas (Ctrl+Shift+M) passa a ser
      // Ctrl+M; valores iguais ao padrao antigo sao tratados como nao definidos.
      if (stored.cycleNoteViewMode === 'Ctrl+Shift+M') delete stored.cycleNoteViewMode
      return { ...DEFAULT_WORKSPACE_SHORTCUTS, ...stored }
    } catch {
      return DEFAULT_WORKSPACE_SHORTCUTS
    }
  })
  // Autosave LIGADO por padrao: ausente no localStorage -> habilitado.
  // Quem desligou explicitamente ("false") continua respeitado.
  const [isAutoSaveEnabled, setAutoSaveEnabled] = useState(
    () => localStorage.getItem('mirrormind.auto-save') !== 'false',
  )
  // Sessão ativa do menu lateral da pagina de Configurações (destacada na
  // navegacao e usada para rolar ate a secao ao clicar).
  const [activeSettingsSection, setActiveSettingsSection] = useState<(typeof SETTINGS_SECTIONS)[number]['id']>('aparencia')
  const settingsScrollRef = useRef<HTMLElement>(null)

  /** Destaque no menu lateral conforme a secao visivel no painel rolavel. */
  useEffect(() => {
    const panel = settingsScrollRef.current
    if (!panel) return
    const updateActiveSection = () => {
      const panelTop = panel.getBoundingClientRect().top
      let current: (typeof SETTINGS_SECTIONS)[number]['id'] = SETTINGS_SECTIONS[0].id
      for (const section of SETTINGS_SECTIONS) {
        const element = document.getElementById(`settings-${section.id}`)
        if (element && element.getBoundingClientRect().top - panelTop <= 140) {
          current = section.id
        }
      }
      setActiveSettingsSection(current)
    }
    updateActiveSection()
    panel.addEventListener('scroll', updateActiveSection, { passive: true })
    return () => panel.removeEventListener('scroll', updateActiveSection)
  }, [])

  /** Rola o painel de Configuracoes ate a secao escolhida no menu lateral. */
  function scrollToSettingsSection(sectionId: (typeof SETTINGS_SECTIONS)[number]['id']) {
    setActiveSettingsSection(sectionId)
    document.getElementById(`settings-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
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
  // Aparência: tema (claro/escuro/seguir Obsidian), fonte do editor/leitura
  // (familia + tamanho) e limite do historico de desfazer/refazer, persistidos.
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => normalizeThemeMode(localStorage.getItem('mirrormind.appearance.theme')),
  )
  const [editorFontFamily, setEditorFontFamily] = useState<EditorFontFamily>(
    () => normalizeFontFamily(localStorage.getItem('mirrormind.appearance.font-family')),
  )
  const [editorFontSize, setEditorFontSize] = useState<number>(
    () => {
      const stored = localStorage.getItem('mirrormind.appearance.font-size')
      return stored === null ? DEFAULT_FONT_SIZE : clampFontSize(Number(stored))
    },
  )
  const [historyLimit, setHistoryLimit] = useState<number>(
    () => {
      const stored = localStorage.getItem('mirrormind.appearance.history-limit')
      return stored === null ? DEFAULT_HISTORY_LIMIT : clampHistoryLimit(Number(stored))
    },
  )
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>(
    () => (localStorage.getItem('mirrormind.reading-width') as ReadingWidth | null) ?? 'comfortable',
  )
  const [isReadingLineWrapEnabled, setReadingLineWrapEnabled] = useState(
    () => localStorage.getItem('mirrormind.reading-line-wrap') !== 'false',
  )
  useEffect(() => {
    localStorage.setItem('mirrormind.review-gap-mode', reviewGapMode)
  }, [reviewGapMode])
  useEffect(() => {
    localStorage.setItem('mirrormind.graph3d.node-size', String(graph3dNodeSize))
    localStorage.setItem('mirrormind.graph3d.node-spacing', String(graph3dNodeSpacing))
    localStorage.setItem('mirrormind.graph3d.orbit-speed', String(graph3dOrbitSpeed))
    localStorage.setItem('mirrormind.graph3d.max-edge-length', String(graph3dMaxEdgeLength))
    localStorage.setItem('mirrormind.graph3d.min-edge-length', String(graph3dMinEdgeLength))
    localStorage.setItem('mirrormind.graph3d.degree-growth', String(graph3dDegreeGrowth))
  }, [graph3dDegreeGrowth, graph3dMaxEdgeLength, graph3dMinEdgeLength, graph3dNodeSize, graph3dNodeSpacing, graph3dOrbitSpeed])
  useEffect(() => {
    localStorage.setItem('mirrormind.graph2d.repulsion-strength', String(graph2dRepulsionStrength))
    localStorage.setItem('mirrormind.graph2d.link-stiffness', String(graph2dLinkStiffness))
    localStorage.setItem('mirrormind.graph2d.velocity-decay', String(graph2dVelocityDecay))
    localStorage.setItem('mirrormind.graph2d.link-distance', String(graph2dLinkDistance))
    localStorage.setItem('mirrormind.graph2d.center-force', String(graph2dCenterForce))
    localStorage.setItem('mirrormind.graph2d.render-limit', String(graphRenderLimit))
  }, [graph2dCenterForce, graph2dLinkDistance, graph2dLinkStiffness, graph2dRepulsionStrength, graph2dVelocityDecay, graphRenderLimit])
  // Resumo diario de revisoes vencidas: verifica a cada 5 minutos enquanto ha
  // um vault aberto. O backend garante no maximo uma notificacao por dia local.
  useEffect(() => {
    if (!vault) return
    let cancelled = false
    async function check() {
      if (cancelled || !vault) return
      try {
        const result = await checkReviewNotifications({
          vaultPath: vault.path,
          nowUnixMs: Date.now(),
          localDayStartUnixMs: localDayStartUnixMs(),
        })
        if (!cancelled) setNotificationLastCheck(result)
      } catch {
        // Silencioso: falhas de notificacao nao devem incomodar a edicao.
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5 * 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [vault])
  const [noteReadiness, setNoteReadiness] = useState<string | null>(null)
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
  const [externalNoteConflict, setExternalNoteConflict] = useState<ExternalNoteConflict | null>(null)
  const [externalRemovedNote, setExternalRemovedNote] = useState<ExternalRemovedNote | null>(null)
  const [recoveredNotePath, setRecoveredNotePath] = useState('')
  const [showNoteLinkDialog, setShowNoteLinkDialog] = useState(false)
  const [noteLinkQuery, setNoteLinkQuery] = useState('')
  const [graphConnectSource, setGraphConnectSource] = useState<GraphDocument | null>(null)
  const [graphConnectQuery, setGraphConnectQuery] = useState('')
  const [tagIndex, setTagIndex] = useState<TagSummary[]>([])
  const [attachments, setAttachments] = useState<string[]>([])
  const [specialFiles, setSpecialFiles] = useState<SpecialVaultFile[]>([])
  const [specialFilesTruncated, setSpecialFilesTruncated] = useState(false)
  // Visualizacao somente leitura de Canvas/Excalidraw (nunca edita o arquivo).
  const [specialFileViewer, setSpecialFileViewer] = useState<SpecialVaultFile | null>(null)
  const [specialFileViewerContent, setSpecialFileViewerContent] = useState<string | null>(null)
  const [specialFileViewerError, setSpecialFileViewerError] = useState<string | null>(null)
  const [vaultDiagnostics, setVaultDiagnostics] = useState<ScanDiagnostics | null>(null)
  const [diagnosticsDismissed, setDiagnosticsDismissed] = useState(false)
  const [showSpecialFilesDialog, setShowSpecialFilesDialog] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagFilterQuery, setTagFilterQuery] = useState('')
  const [showTagFilterDialog, setShowTagFilterDialog] = useState(false)
  const [showTagFilterDropdown, setShowTagFilterDropdown] = useState(false)
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenu | null>(null)
  const [showTagDialog, setShowTagDialog] = useState(false)
  const [tagName, setTagName] = useState('')
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({ canUndo: false, canRedo: false })
  const [loading, setLoading] = useState(false)
  const [wikilinkIndexProgress, setWikilinkIndexProgress] = useState<{ processed: number; total: number } | null>(null)
  const [wikilinkIndexCancelled, setWikilinkIndexCancelled] = useState(false)
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

  // Verificacao de atualizacoes do app: no mount consulta o endpoint do
  // updater (latest.json no GitHub Releases); a versao disponivel vira banner
  // no canto inferior direito. A verificacao manual fica nas Configuracoes >
  // Aplicativo. Fora do runtime Tauri (Vite no navegador) o hook fica 'idle'.
  const appUpdater = useAppUpdater()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  useEffect(() => {
    if (!isTauriRuntime()) return
    void getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion(null))
  }, [])

  // Escape fecha o dialog do topo (um por vez): cada modal se registra na
  // pilha global enquanto aberto. A command palette e o popover do editor
  // tratam Escape manualmente e nao se registram.
  useEscapeToClose(Boolean(externalNoteConflict), () => setExternalNoteConflict(null))
  useEscapeToClose(Boolean(externalRemovedNote), () => setExternalRemovedNote(null))
  useEscapeToClose(showSpecialFilesDialog, () => setShowSpecialFilesDialog(false))
  useEscapeToClose(Boolean(specialFileViewer), () => setSpecialFileViewer(null))
  useEscapeToClose(showNoteSearch, () => setShowNoteSearch(false))
  useEscapeToClose(showNoteLinkDialog, () => setShowNoteLinkDialog(false))
  useEscapeToClose(showTagFilterDialog, () => setShowTagFilterDialog(false))
  useEscapeToClose(showTagDialog, () => setShowTagDialog(false))
  useEscapeToClose(showFolderDialog, () => setShowFolderDialog(false))
  useEscapeToClose(Boolean(renameTarget), () => setRenameTarget(null))
  useEscapeToClose(Boolean(moveTarget), () => setMoveTarget(null))
  useEscapeToClose(Boolean(deleteTarget), () => setDeleteTarget(null))
  useEscapeToClose(Boolean(permanentDeleteTarget), () => setPermanentDeleteTarget(null))
  useEscapeToClose(Boolean(graphConnectSource), () => setGraphConnectSource(null))

  const isDirty = activeNote !== null && draftContent !== activeNote.content
  // Lacunas da ultima revisao para o motor unico (modo Leitura = Misto
  // read-only): mesma condicao do classico — desliga com o modo 'off' ou com
  // a nota editada (offsets ficam obsoletos). `bodyOffset` desloca os offsets
  // (que incluem o frontmatter) quando o doc do editor nao tem frontmatter.
  const reviewGapData = reviewGapMode !== 'off' && !isDirty
    ? {
      gaps: reviewGaps,
      units: reviewUnits,
      enabled: true,
      bodyOffset: draftContent.length - getMarkdownBody(draftContent).length,
    }
    : null
  const noteTags = extractMarkdownTags(draftContent)
  const frontmatterProperties = getMarkdownFrontmatterProperties(draftContent)
  const noteBody = getMarkdownBody(draftContent)
  const noteWordCount = useMemo(() => countMarkdownWords(draftContent), [draftContent])
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
    '--reading-font-size': `${editorFontSize}px`,
  } as CSSProperties
  const handleVaultSelection = useEffectEvent(async (selectedVault: VaultSummary) => {
    await refreshNotes(selectedVault.path)
    // Constroi o indice de wikilinks do Vault em segundo plano (backlinks e
    // autocomplete sem depender do grafo aberto).
    void buildVaultWikilinkIndex(selectedVault.path)
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
    if (vault && activeNote && isDirty && matchesShortcut(event, shortcuts.saveNote)) {
      event.preventDefault()
      void saveActiveNote()
      return
    }
    if (activeNote && matchesShortcut(event, shortcuts.cycleNoteViewMode)) {
      event.preventDefault()
      cycleNoteViewMode()
      return
    }

    if (event.target instanceof HTMLElement && event.target.closest('.cm-content')) {
      return
    }

    if (activeNote && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openNoteFind()
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
        setStatus(`Nota atualizada a partir de uma alteração externa: ${externalNote.relativePath}`)
        return
      }

      setExternalNoteConflict({ externalNote, localContent: draftContentRef.current })
    } catch {
      // The note may be temporarily unavailable while another application writes it.
    }
  })
  const remapWorkspacePathsForExternalChange = useEffectEvent((sourcePath: string, destinationPath: string) => {
    const remapPath = (path: string) => remapVaultPath(path, sourcePath, destinationPath)
    const remapRecord = <T,>(record: Record<string, T>) => Object.fromEntries(
      Object.entries(record).map(([path, value]) => [remapPath(path), value]),
    )

    setOpenTabs((tabs) => tabs.map(remapPath))
    setDraftsByPath(remapRecord)
    setEditorSessionsByPath(remapRecord)
    setFavorites((paths) => paths.map(remapPath))
    setExpandedFolderIds((paths) => new Set([...paths].map(remapPath)))
    setActiveNote((note) => {
      if (!note) return note
      const relativePath = remapPath(note.relativePath)
      return relativePath === note.relativePath
        ? note
        : { ...note, relativePath, name: relativePath.split('/').at(-1) ?? note.name }
    })
    if (inlineTitleRenamePathRef.current) {
      inlineTitleRenamePathRef.current = remapPath(inlineTitleRenamePathRef.current)
    }
    markdownEditorStateCacheRef.current = new Map(
      [...markdownEditorStateCacheRef.current.entries()].map(([key, value]) => {
        const separatorIndex = key.indexOf('::')
        const notePath = separatorIndex === -1 ? key : key.slice(0, separatorIndex)
        const suffix = separatorIndex === -1 ? '' : key.slice(separatorIndex)
        return [`${remapPath(notePath)}${suffix}`, value]
      }),
    )
  })
  const checkExternalVaultTree = useEffectEvent(async (change?: VaultFileSystemChange) => {
    if (!vault || saveInFlightRef.current) return
    const vaultPath = vault.path

    try {
      const renamePaths = change?.kind === 'rename' && change.paths.length >= 2
        ? [change.paths[0], change.paths.at(-1) ?? change.paths[1]] as const
        : null
      let trackedTabs = renamePaths
        ? openTabsRef.current.map((path) => remapVaultPath(path, renamePaths[0], renamePaths[1]))
        : openTabsRef.current
      if (renamePaths) {
        remapWorkspacePathsForExternalChange(renamePaths[0], renamePaths[1])
      }

      // Inventario incremental: mudancas simples de anexos/pastas (criacao,
      // remocao ou renomeacao, sem nota ou arquivo especial envolvido e sem
      // rescan/modify) sao aplicadas ao inventario em memoria no backend em
      // vez de re-varrer o Vault inteiro. A reconciliacao periodica (30s) e a
      // varredura manual continuam corrigindo qualquer divergencia.
      if (canApplyInventoryIncrementally(change)) {
        const updated = await invoke<unknown>('apply_vault_inventory_changes', {
          path: vaultPath,
          changes: [change],
        }).catch(() => null)
        if (activeVaultPathRef.current !== vaultPath) return
        if (updated) {
          const inventory = parseVaultInventory(updated)
          setFolders(inventory.folders)
          setAttachments(inventory.attachments)
        }
        return
      }

      // Varredura unificada: uma unica passagem no backend produz notas,
      // pastas, anexos e arquivos especiais (em vez de quatro varreduras).
      const inventory = parseVaultInventory(await invoke<unknown>('scan_vault_inventory', { path: vaultPath }))
      if (activeVaultPathRef.current !== vaultPath) return
      const nextNotes = inventory.notes
      const nextFolders = inventory.folders
      const nextSpecialInventory = inventory.specialFiles
      const nextSpecialFiles = nextSpecialInventory.files
      const previousNotePaths = notesRef.current.map((note) => note.relativePath)
      const nextNotePaths = nextNotes.map((note) => note.relativePath)
      const { removedPaths: removedLearningPaths, createdPaths: createdLearningPaths } = diffVaultNotePaths(previousNotePaths, nextNotePaths)
      const reconciledLearningNotePairs = removedLearningPaths.length > 0 && createdLearningPaths.length > 0
        ? await invoke<Array<[string, string]>>('reconcile_external_learning_paths', {
            path: vaultPath,
            removedPaths: removedLearningPaths,
            createdPaths: createdLearningPaths,
          }).catch(() => [])
        : []
      for (const [sourcePath, destinationPath] of reconciledLearningNotePairs) {
        // O backend so confirma pares cujo hash de conteudo e identico: o remapeamento
        // do workspace segue identidade verificada, nunca adivinha.
        remapWorkspacePathsForExternalChange(sourcePath, destinationPath)
        trackedTabs = trackedTabs.map((path) => remapVaultPath(path, sourcePath, destinationPath))
      }
      const currentSnapshot = JSON.stringify({ folders: [...foldersRef.current].sort(), notes: notesRef.current.map((note) => note.relativePath).sort(), specialFiles: specialFilesRef.current.map((file) => file.relativePath).sort(), specialFilesTruncated: specialFilesTruncatedRef.current })
      const nextSnapshot = JSON.stringify({ folders: [...nextFolders].sort(), notes: nextNotes.map((note) => note.relativePath).sort(), specialFiles: nextSpecialFiles.map((file) => file.relativePath).sort(), specialFilesTruncated: nextSpecialInventory.truncated })
      const availablePaths = new Set(nextNotes.map((note) => note.relativePath))
      const removedPaths = change?.kind === 'remove' ? change.paths : []
      const missingTabs = trackedTabs.filter((path) => path !== '__new_note__' && !availablePaths.has(path))
      const prioritizedMissingTabs = [...missingTabs].sort((left, right) => {
        const leftMatchesEvent = removedPaths.some((path) => isVaultPathAffected(left, path))
        const rightMatchesEvent = removedPaths.some((path) => isVaultPathAffected(right, path))
        return Number(rightMatchesEvent) - Number(leftMatchesEvent)
      })
      const queuedPaths = new Set([
        externalRemovedNote?.relativePath,
        ...externalRemovedNoteQueueRef.current.map((note) => note.relativePath),
      ])
      for (const missingTab of prioritizedMissingTabs) {
        if (queuedPaths.has(missingTab)) continue
        const wasActive = activeNoteRef.current?.relativePath === missingTab
        externalRemovedNoteQueueRef.current.push({
          relativePath: missingTab,
          content: wasActive ? draftContentRef.current : draftsByPathRef.current[missingTab] ?? '',
          wasActive,
        })
      }
      if (!externalRemovedNote) {
        const nextRemovedNote = externalRemovedNoteQueueRef.current.shift()
        if (nextRemovedNote) {
          setExternalRemovedNote(nextRemovedNote)
          setRecoveredNotePath(nextRemovedNote.relativePath.replace(/\.md$/i, '-recuperada.md'))
        }
      }
      if (currentSnapshot === nextSnapshot) return

      setNotes(nextNotes)
      setFolders(nextFolders)
      setSpecialFiles(nextSpecialFiles)
      setSpecialFilesTruncated(nextSpecialInventory.truncated)
      setVaultDiagnostics(inventory.diagnostics)
      setDiagnosticsDismissed(false)
      const nextTagIndex = await invoke<TagSummary[]>('get_tag_index', { path: vaultPath })
      if (activeVaultPathRef.current !== vaultPath) return
      setTagIndex(nextTagIndex)
      setAttachments(inventory.attachments)
      const activePath = renamePaths && activeNoteRef.current
        ? remapVaultPath(activeNoteRef.current.relativePath, renamePaths[0], renamePaths[1])
        : activeNoteRef.current?.relativePath
      const reconciledLearningNoteCount = reconciledLearningNotePairs.length
      setStatus(activePath && !availablePaths.has(activePath)
        ? 'A nota aberta foi removida ou movida fora do MirrorMind. O rascunho local foi preservado.'
        : reconciledLearningNoteCount > 0
          ? `Aprendizado preservado em ${reconciledLearningNoteCount} ${reconciledLearningNoteCount === 1 ? 'nota movida' : 'notas movidas'} externamente.`
          : 'Explorador atualizado a partir de uma alteração externa.')
    } catch {
      // Another application may be writing the vault while it is scanned.
    }
  })

  const requestExternalVaultTreeCheck = useEffectEvent((change?: VaultFileSystemChange) => {
    externalVaultScanCoordinatorRef.current ??= createVaultScanCoordinator(checkExternalVaultTree)
    return externalVaultScanCoordinatorRef.current(change)
  })

  const refreshGraphWhenNotesChange = useEffectEvent(() => {
    if (workspacePage === 'graph' && vault && graphDocuments.length > 0) void openGraphPage()
  })

  useEffect(() => {
    graphLoadRequestRef.current += 1
    if (!vault) {
      setNotes([])
      setFolders([])
      setActiveNote(null)
      setOpenTabs([])
      setDraftContent('')
      setDraftsByPath({})
      setBacklinks([])
      setBrokenLinks([])
      setExternalNoteConflict(null)
      setExternalRemovedNote(null)
      graphTagIndexRef.current = new TagIndex()
      externalRemovedNoteQueueRef.current = []
      setRecoveredNotePath('')
      setTagIndex([])
      setAttachments([])
      setSpecialFiles([])
      setSpecialFilesTruncated(false)
      setVaultDiagnostics(null)
      setDiagnosticsDismissed(false)
      setShowSpecialFilesDialog(false)
      setSelectedTags([])
      setTagFilterQuery('')
      return
    }

    void handleVaultSelection(vault)
  }, [vault])

  // Captura phase: o atalho roda antes de qualquer outro listener (CodeMirror,
  // inputs, modais) e nao pode ser engolido por stopPropagation.
  useEffect(() => {
    window.addEventListener('keydown', handleWorkspaceShortcut, true)
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut, true)
  }, [])

  useEffect(() => {
    if (!vault) return
    try {
      const stored = JSON.parse(localStorage.getItem(`mirrormind.graph.${vault.path}`) ?? '{}') as Partial<{ positions: Record<string, GraphPosition>; viewport: GraphViewport; folder: string; tag: string; showOrphans: boolean; hideAllNames: boolean; mode: GraphMode; localDepth: number; groupByFolder: boolean; groupByTag: boolean; primaryTag: string; colorOverrides: Record<string, string> }>
      setGraphNodeOverrides(stored.positions ?? {})
      setGraphViewport(stored.viewport ?? { scale: 1, x: 0, y: 0 })
      setGraphFolder(stored.folder ?? '')
      setGraphTag(stored.tag ?? '')
      setShowGraphOrphans(stored.showOrphans ?? true)
      setGraphHideAllNames(stored.hideAllNames ?? false)
      setGraphMode(stored.mode ?? 'global')
      setGraphLocalDepth(stored.localDepth ?? 1)
      setGraphGroupByFolder(stored.groupByFolder ?? false)
      setGraphGroupByTag(stored.groupByTag ?? false)
      setGraphPrimaryTag(stored.primaryTag ?? '')
      setGraphColorOverrides(stored.colorOverrides ?? {})
    } catch {
      setGraphNodeOverrides({})
    }
  }, [vault])

  useEffect(() => {
    if (!vault) return
    localStorage.setItem(`mirrormind.graph.${vault.path}`, JSON.stringify({
      positions: graphNodeOverrides,
      viewport: graphViewport,
      folder: graphFolder,
      tag: graphTag,
      showOrphans: showGraphOrphans,
      hideAllNames: graphHideAllNames,
      mode: graphMode,
      localDepth: graphLocalDepth,
      groupByFolder: graphGroupByFolder,
      groupByTag: graphGroupByTag,
      primaryTag: graphPrimaryTag,
      colorOverrides: graphColorOverrides,
    }))
  }, [graphColorOverrides, graphFolder, graphGroupByFolder, graphGroupByTag, graphHideAllNames, graphLocalDepth, graphMode, graphNodeOverrides, graphPrimaryTag, graphTag, graphViewport, showGraphOrphans, vault])

  // Ao abrir a pagina do grafo, ajusta o viewport para que todas as notas
  // fiquem visiveis (encaixa o conteudo no painel), independente do zoom/pan
  // que o usuario tenha deixado da ultima vez.
  useEffect(() => {
    if (workspacePage !== 'graph' || isGraphLoading || graphDocuments.length === 0) return
    const surface = graphSurfaceRef.current
    if (!surface) return
    const width = surface.clientWidth
    const height = surface.clientHeight
    if (width <= 0 || height <= 0) return
    // Mesma formula de graphNodePositions (override do usuario ou circulo).
    const circleRadius = graphDocuments.length < 3 ? 56 : 68
    const positions = graphDocuments.map((document, index) => {
      const override = graphNodeOverrides[document.relativePath]
      if (override) return override
      const angle = (Math.PI * 2 * index) / Math.max(graphDocuments.length, 1) - Math.PI / 2
      return { x: GRAPH_2D_WORLD_CENTER + Math.cos(angle) * circleRadius, y: GRAPH_2D_WORLD_CENTER + Math.sin(angle) * circleRadius }
    })
    if (positions.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const position of positions) {
      minX = Math.min(minX, position.x)
      minY = Math.min(minY, position.y)
      maxX = Math.max(maxX, position.x)
      maxY = Math.max(maxY, position.y)
    }
    const spanX = Math.max(maxX - minX, 10)
    const spanY = Math.max(maxY - minY, 10)
    const scale = Math.max(
      0.35,
      Math.min(1.15, Math.min((width - 170) / ((spanX / GRAPH_2D_WORLD_SIZE) * width), (height - 130) / ((spanY / GRAPH_2D_WORLD_SIZE) * height))),
    )
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    setGraphViewport({
      scale,
      x: width / 2 - (centerX / GRAPH_2D_WORLD_SIZE) * width * scale,
      y: height / 2 - (centerY / GRAPH_2D_WORLD_SIZE) * height * scale,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePage, isGraphLoading])

  useEffect(() => {
    const query = graphQuery.trim().toLowerCase()
    if (!query) return
    const index = graphDocuments.findIndex((document) => document.name.replace(/\.md$/i, '').toLowerCase().includes(query))
    if (index === -1) return
    const document = graphDocuments[index]
    setFocusedGraphPath(document.relativePath)
    // Modo 3D: sem superficie 2D para panoramizar — o destaque e os pulsos do
    // componente 3D ja localizam a nota; o pan/zoom do viewport e do 2D.
    if (!graphSurfaceRef.current) return
    const angle = (Math.PI * 2 * index) / Math.max(graphDocuments.length, 1) - Math.PI / 2
    const position = graphNodeOverrides[document.relativePath] ?? { x: GRAPH_2D_WORLD_CENTER + Math.cos(angle) * (graphDocuments.length < 3 ? 56 : 68), y: GRAPH_2D_WORLD_CENTER + Math.sin(angle) * (graphDocuments.length < 3 ? 56 : 68) }
    const bounds = graphSurfaceRef.current.getBoundingClientRect()
    const scale = 1.2
    setGraphViewport({
      scale,
      x: (bounds.width / 2) - ((position.x / GRAPH_2D_WORLD_SIZE) * bounds.width * scale),
      y: (bounds.height / 2) - ((position.y / GRAPH_2D_WORLD_SIZE) * bounds.height * scale),
    })
  }, [graphDocuments, graphNodeOverrides, graphQuery])

  useEffect(() => {
    refreshGraphWhenNotesChange()
  }, [notes])

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

  // Aparencia: persiste tema, fonte e historico e aplica o tema no documento
  // (atributo `data-theme` lido pelo CSS) e as variaveis de fonte/leitura.
  useEffect(() => {
    localStorage.setItem('mirrormind.appearance.theme', themeMode)
  }, [themeMode])

  useEffect(() => {
    localStorage.setItem('mirrormind.appearance.font-family', editorFontFamily)
  }, [editorFontFamily])

  useEffect(() => {
    localStorage.setItem('mirrormind.appearance.font-size', String(editorFontSize))
  }, [editorFontSize])

  useEffect(() => {
    localStorage.setItem('mirrormind.appearance.history-limit', String(historyLimit))
  }, [historyLimit])

  const effectiveTheme = effectiveThemeMode(themeMode, vault?.obsidianAppearance ?? null)
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
  }, [effectiveTheme])

  // Fonte do editor/leitura: familia e tamanho aplicados no espaco de trabalho
  // via variaveis CSS consumidas pelo editor (CodeMirror) e pelo modo Leitura.
  const editorFontStyle = {
    '--editor-font-family': fontFamilyCss(editorFontFamily),
    '--editor-font-size': `${editorFontSize}px`,
  } as CSSProperties

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
    notesRef.current = notes
    foldersRef.current = folders
    specialFilesRef.current = specialFiles
    specialFilesTruncatedRef.current = specialFilesTruncated
  }, [folders, notes, specialFiles, specialFilesTruncated])

  useEffect(() => {
    if (specialFiles.length === 0) setShowSpecialFilesDialog(false)
  }, [specialFiles.length])

  useEffect(() => {
    openTabsRef.current = openTabs
    draftsByPathRef.current = draftsByPath
  }, [draftsByPath, openTabs])

  useEffect(() => {
    setExternalNoteConflict(null)
    // O conteudo do popover desmonta quando fechado, entao o dot de status
    // precisa ser resetado ao trocar de nota (senao mostraria o estado antigo).
    setNoteReadiness(null)
    setReviewUnits([])
  }, [activeNote?.relativePath])

  useEffect(() => {
    if (!vault || !activeNote || isNewNoteDraft) {
      setReviewGaps([])
      setReviewUnits([])
      return
    }
    let disposed = false
    void getNoteReviewGaps({ vaultPath: vault.path, relativePath: activeNote.relativePath })
      .then((gaps) => {
        if (disposed) return
        setReviewGaps(gaps)
      })
      .catch(() => {
        if (!disposed) setReviewGaps([])
      })
    void getNoteReviewUnits({ vaultPath: vault.path, relativePath: activeNote.relativePath })
      .then((units) => {
        if (disposed) return
        setReviewUnits(units)
      })
      .catch(() => {
        if (!disposed) setReviewUnits([])
      })
    return () => {
      disposed = true
    }
  }, [activeNote, isNewNoteDraft, vault])

  useEffect(() => {
    if (!vault || !activeNote || isNewNoteDraft) return
    const interval = window.setInterval(() => void checkExternalNoteChange(), 2_500)
    return () => window.clearInterval(interval)
  }, [activeNote, isNewNoteDraft, vault])

  useEffect(() => {
    if (!vault) return
    const interval = window.setInterval(() => void requestExternalVaultTreeCheck(), 30_000)
    return () => window.clearInterval(interval)
  }, [vault])

  useEffect(() => {
    if (!vault) return
    let disposed = false
    let unlisten: (() => void) | undefined
    let watcherId: number | undefined
    const requestId = nextVaultWatcherRequestId
    nextVaultWatcherRequestId += 1
    activeVaultWatcherRequestRef.current = requestId

    void (async () => {
      try {
        const cleanup = await listen<ScopedVaultFileSystemChange>('vault-file-system-change', (event) => {
          if (!isVaultWatcherEventForRequest(event.payload, requestId)) return
          const queueAction = enqueueVaultFileSystemChange(vaultChangeQueueRef.current, event.payload)
          if (queueAction === 'unchanged') return
          if (vaultChangeDebounceRef.current !== null) {
            window.clearTimeout(vaultChangeDebounceRef.current)
          }
          vaultChangeDebounceRef.current = window.setTimeout(() => {
            const changes = vaultChangeQueueRef.current.splice(0)
            vaultChangeDebounceRef.current = null
            const primaryChange = changes.find((change) => change.kind === 'rename' && change.paths.length >= 2)
              ?? changes.at(-1)
            if (changes.some((change) => change.kind === 'modify')) {
              void checkExternalNoteChange()
            }
            void requestExternalVaultTreeCheck(primaryChange)
          }, queueAction === 'rescan' ? 0 : 220)
        })
        if (disposed || activeVaultWatcherRequestRef.current !== requestId) {
          cleanup()
          return
        }
        unlisten = cleanup

        const id = await invoke<number>('watch_vault', { path: vault.path, requestId })
        if (disposed || activeVaultWatcherRequestRef.current !== requestId) {
          void invoke('unwatch_vault', { watcherId: id }).catch(() => undefined)
          return
        }
        watcherId = id
      } catch {
        if (!disposed && activeVaultWatcherRequestRef.current === requestId) {
          setStatus('Eventos nativos indisponiveis; a sincronização externa usara verificação periodica.')
        }
      }
    })()

    return () => {
      disposed = true
      unlisten?.()
      vaultChangeQueueRef.current = []
      if (vaultChangeDebounceRef.current !== null) {
        window.clearTimeout(vaultChangeDebounceRef.current)
        vaultChangeDebounceRef.current = null
      }
      if (watcherId !== undefined) {
        void invoke('unwatch_vault', { watcherId }).catch(() => undefined)
      }
    }
  }, [vault])

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

  // Progresso da (re)construcao do indice de wikilinks durante uma
  // renomeacao/movimentacao (eventos emitidos pelo backend).
  useEffect(() => {
    if (!vault) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<{ processed: number; total: number }>('wikilink-index-progress', (event) => {
      if (disposed) return
      const { processed, total } = event.payload
      if (typeof processed !== 'number' || typeof total !== 'number' || total < 1) return
      setWikilinkIndexProgress({ processed: Math.min(processed, total), total })
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unlisten = cleanup
    })
    return () => {
      disposed = true
      unlisten?.()
      setWikilinkIndexProgress(null)
      setWikilinkIndexCancelled(false)
    }
  }, [vault])

  useEffect(() => {
    markdownEditorStateCacheRef.current.clear()
    vaultNoteContentsRef.current = null
    setMarkdownHistoryStatus({ canUndo: false, canRedo: false })
  }, [vault?.path])

  useEffect(() => {
    if (editorMode === 'read') setMarkdownToolsOpen(false)
  }, [editorMode])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    try {
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
    } catch {
      // Fora do runtime Tauri (ex.: a URL do Vite aberta no navegador), o
      // drag-and-drop nativo fica indisponivel sem derrubar a aplicacao.
    }
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
        caughtError instanceof Error ? caughtError.message : 'Não foi possível abrir o vault.'
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
    setStatus('Reabrindo o último vault usado...')

    try {
      const vaultPayload = await invoke<unknown>('reopen_recent_vault')
      if (!vaultPayload) {
        setStatus('O último vault nao esta mais disponivel. Escolha outra pasta.')
        return
      }

      const parsedVault = parseVaultSummary(vaultPayload)
      setVault(parsedVault)
      setStatus(`Vault reaberto: ${parsedVault.name}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Não foi possível reabrir o último vault.'
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
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar a preferencia.')
    }
  }

  async function dismissRecentVault() {
    try {
      if (skipRecentVaultPrompt) {
        await updateRecentVaultPromptPreference(false)
      }
      setShowRecentVaultModal(false)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar a preferencia.')
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
      setError('Escolha a pasta onde o novo vault será criado.')
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
        caughtError instanceof Error ? caughtError.message : 'Não foi possível criar o vault.'
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
      setStatus('Metadados inicializados. Este vault ja pode receber revisões.')
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Não foi possível inicializar os metadados.'
      setError(message)
      setStatus('Falha ao preparar o vault para revisões.')
    } finally {
      setLoading(false)
    }
  }

  /** Constroi o indice de wikilinks do Vault inteiro em segundo plano com a
   *  leitura unificada (`read_vault_notes`, UMA chamada IPC em vez de N
   *  `read_note`). Alimenta backlinks e autocomplete sem exigir que o grafo
   *  esteja aberto e popula o cache de conteudos que o grafo reutiliza. */
  async function buildVaultWikilinkIndex(vaultPath: string) {
    const requestId = vaultWikilinkIndexRequestRef.current + 1
    vaultWikilinkIndexRequestRef.current = requestId
    vaultWikilinkIndexLoadedPathRef.current = vaultPath
    try {
      const allNotes = parseNoteDocumentList(
        await invoke<unknown>('read_vault_notes', { path: vaultPath }),
      )
      if (requestId !== vaultWikilinkIndexRequestRef.current || vaultWikilinkIndexLoadedPathRef.current !== vaultPath) return
      const contents = allNotes.map((note) => ({ relativePath: note.relativePath, content: note.content }))
      vaultWikilinkIndexRef.current = buildWikilinkIndex(contents)
      vaultNoteContentsRef.current = {
        vaultPath,
        documents: new Map(allNotes.map((note) => [note.relativePath, note])),
      }
      // Atualiza os backlinks da nota ativa com o indice pronto.
      if (vault && activeNoteRef.current && activeNoteRef.current.relativePath !== '__new_note__') {
        setBacklinks(resolveBacklinksFromIndex(vaultWikilinkIndexRef.current, activeNoteRef.current.relativePath))
      }
    } catch {
      // Indexacao em segundo plano nunca derruba a interface; o get_backlinks
      // (varredura no disco) continua como fallback.
      vaultWikilinkIndexRef.current = null
    }
  }

  async function retryVaultDiagnostics() {
    if (!vault) return
    try {
      const inventory = parseVaultInventory(
        await invoke<unknown>('scan_vault_inventory', { path: vault.path }),
      )
      setVaultDiagnostics(inventory.diagnostics)
      setDiagnosticsDismissed(false)
      setStatus('Varredura refeita.')
    } catch {
      setVaultDiagnostics(null)
      setStatus('Não foi possível refazer a varredura do vault.')
    }
  }

  async function refreshNotes(vaultPath: string, preferredPath?: string) {
    setLoading(true)
    setError(null)

    try {
      // Varredura unificada: uma unica passagem no backend produz notas,
      // pastas, anexos e arquivos especiais.
      const inventory = parseVaultInventory(await invoke<unknown>('scan_vault_inventory', { path: vaultPath }))
      const nextNotes = inventory.notes
      const nextFolders = inventory.folders
      const nextTagIndex = await invoke<TagSummary[]>('get_tag_index', { path: vaultPath })
      const nextAttachments = inventory.attachments
      const nextSpecialInventory = inventory.specialFiles
      const nextSpecialFiles = nextSpecialInventory.files
      const nextFavorites = await invoke<string[]>('list_favorites', { path: vaultPath })
      const nextTemplates = await invoke<NoteTemplate[]>('list_templates', { path: vaultPath })
      setNotes(nextNotes)
      setFolders(nextFolders)
      setTagIndex(nextTagIndex)
      setAttachments(nextAttachments)
      setSpecialFiles(nextSpecialFiles)
      setSpecialFilesTruncated(nextSpecialInventory.truncated)
      setFavorites(nextFavorites)
      setTemplates(nextTemplates)
      setVaultDiagnostics(inventory.diagnostics)
      setDiagnosticsDismissed(false)

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
        caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar as notas.'
      setError(message)
      setStatus('Falha ao carregar a lista de notas do vault.')
    } finally {
      setLoading(false)
    }
  }

  async function openSpecialFileViewer(file: SpecialVaultFile) {
    if (!vault || (file.kind !== 'canvas' && file.kind !== 'excalidraw')) return
    setSpecialFileViewer(file)
    setSpecialFileViewerContent(null)
    setSpecialFileViewerError(null)
    try {
      const payload = await invoke<number[]>('read_special_vault_file', {
        path: vault.path,
        relativePath: file.relativePath,
      })
      const bytes = payload instanceof Array ? payload : Array.from(payload as ArrayLike<number>)
      setSpecialFileViewerContent(new TextDecoder().decode(Uint8Array.from(bytes)))
    } catch (cause) {
      setSpecialFileViewerError(cause instanceof Error ? cause.message : 'Não foi possível ler o arquivo especial.')
    }
  }

  async function openTagManagementPage() {
    if (!vault) return
    setLoading(true)
    setError(null)
    try {
      const activePath = activeNoteRef.current?.relativePath
      await persistWorkspaceDraftsBeforePathChange(vault.path)
      if (activePath && activePath !== '__new_note__') {
        const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath: activePath })
        const savedNote = parseNoteDocument(payload)
        setActiveNote(savedNote)
        setDraftContent(savedNote.content)
      }
      setWorkspacePage('tags')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível abrir a página de tags.')
    } finally {
      setLoading(false)
    }
  }

  async function synchronizeTagChanges(markdownNotePaths: string[]) {
    if (!vault) return
    const nextTagIndex = await invoke<TagSummary[]>('get_tag_index', { path: vault.path })
    setTagIndex(nextTagIndex)
    const current = activeNoteRef.current
    if (!current || !markdownNotePaths.includes(current.relativePath)) return
    const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath: current.relativePath })
    const updated = parseNoteDocument(payload)
    markdownEditorStateCacheRef.current.delete(updated.relativePath)
    setEditorSessionsByPath((sessions) => {
      const { [updated.relativePath]: _discarded, ...remaining } = sessions
      return remaining
    })
    setActiveNote(updated)
    setDraftContent(updated.content)
    setDraftsByPath((drafts) => {
      const { [updated.relativePath]: _discarded, ...remaining } = drafts
      return remaining
    })
  }
  /** Abre uma sessao de revisao imediata para a nota ativa: usa o item da
   *  fila quando a nota ja esta vencida; senao sintetiza um item com os
   *  dados de estado (a sessao so valida notas prontas e inscritas). */
  async function handleStartReviewNow(info: ReviewStartInfo | null) {
    if (!vault || !activeNote) return
    let dueItem: DueReviewItem | null = null
    try {
      const queue = await getDueReviewQueue(vault.path)
      dueItem = queue.find((candidate) => candidate.relativePath === activeNote.relativePath) ?? null
    } catch {
      dueItem = null
    }
    const synthesizedItem: DueReviewItem = {
      noteId: info?.noteId ?? activeNote.relativePath,
      relativePath: activeNote.relativePath,
      title: activeNote.name.replace(/\.md$/i, ''),
      nextReviewAtUnixMs: info?.nextReviewAtUnixMs ?? Date.now(),
      priorityWeight: 1,
      deadlineAtUnixMs: null,
      preferredMode: info?.preferredMode ?? 'exam',
      isFirstReview: info?.firstReviewAtUnixMs == null,
    }
    setReviewMenuOpen(false)
    setActiveReviewItem(dueItem ?? synthesizedItem)
    setWorkspacePage('review')
  }

  /** Inicia uma revisao direto do dashboard (prazo ativo e encerrado): usa o
   *  item real da fila quando existe; senao sintetiza com os dados do prazo
   *  (itens encerrados nao carregam prioridade, entao usa 1 como fallback).
   *  A sessao valida no backend prontidao, adesao e vencimento. */
  async function handleStartReviewFromDeadline(item: UpcomingDeadlineItem | ExpiredDeadlineItem) {
    if (!vault) return
    let dueItem: DueReviewItem | null = null
    try {
      const queue = await getDueReviewQueue(vault.path)
      dueItem = queue.find((candidate) => candidate.noteId === item.noteId) ?? null
    } catch {
      dueItem = null
    }
    const synthesizedItem: DueReviewItem = {
      noteId: item.noteId,
      relativePath: item.relativePath,
      title: item.title,
      nextReviewAtUnixMs: Date.now(),
      priorityWeight: 'priorityWeight' in item ? item.priorityWeight : 1,
      deadlineAtUnixMs: item.deadlineAtUnixMs,
      // Quando o item real da fila existe, preserva o modo preferido da nota;
      // no fallback sintetizado (sem fila) usa o padrao Prova.
      preferredMode: dueItem?.preferredMode ?? 'exam',
      isFirstReview: false,
    }
    setActiveReviewItem(dueItem ?? synthesizedItem)
    setWorkspacePage('review')
  }

  /** Auditoria estrutural deterministica (sem IA) da nota aberta: consome a
   *  mesma regra de segmentacao por secoes e devolve achados com sugestoes.
   *  Roda sobre o conteudo salvo em disco (como a avaliacao de prontidao). */
  async function runStructuralAudit() {
    if (!vault || !activeNote || isNewNoteDraft) return
    setStructuralAuditLoading(true)
    setStructuralAuditError(null)
    setStructuralAuditAppliedIndex(null)
    try {
      const result = await auditNoteStructure({
        vaultPath: vault.path,
        relativePath: activeNote.relativePath,
      })
      setStructuralAudit(result)
    } catch (error) {
      setStructuralAuditError(error instanceof Error ? error.message : String(error))
    } finally {
      setStructuralAuditLoading(false)
    }
  }

  /** Verificacao factual opcional (separada da avaliacao de memoria): compara
   *  as afirmacoes da nota com o conhecimento do modelo, distingue fatos
   *  confirmados/divergentes/incertos e NUNCA altera a nota nem as pontuacoes. */
  async function runFactCheck() {
    if (!vault || !activeNote || isNewNoteDraft) return
    setFactCheckLoading(true)
    setFactCheckError(null)
    setFactCheck(null)
    try {
      const result = await verifyNoteFacts({
        vaultPath: vault.path,
        relativePath: activeNote.relativePath,
        provider: reviewProvider,
      })
      setFactCheck(result)
    } catch (error) {
      setFactCheckError(error instanceof Error ? error.message : String(error))
    } finally {
      setFactCheckLoading(false)
    }
  }

  /** Aplica uma sugestao com edicao determinista ao rascunho do editor. O
   *  usuario revisa no editor e salva — nunca editamos o Markdown sozinhos. */
  function handleApplyStructuralAuditEdit(index: number) {
    const edit = structuralAudit?.findings[index]?.edit
    if (!edit) return
    const nextContent = applyStructuralAuditEdit(draftContent, edit)
    if (nextContent === null) {
      setStructuralAuditError('Não foi possível aplicar a sugestão (offsets desatualizados). Re-execute a auditoria.')
      return
    }
    setDraftContent(nextContent)
    setStructuralAuditAppliedIndex(index)
  }

  // Re-executa a auditoria sempre que o painel abre (o conteudo salvo pode ter
  // mudado) e fecha/limpa ao trocar de nota.
  useEffect(() => {
    if (structuralAuditOpen && vault && activeNote && !isNewNoteDraft) {
      void runStructuralAudit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralAuditOpen])

  useEffect(() => {
    setStructuralAuditOpen(false)
    setStructuralAudit(null)
    setStructuralAuditError(null)
    setStructuralAuditAppliedIndex(null)
    setFactCheckOpen(false)
    setFactCheck(null)
    setFactCheckError(null)
  }, [activeNote?.relativePath])

  /** Le todos os conteudos do Vault em UMA chamada IPC (`read_vault_notes`),
   *  ouvindo o progresso emitido pelo backend para a UI nao parecer travada em
   *  Vaults grandes. O listener e removido ao concluir. */
  async function readAllVaultNotesWithProgress(requestId: number, vaultPath: string) {
    const unlistenProgress = await listen<{ processed: number; total: number }>('vault-notes-read-progress', (event) => {
      if (requestId === graphLoadRequestRef.current && vault?.path === vaultPath) {
        setGraphLoadProgress(event.payload.processed)
      }
    })
    try {
      return parseNoteDocumentList(await invoke<unknown>('read_vault_notes', { path: vaultPath }))
    } finally {
      unlistenProgress()
    }
  }

  async function openGraphPage() {
    if (!vault) return
    const requestId = graphLoadRequestRef.current + 1
    graphLoadRequestRef.current = requestId
    const vaultPath = vault.path
    setWorkspacePage('graph')
    setGraphDetailOpen(false)
    setGraphLoading(true)
    setGraphLoadProgress(0)
    setError(null)

    try {
      // Reutiliza o cache de conteudos da indexacao em segundo plano quando
      // fresco (mesmo Vault e MESMO conjunto de notas): abrir o grafo nao
      // rele NADA. Mudancas estruturais (notas criadas/removidas/renomeadas
      // pelo app ou externamente) tornam o conjunto diferente e caem na
      // leitura unificada abaixo.
      const cached = vaultNoteContentsRef.current
      if (
        cached
        && cached.vaultPath === vaultPath
        && cached.documents.size === notes.length
        && notes.every((note) => cached.documents.has(note.relativePath))
      ) {
        const documents = [...cached.documents.values()]
        setGraphDocuments(documents)
        // Indexa os conteudos em memoria para o grafo e os backlinks.
        graphWikilinkIndexRef.current = buildWikilinkIndex(documents)
        setFocusedGraphPath(activeNote?.relativePath ?? null)
        return
      }

      // Leitura unificada: UMA chamada devolve todos os conteudos (o backend
      // emite progresso em lotes). A troca de Vault ou um novo pedido
      // incrementam `graphLoadRequestRef` e descartam o resultado.
      const allNotes = await readAllVaultNotesWithProgress(requestId, vaultPath)
      if (requestId !== graphLoadRequestRef.current || vault.path !== vaultPath) return
      setGraphDocuments(allNotes)
      // Indexa os conteudos recém-lidos em memoria para o grafo e os backlinks.
      graphWikilinkIndexRef.current = buildWikilinkIndex(allNotes)
      vaultNoteContentsRef.current = {
        vaultPath,
        documents: new Map(allNotes.map((note) => [note.relativePath, note])),
      }
      setFocusedGraphPath(activeNote?.relativePath ?? null)
    } catch {
      if (requestId !== graphLoadRequestRef.current) return
      setGraphDocuments([])
      setError('Não foi possível carregar as conexoes entre as notas.')
    } finally {
      if (requestId === graphLoadRequestRef.current) {
        setGraphLoading(false)
        setGraphLoadProgress(null)
      }
    }
  }

  function reorganizeGraphNodes() {
    if (graphMode3d) {
      setGraph3dLayoutVersion((version) => version + 1)
      return
    }
    // Reorganizar em 2D = nova simulacao ambiente: para a fisica em
    // andamento, descarta o layout persistido e espalha os nos por toda a
    // area a partir do circulo inicial (gravidade ao centro + repulsao).
    if (graphPhysicsFrameRef.current !== null) {
      cancelAnimationFrame(graphPhysicsFrameRef.current)
      graphPhysicsFrameRef.current = null
    }
    graphPhysicsRef.current = null
    graphPhysicsLastTimeRef.current = null
    stopGraph2dWorkerAmbient()
    setGraphNodeOverrides({})
    startGraph2dAmbientSimulation()
  }

  function resetGraphView() {
    setGraphViewport({ scale: 1, x: 0, y: 0 })
  }

  function resetGraph3dSettings() {
    setGraph3dNodeSize(0.55)
    setGraph3dNodeSpacing(8)
    setGraph3dOrbitSpeed(1)
    setGraph3dMaxEdgeLength(14)
    setGraph3dMinEdgeLength(2.5)
    setGraph3dDegreeGrowth(0.13)
    // Tambem restaura as forcas do grafo 2D (mesmo popover/header).
    setGraph2dRepulsionStrength(2000)
    setGraph2dLinkStiffness(4.0)
    setGraph2dVelocityDecay(0.4)
    setGraph2dLinkDistance(30)
    setGraph2dCenterForce(100)
  }

  /** Um passo da simulacao 2D (rAF): arrasto fluido (ancora fixo no cursor e
   * vizinhos respondem as forcas do cluster) ou assentamento pos-arrasto
   * (amortecimento ate parar). Escreve as posicoes transitorias em
   * graphLivePositions e segue agendando enquanto houver interacao ativa. */
  /** Integra um passo (amortecimento + movimento) para os nos em movimento e
   * devolve a energia cinetica residual (para detectar o assentamento). */
  function integrateGraph2dStep(paths: string[], positions: Map<string, GraphPosition>, velocities: Map<string, GraphPosition>, delta: number, velocityDecay: number) {
    let remaining = 0
    for (const path of paths) {
      const current = positions.get(path)
      const velocity = velocities.get(path)
      if (!current || !velocity) continue
      const damping = Math.max(0, 1 - velocityDecay * delta)
      velocity.x *= damping
      velocity.y *= damping
      current.x = Math.max(GRAPH_2D_BOUNDS.minX, Math.min(GRAPH_2D_BOUNDS.maxX, current.x + velocity.x * delta))
      current.y = Math.max(GRAPH_2D_BOUNDS.minY, Math.min(GRAPH_2D_BOUNDS.maxY, current.y + velocity.y * delta))
      remaining += velocity.x * velocity.x + velocity.y * velocity.y
    }
    return remaining
  }

  /** Aplica as forcas do modelo Obsidian com as configuracoes atuais (sliders
   * de repulsao, distancia do link e forca central) ao conjunto em movimento.
   * Os nos FIXOS (pinned) entram em `paths` para repeler/puxar por mola, mas
   * nao se movem porque nao tem entrada no mapa de `velocities`. */
  function applyGraph2dForces(params: {
    paths: string[]
    fixed?: string[]
    positions: Map<string, GraphPosition>
    velocities: Map<string, GraphPosition>
    edges: NoteGraphLayoutLink[]
    alpha: number
    delta: number
    /** Molas cheias nos dois extremos (sem ponderar pelo grau) — usado no
     * ARRASTO/ASSENTAMENTO para o cluster seguir o no arrastado com a
     * fluidez do Obsidian (a ponderacao por grau deixa o hub com 1/grau da
     * forca e os conectados quase nao se movem). Padrao: ponderado (ambiente). */
    springBiasByDegree?: boolean
    /** Centralizacao de hubs desligada no ARRASTO/ASSENTAMENTO — ela puxa o
     * hub de volta ao centro contra o controle do usuario. Padrao: ligada (ambiente). */
    hubCentering?: boolean
    /** No segurado pelo cursor: as arestas incidentes a ele ficam mais
     * rigidas (dragSpringBoost) para o cluster CONECTADO acompanhar o
     * arrasto — sem isso as molas internas equilibram a puxada e os
     * vizinhos quase nao se movem. */
    dragAnchor?: string
    dragSpringBoost?: number
  }) {
    const settings = graphPhysicsSettingsRef.current
    accumulateObsidianForces2D({
      paths: params.fixed ? [...params.paths, ...params.fixed] : params.paths,
      positions: params.positions,
      velocities: params.velocities,
      edges: params.edges,
      linkStiffness: settings.linkStiffness,
      linkRest: settings.linkDistance,
      repulsionStrength: settings.repulsionStrength,
      centerStrength: OBSIDIAN_PHYSICS_2D.centerStrength * (settings.centerForce / 100),
      groupCenters: graphGroupCentersRef.current ?? undefined,
      alpha: params.alpha,
      delta: params.delta,
      springBiasByDegree: params.springBiasByDegree,
      hubCentering: params.hubCentering,
      dragAnchor: params.dragAnchor,
      dragSpringBoost: params.dragSpringBoost,
    })
  }

  function stepGraph2dPhysics() {
    const physics = graphPhysicsRef.current
    // A superficie 2D foi desmontada (navegou ou trocou para 3D) no meio de um
    // frame: para a simulacao sem atualizar estado de um grafo invisivel.
    if (!physics || !graphSurfaceRef.current) {
      if (graphPhysicsFrameRef.current !== null) {
        cancelAnimationFrame(graphPhysicsFrameRef.current)
        graphPhysicsFrameRef.current = null
      }
      graphPhysicsRef.current = null
      return
    }
    const now = performance.now()
    const last = graphPhysicsLastTimeRef.current ?? now
    const delta = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
    graphPhysicsLastTimeRef.current = now
    // O ARRASTO usa o decay do usuario (baixo = fluido); o ASSENTAMENTO
    // (pos-arrasto e ambiente) usa um piso mais alto para a oscilacao
    // amortecer e o layout convergir no circulo ao redor do hub.
    const settleDecay = Math.max(graphPhysicsSettingsRef.current.velocityDecay, OBSIDIAN_PHYSICS_2D.settleVelocityDecayMin)
    const { positions, edges, drag, coast } = physics
    let sleepDrag = false
    if (drag) {
      // Unico ponto fixado (pinned): o no arrastado acompanha o cursor; o
      // restante do grafo visivel flui pelas MESMAS forcas (molas das arestas,
      // repulsao 1/d² e center force) — como o Obsidian, sem cluster rigido.
      const anchor = positions.get(drag.anchor)
      if (anchor) {
        anchor.x = drag.draggedTarget.x
        anchor.y = drag.draggedTarget.y
      }
      applyGraph2dForces({
        paths: drag.paths,
        fixed: [drag.anchor],
        positions,
        velocities: drag.velocities,
        edges,
        alpha: 1,
        delta,
        // O cluster segue o no arrastado com molas CHEIAS, sem o hub ser
        // puxado de volta ao centro, e com as arestas do no segurado mais
        // rigidas (boost) — as molas internas do cluster nao equilibram a
        // puxada e os conectados acompanham o arrasto (fluidez do Obsidian).
        springBiasByDegree: false,
        hubCentering: false,
        dragAnchor: drag.anchor,
        dragSpringBoost: OBSIDIAN_PHYSICS_2D.dragSpringBoost,
      })
      const dragRemaining = integrateGraph2dStep(drag.paths, positions, drag.velocities, delta, graphPhysicsSettingsRef.current.velocityDecay)
      // Se o cursor parou e o cluster ja assentou, "dorme" o loop ate o
      // proximo pointermove (evita 60fps desnecessarios com o arrasto imovel).
      const targetMoved = drag.lastTarget.x !== drag.draggedTarget.x || drag.lastTarget.y !== drag.draggedTarget.y
      drag.lastTarget.x = drag.draggedTarget.x
      drag.lastTarget.y = drag.draggedTarget.y
      if (!targetMoved && dragRemaining < 0.05) sleepDrag = true
    } else if (coast) {
      // Assentamento pos-arrasto: o no arrastado fica FIXO no ponto da
      // soltura e o restante do grafo visivel assenta com as mesmas forcas,
      // com o alpha decaindo ate parar (como o Obsidian apos soltar).
      const hub = positions.get(coast.hub)
      if (hub) {
        applyGraph2dForces({
          paths: coast.paths,
          fixed: [coast.hub],
          positions,
          velocities: coast.velocities,
          edges,
          alpha: coast.alpha,
          delta,
          // Mesmo contrato do arrasto: molas cheias, sem centralizacao de
          // hubs puxando o cluster de volta ao centro contra a soltura.
          springBiasByDegree: false,
          hubCentering: false,
        })
        const coastRemaining = integrateGraph2dStep(coast.paths, positions, coast.velocities, delta, settleDecay)
        coast.alpha *= OBSIDIAN_PHYSICS_2D.alphaDecay
        if (coastRemaining < 0.05 || coast.alpha < OBSIDIAN_PHYSICS_2D.alphaMin || now - coast.startedAt > 4000) {
      // Assentou: congela o layout reorganizado como a nova base persistida.
      physics.coast = null
      setGraphNodeOverrides((previous) => ({ ...previous, ...Object.fromEntries(positions) }))
        }
      }
    } else if (physics.ambient) {
      // Simulacao ambiente (big bang ao abrir o grafo / Reorganizar): todos os
      // nos visiveis partem do centro e se espalham pelas forcas; o alpha
      // decai ate assentar (ou timeout) e o layout final e persistido.
      const ambient = physics.ambient
      applyGraph2dForces({
        paths: ambient.paths,
        positions,
        velocities: ambient.velocities,
        edges,
        alpha: ambient.alpha,
        delta,
      })
      const ambientRemaining = integrateGraph2dStep(ambient.paths, positions, ambient.velocities, delta, settleDecay)
      ambient.alpha *= OBSIDIAN_PHYSICS_2D.alphaDecay
      if (ambientRemaining < 0.05 || ambient.alpha < OBSIDIAN_PHYSICS_2D.alphaMin || now - ambient.startedAt > 4500) {
        // Assentou: vira a nova base persistida (layout espalhado).
        physics.ambient = null
        setGraphNodeOverrides((previous) => ({ ...previous, ...Object.fromEntries(positions) }))
      }
    }
    // Escreve as posicoes DIRETAMENTE no DOM (imperativo) — o React NAO e
    // re-renderizado em nenhum frame da simulacao (era a causa das travadinhas
    // durante o arrasto: o App inteiro, incluindo a arvore do explorador,
    // renderizava a 60fps).
    writeGraph2dPositionsToDom(positions)
    if (sleepDrag) {
      graphPhysicsFrameRef.current = null
    } else if (physics.drag || physics.coast || physics.ambient) {
      graphPhysicsFrameRef.current = requestAnimationFrame(stepGraph2dPhysics)
    } else {
      graphPhysicsFrameRef.current = null
    }
  }

  /** Escreve as posicoes da simulacao diretamente no DOM dos nos e arestas 2D
   * (sem estado React). Usada pelo loop e por um useLayoutEffect que roda apos
   * cada render — assim, qualquer re-render do React por outro motivo (hover,
   * drawer...) re-sincroniza o DOM com as posicoes REAIS da fisica, sem que os
   * nos "pulem" para posicoes antigas do VDOM. */
  function writeGraph2dPositionsToDom(positions: Map<string, GraphPosition>, surfaceSize?: { width: number; height: number } | null) {
    const resolvedSurfaceSize = surfaceSize !== undefined ? surfaceSize : (graphPhysicsRef.current?.surfaceSize ?? null)
    for (const [path, element] of graph2dNodeElementsRef.current) {
      const position = positions.get(path)
      if (!element || !position) continue
      if (resolvedSurfaceSize && resolvedSurfaceSize.width > 0 && resolvedSurfaceSize.height > 0) {
        // Posiciona por transform translate (px) — composicao GPU, sem forcar
        // layout a cada frame. Zera o left/top percentual uma unica vez; as
        // escritas de transform so mudam quando a posicao muda.
        if (element.style.left !== '0px') element.style.left = '0px'
        if (element.style.top !== '0px') element.style.top = '0px'
        const transform = `translate(${(position.x / GRAPH_2D_WORLD_SIZE) * resolvedSurfaceSize.width}px, ${(position.y / GRAPH_2D_WORLD_SIZE) * resolvedSurfaceSize.height}px)`
        if (element.style.transform !== transform) element.style.transform = transform
      } else {
        // Sem tamanho capturado (fallback): posiciona por left/top %.
        const left = `${(position.x / GRAPH_2D_WORLD_SIZE) * 100}%`
        const top = `${(position.y / GRAPH_2D_WORLD_SIZE) * 100}%`
        if (element.style.left !== left) element.style.left = left
        if (element.style.top !== top) element.style.top = top
      }
    }
    for (const [key, element] of graph2dLinkElementsRef.current) {
      const separatorIndex = key.indexOf('\u0000')
      const source = key.slice(0, separatorIndex)
      const target = key.slice(separatorIndex + 1)
      const sourcePosition = positions.get(source)
      const targetPosition = positions.get(target)
      if (element && sourcePosition && targetPosition) {
        // UM atributo transform por frame (rotacao + escala da linha base),
        // em vez de 4 atributos de geometria x1/y1/x2/y2 — transform e
        // composto por GPU e nao invalida o layout do SVG a cada frame
        // (causa do drop de FPS ao arrastar com muitas arestas).
        const value = graph2dLineTransform(sourcePosition, targetPosition)
        if (graph2dLinkLastValuesRef.current.get(element) !== value) {
          graph2dLinkLastValuesRef.current.set(element, value)
          element.setAttribute('transform', value)
        }
      }
    }
  }

  // Durante uma simulacao ativa, qualquer render do React (hover, drawer,
  // fim da simulacao...) re-sincroniza o DOM com as posicoes reais da fisica.
  // O caso do ambiente no worker tambem e coberto aqui: o JSX escreve
  // left/top % a cada render, mas o worker posiciona por left 0 + transform
  // px — sem re-sincronizar apos o render, os nos ficam duplamente
  // posicionados (% somado ao px) e, ao assentar, o transform px residual
  // ficaria somado ao left % para SEMPRE, desprendendo os nos das arestas
  // (bug classico do grafo 2D: nos espalhados apos a simulacao ambiente).
  useLayoutEffect(() => {
    const physics = graphPhysicsRef.current
    if (physics) {
      writeGraph2dPositionsToDom(physics.positions)
      return
    }
    if (graphWorkerAmbientIdRef.current !== 0 && graphWorkerPositionsRef.current) {
      writeGraph2dPositionsToDom(graphWorkerPositionsRef.current, graphSurfaceSizeRef.current)
      return
    }
    // Sem simulacao ativa, o React e a fonte das posicoes (left/top %): limpa
    // o transform px que o worker deixou no DOM para os nos nao ficarem
    // deslocados das arestas (arestas sao desenhadas em coordenadas %).
    for (const element of graph2dNodeElementsRef.current.values()) {
      if (element && element.style.transform && element.style.transform !== 'none') {
        element.style.transform = ''
      }
    }
  })

  /** Inicia (ou reinicia) o loop da fisica 2D na proxima moldura. */
  function kickGraph2dPhysics() {
    if (graphPhysicsFrameRef.current === null) {
      graphPhysicsFrameRef.current = requestAnimationFrame(stepGraph2dPhysics)
    }
    graphPhysicsLastTimeRef.current = null
  }

  /** Nos visiveis da superficie 2D (mesmo filtro do render: query/pasta/tag/
   * modo/orfaos) + arestas entre eles. Usado por ambient e arrasto para
   * simular apenas o que esta na tela. Devolve tambem o conjunto SIMULADO:
   * limitado aos nos efetivamente RENDERIZADOS (culling) quando o grafo
   * excede o limite — a fisica O(n²) so move o que esta na tela (+ o no
   * prioritario e seus vizinhos como contexto), entao o arrasto nao derruba
   * o FPS em vaults grandes (o numero de nos DESENHADOS e pequeno, mas a
   * simulacao antiga movia TODOS os visiveis). */
  function getGraph2dSimulationState(extraPriorityPath?: string | null) {
    const links = graphWikilinkIndex
      ? buildNoteGraphLinksFromIndex(graphWikilinkIndex, graphDocuments)
      : buildNoteGraphLinks(graphDocuments, notes.map((note) => note.relativePath))
    const degreeByPath = links.reduce<Record<string, number>>((degrees, link) => {
      degrees[link.source] = (degrees[link.source] ?? 0) + 1
      degrees[link.target] = (degrees[link.target] ?? 0) + 1
      return degrees
    }, {})
    const localGraphCenterPath = focusedGraphPath ?? activeNote?.relativePath ?? null
    const localGraphPaths = new Set(localGraphCenterPath
      ? [localGraphCenterPath, ...links.flatMap((link) => link.source === localGraphCenterPath ? [link.target] : link.target === localGraphCenterPath ? [link.source] : [])]
      : [])
    const visibleGraphDocuments = graphDocuments.filter((document) => {
      const title = document.name.replace(/\.md$/i, '').toLowerCase()
      const matchesQuery = !graphQuery.trim() || title.includes(graphQuery.trim().toLowerCase())
      const matchesFolder = !graphFolder || document.relativePath.startsWith(`${graphFolder}/`)
      const matchesTag = !graphTag || graphTagIndexRef.current.tagsOf(document.relativePath).includes(graphTag)
      const isOrphan = (degreeByPath[document.relativePath] ?? 0) === 0
      return matchesQuery && matchesFolder && matchesTag && (graphMode === 'global' || localGraphPaths.has(document.relativePath)) && (showOnlyGraphOrphans ? isOrphan : showGraphOrphans || !isOrphan)
    })
    const visiblePaths = new Set(visibleGraphDocuments.map((document) => document.relativePath))
    const edges: NoteGraphLayoutLink[] = []
    for (const link of links) {
      if (visiblePaths.has(link.source) && visiblePaths.has(link.target)) edges.push(link)
    }
    // Prioridade do culling da SIMULACAO: o no prioritario (o arrastado, no
    // arrasto) e seus vizinhos diretos sempre participam, como no render.
    const priorityPath = extraPriorityPath ?? focusedGraphPath
    const simulationPriority = priorityPath
      ? new Set([
          priorityPath,
          ...links.filter((link) => link.source === priorityPath).map((link) => link.target),
          ...links.filter((link) => link.target === priorityPath).map((link) => link.source),
        ])
      : undefined
    const positionsForCulling = graphDocuments.reduce<Record<string, GraphPosition>>((acc, document, index) => {
      const live = graphPhysicsRef.current?.positions.get(document.relativePath)
        ?? graphWorkerPositionsRef.current?.get(document.relativePath)
      if (live) {
        acc[document.relativePath] = live
      } else {
        acc[document.relativePath] = graphNodeOverrides[document.relativePath]
          ?? { x: GRAPH_2D_WORLD_CENTER + Math.cos((Math.PI * 2 * index) / Math.max(graphDocuments.length, 1)) * 68, y: GRAPH_2D_WORLD_CENTER + Math.sin((Math.PI * 2 * index) / Math.max(graphDocuments.length, 1)) * 68 }
      }
      return acc
    }, {})
    const simulatedDocuments = selectRenderedGraphDocuments({
      documents: visibleGraphDocuments,
      positions: positionsForCulling,
      viewport: graphViewport,
      surfaceSize: graphSurfaceSize,
      limit: graphRenderLimit,
      priorityPaths: simulationPriority,
    })
    const simulatedPaths = new Set(simulatedDocuments.map((document) => document.relativePath))
    const simulatedEdges = edges.filter((link) => simulatedPaths.has(link.source) && simulatedPaths.has(link.target))
    return { visibleGraphDocuments, visiblePaths, edges, degreeByPath, simulatedPaths, simulatedEdges }
  }

  /** Monta o mapa de posicoes e velocidades da simulacao a partir do estado
   * atual (posicoes transitorias > override > layout inicial). Com jitter
   * (big bang), o no parte do centro com pequena perturbacao aleatoria e
   * velocidade zero — como o Obsidian ao montar o grafo. Com
   * `ignoreExisting`, TODAS as posicoes partem do centro (big bang forcado ao
   * abrir o grafo), ignorando overrides/layout persistido. */
  function buildGraph2dPositions(visiblePaths: Set<string>, jitter: boolean, ignoreExisting = false) {
    const positions = new Map<string, GraphPosition>()
    const velocities = new Map<string, GraphPosition>()
    graphDocuments.forEach((document, index) => {
      if (!visiblePaths.has(document.relativePath)) return
      if (!ignoreExisting) {
        // A simulacao em andamento e a fonte mais atual (arrasto no meio de uma
        // simulacao continua de onde os nos estao, sem "pulos"). Quando o
        // ambiente roda no worker, as posicoes dele sao a fonte viva.
        const live = graphPhysicsRef.current?.positions.get(document.relativePath)
          ?? graphWorkerPositionsRef.current?.get(document.relativePath)
        const override = graphNodeOverrides[document.relativePath]
        if (live) {
          positions.set(document.relativePath, live)
        } else if (override) {
          positions.set(document.relativePath, override)
        } else {
          const angle = (Math.PI * 2 * index) / Math.max(graphDocuments.length, 1) - Math.PI / 2
          // Big bang "suave": os nos partem de um ANEL frouxo ao redor do
          // centro (16-26) em vez de todos colocalizados no centro — sem a
          // explosao violenta (repulsao 1/d² a d~0) que lancava os nos longe
          // demais para oscilar sem assentar. O anel inicial ja esta perto do
          // descanso das molas (30), entao o layout relaxa no circulo.
          const radius = jitter ? 16 + Math.random() * 10 : graphDocuments.length < 3 ? 56 : 68
          positions.set(document.relativePath, { x: GRAPH_2D_WORLD_CENTER + Math.cos(angle) * radius, y: GRAPH_2D_WORLD_CENTER + Math.sin(angle) * radius })
        }
      } else {
        const angle = (Math.PI * 2 * index) / Math.max(graphDocuments.length, 1) - Math.PI / 2
        const radius = jitter ? 16 + Math.random() * 10 : graphDocuments.length < 3 ? 56 : 68
        positions.set(document.relativePath, { x: GRAPH_2D_WORLD_CENTER + Math.cos(angle) * radius, y: GRAPH_2D_WORLD_CENTER + Math.sin(angle) * radius })
      }
      velocities.set(document.relativePath, { x: 0, y: 0 })
    })
    return { positions, velocities }
  }

  /** Cria (lazy) o worker de layout e conecta as mensagens. Devolve null
   * quando o ambiente nao oferece Worker (ex.: testes jsdom) — o chamador cai
   * no loop da thread principal. */
  function ensureGraphPhysicsWorker(): Worker | null {
    if (graphPhysicsWorkerRef.current) return graphPhysicsWorkerRef.current
    if (typeof Worker === 'undefined') return null
    try {
      const worker = new Worker(new URL('./workers/graphPhysics.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ type: string; requestId: number; positions?: Record<string, GraphPosition> }>) => {
        const message = event.data
        if (message.requestId !== graphWorkerAmbientIdRef.current) return
        if (message.type === 'ambient-step' && message.positions) {
          graphWorkerPositionsRef.current = new Map(Object.entries(message.positions))
          writeGraph2dPositionsToDom(graphWorkerPositionsRef.current, graphSurfaceSizeRef.current)
        } else if (message.type === 'ambient-settled' && message.positions) {
          graphWorkerPositionsRef.current = new Map(Object.entries(message.positions))
          setGraphNodeOverrides((previous) => ({ ...previous, ...message.positions }))
          graphWorkerAmbientIdRef.current = 0
        }
      }
      worker.onerror = () => {
        // Worker indisponivel em tempo de execucao: encerra e volta ao loop
        // da thread principal na proxima chamada.
        graphPhysicsWorkerRef.current = null
        graphWorkerAmbientIdRef.current = 0
      }
      graphPhysicsWorkerRef.current = worker
      return worker
    } catch {
      return null
    }
  }

  /** Cancela a simulacao ambiente do worker (se houver). */
  function stopGraph2dWorkerAmbient() {
    if (graphPhysicsWorkerRef.current) {
      graphPhysicsWorkerRef.current.postMessage({ type: 'stop' })
    }
    graphWorkerAmbientIdRef.current = 0
  }

  /** Roda o big bang no worker: a thread de interface fica livre enquanto a
   * fisica integra (muitos nos). Devolve true quando assumiu (o DOM sera
   * atualizado pelos passos do worker) e false para cair no loop local. */
  function startGraph2dWorkerAmbient(visiblePaths: Set<string>, edges: NoteGraphLayoutLink[], forceBigBang: boolean): boolean {
    const worker = ensureGraphPhysicsWorker()
    if (!worker) return false
    const { positions } = buildGraph2dPositions(visiblePaths, true, forceBigBang)
    const requestId = graphWorkerAmbientIdRef.current + 1
    graphWorkerAmbientIdRef.current = requestId
    graphWorkerPositionsRef.current = positions
    const surfaceElement = graphSurfaceRef.current
    graphSurfaceSizeRef.current = surfaceElement && surfaceElement.clientWidth > 0 ? { width: surfaceElement.clientWidth, height: surfaceElement.clientHeight } : null
    const settings = graphPhysicsSettingsRef.current
    worker.postMessage({
      type: 'ambient-start',
      requestId,
      paths: [...visiblePaths],
      positions: Object.fromEntries(positions),
      edges,
      settings: {
        linkStiffness: settings.linkStiffness,
        linkRest: settings.linkDistance,
        repulsionStrength: settings.repulsionStrength,
        velocityDecay: settings.velocityDecay,
        centerStrength: OBSIDIAN_PHYSICS_2D.centerStrength * (settings.centerForce / 100),
      },
      groupCenters: graphGroupCentersRef.current ? Object.fromEntries(graphGroupCentersRef.current) : undefined,
    })
    return true
  }

  /** Simulacao ambiente do grafo 2D (big bang estilo Obsidian): todos os nos
   * visiveis partem do centro com pequena perturbacao e se espalham pelas
   * forcas (molas + repulsao 1/d² + center force), com alpha decaindo ate
   * assentar. Os orfaos (sem conexao) sao atraidos ao anel central. Roda ao
   * abrir o grafo 2D (big bang forcado: `forceBigBang`) e no botao
   * Reorganizar; qualquer arrasto a cancela. Quando o ambiente oferece um
   * Worker, a simulacao roda FORA da thread de interface (layout em worker);
   * senao, cai no loop local em rAF. */
  function startGraph2dAmbientSimulation(forceBigBang = false) {
    const { visibleGraphDocuments, visiblePaths, edges, simulatedPaths, simulatedEdges } = getGraph2dSimulationState()
    if (graphSurfaceRef.current === null || visibleGraphDocuments.length === 0) return
    // O worker roda FORA da thread: simula o conjunto completo. O fallback da
    // thread principal usa o conjunto SIMULADO (culling) para nao travar.
    if (startGraph2dWorkerAmbient(visiblePaths, edges, forceBigBang)) return
    const { positions, velocities } = buildGraph2dPositions(simulatedPaths, true, forceBigBang)
    const surfaceElement = graphSurfaceRef.current
    graphPhysicsRef.current = {
      positions,
      edges: simulatedEdges,
      surfaceSize: surfaceElement && surfaceElement.clientWidth > 0 ? { width: surfaceElement.clientWidth, height: surfaceElement.clientHeight } : null,
      drag: null,
      coast: null,
      ambient: {
        paths: [...simulatedPaths],
        velocities,
        startedAt: performance.now(),
        alpha: 1,
      },
    }
    kickGraph2dPhysics()
  }

  // Ao abrir o grafo 2D (ou mudar filtros/modo), espalha os nos por toda a
  // area com a simulacao ambiente, apos a superficie montar. Navegar para
  // outra pagina ou trocar para 3D limpa a simulacao (efeito acima).
  useEffect(() => {
    if (workspacePage !== 'graph' || graphMode3d || isGraphLoading || graphDocuments.length === 0) return
    // Big bang forcado ao ABRIR o grafo 2D (sem simulacao ativa = primeira
    // abertura/montagem da pagina); mudancas de filtro no meio continuam a
    // simulacao de onde os nos estao, sem re-explodir.
    const forceBigBang = graphPhysicsRef.current === null
    const timeoutId = window.setTimeout(() => startGraph2dAmbientSimulation(forceBigBang), 120)
    return () => window.clearTimeout(timeoutId)
  }, [workspacePage, graphMode3d, isGraphLoading, graphDocuments, graphMode, graphFolder, graphTag, graphGroupByFolder, showGraphOrphans, showOnlyGraphOrphans])

  // Mede o tamanho da superficie 2D (para a renderizacao seletiva e o
  // posicionamento do worker). Sem tamanho conhecido (jsdom/desconhecido),
  // nada e cortado e tudo e renderizado.
  useEffect(() => {
    if (workspacePage !== 'graph' || graphMode3d || isGraphLoading) return
    const update = () => {
      const element = graphSurfaceRef.current
      if (element && element.clientWidth > 0 && element.clientHeight > 0) {
        setGraphSurfaceSize({ width: element.clientWidth, height: element.clientHeight })
      } else {
        setGraphSurfaceSize(null)
      }
    }
    update()
    if (typeof ResizeObserver !== 'undefined') {
      // Usa o contentRect do entry (medida sem forcar layout) em vez de
      // reler clientWidth a cada callback.
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setGraphSurfaceSize({ width: entry.contentRect.width, height: entry.contentRect.height })
        } else {
          update()
        }
      })
      if (graphSurfaceRef.current) observer.observe(graphSurfaceRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [graphMode3d, isGraphLoading, workspacePage])

  // Encerra o worker de layout ao desmontar o App.
  useEffect(() => () => {
    if (graphPhysicsWorkerRef.current) {
      graphPhysicsWorkerRef.current.terminate()
      graphPhysicsWorkerRef.current = null
    }
  }, [])

  /** Inicia o arrasto de um no no grafo 2D (modelo Obsidian): o no segurado
   * vira o UNICO ponto fixado (pinned) e todo o grafo visivel flui pelas mesmas
   * forcas (molas + repulsao 1/d² + center force) no rAF. Qualquer simulacao
   * anterior (ambiente/assentamento) e cancelada. */
  function startGraph2dNodeDrag(relativePath: string, event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    graphNodeDragRef.current = relativePath
    graphSkipNodeClickRef.current = false
    setFocusedGraphPath(relativePath)
    // O arrasto assume o controle: cancela a simulacao ambiente do worker (as
    // posicoes dele viram a fonte viva abaixo, sem "pulos" para o layout antigo).
    stopGraph2dWorkerAmbient()
    // Simula apenas o conjunto RENDERIZADO (culling) mais o no arrastado e
    // seus vizinhos (prioridade): em vaults grandes, a fisica O(n²) nao move
    // os milhares de nos fora da tela — o arrasto nao derruba o FPS.
    const { simulatedPaths, simulatedEdges } = getGraph2dSimulationState(relativePath)
    const { positions, velocities } = buildGraph2dPositions(simulatedPaths, false)
    const startPosition = positions.get(relativePath) ?? { x: 50, y: 50 }
    const paths = [...simulatedPaths].filter((path) => path !== relativePath)
    // O ancora e FIXO: sem entrada em velocities (contrato de movimento da
    // funcao de forcas), apenas com a posicao atualizada pelo cursor.
    velocities.delete(relativePath)
    // Bounds da superficie capturados uma vez no inicio do arrasto: evita
    // chamar getBoundingClientRect() a cada pointermove (que forca layout
    // sincrono a cada evento — causa das travadinhas durante o arrasto).
    const surfaceBounds = graphSurfaceRef.current?.getBoundingClientRect() ?? null
    const surfaceElement = graphSurfaceRef.current
    graphPhysicsRef.current = {
      positions,
      edges: simulatedEdges,
      surfaceSize: surfaceElement && surfaceElement.clientWidth > 0 ? { width: surfaceElement.clientWidth, height: surfaceElement.clientHeight } : null,
      drag: {
        anchor: relativePath,
        paths,
        velocities,
        draggedTarget: startPosition,
        lastTarget: { ...startPosition },
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        bounds: surfaceBounds ? { left: surfaceBounds.left, top: surfaceBounds.top, width: surfaceBounds.width, height: surfaceBounds.height } : null,
      },
      coast: null,
      ambient: null,
    }
    kickGraph2dPhysics()
  }

  /** Fim do arrasto 2D (modelo Obsidian): com movimento real, o no arrastado
   * e fixado no ponto da soltura e o restante do grafo visivel assenta com as
   * mesmas forcas (alpha decaindo) ate parar — o layout final e persistido.
   * Sem movimento (clique), apenas para a simulacao e deixa o onClick abrir a
   * nota. */
  function finishGraph2dNodeDrag(event: React.PointerEvent<HTMLButtonElement>) {
    graphNodeDragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const physics = graphPhysicsRef.current
    if (!physics?.drag) return
    const drag = physics.drag
    physics.drag = null
    if (drag.moved) {
      // O no ARRASTADO fica FIXO no ponto da soltura (onde o usuario o soltou);
      // os demais nos visiveis fluem ao redor dele ate assentarem. O hub (no
      // com mais conexoes) nao e reposicionado: cada no permanece onde estava.
      const dropPosition = drag.draggedTarget
      physics.positions.set(drag.anchor, dropPosition)
      const velocities = new Map<string, GraphPosition>()
      for (const path of drag.paths) velocities.set(path, drag.velocities.get(path) ?? { x: 0, y: 0 })
      // O no arrastado e FIXO no ponto da soltura: sem entrada em velocities.
      velocities.delete(drag.anchor)
      physics.coast = {
        hub: drag.anchor,
        paths: drag.paths.filter((path) => path !== drag.anchor),
        velocities,
        startedAt: performance.now(),
        alpha: 0.8,
      }
      // Acorda o loop (pode ter dormido com o cursor parado) para o
      // assentamento rodar.
      kickGraph2dPhysics()
      setFocusedGraphPath(null)
    } else {
      // Clique (sem arrasto): para a simulacao e volta ao estado persistido;
      // o onClick cuida de abrir a nota.
      graphSkipNodeClickRef.current = false
    }
    if (!physics.drag && !physics.coast && graphPhysicsFrameRef.current !== null) {
      cancelAnimationFrame(graphPhysicsFrameRef.current)
      graphPhysicsFrameRef.current = null
    }
  }

  async function copyGraphWikiLink(relativePath: string) {
    const wikiLink = `[[${relativePath.replace(/\.md$/i, '')}]]`
    try {
      await navigator.clipboard.writeText(wikiLink)
      setStatus(`Link ${wikiLink} copiado.`)
    } catch {
      setStatus(`Não foi possível copiar ${wikiLink}.`)
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
    if (command.id === 'manage-tags') void openTagManagementPage()
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
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível criar a pasta.')
    } finally {
      setLoading(false)
    }
  }

  function startRename(path: string, name: string, type: 'note' | 'folder') {
    setRenameTarget({ path, name, type })
    setRenameName(type === 'note' ? name.replace(/\.md$/i, '') : name)
  }

  async function persistWorkspaceDraftsBeforePathChange(vaultPath: string) {
    const pendingDrafts = new Map(Object.entries(draftsByPathRef.current))
    if (activeNoteRef.current) {
      pendingDrafts.set(activeNoteRef.current.relativePath, draftContentRef.current)
    }
    const availablePaths = new Set(notesRef.current.map((note) => note.relativePath))
    await Promise.all(
      [...pendingDrafts.entries()]
        .filter(([relativePath]) => relativePath !== '__new_note__' && availablePaths.has(relativePath))
        .map(([relativePath, content]) => invoke('save_note', {
          path: vaultPath,
          relativePath,
          content,
        })),
    )
    draftsByPathRef.current = {}
    setDraftsByPath({})
  }

  async function cancelWikilinkIndexBuild() {
    if (!vault) return
    setWikilinkIndexCancelled(true)
    await invoke('cancel_wikilink_index_build', { path: vault.path }).catch(() => undefined)
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
    setWikilinkIndexProgress(null)
    setWikilinkIndexCancelled(false)
    try {
      await persistWorkspaceDraftsBeforePathChange(vault.path)
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
      // Reindexa incrementalmente: remove o caminho antigo e registra o novo
      // com o mesmo conteudo (somente notas renomeadas).
      if (vaultWikilinkIndexRef.current) {
        const affected = [...vaultWikilinkIndexRef.current.entries.keys()].filter((path) => remapPath(path) !== path)
        let nextIndex = vaultWikilinkIndexRef.current
        for (const path of affected) {
          const entry = nextIndex.entries.get(path)
          nextIndex = removeWikilinkEntry(nextIndex, path)
          if (entry && remapPath(path) !== path) {
            nextIndex = applyWikilinkEdit(nextIndex, remapPath(path), entry.version)
          }
        }
        vaultWikilinkIndexRef.current = nextIndex
      }
      // Renomear/mover muda caminhos: o cache de conteudos do grafo perde a
      // validade e e reconstruido na proxima leitura unificada.
      vaultNoteContentsRef.current = null
      await refreshNotes(vault.path, remapPath(activeNote?.relativePath ?? ''))
      if (target.type === 'note' && activeNote?.relativePath === target.path) {
        void loadBrokenLinks(destinationPath, vault.path)
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível renomear o item.')
    } finally {
      setLoading(false)
      setWikilinkIndexProgress(null)
      setWikilinkIndexCancelled(false)
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
          await persistWorkspaceDraftsBeforePathChange(vaultPath)
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
          setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível renomear a nota.')
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
    setWikilinkIndexProgress(null)
    setWikilinkIndexCancelled(false)
    try {
      await persistWorkspaceDraftsBeforePathChange(vault.path)
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
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível mover o item.')
    } finally {
      setLoading(false)
      setWikilinkIndexProgress(null)
      setWikilinkIndexCancelled(false)
    }
  }

  async function moveDraggedNote(relativePath: string, destinationFolder: string) {
    if (!vault || relativePath.startsWith(`${destinationFolder}/`)) return
    const name = relativePath.split('/').at(-1) ?? relativePath
    const destinationPath = destinationFolder ? `${destinationFolder}/${name}` : name
    setLoading(true)
    setWikilinkIndexProgress(null)
    setWikilinkIndexCancelled(false)
    try {
      await persistWorkspaceDraftsBeforePathChange(vault.path)
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
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível mover a nota.')
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
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível abrir a lixeira.')
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
      // Remove do indice em memoria as notas atingidas (incremental) e
      // sincroniza notas indexadoras que apontavam para os itens excluidos.
      if (vaultWikilinkIndexRef.current) {
        const deletedPaths = [...vaultWikilinkIndexRef.current.entries.keys()].filter(isDeletedPath)
        const indexadoraSources = new Set<string>()
        for (const path of deletedPaths) {
          for (const source of vaultWikilinkIndexRef.current.backlinks.get(path) ?? []) indexadoraSources.add(source)
        }
        for (const path of deletedPaths) {
          vaultWikilinkIndexRef.current = removeWikilinkEntry(vaultWikilinkIndexRef.current, path)
        }
        for (const sourcePath of indexadoraSources) void syncIndexadoraPath(sourcePath)
      }
      // Exclusao muda o conjunto de notas: o cache de conteudos do grafo
      // perde a validade e e reconstruido na proxima leitura unificada.
      vaultNoteContentsRef.current = null
      await refreshNotes(vault.path, '')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível excluir o item.')
    } finally {
      setLoading(false)
    }
  }

  async function restoreTrashItem(id: string) {
    if (!vault) return
    setError(null)
    setLoading(true)
    try {
      await invoke('restore_trash_item', { path: vault.path, id })
      setTrashItems((items) => items.filter((item) => item.id !== id))
      setStatus('Item restaurado no local original.')
      await refreshNotes(vault.path)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível restaurar o item.')
    } finally {
      setLoading(false)
    }
  }

  async function permanentlyDeleteTrashItem() {
    if (!vault || !permanentDeleteTarget) return
    const target = permanentDeleteTarget
    setError(null)
    setLoading(true)
    try {
      await invoke('permanently_delete_trash_item', { path: vault.path, id: target.id })
      setTrashItems((items) => items.filter((item) => item.id !== target.id))
      setPermanentDeleteTarget(null)
      setStatus('Item excluído permanentemente da lixeira.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível excluir o item permanentemente.')
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

    // Navegar para uma nota existente encerra o rascunho de nova nota: sem
    // isso, autosave, indicador e historico continuavam tratando a nota aberta
    // como se fosse a nova nota nao salva.
    setIsNewNoteDraft(false)

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
      // Painel de propriedades fecha ao trocar de nota (o editor e recriado
      // com o frontmatter colapsado na barra).
      setFrontmatterPanelOpen(false)
      setOpenTabs((currentTabs) =>
        currentTabs.includes(parsedNote.relativePath)
          ? currentTabs
          : [...currentTabs, parsedNote.relativePath],
      )
      setDraftContent(draftsByPathRef.current[parsedNote.relativePath] ?? parsedNote.content)
      void loadBacklinks(parsedNote.relativePath, targetVaultPath)
      void loadBrokenLinks(parsedNote.relativePath, targetVaultPath)
      setStatus(`Editando ${parsedNote.relativePath}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Não foi possível abrir a nota.'
      setError(message)
      setStatus('Falha ao abrir a nota selecionada.')
    } finally {
      setLoading(false)
    }
  }

  async function loadBacklinks(relativePath: string, vaultPath: string) {
    // Consulta o indice em memoria (construido em segundo plano ao abrir o
    // Vault); so varre o disco quando o indice ainda nao esta pronto.
    const index = vaultWikilinkIndexRef.current
    if (index) {
      const namesByPath = new Map(notesRef.current.map((note) => [note.relativePath, note.name]))
      setBacklinks(resolveBacklinksFromIndex(index, relativePath, namesByPath))
      return
    }
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

  function cycleNoteViewMode() {
    changeEditorMode(editorMode === 'mixed' ? 'edit' : editorMode === 'edit' ? 'read' : 'mixed')
  }

  // A troca de modo preserva a posicao de leitura de cada painel e termina a
  // edicao de um bloco misto sem quebrar o layout da tela.
  function changeEditorMode(nextMode: 'mixed' | 'edit' | 'read') {
    if (nextMode === editorMode) return
    const activePath = activeNoteRef.current?.relativePath
    if (activePath && editorPanelRef.current) {
      panelScrollRef.current[`${activePath}:${editorMode}`] = editorPanelRef.current.scrollTop
    }
    setEditorMode(nextMode)
    // O editor e recriado ao trocar de modo: o painel de propriedades volta
    // para a barra colapsada (estado do App sincronizado).
    setFrontmatterPanelOpen(false)
  }

  // Restaura a posicao de leitura ao trocar de modo e, ao trocar de nota, leva
  // para a posicao salva da nova nota (ou para o topo quando nao ha posicao).
  useLayoutEffect(() => {
    const activePath = activeNote?.relativePath
    if (!activePath) return
    const panel = editorPanelRef.current
    if (!panel) return
    const saved = panelScrollRef.current[`${activePath}:${editorMode}`] ?? 0
    const pathChanged = lastEditorPathRef.current !== activePath
    if (pathChanged) {
      panel.scrollTop = saved
    } else if (saved > 0 && panel.scrollTop === 0) {
      panel.scrollTop = saved
    }
    lastEditorPathRef.current = activePath
  }, [editorMode, activeNote?.relativePath])

  /** Aplica `tag` ao frontmatter de `content` (lista YAML de tags), preservando
   *  o resto do rascunho. Retorna o conteudo original quando o frontmatter
   *  nao pode ser editado com seguranca. */
  function withReviewTag(content: string, tag: string): string {
    const nextTags = [...new Set([...extractMarkdownTags(content), tag])]
    const result = setMarkdownFrontmatterPropertySource(content, 'tags', nextTags.map((item) => `- ${item}`).join('\n'))
    return result.error ? content : result.content
  }

  /** Aplica uma tag (painel de propriedades) e SALVA a nota imediatamente:
   *  adicionar uma tag nao pode deixar a nota suja — mudanca so de tag no
   *  frontmatter nao invalida a avaliacao, e o rascunho pendente faria o
   *  status de Avaliacao & revisao perder o verde ate um salvar manual. */
  function applyExistingTag(tag: string) {
    const contentToSave = withReviewTag(draftContent, tag)
    setDraftContent(() => contentToSave)
    setStatus(`Tag aplicada: #${tag}`)
    void saveActiveNote(true, contentToSave)
  }

  /** Adocao de perfil de revisao no popover de Avaliacao & revisao: aplica a
   *  tag ao rascunho E salva a nota imediatamente. Adotar um perfil precisa
   *  ativar a politica e o agendamento na hora — nao pode ficar dependendo do
   *  autosave (desligado por padrao) nem de salvar manualmente. */
  function applyReviewProfileTag(tag: string) {
    const contentToSave = withReviewTag(draftContent, tag)
    setDraftContent(() => contentToSave)
    setStatus(`Tag aplicada: #${tag}`)
    void saveActiveNote(true, contentToSave)
  }

  function removeTag(tag: string) {
    const currentContent = draftContent
    const nextTags = extractMarkdownTags(currentContent).filter((item) => item !== tag)
    const result = setMarkdownFrontmatterPropertySource(currentContent, 'tags', nextTags.map((item) => `- ${item}`).join('\n'))
    const contentToSave = result.error ? currentContent : result.content
    setDraftContent(() => contentToSave)
    setStatus(`Tag removida: #${tag}`)
    void saveActiveNote(true, contentToSave)
  }

  /** Salva a nota ativa. Devolve `true` quando o conteudo foi gravado no
   *  disco (incluindo nota nova); `false` quando nada foi salvo (rascunho em
   *  voo, conflito externo ou falha) — usado por acoes que precisam do
   *  arquivo salvo antes de prosseguir (avaliacao e revisao). */
  async function saveActiveNote(isAutomatic = false, contentOverride?: string): Promise<boolean> {
    if (!vault || !activeNote || saveInFlightRef.current) {
      return false
    }
    saveInFlightRef.current = true
    const notePath = activeNote.relativePath
    const contentToSave = contentOverride ?? draftContent

    if (isNewNoteDraft) {
      const relativePath = formatNoteTitleAsPath(createNoteForm.title)
      if (!relativePath) {
        setError('Defina um titulo valido antes de salvar a nova nota.')
        saveInFlightRef.current = false
        return false
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
        return true
      } finally {
        saveInFlightRef.current = false
        setSaving(false)
        if (isAutomatic) setAutoSaveState('saved')
      }
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
        setStatus('Alteração externa detectada antes de salvar. Escolha qual versão manter.')
        return false
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
      // Atualiza o indice em memoria so da nota salva (incremental) e
      // sincroniza as notas indexadoras afetadas por esta edicao de links.
      const previousTargets = graphWikilinkIndexRef.current?.entries.get(notePath)?.targets
        ?? vaultWikilinkIndexRef.current?.entries.get(notePath)?.targets
        ?? []
      if (graphWikilinkIndexRef.current) {
        graphWikilinkIndexRef.current = applyWikilinkEdit(
          graphWikilinkIndexRef.current,
          parsedNote.relativePath,
          parsedNote.content,
        )
      }
      // Mantem o indice do Vault em dia para backlinks/autocomplete e para a
      // sincronizacao das notas indexadoras (o grafo pode nunca ter sido aberto).
      if (vaultWikilinkIndexRef.current) {
        vaultWikilinkIndexRef.current = applyWikilinkEdit(
          vaultWikilinkIndexRef.current,
          parsedNote.relativePath,
          parsedNote.content,
        )
      }
      // O cache de conteudos do grafo acompanha o salvamento.
      updateVaultNoteContents(parsedNote.relativePath, parsedNote.name, parsedNote.content)
      void syncIndexadorasAfterSave(parsedNote, previousTargets)
      if (isStillActive) setStatus(`Nota salva: ${parsedNote.relativePath}`)
      void loadBacklinks(parsedNote.relativePath, vault.path)
      void loadBrokenLinks(parsedNote.relativePath, vault.path)
      void refreshHistoryStatus(vault.path)
      void invoke<TagSummary[]>('get_tag_index', { path: vault.path })
        .then(setTagIndex)
        .catch(() => undefined)
      return true
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar a nota.'
      setError(message)
      setStatus('Falha ao salvar a nota atual.')
      return false
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
      if (isAutomatic) setAutoSaveState(draftContentRef.current === contentToSave ? 'saved' : 'pending')
    }
  }

  /** Rele a nota `path` e reescreve a secao gerada (se for indexadora) ou a
   *  remove (se a flag saiu). Nao sobrescreve um rascunho mais novo quando
   *  `skipIfDirtyOf` e o proprio caminho. Atualiza os indices em memoria. */
  async function syncIndexadoraPath(path: string, skipIfDirtyOf?: string): Promise<boolean> {
    if (!vault) return false
    const index = graphWikilinkIndexRef.current ?? vaultWikilinkIndexRef.current
    if (!index) return false
    try {
      const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath: path })
      const note = parseNoteDocument(payload)
      if (skipIfDirtyOf === path && draftContentRef.current !== note.content) return false
      const backlinks = getWikilinkBacklinks(index, path)
      const synced = isIndexadora(note.content)
        ? syncIndexadoraSection(note.content, backlinks)
        : removeIndexadoraSection(note.content)
      if (synced === note.content) return false
      await invoke<unknown>('save_note', { path: vault.path, relativePath: path, content: synced })
      if (graphWikilinkIndexRef.current) {
        graphWikilinkIndexRef.current = applyWikilinkEdit(graphWikilinkIndexRef.current, path, synced)
      }
      if (vaultWikilinkIndexRef.current) {
        vaultWikilinkIndexRef.current = applyWikilinkEdit(vaultWikilinkIndexRef.current, path, synced)
      }
      updateVaultNoteContents(path, note.name, synced)
      return true
    } catch {
      // Falha ao gravar uma indexadora nunca derruba o salvamento original.
      return false
    }
  }

  /** Apos salvar uma nota, sincroniza as secoes das notas indexadoras cujos
   *  backlinks mudaram por causa dos links novos/removidos na nota salva. O
   *  conjunto afetado e calculado UMA vez (sem cascata): a propria nota salva
   *  (popula ou remove a propria secao) + indexadoras que a nota salva
   *  comecou/deixou de referenciar. */
  async function syncIndexadorasAfterSave(
    savedNote: ReturnType<typeof parseNoteDocument>,
    previousTargets: string[],
  ) {
    if (!vault) return
    const index = graphWikilinkIndexRef.current ?? vaultWikilinkIndexRef.current
    if (!index) return
    const savedPath = savedNote.relativePath
    const currentTargets = index.entries.get(savedPath)?.targets ?? []
    const affected = new Set<string>([savedPath])
    for (const candidatePath of new Set([...previousTargets, ...currentTargets])) {
      if (candidatePath === savedPath) continue
      try {
        const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath: candidatePath })
        if (isIndexadora(parseNoteDocument(payload).content)) affected.add(candidatePath)
      } catch {
        // Link quebrado ou nota inexistente: nada a sincronizar.
      }
    }
    for (const path of affected) {
      await syncIndexadoraPath(path, savedPath)
    }
  }

  /** Liga/desliga a flag indexadora da nota ativa e salva na hora. A secao
   *  gerada ja entra no rascunho para o editor refletir imediatamente. */
  async function toggleActiveNoteIndexadora() {
    if (!vault || !activeNote || isNewNoteDraft || saving || loading) return
    const enabled = !isIndexadora(activeNote.content)
    const flagContent = setIndexadoraFlag(activeNote.content, enabled)
    const index = graphWikilinkIndexRef.current ?? vaultWikilinkIndexRef.current
    const backlinks = index ? getWikilinkBacklinks(index, activeNote.relativePath) : []
    const finalContent = enabled
      ? syncIndexadoraSection(flagContent, backlinks)
      : removeIndexadoraSection(flagContent)
    draftContentRef.current = finalContent
    setDraftContent(finalContent)
    await saveActiveNote(false, finalContent)
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
    setStatus(`Alteração externa carregada: ${externalNote.relativePath}`)
  }

  function keepLocalNoteVersion() {
    if (!externalNoteConflict) return
    const { externalNote, localContent } = externalNoteConflict
    setActiveNote(externalNote)
    setDraftContent(localContent)
    setDraftsByPath((drafts) => ({ ...drafts, [externalNote.relativePath]: localContent }))
    setExternalNoteConflict(null)
    setStatus('Rascunho local mantido. Salve a nota para aplicar sua versão.')
  }

  async function writeRecoveredExternalNote(relativePath: string, content: string) {
    if (!vault) throw new Error('Nenhum vault esta aberto.')
    const payload = await invoke<unknown>('recover_note', {
      path: vault.path,
      relativePath,
      content,
    })
    return parseNoteDocument(payload)
  }

  function showNextExternallyRemovedNote() {
    const nextRemovedNote = externalRemovedNoteQueueRef.current.shift() ?? null
    setExternalRemovedNote(nextRemovedNote)
    setRecoveredNotePath(nextRemovedNote
      ? nextRemovedNote.relativePath.replace(/\.md$/i, '-recuperada.md')
      : '')
  }

  function applyRecoveredExternalNote(recoveredNote: NoteDocument) {
    if (!externalRemovedNote) return
    const removedPath = externalRemovedNote.relativePath
    setOpenTabs((tabs) => [...new Set(tabs.map((path) => (
      path === removedPath ? recoveredNote.relativePath : path
    )))])
    setDraftsByPath((drafts) => {
      const { [removedPath]: _removedDraft, ...remainingDrafts } = drafts
      return { ...remainingDrafts, [recoveredNote.relativePath]: recoveredNote.content }
    })
    setNotes((currentNotes) => {
      const preview = { name: recoveredNote.name, relativePath: recoveredNote.relativePath }
      return currentNotes.some((note) => note.relativePath === recoveredNote.relativePath)
        ? currentNotes.map((note) => note.relativePath === recoveredNote.relativePath ? preview : note)
        : [...currentNotes, preview]
    })
    if (externalRemovedNote.wasActive) {
      setActiveNote(recoveredNote)
      setDraftContent(recoveredNote.content)
    }
    showNextExternallyRemovedNote()
  }

  async function restoreExternallyRemovedNote() {
    if (!externalRemovedNote) return
    setLoading(true)
    setError(null)
    try {
      const recoveredNote = await writeRecoveredExternalNote(
        externalRemovedNote.relativePath,
        externalRemovedNote.content,
      )
      applyRecoveredExternalNote(recoveredNote)
      setStatus(`Nota restaurada: ${recoveredNote.relativePath}`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível restaurar a nota.')
    } finally {
      setLoading(false)
    }
  }

  async function saveExternallyRemovedNoteAsNew() {
    if (!externalRemovedNote) return
    const destinationPath = normalizeRecoveredNotePath(recoveredNotePath)
    if (!destinationPath) {
      setError('Informe um caminho para a nota recuperada.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const recoveredNote = await writeRecoveredExternalNote(
        destinationPath,
        externalRemovedNote.content,
      )
      applyRecoveredExternalNote(recoveredNote)
      setStatus(`Rascunho recuperado como ${recoveredNote.relativePath}.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível recuperar a nota.')
    } finally {
      setLoading(false)
    }
  }

  function closeExternallyRemovedNote() {
    if (!externalRemovedNote) return
    const removedPath = externalRemovedNote.relativePath
    const pendingRemovedPaths = new Set(
      externalRemovedNoteQueueRef.current.map((note) => note.relativePath),
    )
    const fallbackPath = openTabsRef.current
      .filter((path) => path !== removedPath && !pendingRemovedPaths.has(path))
      .at(-1)
    setOpenTabs((tabs) => tabs.filter((path) => path !== removedPath))
    setDraftsByPath((drafts) => {
      const { [removedPath]: _removedDraft, ...remainingDrafts } = drafts
      return remainingDrafts
    })
    setEditorSessionsByPath((sessions) => {
      const { [removedPath]: _removedSession, ...remainingSessions } = sessions
      return remainingSessions
    })
    for (const key of markdownEditorStateCacheRef.current.keys()) {
      if (key === removedPath || key.startsWith(`${removedPath}::`)) {
        markdownEditorStateCacheRef.current.delete(key)
      }
    }
    showNextExternallyRemovedNote()
    if (externalRemovedNote.wasActive) {
      if (fallbackPath) void openNote(fallbackPath)
      else {
        setActiveNote(null)
        setDraftContent('')
      }
    }
    setStatus('A aba da nota removida foi fechada; o arquivo nao foi recriado.')
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

    // A nota diaria e uma nota existente: encerra o rascunho de nova nota.
    setIsNewNoteDraft(false)

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
        : 'Não foi possível abrir a nota diaria.'
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

  // Navegacao dos links do modo Misto: o widget clicavel aparece quando a
  // mascara esta ativa (cursor longe do link). Nota interna abre no app;
  // URL externa abre em nova janela/aba.
  function handleMixedOpenLink(target: LinkTarget) {
    if (target.kind === 'note') {
      void openWikiLink(target.path, target.fragment ?? null)
    } else {
      window.open(target.href, '_blank', 'noopener,noreferrer')
    }
  }

  // Imagens do modo Misto: ativo local do vault (via `mirrormind.local/asset/`)
  // e resolvido para URL utilizavel (convertFileSrc), como no modo Leitura.
  function resolveMixedAssetUrl(relativePath: string) {
    if (!vault) return relativePath
    return convertFileSrc(`${vault.path}${vault.path.includes('\\') ? '\\' : '/'}${relativePath}`)
  }

  // Embeds de nota do modo Misto: le o corpo (sem frontmatter) da nota
  // incorporada `![[nota]]`, como o ObsidianNoteEmbed faz no modo Leitura.
  // Normaliza a extensao: `![[inicial]]` busca `inicial.md` (o inventario so
  // lista notas .md; o Leitura classico resolvia o caminho pelo inventario).
  function resolveMixedEmbedBody(relativePath: string): Promise<string> {
    if (!vault) return Promise.resolve('')
    const notePath = relativePath.toLowerCase().endsWith('.md') ? relativePath : `${relativePath}.md`
    return invoke<unknown>('read_note', { path: vault.path, relativePath: notePath })
      .then((payload) => getMarkdownBody(parseNoteDocument(payload).content))
  }

  // Sessao do editor atualmente visivel (Edicao usa a chave do caminho; Misto
  // usa a chave composta). Leitura (read-only) nunca abre o popover de selecao.
  const activeEditorSession = useMemo(() => {
    if (editorMode === 'read' || !activeNote) return null
    const key = editorMode === 'edit' ? activeNote.relativePath : `${activeNote.relativePath}::misto::gfm`
    return editorSessionsByPath[key] ?? null
  }, [activeNote, editorMode, editorSessionsByPath])

  // Popover de formatacao: aparece nos modos com editor quando ha uma selecao
  // nao-colapsada, ancorado na linha do cursor inicial da selecao. Some quando
  // a selecao colapsa ou o texto sai da area visivel; o blur e o Escape sao
  // tratados abaixo (onBlur dos editores e listener global de teclado).
  useEffect(() => {
    if (editorMode === 'read' || !activeNote) {
      setSelectionPopover(null)
      return
    }
    const session = activeEditorSession
    if (!session || session.selectionStart === session.selectionEnd) {
      setSelectionPopover(null)
      return
    }
    const container = editorContentRef.current
    if (!container) {
      setSelectionPopover(null)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const rect = markdownCodeEditorRef.current?.getSelectionRect()
    if (!rect) {
      // Sem geometria (ex.: testes/jsdom ou linha fora da area visivel): ancora
      // no topo central do painel para nao perder a acao por falta de layout.
      setSelectionPopover({ flip: false, shiftX: 0, x: Math.max(60, containerRect.width / 2), y: 12 })
      return
    }
    const centerX = (rect.left + rect.right) / 2 - containerRect.left
    const above = rect.top - containerRect.top - 8
    const flip = above < 0
    setSelectionPopover({
      flip,
      shiftX: 0,
      x: Math.min(Math.max(centerX, 60), Math.max(60, containerRect.width - 60)),
      y: flip ? rect.bottom - containerRect.top + 8 : above,
    })
  }, [activeEditorSession, activeNote, editorMode])

  // Contencao horizontal: como o popover e centralizado no ponto de ancoragem
  // (translateX(-50%)), metade da sua largura pode estourar o painel quando a
  // selecao esta perto da borda (ex.: inicio da linha) e ficar cortada pelo
  // explorador. Mede o popover ja renderizado e desloca-o (incrementalmente,
  // via nextPopoverShiftX) para dentro dos limites do mesmo contêiner da busca
  // Ctrl+F (.editor-content) — sem oscilar, pois o delta vira 0 ao entrar.
  useLayoutEffect(() => {
    if (!selectionPopover) return
    const popover = selectionPopoverRef.current
    const container = editorContentRef.current
    if (!popover || !container) return
    const popoverRect = popover.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const shiftX = nextPopoverShiftX(
      popoverRect.left,
      popoverRect.right,
      containerRect.left,
      containerRect.right,
      selectionPopover.shiftX,
    )
    if (shiftX !== selectionPopover.shiftX) {
      setSelectionPopover((current) => (current ? { ...current, shiftX } : current))
    }
  }, [selectionPopover])

  // Escape fecha o popover de formatacao sem roubar o foco do editor.
  useEffect(() => {
    if (!selectionPopover) return
    const handlePopoverKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectionPopover(null)
        focusActiveEditor()
      }
    }
    window.addEventListener('keydown', handlePopoverKeyDown)
    return () => window.removeEventListener('keydown', handlePopoverKeyDown)
  }, [selectionPopover])

  const noteFindMatches = useMemo(() => findTextMatches(draftContent, noteFindQuery), [noteFindQuery, draftContent])
  // No modo Leitura as correspondencias vêm do DOM renderizado (readFindTotal);
  // nos modos com editor, do texto-fonte (noteFindMatches).
  const findTotal = editorMode === 'read' ? readFindTotal : noteFindMatches.length
  const lastNoteFindQueryRef = useRef('')

  // Sincroniza o destaque do editor com a query atual e volta para a primeira
  // correspondencia quando o termo muda (nao quando o documento muda, para nao
  // roubar o cursor do usuario enquanto digita na nota).
  useEffect(() => {
    if (!noteFindOpen) return
    // Modo Leitura: navegacao e destaque sao feitos pelo DOM (readFindMatches/
    // selectReadFindMatch); nao toca no editor — os offsets do texto-fonte
    // (com frontmatter) nao batem com o doc `noteBody` do Leitura.
    if (editorMode === 'read') {
      if (lastNoteFindQueryRef.current !== noteFindQuery) {
        lastNoteFindQueryRef.current = noteFindQuery
        setNoteFindIndex(0)
      }
      return
    }
    // Ao trocar de modo, o editor pode ter sido montado do zero (ex.: Leitura
    // -> Edicao com a busca aberta); reaplica o destaque sem mover a selecao.
    markdownCodeEditorRef.current?.setFindQuery(noteFindQuery)
    if (lastNoteFindQueryRef.current === noteFindQuery) return
    lastNoteFindQueryRef.current = noteFindQuery
    setNoteFindIndex(0)
    const first = noteFindMatches[0]
    if (first) markdownCodeEditorRef.current?.selectRange(first.from, first.to)
  }, [noteFindOpen, noteFindQuery, noteFindMatches, editorMode])

  // Quando o documento muda (ex.: digitacao na nota), o total de correspondencias
  // pode encolher; mantem o indice dentro dos limites sem reiniciar a navegacao.
  useEffect(() => {
    if (!noteFindOpen) return
    const total = editorMode === 'read' ? readFindTotal : noteFindMatches.length
    setNoteFindIndex((current) => Math.min(current, Math.max(0, total - 1)))
  }, [noteFindOpen, noteFindMatches.length, readFindTotal, editorMode])

  // Modo Leitura: recalcula as correspondencias sobre o DOM do artigo quando o
  // termo ou o conteudo mudam. Declarado ANTES do efeito de navegacao para que
  // a ref esteja atualizada quando ele selecionar a primeira correspondencia.
  useEffect(() => {
    if (editorMode !== 'read' || !noteFindOpen || !noteFindQuery.trim()) {
      readFindMatchesRef.current = []
      setReadFindTotal(0)
      return
    }
    const article = editorPanelRef.current
    if (!article) {
      readFindMatchesRef.current = []
      setReadFindTotal(0)
      return
    }
    const matches = findReadMatches(article, noteFindQuery)
    readFindMatchesRef.current = matches
    setReadFindTotal(matches.length)
  }, [editorMode, noteFindOpen, noteFindQuery, draftContent, noteBody])

  // Modo Leitura: seleciona e rola ate a correspondencia atual (Range do DOM,
  // sem mutar a arvore que o React gerencia).
  useEffect(() => {
    if (editorMode !== 'read' || !noteFindOpen) return
    const match = readFindMatchesRef.current[noteFindIndex]
    if (!match) return
    selectReadFindMatch(match)
  }, [editorMode, noteFindOpen, noteFindIndex, noteFindQuery, draftContent])

  // Trocar de nota fecha a busca para nao aplicar um termo antigo ao novo arquivo.
  useEffect(() => {
    resetNoteFindState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.relativePath])

  // Abre a busca no modo atual (Edicao, Misto ou Leitura) sem trocar de modo:
  // a barra flutuante fica sobre o conteudo e a navegacao usa o editor nos
  // modos com CodeMirror e o DOM renderizado no modo Leitura.
  function openNoteFind() {
    setNoteFindOpen(true)
  }

  /** Seleciona (destaca) e rola ate uma correspondencia do modo Leitura. */
  function selectReadFindMatch(match: ReadFindMatch) {
    const range = document.createRange()
    range.setStart(match.node, Math.min(match.start, match.node.data.length))
    range.setEnd(match.endNode, Math.min(match.end, match.endNode.data.length))
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // jsdom nao implementa scrollIntoView (guard para os testes); em navegador
    // reais rola o painel de leitura ate a correspondencia.
    const target = match.node.parentElement
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' })
  }

  function closeNoteFind() {
    resetNoteFindState()
    focusActiveEditor()
  }

  function resetNoteFindState() {
    setNoteFindOpen(false)
    setNoteFindQuery('')
    setNoteFindIndex(0)
    readFindMatchesRef.current = []
    setReadFindTotal(0)
    markdownCodeEditorRef.current?.setFindQuery('')
    // No modo Leitura a selecao da navegacao fica no DOM; limpa ao fechar.
    if (editorMode === 'read') window.getSelection()?.removeAllRanges()
  }

  function navigateNoteFind(delta: number) {
    const total = editorMode === 'read' ? readFindMatchesRef.current.length : noteFindMatches.length
    if (total === 0) return
    const next = (noteFindIndex + delta + total) % total
    setNoteFindIndex(next)
    if (editorMode === 'read') {
      const match = readFindMatchesRef.current[next]
      if (match) selectReadFindMatch(match)
      return
    }
    const match = noteFindMatches[next]
    if (match) markdownCodeEditorRef.current?.selectRange(match.from, match.to)
  }

  function applyMarkdownFormat(format: MarkdownFormat) {
    const selection = getActiveEditorSelection()
    if (!selection) return
    setDraftContent((currentContent) => formatMarkdownSelection(currentContent, selection.selectionStart, selection.selectionEnd, format))
    requestAnimationFrame(focusActiveEditor)
  }

  function replaceEditorSelection(replacement: string) {
    const selection = getActiveEditorSelection()
    if (!selection) return
    const { selectionStart, selectionEnd } = selection
    setDraftContent((currentContent) => `${currentContent.slice(0, selectionStart)}${replacement}${currentContent.slice(selectionEnd)}`)
    requestAnimationFrame(focusActiveEditor)
  }

  function preserveEditorSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
  }

  /** Dados do painel integrado de frontmatter (modo Misto): linhas chave/valor
   * (o valor e a fonte YAML crua de cada propriedade, para edicao estruturada
   * sem perder listas/objetos), a secao de Tags (badges + sugestoes do botao
   * "+") e os backlinks ("Referenciada por"). A propriedade `tags` e
   * EXCLUIDA das linhas — e renderizada pela secao de Tags. */
  function getFrontmatterPanelData(): FrontmatterPanelData {
    const rows = Object.keys(frontmatterProperties)
      .filter((key) => key.toLowerCase() !== 'tags')
      .map((key) => ({
        key,
        value: getMarkdownFrontmatterPropertySource(draftContent, key) ?? '',
      }))
    const backlinkEntries = backlinks.map((backlink) => ({
      name: backlink.name.replace(/\.md$/i, ''),
      relativePath: backlink.relativePath,
    }))
    return {
      rows,
      tags: noteTags,
      availableTags: tagIndex.map((entry) => entry.tag),
      backlinks: backlinkEntries,
    }
  }

  /** Aplica as linhas editadas do painel ao draft, preservando o restante do
   * YAML byte a byte: remove as propriedades que sairam e grava/atualiza as
   * presentes (criando o bloco quando a nota nao tinha frontmatter). Retorna
   * a mensagem de erro (exibida no painel) ou null. */
  function applyFrontmatterPanel(rows: FrontmatterRow[]): string | null {
    let content = draftContent
    const targetKeys = new Set(rows.map((row) => row.key.trim().toLowerCase()))
    for (const key of Object.keys(frontmatterProperties)) {
      if (targetKeys.has(key.toLowerCase())) continue
      const removed = removeMarkdownFrontmatterProperty(content, key)
      if (removed.error) return removed.error
      content = removed.content
    }
    for (const row of rows) {
      const key = row.key.trim()
      if (!key) continue
      const result = setMarkdownFrontmatterPropertySource(content, key, row.value)
      if (result.error) return result.error
      content = result.content
    }
    setDraftContent(content)
    return null
  }

  function selectMarkdownTool(format: MarkdownFormat) {
    applyMarkdownFormat(format)
  }

  function applyMarkdownTableAction(action: MarkdownTableAction) {
    const selection = getActiveEditorSelection()
    if (!selection) return
    setDraftContent((currentContent) => transformMarkdownTable(currentContent, selection.selectionStart, action))
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
      // A posicao X e medida a partir da borda direita: arrastar para a
      // direita reduz a distancia, arrastar para a esquerda aumenta.
      setMarkdownToolsPosition(clampMarkdownToolsPosition({
        x: startPosition.x - (moveEvent.clientX - startX),
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
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível anexar o arquivo.')
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

  function scrollToWikiHeading(fragment: string) {
    if (!fragment) return
    // Motor unico: as linhas sao `.cm-line` e os titulos sao spans mascarados
    // com a classe `cm-live-hN` (nao `<hN>` reais) — o Leitura classico
    // (article ReactMarkdown) foi aposentado.
    if (fragment.startsWith('^')) {
      const blocks = document.querySelectorAll<HTMLElement>('.markdown-mixed .cm-line')
      const block = [...blocks].find((candidate) => candidate.textContent?.trim().endsWith(fragment))
      const target = block?.textContent?.trim() === fragment && block.previousElementSibling instanceof HTMLElement
        ? block.previousElementSibling
        : block
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const targetPath = fragment.split('#').map((segment) => segment.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean)
    const headings = document.querySelectorAll<HTMLElement>('.markdown-mixed [class~="cm-live-h1"], .markdown-mixed [class~="cm-live-h2"], .markdown-mixed [class~="cm-live-h3"], .markdown-mixed [class~="cm-live-h4"], .markdown-mixed [class~="cm-live-h5"], .markdown-mixed [class~="cm-live-h6"]')
    const hierarchy: string[] = []
    const heading = [...headings].find((candidate) => {
      const levelMatch = candidate.className.match(/cm-live-h([1-6])/)
      const level = levelMatch ? Number(levelMatch[1]) : 1
      const title = candidate.textContent?.trim().replace(/\s+/g, ' ').toLowerCase() ?? ''
      hierarchy.length = level - 1
      hierarchy[level - 1] = title
      const path = hierarchy.filter(Boolean)
      return targetPath.length === 1
        ? title === targetPath[0]
        : path.length >= targetPath.length
          && path.slice(-targetPath.length).every((segment, index) => segment === targetPath[index])
    })
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function openWikiLink(relativePath: string, fragment: string | null) {
    if (!vault) return
    // Resolve o wikilink contra o inventario de notas (mesma logica do
    // renderer classico): `[[#fragmento]]` sem caminho vira a nota atual,
    // `[[alvo]]` sem extensao experimenta o sufixo `.md` (o inventario so
    // lista notas .md) e caminhos inexistentes (ex.: `[[nova/página]]`)
    // permanecem como estao, para criacao.
    const available = notes.map((note) => note.relativePath)
    const sourcePath = activeNote?.relativePath ?? ''
    const resolveCandidate = (candidate: string) => resolveObsidianWikiLinkPath(candidate, sourcePath, available)
    let resolvedPath = resolveCandidate(relativePath)
    if (resolvedPath === relativePath && !relativePath.toLowerCase().endsWith('.md')) {
      resolvedPath = resolveCandidate(`${relativePath}.md`)
    }
    const existingPath = notes.find((note) => note.relativePath.toLowerCase() === resolvedPath.toLowerCase())?.relativePath
    const targetPath = existingPath ?? resolvedPath

    if (activeNote?.relativePath.toLowerCase() === targetPath.toLowerCase()) {
      if (fragment) window.setTimeout(() => scrollToWikiHeading(fragment), 0)
      return
    }

    if (!existingPath) {
      const pendingPath = targetPath.toLowerCase()
      if (openingWikiLinkPathsRef.current.has(pendingPath)) return
      openingWikiLinkPathsRef.current.add(pendingPath)
      setLoading(true)
      setError(null)
      try {
        await invoke('create_note', { path: vault.path, relativePath: targetPath })
        await refreshNotes(vault.path)
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível criar a nota vinculada.')
        return
      } finally {
        openingWikiLinkPathsRef.current.delete(pendingPath)
        setLoading(false)
      }
    }

    await openNote(targetPath)
    if (fragment) window.setTimeout(() => scrollToWikiHeading(fragment), 0)
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

  /** Cria uma conexao no grafo: anexa `[[Nota Alvo]]` na nota focada e salva.
   *  Quando a nota tem rascunho nao salvo (aberto ou em outra aba), o link e
   *  incorporado ao rascunho e o salvamento ocorre pelo fluxo normal; caso
   *  contrario, le o arquivo do disco, anexa e salva em segundo plano. */
  async function createGraphConnection(source: GraphDocument, target: NotePreview) {
    if (!vault || !source) return
    setGraphConnectSource(null)
    setGraphConnectQuery('')
    const targetPath = target.relativePath.replace(/\.md$/i, '')
    const link = `[[${targetPath}]]`
    const sourceLabel = source.name.replace(/\.md$/i, '')
    setStatus(`Conectando ${sourceLabel} a ${targetPath}...`)
    try {
      const isActive = activeNote?.relativePath === source.relativePath && !isNewNoteDraft
      const pendingDraft = isActive ? null : (draftsByPathRef.current[source.relativePath] ?? null)
      const baseContent = isActive ? draftContent : pendingDraft
      if (baseContent !== null) {
        const updated = appendWikilinkToContent(baseContent, link)
        if (updated === baseContent) {
          setStatus(`A nota ja referencia ${targetPath}.`)
          return
        }
        if (isActive) {
          setDraftContent(updated)
          await saveActiveNote(false, updated)
        } else {
          await saveGraphNoteInBackground(source.relativePath, updated, true)
        }
        setGraphDocuments((current) => current.map((document) => document.relativePath === source.relativePath ? { ...document, content: updated } : document))
        setStatus(`Conexao criada: ${sourceLabel} -> ${targetPath}`)
        return
      }
      const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath: source.relativePath })
      const latest = parseNoteDocument(payload)
      const updated = appendWikilinkToContent(latest.content, link)
      if (updated === latest.content) {
        setStatus(`A nota ja referencia ${targetPath}.`)
        return
      }
      await saveGraphNoteInBackground(source.relativePath, updated, false)
      setGraphDocuments((current) => current.map((document) => document.relativePath === source.relativePath ? { ...document, content: updated } : document))
      setStatus(`Conexao criada: ${sourceLabel} -> ${targetPath}`)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Não foi possível criar a conexao.'
      setError(message)
      setStatus('Falha ao criar a conexao.')
    }
  }

  /** Revela a nota no explorador: expande as pastas-ancestrais, abre a nota
   *  (selecionando-a na arvore) e rola ate o item. */
  async function revealNoteInExplorer(relativePath: string) {
    setWorkspacePage('notes')
    const segments = relativePath.split('/').filter(Boolean)
    const ancestorIds = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
    setExpandedFolderIds((current) => new Set([...current, ...ancestorIds]))
    await openNote(relativePath)
    requestAnimationFrame(() => {
      document.querySelector('.tree-note.is-active')?.scrollIntoView({ block: 'nearest' })
    })
  }

  /** Salva uma nota que nao e a ativa, atualizando os indices em memoria do
   *  grafo e do vault e sincronizando as notas indexadoras afetadas. Quando
   *  `clearPendingDraft` e true, o rascunho pendente da nota (salvo junto com
   *  o link) e removido para nao ressurgir em um proximo salvamento. */
  async function saveGraphNoteInBackground(relativePath: string, content: string, clearPendingDraft: boolean) {
    if (!vault) return
    const previousTargets = graphWikilinkIndexRef.current?.entries.get(relativePath)?.targets
      ?? vaultWikilinkIndexRef.current?.entries.get(relativePath)?.targets
      ?? []
    const savedPayload = await invoke<unknown>('save_note', {
      path: vault.path,
      relativePath,
      content,
    })
    const savedNote = parseNoteDocument(savedPayload)
    if (clearPendingDraft) {
      setDraftsByPath((current) => {
        if (!(relativePath in current)) return current
        const { [relativePath]: _clearedDraft, ...remaining } = current
        return remaining
      })
    }
    if (graphWikilinkIndexRef.current) {
      graphWikilinkIndexRef.current = applyWikilinkEdit(
        graphWikilinkIndexRef.current,
        relativePath,
        content,
      )
    }
    if (vaultWikilinkIndexRef.current) {
      vaultWikilinkIndexRef.current = applyWikilinkEdit(
        vaultWikilinkIndexRef.current,
        relativePath,
        content,
      )
    }
    updateVaultNoteContents(relativePath, savedNote.name, content)
    void syncIndexadorasAfterSave(savedNote, previousTargets)
    void refreshHistoryStatus(vault.path)
    void invoke<TagSummary[]>('get_tag_index', { path: vault.path })
      .then(setTagIndex)
      .catch(() => undefined)
  }

  function insertTag() {
    const selection = getActiveEditorSelection()
    const normalizedTag = normalizeMarkdownTag(tagName)
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
    const unsupportedMarkdownFeatures = detectUnsupportedMarkdownFeatures(draftContent)
    const activeNotePaths = notes.map((note) => note.relativePath)
    // Notas conectadas a nota ativa (alvos do proprio rascunho + backlinks do
    // indice em memoria, quando o grafo foi aberto) para ranquear o autocomplete.
    const activeConnectedPaths = new Set<string>()
    if (activeNote && !isNewNoteDraft) {
      for (const link of extractObsidianWikiLinks(draftContent)) {
        const targetPath = resolveObsidianWikiLinkPath(link.path, activeNote.relativePath, activeNotePaths)
        if (targetPath !== activeNote.relativePath) activeConnectedPaths.add(targetPath)
      }
      const vaultIndex = vaultWikilinkIndexRef.current
      if (vaultIndex) {
        for (const source of vaultIndex.backlinks.get(activeNote.relativePath) ?? []) activeConnectedPaths.add(source)
      } else if (graphWikilinkIndex) {
        for (const source of graphWikilinkIndex.backlinks.get(activeNote.relativePath) ?? []) activeConnectedPaths.add(source)
      }
    }
    const markdownAutocompleteData = {
      attachments,
      notePaths: activeNotePaths,
      tags: tagIndex.map((entry) => entry.tag),
      connectedNotePaths: [...activeConnectedPaths],
    }
    const favoriteNotes = notes.filter((note) => favorites.includes(note.relativePath))
    const matchingTagSuggestions = tagIndex.filter((entry) =>
      !selectedTags.includes(entry.tag) && entry.tag.includes(tagFilterQuery.trim().replace(/^#/, '').toLowerCase()),
    )
    const allGraphLinks = graphWikilinkIndex
      ? buildNoteGraphLinksFromIndex(graphWikilinkIndex, graphDocuments)
      : buildNoteGraphLinks(graphDocuments, notes.map((note) => note.relativePath))
    const allGraphDegreeByPath = allGraphLinks.reduce<Record<string, number>>((degrees, link) => {
      degrees[link.source] = (degrees[link.source] ?? 0) + 1
      degrees[link.target] = (degrees[link.target] ?? 0) + 1
      return degrees
    }, {})
    const orphanGraphDocuments = graphDocuments.filter((document) => (allGraphDegreeByPath[document.relativePath] ?? 0) === 0)
    const localGraphCenterPath = focusedGraphPath ?? activeNote?.relativePath ?? null
    // Grafo local por profundidade: BFS a partir do centro ate `graphLocalDepth`
    // saltos; `localGraphBeyond` sao as notas alcancaveis alem dessa profundidade
    // (usadas no aviso de resultado limitado).
    const localGraphReached = new Set<string>()
    if (localGraphCenterPath) localGraphReached.add(localGraphCenterPath)
    let localGraphFrontier = localGraphCenterPath ? [localGraphCenterPath] : []
    for (let hop = 1; hop <= graphLocalDepth; hop++) {
      const nextLevel = new Set<string>()
      for (const node of localGraphFrontier) {
        for (const link of allGraphLinks) {
          if (link.source === node && !localGraphReached.has(link.target)) nextLevel.add(link.target)
          else if (link.target === node && !localGraphReached.has(link.source)) nextLevel.add(link.source)
        }
      }
      for (const path of nextLevel) localGraphReached.add(path)
      localGraphFrontier = [...nextLevel]
    }
    const localGraphBeyond = new Set<string>()
    for (const node of localGraphFrontier) {
      for (const link of allGraphLinks) {
        if (link.source === node && !localGraphReached.has(link.target)) localGraphBeyond.add(link.target)
        else if (link.target === node && !localGraphReached.has(link.source)) localGraphBeyond.add(link.source)
      }
    }
    const localGraphPaths = localGraphReached
    const graphFolders = [...new Set(graphDocuments.map((document) => document.relativePath.split('/').slice(0, -1).join('/')).filter(Boolean))].sort()
    const graphTags = graphTagIndex.allTags()
    const focusedGraphDocument = graphDocuments.find((document) => document.relativePath === focusedGraphPath) ?? null
    // Notas candidatas a nova conexao no grafo: exclui a propria nota de origem
    // e as que ja sao alvo de uma saida existente (pelo indice em memoria). A
    // origem pode ser o no focado (drawer) ou uma nota orfa (painel de limpeza).
    const connectSourceIndexTargets = graphConnectSource
      ? new Set(graphWikilinkIndexRef.current ? getWikilinkTargets(graphWikilinkIndexRef.current, graphConnectSource.relativePath) : [])
      : new Set<string>()
    const graphConnectNotes = graphConnectSource
      ? notes.filter((note) =>
          note.relativePath !== graphConnectSource.relativePath
          && !connectSourceIndexTargets.has(note.relativePath)
          && note.relativePath.toLowerCase().includes(graphConnectQuery.trim().toLowerCase()),
        )
      : []
    const focusedIncomingLinks = focusedGraphPath ? allGraphLinks.filter((link) => link.target === focusedGraphPath) : []
    const focusedOutgoingLinks = focusedGraphPath ? allGraphLinks.filter((link) => link.source === focusedGraphPath) : []
    // Notas que referenciam a selecionada (para os chips clicaveis no drawer).
    const focusedIncomingNotes = focusedIncomingLinks
      .map((link) => graphDocuments.find((document) => document.relativePath === link.source))
      .filter((document): document is GraphDocument => document !== undefined)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    const visibleGraphDocuments = graphDocuments.filter((document) => {
      const title = document.name.replace(/\.md$/i, '').toLowerCase()
      const matchesQuery = !graphQuery.trim() || title.includes(graphQuery.trim().toLowerCase())
      const matchesFolder = !graphFolder || document.relativePath.startsWith(`${graphFolder}/`)
      const matchesTag = !graphTag || graphTagIndex.tagsOf(document.relativePath).includes(graphTag)
      const isOrphan = (allGraphDegreeByPath[document.relativePath] ?? 0) === 0
      return matchesQuery && matchesFolder && matchesTag && (graphMode === 'global' || localGraphPaths.has(document.relativePath)) && (showOnlyGraphOrphans ? isOrphan : showGraphOrphans || !isOrphan)
    })
    const visibleGraphPaths = new Set(visibleGraphDocuments.map((document) => document.relativePath))
    const graphLinks = allGraphLinks.filter((link) => visibleGraphPaths.has(link.source) && visibleGraphPaths.has(link.target))
    const graphDegreeByPath = graphLinks.reduce<Record<string, number>>((degrees, link) => {
      degrees[link.source] = (degrees[link.source] ?? 0) + 1
      degrees[link.target] = (degrees[link.target] ?? 0) + 1
      return degrees
    }, {})
    // Vizinhança direta do no em hover: destacar as arestas e esmaecer os
    // nos sem conexao direta com ele.
    const graphHoverNeighbors = graphHoverPath
      ? new Set([
          graphHoverPath,
          ...graphLinks.filter((link) => link.source === graphHoverPath).map((link) => link.target),
          ...graphLinks.filter((link) => link.target === graphHoverPath).map((link) => link.source),
        ])
      : null
    const graphNodePositions = graphDocuments.reduce<Record<string, GraphPosition>>((positions, document, index) => {
      // Posicoes da simulacao ativa (lidas do mapa vivo em graphPhysicsRef,
      // ou do worker de layout quando o ambiente roda fora da thread) tem
      // prioridade sobre o layout persistido; o restante cai no override ou no
      // circulo. Assim qualquer render do React durante uma simulacao mostra as
      // posicoes REAIS (sem "pulos" para posicoes antigas).
      const live = graphPhysicsRef.current?.positions.get(document.relativePath)
        ?? graphWorkerPositionsRef.current?.get(document.relativePath)
      if (live) {
        positions[document.relativePath] = live
        return positions
      }
      const angle = (Math.PI * 2 * index) / Math.max(graphDocuments.length, 1) - Math.PI / 2
      const radius = graphDocuments.length < 3 ? 56 : 68
      positions[document.relativePath] = graphNodeOverrides[document.relativePath] ?? { x: GRAPH_2D_WORLD_CENTER + Math.cos(angle) * radius, y: GRAPH_2D_WORLD_CENTER + Math.sin(angle) * radius }
      return positions
    }, {})
    // Renderizacao seletiva: acima do limite configuravel, desenha apenas os
    // nos dentro do viewport (com margem) mais o contexto (no focado, no
    // hover e seus vizinhos). Sem tamanho de superficie conhecido, nada e
    // cortado. O resultado resumido exibe a contagem parcial e um aviso.
    const renderedGraphDocuments = selectRenderedGraphDocuments({
      documents: visibleGraphDocuments,
      positions: graphNodePositions,
      viewport: graphViewport,
      surfaceSize: graphSurfaceSize,
      limit: graphRenderLimit,
      priorityPaths: focusedGraphPath || graphHoverPath
        ? new Set([...(focusedGraphPath ? [focusedGraphPath] : []), ...(graphHoverNeighbors ?? [])])
        : undefined,
    })
    const graphRenderedPaths = new Set(renderedGraphDocuments.map((document) => document.relativePath))
    const graphIsSummarized = renderedGraphDocuments.length < visibleGraphDocuments.length
    // Tipo de agrupamento ativo: pasta tem prioridade sobre tag.
    const graphGroupingKind: 'folder' | 'tag' | null = graphGroupByFolder
      ? 'folder'
      : graphGroupByTag
        ? 'tag'
        : null
    // Centros dos grupos (pasta ou tag) para a mola da fisica 2D: atualizado
    // no render com o conjunto visivel atual; a fisica le em
    // graphGroupCentersRef.
    graphGroupCentersRef.current = graphGroupingKind && !graphMode3d
      ? buildGraph2dGroupCentersForGroups(buildGraphGroups(visibleGraphDocuments, {
          kind: graphGroupingKind,
          tagsOfPath: (path) => graphTagIndexRef.current.tagsOf(path),
          primaryTag: graphPrimaryTag || undefined,
        }))
      : null
    // Mapas de grupos (pasta ou tag) para legenda, cores e exportacao
    // (somente com o agrupamento ativo; null economiza o calculo no uso diario).
    const graphGroupMaps = graphGroupingKind
      ? buildGroupMaps(graphDocuments, {
          kind: graphGroupingKind,
          tagsOfPath: (path) => graphTagIndexRef.current.tagsOf(path),
          primaryTag: graphPrimaryTag || undefined,
          colorOverrides: graphColorOverrides,
        })
      : null

    const graphExportLegend = graphGroupMaps
      ? graphGroupMaps.groups.map((group) => ({ label: group.label, color: group.color }))
      : []

    /** Monta o SVG do grafo 2D atual (posicoes percentuais -> pixels). */
    function buildGraph2dSvg(): string | null {
      const width = 1200
      const height = 800
      const scaleX = (width - 40) / GRAPH_2D_WORLD_SIZE
      const scaleY = (height - 40) / GRAPH_2D_WORLD_SIZE
      const toPixels = (position: GraphPosition) => ({ x: 20 + position.x * scaleX, y: 20 + position.y * scaleY })
      const nodes = visibleGraphDocuments.flatMap((document) => {
        const position = graphNodePositions[document.relativePath]
        if (!position) return []
        const group = graphGroupMaps?.groupByPath[document.relativePath]
        const groupColor = group !== undefined ? graphGroupMaps?.groupColorByPath[group] : undefined
        const pixel = toPixels(position)
        return [{
          x: pixel.x,
          y: pixel.y,
          radius: 7,
          color: graphNodeExportColor({
            degree: graphDegreeByPath[document.relativePath] ?? 0,
            isCurrent: document.relativePath === activeNote?.relativePath,
            isFocused: focusedGraphPath === document.relativePath,
            folderColor: groupColor,
          }),
          label: document.name.replace(/\.md$/i, ''),
        }]
      })
      const links = graphLinks.flatMap((link) => {
        const source = graphNodePositions[link.source]
        const target = graphNodePositions[link.target]
        if (!source || !target) return []
        const start = toPixels(source)
        const end = toPixels(target)
        const focused = focusedGraphPath === link.source || focusedGraphPath === link.target
        return [{ x1: start.x, y1: start.y, x2: end.x, y2: end.y, color: focused ? '#8fd4f2' : '#50688a' }]
      })
      return buildGraphSvg({
        width,
        height,
        nodes,
        links,
        legend: graphExportLegend,
        title: 'Grafo das notas',
      })
    }

    /** Entrega o arquivo exportado (SVG direto ou PNG rasterizado localmente). */
    async function deliverGraphExport(svg: string, format: 'svg' | 'png') {
      const stamp = new Date().toISOString().slice(0, 10)
      const filename = `mirrormind-grafo-${stamp}.${format}`
      if (format === 'svg') {
        downloadSvg(svg, filename)
      } else {
        const rasterized = await downloadPng(svg, filename, graphExportScale)
        if (!rasterized) setStatus('Exportação PNG indisponivel neste dispositivo.')
      }
    }

    /** Resposta do grafo 3D com a cena projetada (id confere o pedido). */
    function handleGraph3dExport(requestId: number, scene: Graph3DExportScene | null) {
      const request = graphExportRequest
      if (!request || request.id !== requestId) return
      setGraphExportRequest(null)
      if (!scene || scene.nodes.length === 0) {
        setStatus('A cena do grafo 3D ainda nao esta pronta para exportar.')
        return
      }
      const svg = buildGraphSvg({
        width: scene.width,
        height: scene.height,
        nodes: scene.nodes,
        links: scene.links,
        legend: graphExportLegend,
        title: 'Grafo das notas',
      })
      void deliverGraphExport(svg, request.format)
    }

    /** Inicia a exportacao: 3D pede a cena ao componente; 2D monta direto. */
    function handleGraphExport(format: 'svg' | 'png') {
      setGraphExportOpen(false)
      if (graphMode3d) {
        const id = graphExportRequestIdRef.current + 1
        graphExportRequestIdRef.current = id
        setGraphExportRequest({ id, format, scale: graphExportScale })
        return
      }
      const svg = buildGraph2dSvg()
      if (!svg) {
        setStatus('O grafo ainda nao esta pronto para exportar.')
        return
      }
      void deliverGraphExport(svg, format)
    }
    const paletteCommands: PaletteCommand[] = [
      { id: 'new-note', label: 'Criar nova nota', description: 'Abre uma nova nota com foco no titulo.' },
      { id: 'daily-note', label: 'Abrir nota diaria', description: 'Cria ou abre a nota de hoje em Diarias.' },
      { id: 'open-note', label: 'Abrir nota', description: 'Pesquisa notas por nome, conteudo ou tags.' },
      { id: 'filter-tags', label: 'Filtrar por tags', description: 'Abre o filtro completo de tags.' },
      { id: 'manage-tags', label: 'Gerenciar tags', description: 'Abre a página de tags e políticas de revisão.' },
      { id: 'favorite', label: favorites.includes(activeNote?.relativePath ?? '') ? 'Remover dos favoritos' : 'Adicionar aos favoritos', description: 'Fixa ou remove a nota atual.', disabled: !activeNote || isNewNoteDraft },
      { id: 'undo', label: 'Desfazer', description: 'Reverte a última alteração da nota ou do vault.', disabled: !canUndoActiveEditor },
      { id: 'redo', label: 'Refazer', description: 'Refaz a última alteração da nota ou do vault.', disabled: !canRedoActiveEditor },
      { id: 'settings', label: 'Abrir configurações', description: 'Vai para as configurações do workspace.' },
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
          ...editorFontStyle,
        } as CSSProperties}
        data-builder-name="workspace-shell"
      >
        <TitleBar>
          {workspacePage === 'notes' ? (
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
          ) : null}
        </TitleBar>
        <a className="skip-link" href="#workspace-content">Pular para o conteudo da nota</a>
        <aside className="workspace-rail" aria-label="Ferramentas do workspace" data-builder-name="workspace-rail">
          <TitleBarBrand />
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
            className={`rail-button${workspacePage === 'review' ? ' is-active' : ''}`}
            onClick={() => setWorkspacePage('review')}
            aria-label="Abrir fila de revisão"
            title="Revisar"
          >
            <BookOpenCheck size={17} strokeWidth={1.5} aria-hidden="true" />
            <span className="rail-label">Revisar</span>
          </button>
          <button
            type="button"
            className={`rail-button${workspacePage === 'dashboard' ? ' is-active' : ''}`}
            onClick={() => setWorkspacePage('dashboard')}
            aria-label="Abrir painel de aprendizado"
            title="Painel de aprendizado"
          >
            <LayoutDashboard size={17} strokeWidth={1.5} aria-hidden="true" />
            <span className="rail-label">Painel</span>
          </button>
          <button
            type="button"
            className={`rail-button${workspacePage === 'reports' ? ' is-active' : ''}`}
            onClick={() => setWorkspacePage('reports')}
            aria-label="Abrir relatórios de revisão"
            title="Relatórios"
          >
            <ClipboardList size={17} strokeWidth={1.5} aria-hidden="true" />
            <span className="rail-label">Relatórios</span>
          </button>
          <button
            type="button"
            className={`rail-button${workspacePage === 'tags' ? ' is-active' : ''}`}
            onClick={() => void openTagManagementPage()}
            aria-label="Abrir gerenciador de tags"
            title="Tags"
          >
            <Hash size={17} strokeWidth={1.5} aria-hidden="true" />
            <span className="rail-label">Tags</span>
          </button>
          <button
            type="button"
            className={`rail-button${workspacePage === 'bases' ? ' is-active' : ''}`}
            onClick={() => setWorkspacePage('bases')}
            aria-label="Abrir tabela de notas"
            title="Tabela"
          >
            <Table2 size={17} strokeWidth={1.5} aria-hidden="true" />
            <span className="rail-label">Tabela</span>
          </button>
          <button
            type="button"
            className={`rail-button${workspacePage === 'graph' ? ' is-active' : ''}`}
            onClick={() => void openGraphPage()}
            aria-label="Abrir grafo das notas"
            title="Grafo das notas"
          >
            <Network size={17} strokeWidth={1.5} aria-hidden="true" />
            <span className="rail-label">Grafo</span>
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
            aria-label="Configurações"
            title="Configurações"
          >
            <span className="rail-icon" aria-hidden="true">&#9881;</span>
            <span className="rail-label">Configurações</span>
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
              {vault.obsidianPreferences?.ignoredPreferenceFields.length ||
              vault.obsidianIgnoredConfigFiles.length ? (
                <p className="obsidian-config-note" title="Apenas os nomes sao informados; nenhum conteudo de plugin e exposto.">
                  Config Obsidian:{' '}
                  {vault.obsidianPreferences?.ignoredPreferenceFields.length
                    ? ` ${vault.obsidianPreferences.ignoredPreferenceFields.length} campo(s) ignorado(s) em app.json`
                    : ''}
                  {vault.obsidianPreferences?.ignoredPreferenceFields.length &&
                  vault.obsidianIgnoredConfigFiles.length
                    ? ' ·'
                    : ''}
                  {vault.obsidianIgnoredConfigFiles.length
                    ? ` ${vault.obsidianIgnoredConfigFiles.length} config(s) nao aplicada(s)`
                    : ''}
                </p>
              ) : null}
            </div>

            <div className="sidebar-block sidebar-block--stretch">
              <div className="sidebar-section-header" data-builder-name="vault-explorer-header">
                <div className="explorer-title-row">
                  <p className="card-kicker">Notas do vault</p>
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
                  <button type="button" className="secondary-button" onClick={() => setStatus('As notas estão ordenadas por nome.')} title="Ordenação" aria-label="Ordenação">
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
                  {specialFiles.length > 0 ? (
                    <button
                      type="button"
                      className="secondary-button special-files-button"
                      onClick={() => setShowSpecialFilesDialog(true)}
                      title={`${specialFiles.length}${specialFilesTruncated ? '+' : ''} arquivo${specialFiles.length === 1 ? '' : 's'} preservado${specialFiles.length === 1 ? '' : 's'} sem edicao`}
                      aria-label={`Ver ${specialFiles.length}${specialFilesTruncated ? ' ou mais' : ''} arquivo${specialFiles.length === 1 ? '' : 's'} com compatibilidade limitada`}
                    >
                      <FileWarning size={15} strokeWidth={1.5} aria-hidden="true" />
                      <span aria-hidden="true">{specialFiles.length}{specialFilesTruncated ? '+' : ''}</span>
                    </button>
                  ) : null}
                  </div>
                </div>
              </div>
              {vaultDiagnostics && !diagnosticsDismissed && hasScanDiagnostics(vaultDiagnostics) ? (
                <VaultDiagnosticsBanner
                  diagnostics={vaultDiagnostics}
                  onDismiss={() => setDiagnosticsDismissed(true)}
                  onRetry={() => void retryVaultDiagnostics()}
                />
              ) : null}
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
            <footer className="vault-indicator">
              <button
                type="button"
                className="vault-switch-button"
                onClick={() => void chooseExistingVault()}
                disabled={loading || saving}
                title={`${vault.path} — clique para trocar de vault`}
              >
                <span className="vault-indicator-icon" aria-hidden="true">&#9670;</span>
                <span>{vault.name}</span>
              </button>
              <button type="button" className="secondary-button vault-refresh-button" onClick={() => void refreshNotes(vault.path)} disabled={loading || saving} title="Atualizar explorador" aria-label="Atualizar explorador de arquivos">
                <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </footer>
          </aside>

          <section id="workspace-content" className="editor-surface" role="region" aria-label="Conteudo do workspace" tabIndex={-1} data-builder-name="workspace-content-panel">
            {workspacePage === 'notes' ? (
              <>
            {activeNote ? (
              <>
                <div className="editor-header" data-builder-name="editor-header">
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
                        aria-label="Título da nova nota"
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
                    {unsupportedMarkdownFeatures.length > 0 ? (
                      <p className="markdown-preservation-notice" role="status">
                        Compatibilidade limitada, fonte preservada: {unsupportedMarkdownFeatures.map((feature) => LIMITED_MARKDOWN_FEATURE_LABELS[feature] ?? feature).join(', ')}.
                      </p>
                    ) : null}
                    {!isNewNoteDraft && brokenLinks.length > 0 ? (
                      <div className="backlink-list broken-link-list" aria-label="Links quebrados">
                        <span>Links quebrados</span>
                        {brokenLinks.map((link) => <code key={link.target}>{`[[${link.target.replace(/\.md$/i, '')}]]`}</code>)}
                      </div>
                    ) : null}
                  </div>
                  <div className="editor-actions">
                    <div className="history-actions" aria-label="Histórico de edicao">
                      <button type="button" className="secondary-button" onMouseDown={preserveEditorSelection} onClick={() => void undoLastCommand()} disabled={!canUndoActiveEditor || loading || saving} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Undo2 size={15} strokeWidth={1.5} aria-hidden="true" /></button>
                      <button type="button" className="secondary-button" onMouseDown={preserveEditorSelection} onClick={() => void redoLastCommand()} disabled={!canRedoActiveEditor || loading || saving} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><Redo2 size={15} strokeWidth={1.5} aria-hidden="true" /></button>
                    </div>
                    {isAutoSaveEnabled && !isNewNoteDraft ? (
                      <span className={`autosave-indicator is-${autoSaveState}`} aria-live="polite">
                        {autoSaveState === 'pending' ? 'Alterações pendentes' : autoSaveState === 'saving' ? 'Salvando...' : autoSaveState === 'saved' ? 'Salvo' : 'Auto Save'}
                      </span>
                    ) : null}
                    {!isNewNoteDraft ? <button type="button" className={`secondary-button favorite-button${favorites.includes(activeNote.relativePath) ? ' is-active' : ''}`} onClick={() => void toggleActiveFavorite()} title="Fixar nota" aria-label="Fixar nota"><Star size={15} fill={favorites.includes(activeNote.relativePath) ? 'currentColor' : 'none'} aria-hidden="true" /></button> : null}
                    {!isNewNoteDraft ? (
                      <button
                        type="button"
                        className={`secondary-button indexadora-button${isIndexadora(activeNote.content) ? ' is-active' : ''}`}
                        onClick={() => void toggleActiveNoteIndexadora()}
                        disabled={saving || loading}
                        title={isIndexadora(activeNote.content) ? 'Nota indexadora: remove a lista automatica de referencias' : 'Declarar como nota indexadora: lista automaticamente as notas que referenciam esta nota'}
                        aria-label="Declarar nota como indexadora"
                        aria-pressed={isIndexadora(activeNote.content)}
                      >
                        <BookMarked size={15} strokeWidth={1.5} aria-hidden="true" />
                        <span>Indexadora</span>
                      </button>
                    ) : null}
                    {!isNewNoteDraft ? (                        <Popover open={reviewMenuOpen} onOpenChange={(open) => {
                          setReviewMenuOpen(open)
                          if (!open) setReviewReportOpen(false)
                        }}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="secondary-button note-review-menu-trigger"
                            aria-label="Avaliação e revisão da nota"
                            title="Avaliação e revisão da nota"
                          >
                            <span className={`note-review-status-dot is-${noteReadiness ?? 'none'}`} aria-hidden="true" />
                            <ClipboardList size={15} strokeWidth={1.5} aria-hidden="true" />
                            <span>Avaliação &amp; revisão</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" sideOffset={6} className="note-review-menu">
                          {reviewReportOpen ? null : (
                            <header className="note-review-menu-header">
                              <strong>Avaliação &amp; revisão</strong>
                              <small>Prontidão, agenda e política desta nota</small>
                            </header>
                          )}
                          <NoteReadinessControl
                            vaultPath={vault.path}
                            relativePath={activeNote.relativePath}
                            sourceRevision={activeNote.content}
                            isDirty={isDirty}
                            disabled={loading || saving}
                            noteTags={activeTags}
                            onApplyTag={applyReviewProfileTag}
                            onStatusChange={setNoteReadiness}
                            onStartReview={(info) => void handleStartReviewNow(info)}
                            reportOpen={reviewReportOpen}
                            onReportOpenChange={setReviewReportOpen}
                            onSaveFirst={async () => {
                              try {
                                return await saveActiveNote(false)
                              } catch {
                                return false
                              }
                            }}
                          />
                          {reviewReportOpen ? null : (
                            <NoteReviewPolicyControl
                              vaultPath={vault.path}
                              relativePath={activeNote.relativePath}
                              sourceRevision={activeNote.content}
                              isDirty={isDirty}
                              disabled={loading || saving}
                            />
                          )}
                          </PopoverContent>
                        </Popover>
                      ) : null}
                      {!isNewNoteDraft ? (
                        <Popover open={factCheckOpen} onOpenChange={(open) => {
                          setFactCheckOpen(open)
                          if (open && factCheck === null && factCheckError === null) void runFactCheck()
                        }}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="secondary-button structural-audit-trigger"
                              aria-label="Verificar fatos da nota"
                              title="Verificação factual opcional — compara as afirmações com conhecimento externo, sem alterar a nota nem as pontuações"
                            >
                              <CheckCircle2 size={15} strokeWidth={1.5} aria-hidden="true" />
                              <span>Verificar fatos</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="end" sideOffset={6} className="structural-audit-panel fact-check-panel">
                            <header className="structural-audit-header">
                              <strong>Verificacao factual</strong>
                              <small>Compara as afirmacoes da nota com conhecimento externo — nao altera a nota nem as revisoes.</small>
                            </header>
                            {factCheckLoading ? (
                              <div className="structural-audit-state">Verificando os fatos…</div>
                            ) : factCheckError ? (
                              <div className="structural-audit-state is-error">
                                <span>{factCheckError}</span>
                                <button type="button" className="secondary-button" onClick={() => void runFactCheck()}>Tentar novamente</button>
                              </div>
                            ) : factCheck === null ? (
                              <div className="structural-audit-state">Abra a verificacao para analisar os fatos.</div>
                            ) : factCheck.outcome === 'invalid' ? (
                              <div className="structural-audit-state is-error">
                                <span>{factCheck.message}</span>
                                {factCheck.validationErrors.length > 0 ? (
                                  <ul>{factCheck.validationErrors.map((error) => <li key={error}>{error}</li>)}</ul>
                                ) : null}
                              </div>
                            ) : (
                              <div className="fact-check-results">
                                <p className="fact-check-summary">{factCheck.report.overallSummary}</p>
                                <ul>
                                  {factCheck.report.findings.map((finding, index) => (
                                    <li key={`${finding.claim}-${index}`} className={`fact-check-finding is-${finding.status}`}>
                                      <div className="fact-check-finding-head">
                                        <span className="fact-check-status">
                                          {finding.status === 'confirmed' ? 'Confirmado' : finding.status === 'divergent' ? 'Divergente' : 'Incerto'}
                                        </span>
                                        <p>{finding.claim}</p>
                                      </div>
                                      {finding.quote && finding.quote !== finding.claim ? (
                                        <pre className="structural-audit-quote">{finding.quote}</pre>
                                      ) : null}
                                      <p className="fact-check-reason">{finding.reason}</p>
                                      {finding.source ? <p className="fact-check-source">Fonte: {finding.source}</p> : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      ) : null}
                      {!isNewNoteDraft ? (
                        <Popover open={structuralAuditOpen} onOpenChange={setStructuralAuditOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="secondary-button structural-audit-trigger"
                              aria-label="Auditoria estrutural da nota"
                              title="Auditoria estrutural — sugere melhorias na organização da nota para a revisão"
                            >
                              <Sparkles size={15} strokeWidth={1.5} aria-hidden="true" />
                              <span>Propor melhorias</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="end" sideOffset={6} className="structural-audit-panel">
                            <header className="structural-audit-header">
                              <strong>Auditoria estrutural</strong>
                              <small>
                                {structuralAudit
                                  ? `${structuralAudit.noteWords.toLocaleString('pt-BR')} palavras · ${structuralAudit.unitCount} ${structuralAudit.unitCount === 1 ? 'unidade' : 'unidades'} de revisão`
                                  : 'Analisa a organização da nota com a regra de segmentação por seções.'}
                              </small>
                            </header>
                            {structuralAuditLoading ? (
                              <div className="structural-audit-state">Analisando a estrutura da nota…</div>
                            ) : structuralAuditError ? (
                              <div className="structural-audit-state is-error">
                                <span>{structuralAuditError}</span>
                                <button type="button" className="secondary-button" onClick={() => void runStructuralAudit()}>Tentar novamente</button>
                              </div>
                            ) : structuralAudit === null ? (
                              <div className="structural-audit-state">Abra a auditoria para ver as sugestoes.</div>
                            ) : structuralAudit.findings.length === 0 ? (
                              <div className="structural-audit-state is-clean">
                                <CheckSquare size={15} strokeWidth={1.5} aria-hidden="true" />
                                <span>Estrutura boa para revisao — nenhum achado.</span>
                              </div>
                            ) : (
                              <div className="structural-audit-findings">
                                {structuralAudit.findings.map((finding, index) => (
                                  <article key={`${finding.code}-${index}`} className={`structural-audit-finding is-${finding.severity}`}>
                                    <div className="structural-audit-finding-head">
                                      <span className="structural-audit-severity">
                                        {finding.severity === 'warning' ? 'Atencao' : 'Dica'}
                                      </span>
                                      <p>{finding.message}</p>
                                    </div>
                                    <p className="structural-audit-suggestion">{finding.suggestion}</p>
                                    {finding.sourceQuote ? (
                                      <pre className="structural-audit-quote">{finding.sourceQuote}</pre>
                                    ) : null}
                                    {finding.edit ? (
                                      <div className="structural-audit-apply-row">
                                        <button
                                          type="button"
                                          className="primary-button structural-audit-apply"
                                          onClick={() => handleApplyStructuralAuditEdit(index)}
                                          disabled={structuralAuditAppliedIndex !== null && structuralAuditAppliedIndex !== index}
                                        >
                                          {structuralAuditAppliedIndex === index ? (
                                            <><CheckSquare size={13} strokeWidth={1.8} aria-hidden="true" /> Aplicado no rascunho</>
                                          ) : (
                                            'Aplicar no rascunho'
                                          )}
                                        </button>
                                        {structuralAuditAppliedIndex !== null && structuralAuditAppliedIndex !== index ? (
                                          <small className="structural-audit-hint">Aplique uma de cada vez; re-execute a auditoria depois.</small>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </article>
                                ))}
                              </div>
                            )}
                            {structuralAudit !== null && !structuralAuditLoading ? (
                              <footer className="structural-audit-footer">
                                <button
                                  type="button"
                                  className="structural-audit-rerun"
                                  onClick={() => void runStructuralAudit()}
                                >
                                  <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
                                  <span>Re-executar auditoria</span>
                                </button>
                              </footer>
                            ) : null}
                          </PopoverContent>
                        </Popover>
                      ) : null}
                      <div
                        className="editor-mode-control"
                      role="radiogroup"
                      aria-label="Modo de visualização da nota"
                      title="Como o Markdown será exibido: Edicao mostra o codigo, Misto edita o bloco ativo e Leitura mostra a nota formatada."
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                        event.preventDefault()
                        const modes: Array<'edit' | 'mixed' | 'read'> = ['edit', 'mixed', 'read']
                        const currentIndex = modes.indexOf(editorMode)
                        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
                        changeEditorMode(modes[(currentIndex + direction + modes.length) % modes.length])
                      }}
                    >
                      <Eye size={15} strokeWidth={1.5} aria-hidden="true" />
                      <button
                        type="button"
                        role="radio"
                        className={`editor-mode-button${editorMode === 'edit' ? ' is-active' : ''}`}
                        onClick={() => changeEditorMode('edit')}
                        aria-checked={editorMode === 'edit'}
                        title="Edicao: mostra o Markdown puro"
                      >Edicao</button>
                      <button
                        type="button"
                        role="radio"
                        className={`editor-mode-button${editorMode === 'mixed' ? ' is-active' : ''}`}
                        onClick={() => changeEditorMode('mixed')}
                        aria-checked={editorMode === 'mixed'}
                        title="Misto: edita o bloco ativo com a nota formatada"
                      >Misto</button>
                      <button
                        type="button"
                        role="radio"
                        className={`editor-mode-button${editorMode === 'read' ? ' is-active' : ''}`}
                        onClick={() => changeEditorMode('read')}
                        aria-checked={editorMode === 'read'}
                        title="Leitura: mostra a nota formatada"
                      >Leitura</button>
                    </div>
                    {editorMode === 'read' && (reviewGaps.length > 0 || reviewUnits.length > 0) ? (
                      <div
                        className="review-gap-mode-control"
                        role="radiogroup"
                        aria-label="Exibição das lacunas da última revisão"
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                          event.preventDefault()
                          const modes: ReviewGapMode[] = ['always', 'hover', 'off']
                          const currentIndex = modes.indexOf(reviewGapMode)
                          const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
                          setReviewGapMode(modes[(currentIndex + direction + modes.length) % modes.length])
                        }}
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={reviewGapMode === 'always'}
                          className={reviewGapMode === 'always' ? 'is-active' : ''}
                          onClick={() => setReviewGapMode('always')}
                          title="Lacunas sempre visiveis"
                          aria-label="Lacunas sempre visiveis"
                        >
                          <Highlighter size={15} strokeWidth={1.5} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={reviewGapMode === 'hover'}
                          className={reviewGapMode === 'hover' ? 'is-active' : ''}
                          onClick={() => setReviewGapMode('hover')}
                          title="Lacunas somente no hover"
                          aria-label="Lacunas somente no hover"
                        >
                          <Eye size={15} strokeWidth={1.5} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={reviewGapMode === 'off'}
                          className={reviewGapMode === 'off' ? 'is-active' : ''}
                          onClick={() => setReviewGapMode('off')}
                          title="Lacunas desativadas"
                          aria-label="Lacunas desativadas"
                        >
                          <EyeOff size={15} strokeWidth={1.5} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={openNoteFind} title="Buscar na nota (Ctrl+F)" aria-label="Buscar na nota"><Search size={15} strokeWidth={1.5} aria-hidden="true" /></button>
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
                  {editorMode === 'mixed' ? (
                    <div className="frontmatter-menu">
                      {/* Arrow down: fica em cima da borda inferior do header e,
                          ao clicar, desce junto com a borda (animacao slide
                          down) — o menu integrado abre dentro do header. */}
                      <button
                        type="button"
                        className={`editor-disclosure-button${frontmatterPanelOpen ? ' is-open' : ''}`}
                        onClick={() => setFrontmatterPanelOpen((isOpen) => !isOpen)}
                        aria-expanded={frontmatterPanelOpen}
                        aria-controls="frontmatter-menu-panel"
                        title={frontmatterPanelOpen ? 'Recolher propriedades da nota' : 'Expandir propriedades da nota'}
                      >
                        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                      {frontmatterPanelOpen ? (
                        <div className="frontmatter-menu-collapse">
                          <div id="frontmatter-menu-panel" className="frontmatter-menu-panel">
                            <FrontmatterPanelForm
                              {...getFrontmatterPanelData()}
                              onApplyTag={applyExistingTag}
                              onRemoveTag={removeTag}
                              onApply={applyFrontmatterPanel}
                              onOpenBacklink={(relativePath) => void openNote(relativePath)}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div id="note-editor" className="editor-content" ref={editorContentRef} data-builder-name="editor-content">
                {noteFindOpen && activeNote ? (
                  <div className="note-find-bar" role="search">
                    <Search size={13} strokeWidth={1.7} aria-hidden="true" />
                    <input
                      ref={noteFindInputRef}
                      value={noteFindQuery}
                      onChange={(event) => setNoteFindQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          navigateNoteFind(event.shiftKey ? -1 : 1)
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          closeNoteFind()
                        }
                      }}
                      placeholder="Buscar na nota"
                      aria-label="Buscar na nota"
                      autoFocus
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <span className="note-find-count" aria-live="polite">
                      {noteFindQuery.trim() && findTotal > 0 ? `${noteFindIndex + 1}/${findTotal}` : '0/0'}
                    </span>
                    <button type="button" className="note-find-nav-button" onClick={() => navigateNoteFind(-1)} disabled={findTotal === 0} title="Correspondência anterior" aria-label="Correspondência anterior"><ChevronUp size={14} strokeWidth={1.7} aria-hidden="true" /></button>
                    <button type="button" className="note-find-nav-button" onClick={() => navigateNoteFind(1)} disabled={findTotal === 0} title="Próxima correspondência" aria-label="Próxima correspondência"><ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" /></button>
                    <button type="button" className="note-find-close" onClick={closeNoteFind} title="Fechar busca (Esc)" aria-label="Fechar busca"><X size={13} strokeWidth={1.7} aria-hidden="true" /></button>
                  </div>
                ) : null}
                {editorMode === 'edit' ? (
                  <MarkdownCodeEditor
                    ref={markdownCodeEditorRef}
                    ariaLabel={`Editor Markdown da nota ${activeNote.name.replace(/\.md$/i, '')}`}
                    documentKey={activeNote.relativePath}
                    historyLimit={historyLimit}
                    spellCheck={isSpellCheckEnabled}
                    stateCache={markdownEditorStateCacheRef.current}
                    autocompleteData={markdownAutocompleteData}
                    onBlur={() => setSelectionPopover(null)}
                    onSearchRequest={openNoteFind}
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
                  <section ref={editorPanelRef} className={`markdown-mixed markdown-reading-engine${reviewGapData ? ' has-gap-marks' : ''}${reviewGapMode === 'hover' ? ' is-gap-hover-only' : ''}`} style={readingStyle}>
                    <MarkdownCodeEditor
                      ref={markdownCodeEditorRef}
                      ariaLabel={`Leitura da nota ${activeNote.name.replace(/\.md$/i, '')}`}
                      documentKey={`${activeNote.relativePath}::leitura`}
                      livePreview
                      readOnly
                      lineWrap={isReadingLineWrapEnabled}
                      historyLimit={historyLimit}
                      spellCheck={isSpellCheckEnabled}
                      stateCache={markdownEditorStateCacheRef.current}
                      autocompleteData={markdownAutocompleteData}
                      onBlur={() => setSelectionPopover(null)}
                      onOpenLink={handleMixedOpenLink}
                      resolveAssetUrl={resolveMixedAssetUrl}
                      getEmbedContent={resolveMixedEmbedBody}
                      vaultPath={vault?.path}
                      reviewGapData={reviewGapData}
                      onSearchRequest={openNoteFind}
                      value={noteBody}
                      // O doc do Leitura e `noteBody` (sem frontmatter): o merge
                      // preserva o frontmatter do draft ao alternar um checkbox.
                      onChange={(content) => setDraftContent((current) => replaceMarkdownBody(current, content))}
                      onHistoryChange={setMarkdownHistoryStatus}
                      onSessionChange={(session) => {
                        setEditorSessionsByPath((currentSessions) => ({
                          ...currentSessions,
                          [`${activeNote.relativePath}::leitura`]: session,
                        }))
                      }}
                      session={editorSessionsByPath[`${activeNote.relativePath}::leitura`]}
                    />
                  </section>
                ) : (
                  <section ref={editorPanelRef} className={`markdown-mixed${reviewGapData ? ' has-gap-marks' : ''}${reviewGapMode === 'hover' ? ' is-gap-hover-only' : ''}`}>
                    <MarkdownCodeEditor
                      ref={markdownCodeEditorRef}
                      ariaLabel={`Editor Markdown (Misto) da nota ${activeNote.name.replace(/\.md$/i, '')}`}
                      documentKey={`${activeNote.relativePath}::misto::gfm`}
                      livePreview
                      historyLimit={historyLimit}
                      spellCheck={isSpellCheckEnabled}
                      stateCache={markdownEditorStateCacheRef.current}
                      autocompleteData={markdownAutocompleteData}
                      onBlur={() => setSelectionPopover(null)}
                      onOpenLink={handleMixedOpenLink}
                      resolveAssetUrl={resolveMixedAssetUrl}
                      getEmbedContent={resolveMixedEmbedBody}
                      vaultPath={vault?.path}
                      onSearchRequest={openNoteFind}
                      value={draftContent}
                      onChange={setDraftContent}
                      onHistoryChange={setMarkdownHistoryStatus}
                      onSessionChange={(session) => {
                        setEditorSessionsByPath((currentSessions) => ({
                          ...currentSessions,
                          [`${activeNote.relativePath}::misto::gfm`]: session,
                        }))
                      }}
                      session={editorSessionsByPath[`${activeNote.relativePath}::misto::gfm`]}
                    />
                  </section>
                )}
                {selectionPopover && editorMode !== 'read' ? (
                  <div
                    ref={selectionPopoverRef}
                    className={`selection-format-popover is-${selectionPopover.flip ? 'below' : 'above'}`}
                    role="toolbar"
                    aria-label="Formatar seleção"
                    style={{ left: selectionPopover.x + selectionPopover.shiftX, top: selectionPopover.y }}
                  >
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('bold')} title="Negrito" aria-label="Negrito (seleção)"><Bold size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('italic')} title="Itálico" aria-label="Itálico (seleção)"><Italic size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('strikethrough')} title="Riscado" aria-label="Riscado (seleção)"><Strikethrough size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('code')} title="Código" aria-label="Código (seleção)"><Code2 size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('math')} title="Matemática" aria-label="Matemática (seleção)"><Sigma size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('subscript')} title="Subscrito (fórmula química)" aria-label="Subscrito (seleção)"><Subscript size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('superscript')} title="Sobrescrito (expoente)" aria-label="Sobrescrito (seleção)"><Superscript size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('reactionArrow')} title="Seta de reação com texto acima" aria-label="Seta de reação (seleção)"><ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('reverseReactionArrow')} title="Seta reversa com texto acima" aria-label="Seta reversa (seleção)"><ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                    <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownFormat('link')} title="Link" aria-label="Link (seleção)"><Link size={15} strokeWidth={1.8} aria-hidden="true" /></button>
                  </div>
                ) : null}
                <div className="note-word-count" data-testid="note-word-count" title={`${noteWordCount} palavra${noteWordCount === 1 ? '' : 's'}`}>
                  {noteWordCount} palavra{noteWordCount === 1 ? '' : 's'}
                </div>
                {isMarkdownToolsOpen && editorMode !== 'read' ? (
                  <div
                    ref={markdownToolsRef}
                    className={`floating-markdown-toolbar is-${markdownToolsOrientation}`}
                    role="toolbar"
                    aria-label="Ferramentas de Markdown"
                    style={{ right: markdownToolsPosition.x, top: markdownToolsPosition.y }}
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
                      <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('quote')} title="Citação"><TextQuote size={16} /></button>
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
            ) : workspacePage === 'review' || workspacePage === 'dashboard' || workspacePage === 'reports' || workspacePage === 'tags' || workspacePage === 'bases' ? (
              <Suspense fallback={<p className="workspace-page-loading">Carregando pagina...</p>}>
                {workspacePage === 'review' ? (
                  activeReviewItem ? (
                    <ReviewSessionPage
                      vaultPath={vault.path}
                      item={activeReviewItem}
                      onExit={() => setActiveReviewItem(null)}
                      onCompleted={() => undefined}
                    />
                  ) : (
                    <ReviewQueuePage
                      vaultPath={vault.path}
                      onStartReview={setActiveReviewItem}
                      onOpenNote={(relativePath) => {
                        setWorkspacePage('notes')
                        void openNote(relativePath)
                      }}
                    />
                  )
                ) : workspacePage === 'dashboard' ? (
                  <ReviewDashboardPage
                    vaultPath={vault.path}
                    onOpenNote={(relativePath) => {
                      setWorkspacePage('notes')
                      void openNote(relativePath)
                    }}
                    onStartReview={(item) => void handleStartReviewFromDeadline(item)}
                  />
                ) : workspacePage === 'reports' ? (
                  <ReviewReportsPage
                    vaultPath={vault.path}
                    onOpenNote={(relativePath) => {
                      setWorkspacePage('notes')
                      void openNote(relativePath)
                    }}
                  />
                ) : workspacePage === 'bases' ? (
                  <BasesPage
                    vaultPath={vault.path}
                    notePreviews={notes}
                    onOpenNote={(relativePath) => {
                      setWorkspacePage('notes')
                      void openNote(relativePath)
                    }}
                  />
                ) : (
                  <TagManagementPage
                    vaultPath={vault.path}
                    onTagsChanged={synchronizeTagChanges}
                  />
                )}
              </Suspense>
            ) : workspacePage === 'graph' ? (
              <section
                className="workspace-page graph-page"
                data-builder-name="note-graph-page"
                onPointerMove={pokeGraphUi}
                onPointerDown={pokeGraphUi}
                onWheel={pokeGraphUi}
              >
                {isGraphLoading ? (
                  <p className="graph-empty-state graph-empty-state-overlay" role="status">
                    {graphLoadProgress !== null && graphLoadProgress > 0
                      ? `Lendo os links das notas... (${graphLoadProgress} de ${notes.length} notas)`
                      : 'Lendo os links das notas...'}
                  </p>
                ) : graphDocuments.length === 0 ? (
                  <p className="graph-empty-state graph-empty-state-overlay">Nenhuma nota disponivel para montar o grafo.</p>
                ) : (
                  <>
                    <div
                      className={`graph-immersive-header${graphUiVisible ? '' : ' is-hidden'}`}
                      onMouseEnter={() => { setGraphUiVisible(true); if (graphUiHideTimerRef.current !== null) window.clearTimeout(graphUiHideTimerRef.current) }}
                      onMouseLeave={pokeGraphUi}
                      role="toolbar"
                      aria-label="Controles do grafo"
                    >
                      <h2 className="graph-header-title">Grafo das notas</h2>
                      <span className="graph-header-sep" aria-hidden="true" />
                      <div className="graph-dimension-toggle" role="radiogroup" aria-label="Dimensao do grafo">
                        <button type="button" role="radio" aria-checked={!graphMode3d} className={!graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(false)} title="Grafo em 2D">2D</button>
                        <button type="button" role="radio" aria-checked={graphMode3d} className={graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(true)} title="Grafo 3D com pulsos eletricos">3D</button>
                      </div>
                      <select value={graphMode} onChange={(event) => setGraphMode(event.target.value as GraphMode)} aria-label="Modo do grafo"><option value="global">Grafo global</option><option value="local">Grafo local</option></select>
                      {graphMode === 'local' ? (
                        <select value={graphLocalDepth} onChange={(event) => setGraphLocalDepth(Number(event.target.value))} aria-label="Profundidade do grafo local">
                          <option value={1}>1 salto</option>
                          <option value={2}>2 saltos</option>
                          <option value={3}>3 saltos</option>
                        </select>
                      ) : null}
                      <select value={graphFolder} onChange={(event) => setGraphFolder(event.target.value)} aria-label="Filtrar pasta do grafo"><option value="">Todas as pastas</option>{graphFolders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select>
                      <select value={graphTag} onChange={(event) => setGraphTag(event.target.value)} aria-label="Filtrar tag do grafo"><option value="">Todas as tags</option>{graphTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}</select>
                      <span className="graph-header-sep" aria-hidden="true" />
                      <input value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder="Buscar nota" aria-label="Buscar nota no grafo" />
                      <button type="button" className="secondary-button" onClick={reorganizeGraphNodes} aria-label="Reorganizar nos">Reorganizar</button>
                      {!graphMode3d ? (
                        <span className="graph-zoom-cluster" aria-label="Zoom do grafo">
                          <button type="button" className="secondary-button" onClick={() => setGraphViewport((view) => ({ ...view, scale: Math.min(2.4, view.scale + 0.15) }))} aria-label="Aproximar grafo">+</button>
                          <button type="button" className="secondary-button" onClick={() => setGraphViewport((view) => ({ ...view, scale: Math.max(0.55, view.scale - 0.15) }))} aria-label="Afastar grafo">−</button>
                          <button type="button" className="secondary-button" onClick={resetGraphView} aria-label="Centralizar grafo">Centralizar</button>
                        </span>
                      ) : null}
                      <span className="graph-header-sep" aria-hidden="true" />
                      <button type="button" className="secondary-button" onClick={() => void openGraphPage()} disabled={isGraphLoading} aria-label="Atualizar grafo">
                        <RefreshCw size={15} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                      <Popover open={graphExportOpen} onOpenChange={setGraphExportOpen}>
                        <PopoverTrigger asChild>
                          <button type="button" className="secondary-button graph-export-button" aria-label="Exportar grafo" title="Exportar grafo como SVG ou PNG">
                            <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" sideOffset={6} className="graph-export-popover">
                          <p className="graph-settings-header-title"><Download size={14} strokeWidth={1.75} aria-hidden="true" /><strong>Exportar grafo</strong></p>
                          <label className="graph-settings-row">
                            <span>Resolucao PNG<small>Multiplicador de pixels</small></span>
                            <select value={graphExportScale} onChange={(event) => setGraphExportScale(Number(event.target.value))} aria-label="Resolução do PNG exportado">
                              <option value={1}>1x</option>
                              <option value={2}>2x</option>
                              <option value={3}>3x</option>
                            </select>
                          </label>
                          <div className="graph-export-actions">
                            <button type="button" className="secondary-button" onClick={() => handleGraphExport('svg')} aria-label="Exportar grafo como SVG">SVG</button>
                            <button type="button" className="secondary-button" onClick={() => handleGraphExport('png')} aria-label="Exportar grafo como PNG">PNG</button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Popover open={graphSettingsOpen} onOpenChange={setGraphSettingsOpenSynced}>
                        <PopoverTrigger asChild>
                          <button type="button" className="secondary-button graph-settings-button" aria-label="Configurações do grafo" title="Configurações do grafo">
                            <Settings size={15} strokeWidth={1.5} aria-hidden="true" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" sideOffset={6} className="graph-settings-popover">
                          <header className="graph-settings-header">
                            <span className="graph-settings-header-title">
                              <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
                              <strong>Configurações do grafo</strong>
                            </span>
                            <button type="button" className="graph-settings-reset" onClick={resetGraph3dSettings} title="Restaurar os valores padrao" aria-label="Restaurar os valores padrao">
                              <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
                              <span>Padroes</span>
                            </button>
                          </header>
                          <section className="graph-settings-group" aria-label="Visual dos nos">
                            <p className="graph-settings-group-title"><Palette size={12} strokeWidth={1.75} aria-hidden="true" /> Visual</p>
                            <label className="graph-settings-row">
                              <span>Tamanho dos nos<small>Raio base dos orbes</small></span>
                              <input type="number" min={0.2} max={3} step={0.05} value={graph3dNodeSize} onChange={(event) => setGraph3dNodeSize(updateNumberSetting(event.target.value, graph3dNodeSize, 0.2, 3))} aria-label="Tamanho dos nos no grafo 3D" />
                            </label>
                            <label className="graph-settings-row">
                              <span>Aumento por conexao<small>Crescimento do no por link</small></span>
                              <input type="number" min={0} max={1} step={0.01} value={graph3dDegreeGrowth} onChange={(event) => setGraph3dDegreeGrowth(updateNumberSetting(event.target.value, graph3dDegreeGrowth, 0, 1))} aria-label="Fator de aumento por conexao no grafo 3D" />
                            </label>
                          </section>
                          <section className="graph-settings-group" aria-label="Orbita dos nos">
                            <p className="graph-settings-group-title"><Orbit size={12} strokeWidth={1.75} aria-hidden="true" /> Orbita</p>
                            <label className="graph-settings-row">
                              <span>Distancia entre nos<small>Raio das orbitas ao redor do nucleo</small></span>
                              <input type="number" min={2} max={20} step={0.5} value={graph3dNodeSpacing} onChange={(event) => setGraph3dNodeSpacing(updateNumberSetting(event.target.value, graph3dNodeSpacing, 2, 20))} aria-label="Distancia entre nos no grafo 3D" />
                            </label>
                            <label className="graph-settings-row">
                              <span>Velocidade de orbitacao<small>Multiplicador do giro orbital</small></span>
                              <input type="number" min={0.1} max={5} step={0.1} value={graph3dOrbitSpeed} onChange={(event) => setGraph3dOrbitSpeed(updateNumberSetting(event.target.value, graph3dOrbitSpeed, 0.1, 5))} aria-label="Velocidade de orbitação no grafo 3D" />
                            </label>
                          </section>
                          <section className="graph-settings-group" aria-label="Arestas do grafo">
                            <p className="graph-settings-group-title"><Link2 size={12} strokeWidth={1.75} aria-hidden="true" /> Arestas</p>
                            <label className="graph-settings-row">
                              <span>Aresta maxima<small>Limite superior das conexoes</small></span>
                              <input type="number" min={4} max={40} step={1} value={graph3dMaxEdgeLength} onChange={(event) => setGraph3dMaxEdgeLength(updateNumberSetting(event.target.value, graph3dMaxEdgeLength, 4, 40))} aria-label="Tamanho maximo das arestas no grafo 3D" />
                            </label>
                            <label className="graph-settings-row">
                              <span>Aresta minima<small>Distancia minima entre conectados</small></span>
                              <input type="number" min={0} max={30} step={0.5} value={graph3dMinEdgeLength} onChange={(event) => setGraph3dMinEdgeLength(updateNumberSetting(event.target.value, graph3dMinEdgeLength, 0, 30))} aria-label="Tamanho minimo das arestas no grafo 3D" />
                            </label>
                          </section>
                          <section className="graph-settings-group" aria-label="Forcas do grafo 2D">
                            <p className="graph-settings-group-title"><Zap size={12} strokeWidth={1.75} aria-hidden="true" /> Forcas (2D)</p>
                            <label className="graph-settings-row">
                              <span>Repulsao<small>Forca entre os nos (1/distancia²)</small></span>
                              <input type="number" step={50} value={graph2dRepulsionStrength} onChange={(event) => setGraph2dRepulsionStrength(updateNumberSetting(event.target.value, graph2dRepulsionStrength, -Infinity, Infinity))} aria-label="Forca de repulsao dos nos no grafo 2D" />
                            </label>
                            <label className="graph-settings-row">
                              <span>Rigidez da mola<small>Forca das arestas por unidade de distancia</small></span>
                              <input type="number" step={0.1} value={graph2dLinkStiffness} onChange={(event) => setGraph2dLinkStiffness(updateNumberSetting(event.target.value, graph2dLinkStiffness, -Infinity, Infinity))} aria-label="Rigidez da mola das arestas no grafo 2D" />
                            </label>
                            <label className="graph-settings-row">
                              <span>Amortecimento<small>Decaimento de velocidade por segundo</small></span>
                              <input type="number" step={0.05} value={graph2dVelocityDecay} onChange={(event) => setGraph2dVelocityDecay(updateNumberSetting(event.target.value, graph2dVelocityDecay, -Infinity, Infinity))} aria-label="Amortecimento da velocidade no grafo 2D" />
                            </label>
                            <label className="graph-settings-row">
                              <span>Distancia do link<small>Descanso das molas entre conectados</small></span>
                              <input type="number" step={0.5} value={graph2dLinkDistance} onChange={(event) => setGraph2dLinkDistance(updateNumberSetting(event.target.value, graph2dLinkDistance, -Infinity, Infinity))} aria-label="Distancia do link no grafo 2D" />
                            </label>
                            <label className="graph-settings-row">
                              <span>Forca central<small>Atracao ao anel no meio do grafo</small></span>
                              <input type="number" step={5} value={graph2dCenterForce} onChange={(event) => setGraph2dCenterForce(updateNumberSetting(event.target.value, graph2dCenterForce, -Infinity, Infinity))} aria-label="Forca central do grafo 2D" />
                            </label>
                          </section>
                          <section className="graph-settings-group" aria-label="Exibição do grafo">
                            <p className="graph-settings-group-title"><Eye size={12} strokeWidth={1.75} aria-hidden="true" /> Exibicao</p>
                            <label className="graph-settings-toggle">
                              <span>Mostrar notas sem conexao<small>Inclui notas isoladas no grafo</small></span>
                              <input type="checkbox" checked={showGraphOrphans} onChange={(event) => setShowGraphOrphans(event.target.checked)} />
                              <span className="graph-settings-toggle-track" aria-hidden="true" />
                            </label>
                            <label className="graph-settings-toggle">
                              <span>Somente notas não conectadas<small>Esconde as conectadas</small></span>
                              <input type="checkbox" checked={showOnlyGraphOrphans} onChange={(event) => setShowOnlyGraphOrphans(event.target.checked)} />
                              <span className="graph-settings-toggle-track" aria-hidden="true" />
                            </label>
                            <label className="graph-settings-toggle">
                              <span>Ocultar nomes<small>Nome aparece apenas no hover</small></span>
                              <input type="checkbox" checked={graphHideAllNames} onChange={(event) => setGraphHideAllNames(event.target.checked)} />
                              <span className="graph-settings-toggle-track" aria-hidden="true" />
                            </label>
                            <label className="graph-settings-toggle">
                              <span>Agrupar por pasta<small>Clusters e cores por pasta com legenda</small></span>
                              <input type="checkbox" checked={graphGroupByFolder} onChange={(event) => setGraphGroupByFolder(event.target.checked)} aria-label="Agrupar por pasta" />
                              <span className="graph-settings-toggle-track" aria-hidden="true" />
                            </label>
                            <label className="graph-settings-toggle">
                              <span>Agrupar por tag<small>Clusters e cores pela tag principal com legenda</small></span>
                              <input type="checkbox" checked={graphGroupByTag} onChange={(event) => setGraphGroupByTag(event.target.checked)} aria-label="Agrupar por tag" />
                              <span className="graph-settings-toggle-track" aria-hidden="true" />
                            </label>
                            {graphGroupByTag ? (
                              <label className="graph-settings-row">
                                <span>Tag principal<small>Usada para desempatar notas com varias tags</small></span>
                                <select
                                  value={graphPrimaryTag}
                                  onChange={(event) => setGraphPrimaryTag(event.target.value)}
                                  aria-label="Tag principal do agrupamento por tag"
                                >
                                  <option value="">Primeira tag da nota</option>
                                  {graphTagIndexRef.current.allTags().map((tag) => (
                                    <option key={tag} value={tag}>#{tag}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {graphGroupMaps ? (
                              <section className="graph-settings-colors" aria-label="Cores dos grupos">
                                <p className="graph-settings-colors-title"><Palette size={12} strokeWidth={1.75} aria-hidden="true" /> Cores dos grupos</p>
                                {graphGroupMaps.groups.slice(0, 12).map((group) => {
                                  const override = graphColorOverrides[group.key]
                                  return (
                                    <label key={group.key} className="graph-settings-color-row">
                                      <input
                                        type="color"
                                        value={override && /^#[0-9a-fA-F]{6}$/.test(override) ? override : group.color}
                                        onChange={(event) => setGraphColorOverrides((current) => ({ ...current, [group.key]: event.target.value }))}
                                        aria-label={`Cor do grupo ${group.label}`}
                                      />
                                      <span className="graph-settings-color-label" title={group.label}>{group.label}</span>
                                      {override ? (
                                        <button
                                          type="button"
                                          className="graph-settings-color-reset"
                                          onClick={() => setGraphColorOverrides((current) => {
                                            const next = { ...current }
                                            delete next[group.key]
                                            return next
                                          })}
                                          aria-label={`Restaurar cor padrao do grupo ${group.label}`}
                                        >Restaurar</button>
                                      ) : null}
                                    </label>
                                  )
                                })}
                                {Object.keys(graphColorOverrides).length > 0 ? (
                                  <button
                                    type="button"
                                    className="graph-settings-color-reset-all"
                                    onClick={() => setGraphColorOverrides({})}
                                  >Restaurar todas as cores</button>
                                ) : null}
                              </section>
                            ) : null}
                            <label className="graph-settings-row">
                              <span>Limite de nos renderizados<small>Acima dele, so o viewport e o contexto aparecem</small></span>
                              <input type="number" min={50} max={10000} step={50} value={graphRenderLimit} onChange={(event) => setGraphRenderLimit(updateNumberSetting(event.target.value, graphRenderLimit, 50, 10000))} aria-label="Limite de nos renderizados no grafo 2D" />
                            </label>
                          </section>
                          <p className="graph-settings-note"><Info size={12} strokeWidth={1.75} aria-hidden="true" /> Sincronizado com a pagina de Configurações.</p>
                        </PopoverContent>
                      </Popover>
                    </div>
                    {graphMode3d ? (
                      <Suspense fallback={<div className="note-graph-3d note-graph-3d-fallback">Carregando grafo 3D...</div>}>
                        <NoteGraph3D
                          nodes={visibleGraphDocuments.map((document) => ({ name: document.name, relativePath: document.relativePath }))}
                          links={graphLinks}
                          degreeByPath={graphDegreeByPath}
                          focusedPath={focusedGraphPath}
                          currentPath={activeNote?.relativePath ?? null}
                          layoutVersion={graph3dLayoutVersion}
                          hideAllLabels={graphHideAllNames}
                          nodeSize={graph3dNodeSize}
                          nodeSpacing={graph3dNodeSpacing}
                          orbitSpeed={graph3dOrbitSpeed}
                          maxEdgeLength={graph3dMaxEdgeLength}
                          minEdgeLength={graph3dMinEdgeLength}
                          degreeGrowth={graph3dDegreeGrowth}
                          groupByPath={graphGroupMaps?.groupByPath}
                          groupColorByPath={graphGroupMaps?.groupColorByPath}
                          groupingEnabled={Boolean(graphGroupingKind)}
                          exportRequest={graphExportRequest}
                          onGraphExport={handleGraph3dExport}
                          onFocus={(path) => { setFocusedGraphPath(path); setGraphDetailOpen(Boolean(path)) }}
                          onOpenNote={(relativePath) => { setWorkspacePage('notes'); void openNote(relativePath) }}
                        />
                      </Suspense>
                    ) : (
                    <div
                      ref={graphSurfaceRef}
                      className="note-graph"
                      role="region"
                      aria-label="Grafo interativo das notas"
                      onWheel={(event) => { event.preventDefault(); setGraphViewport((view) => ({ ...view, scale: Math.max(0.55, Math.min(2.4, view.scale + (event.deltaY < 0 ? 0.1 : -0.1))) })) }}
                      onPointerDown={(event) => { if (event.target instanceof Element && event.target.closest('.note-graph-node')) return; event.currentTarget.setPointerCapture?.(event.pointerId); graphPanRef.current = { x: event.clientX, y: event.clientY, viewport: graphViewport } }}
                      onPointerMove={(event) => {
                        const pan = graphPanRef.current
                        if (pan) {
                          setGraphViewport({ ...pan.viewport, x: pan.viewport.x + event.clientX - pan.x, y: pan.viewport.y + event.clientY - pan.y })
                        } else if (!(event.target instanceof Element && event.target.closest('.note-graph-node'))) {
                          // Sem arrastar e sem estar sobre um no: limpa o hover
                          // (mantem o valor para nao re-renderizar a cada move).
                          setGraphHoverPath((current) => (current === null ? current : null))
                        }
                      }}
                      onPointerUp={(event) => { graphPanRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId) }}
                      onPointerCancel={() => { graphPanRef.current = null }}
                      onPointerLeave={() => setGraphHoverPath(null)}
                    >
                      <div className="note-graph-world" style={{ transform: `translate(${graphViewport.x}px, ${graphViewport.y}px) scale(${graphViewport.scale})` }}>
                        <svg className="note-graph-links" viewBox={`0 0 ${GRAPH_2D_WORLD_SIZE} ${GRAPH_2D_WORLD_SIZE}`} preserveAspectRatio="none" aria-hidden="true">
                          {graphLinks.map((link) => {
                            if (!graphRenderedPaths.has(link.source) || !graphRenderedPaths.has(link.target)) return null
                            const source = graphNodePositions[link.source]
                            const target = graphNodePositions[link.target]
                            const isFocused = focusedGraphPath === link.source || focusedGraphPath === link.target
                            const isHovered = graphHoverPath !== null && (link.source === graphHoverPath || link.target === graphHoverPath)
                            const linkClassName = `${isFocused ? 'is-focused' : ''}${isHovered ? ' is-hovered' : ''}`.trim() || undefined
                            // A linha usa geometria base fixa [0,0]-[100,0] e o
                            // transform (rotacao + escala) liga os nos; o loop
                            // da fisica so reescreve o transform a cada frame
                            // (composicao por GPU, sem invalidar layout SVG).
                            return <line className={linkClassName} key={`${link.source}-${link.target}`} x1="0" y1="0" x2="100" y2="0" transform={graph2dLineTransform(source, target)} ref={(element) => {
                              const linkKey = `${link.source}\u0000${link.target}`
                              if (element) graph2dLinkElementsRef.current.set(linkKey, element)
                              else graph2dLinkElementsRef.current.delete(linkKey)
                            }} />
                          })}
                        </svg>
                      {renderedGraphDocuments.map((document) => {
                        const position = graphNodePositions[document.relativePath]
                        const degree = graphDegreeByPath[document.relativePath] ?? 0
                        const isCurrent = document.relativePath === activeNote?.relativePath
                        const isHovered = graphHoverPath === document.relativePath
                        // O nome aparece de acordo com o zoom: com o zoom bem
                        // afastado nos de poucas conexoes ocultam o nome, e
                        // "Ocultar nomes" esconde todos. No hover o nome
                        // sempre aparece abaixo da bolinha.
                        const hideNameByZoom = graphHideAllNames || (graphViewport.scale < 0.65 && degree < 2)
                        const showLabel = !hideNameByZoom || isHovered
                        // No hover, nos sem conexao direta com o no sao
                        // esmaecidos (opacidade reduzida).
                        const isDimmed = graphHoverNeighbors !== null && !graphHoverNeighbors.has(document.relativePath)
                        return (
                          <button
                            key={document.relativePath}
                            type="button"
                            className={`note-graph-node${isCurrent ? ' is-current' : ''}${focusedGraphPath === document.relativePath ? ' is-focused' : ''}${isHovered ? ' is-hovered' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                            style={{ left: `${(position.x / GRAPH_2D_WORLD_SIZE) * 100}%`, top: `${(position.y / GRAPH_2D_WORLD_SIZE) * 100}%` } as CSSProperties}
                            ref={(element) => {
                              if (element) graph2dNodeElementsRef.current.set(document.relativePath, element)
                              else graph2dNodeElementsRef.current.delete(document.relativePath)
                            }}
                            onPointerEnter={() => setGraphHoverPath(document.relativePath)}
                            onPointerDown={(event) => { startGraph2dNodeDrag(document.relativePath, event) }}
                            onPointerMove={(event) => {
                              if (graphNodeDragRef.current !== document.relativePath) return
                              graphSkipNodeClickRef.current = true
                              const physics = graphPhysicsRef.current
                              if (!physics?.drag) return
                              const bounds = physics.drag.bounds
                              // Unico ponto fixado: o no arrastado segue o cursor
                              // (os vizinhos fluem pelas forcas no rAF). Bounds
                              // capturados no inicio do arrasto — sem chamadas de
                              // getBoundingClientRect no caminho quente.
                              if (bounds && bounds.width > 0 && bounds.height > 0) {
                                physics.drag.draggedTarget = {
                                  x: Math.max(GRAPH_2D_BOUNDS.minX, Math.min(GRAPH_2D_BOUNDS.maxX, ((event.clientX - bounds.left - graphViewport.x) / (bounds.width * graphViewport.scale)) * GRAPH_2D_WORLD_SIZE)),
                                  y: Math.max(GRAPH_2D_BOUNDS.minY, Math.min(GRAPH_2D_BOUNDS.maxY, ((event.clientY - bounds.top - graphViewport.y) / (bounds.height * graphViewport.scale)) * GRAPH_2D_WORLD_SIZE)),
                                }
                              }
                              // Acorda o loop se estava dormindo (cursor parado).
                              if (graphPhysicsFrameRef.current === null) kickGraph2dPhysics()
                              if (Math.hypot(event.clientX - physics.drag.startX, event.clientY - physics.drag.startY) > 3) physics.drag.moved = true
                            }}
                            onPointerUp={(event) => { finishGraph2dNodeDrag(event) }}
                            onPointerCancel={() => {
                              graphNodeDragRef.current = null
                              const physics = graphPhysicsRef.current
                              if (physics) {
                                physics.drag = null
                                physics.coast = null
                              }
                              if (graphPhysicsFrameRef.current !== null) {
                                cancelAnimationFrame(graphPhysicsFrameRef.current)
                                graphPhysicsFrameRef.current = null
                              }
                            }}
                            onFocus={() => setFocusedGraphPath(document.relativePath)}
                            onClick={() => { if (graphSkipNodeClickRef.current) { graphSkipNodeClickRef.current = false; return }; setWorkspacePage('notes'); void openNote(document.relativePath) }}
                            aria-label={`Abrir nota ${document.name.replace(/\.md$/i, '')} no grafo`}
                            title={`${document.name.replace(/\.md$/i, '')}${degree ? `, ${degree} conexao(oes)` : ''}`}
                          >
                            {/* Bolinha sempre circular; cresce com as conexoes. Com
                               agrupamento por pasta, a cor vem do grupo. */}
                            <span className="note-graph-node-dot" style={{ '--graph-scale': 1 + Math.min(degree, 8) * 0.13, ...(graphGroupingKind && graphGroupMaps ? { '--node-folder-color': graphGroupMaps.groupColorByPath[graphGroupMaps.groupByPath[document.relativePath] ?? ''] } : {}) } as CSSProperties} />
                            <span className={`note-graph-node-label${showLabel ? '' : ' is-hidden'}`}>{document.name.replace(/\.md$/i, '')}</span>
                          </button>
                        )
                      })}
                      </div>
                    </div>
                    )}
                    {graphGroupingKind && graphGroupMaps && graphGroupMaps.groups.length > 0 ? (
                      <aside className="graph-group-legend" aria-label={graphGroupingKind === 'folder' ? 'Legenda das pastas do grafo' : 'Legenda das tags do grafo'}>
                        {graphGroupMaps.groups.map((group) => (
                          <span key={group.key} className="graph-group-legend-row" title={`${group.label}: ${group.paths.length} ${group.paths.length === 1 ? 'nota' : 'notas'}`}>
                            <span className="graph-group-legend-swatch" style={{ background: group.color }} aria-hidden="true" />
                            <span className="graph-group-legend-name">{group.label}</span>
                            <span className="graph-group-legend-count">{group.paths.length}</span>
                          </span>
                        ))}
                      </aside>
                    ) : null}
                    <div className="graph-summary-counter" aria-label="Resumo do grafo">
                      {graphIsSummarized ? (
                        <span>{renderedGraphDocuments.length} de {visibleGraphDocuments.length} notas</span>
                      ) : (
                        <span>{visibleGraphDocuments.length} {visibleGraphDocuments.length === 1 ? 'nota' : 'notas'}</span>
                      )}
                      <span>{graphLinks.length} {graphLinks.length === 1 ? 'conexao' : 'conexoes'}</span>
                    </div>
                    {graphIsSummarized ? (
                      <p className="graph-culling-note" role="status">Grafo resumido: exibindo {renderedGraphDocuments.length} de {visibleGraphDocuments.length} nos no viewport (limite de {graphRenderLimit}). Aproxime ou reduza o limite nas configuracoes para ver os demais.</p>
                    ) : null}
                    {graphMode === 'local' && localGraphBeyond.size > 0 ? (
                      <p className="graph-local-limit-note">Grafo local limitado: {localGraphBeyond.size} {localGraphBeyond.size === 1 ? 'nota esta' : 'notas estão'} alem de {graphLocalDepth} {graphLocalDepth === 1 ? 'salto' : 'saltos'} de {localGraphCenterPath?.split('/').at(-1)?.replace(/\.md$/i, '') ?? 'a nota central'}.</p>
                    ) : null}
                    <Drawer direction="right" open={graphDetailOpen && Boolean(focusedGraphDocument)} onOpenChange={(open) => { if (!open) { setGraphDetailOpen(false); setFocusedGraphPath(null) } }}>
                      <DrawerContent className="graph-note-drawer">
                        {focusedGraphDocument ? (
                          <>
                            <DrawerHeader className="graph-note-drawer-header">
                              <div className="graph-note-drawer-heading">
                                <p className="graph-note-drawer-eyebrow">Nota no grafo</p>
                                <DrawerTitle>{focusedGraphDocument.name.replace(/\.md$/i, '')}</DrawerTitle>
                                <DrawerDescription>{focusedGraphDocument.relativePath}</DrawerDescription>
                              </div>
                              <button type="button" className="graph-note-drawer-close" onClick={() => setGraphDetailOpen(false)} aria-label="Fechar detalhes da nota">
                                <X size={16} strokeWidth={1.75} aria-hidden="true" />
                              </button>
                            </DrawerHeader>
                            <div className="graph-detail-stats" aria-label="Metricas da nota no grafo">
                              <div className="graph-detail-stat"><strong>{focusedIncomingLinks.length}</strong><span>entradas</span></div>
                              <div className="graph-detail-stat"><strong>{focusedOutgoingLinks.length}</strong><span>saidas</span></div>
                              <div className="graph-detail-stat"><strong>{graphDegreeByPath[focusedGraphDocument.relativePath] ?? 0}</strong><span>conexoes</span></div>
                            </div>
                            <div className="graph-note-drawer-section">
                              <p className="graph-note-drawer-section-title">Conteudo</p>
                              <p className="graph-note-drawer-preview">{getMarkdownPreviewText(focusedGraphDocument.content, 240) || 'Nota vazia.'}</p>
                            </div>
                            {focusedIncomingNotes.length > 0 ? (
                              <div className="graph-note-drawer-section">
                                <p className="graph-note-drawer-section-title">Referenciada por</p>
                                <div className="graph-note-drawer-references">
                                  {focusedIncomingNotes.map((note) => (
                                    <button
                                      key={note.relativePath}
                                      type="button"
                                      className="graph-note-drawer-ref"
                                      onClick={() => setFocusedGraphPath(note.relativePath)}
                                      title={`Focar ${note.name.replace(/\.md$/i, '')} no grafo`}
                                    >
                                      {note.name.replace(/\.md$/i, '')}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <div className="graph-note-drawer-actions">
                              <button type="button" className="graph-note-drawer-primary" onClick={() => { setWorkspacePage('notes'); void openNote(focusedGraphDocument.relativePath) }}>
                                <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" /> Abrir nota
                              </button>
                              <div className="graph-note-drawer-actions-grid">
                                <button type="button" className="secondary-button" onClick={() => { setGraphConnectQuery(''); setGraphConnectSource(focusedGraphDocument) }} title={`Criar uma conexao de ${focusedGraphDocument.name.replace(/\.md$/i, '')} para outra nota`}>
                                  <Link2 size={14} strokeWidth={1.75} aria-hidden="true" /> Criar conexao
                                </button>
                                <button type="button" className="secondary-button" onClick={() => void revealNoteInExplorer(focusedGraphDocument.relativePath)} title="Revelar no explorador de notas">
                                  <PanelLeft size={14} strokeWidth={1.75} aria-hidden="true" /> Revelar no explorador
                                </button>
                                <button type="button" className="secondary-button" onClick={() => void copyGraphWikiLink(focusedGraphDocument.relativePath)}>
                                  <Link2 size={14} strokeWidth={1.75} aria-hidden="true" /> Copiar wikilink
                                </button>
                                <button type="button" className="secondary-button" onClick={() => { setGraphDetailOpen(false); setGraphMode('local') }}>
                                  <Network size={14} strokeWidth={1.75} aria-hidden="true" /> Grafo local
                                </button>
                              </div>
                            </div>
                          </>
                        ) : null}
                      </DrawerContent>
                    </Drawer>
                    {showOnlyGraphOrphans ? (
                      <section className="graph-orphan-panel" aria-label="Notas não conectadas">
                        <div><p className="card-kicker">Limpeza do vault</p><h3>{orphanGraphDocuments.length} notas não conectadas</h3></div>
                        {orphanGraphDocuments.length > 0 ? <div className="graph-orphan-list">{orphanGraphDocuments.map((document) => <div key={document.relativePath}><span>{document.name.replace(/\.md$/i, '')}</span><div className="graph-orphan-actions"><button type="button" className="secondary-button" onClick={() => void revealNoteInExplorer(document.relativePath)} title="Revelar no explorador de notas">Revelar</button><button type="button" className="secondary-button" onClick={() => { setGraphConnectQuery(''); setGraphConnectSource(document) }} title={`Criar uma conexao de ${document.name.replace(/\.md$/i, '')} para outra nota`}>Conectar</button><button type="button" className="secondary-button" onClick={() => { setWorkspacePage('notes'); void openNote(document.relativePath) }}>Abrir</button></div></div>)}</div> : <p>Nenhuma nota isolada com os filtros atuais.</p>}
                      </section>
                    ) : null}
                    {visibleGraphDocuments.length === 0 ? <p className="graph-empty-state graph-empty-state-overlay">Nenhuma nota corresponde aos filtros atuais.</p> : graphLinks.length === 0 ? <p className="graph-empty-state graph-empty-state-overlay">Ainda nao ha links internos entre estas notas. Use <code>[[Nome da nota]]</code> para criar conexoes.</p> : null}
                  </>
                )}
              </section>
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
                      <strong>Salvar nota</strong>
                      <small>Salva as alteracoes da nota aberta.</small>
                    </span>
                    <input
                      value={shortcuts.saveNote}
                      onKeyDown={(event) => {
                        event.preventDefault()
                        setShortcuts((current) => ({ ...current, saveNote: formatShortcut(event.nativeEvent) }))
                      }}
                      aria-label="Atalho para salvar nota"
                      readOnly
                    />
                  </label>
                  <label>
                    <span>
                      <strong>Alternar modo de visualizacao</strong>
                      <small>Alterna entre os modos Misto, Edicao e Leitura.</small>
                    </span>
                    <input
                      value={shortcuts.cycleNoteViewMode}
                      onKeyDown={(event) => {
                        event.preventDefault()
                        setShortcuts((current) => ({ ...current, cycleNoteViewMode: formatShortcut(event.nativeEvent) }))
                      }}
                      aria-label="Atalho para alternar modo de visualização"
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
                      <tr><th>Arquivo</th><th>Tipo</th><th>Excluído em</th><th>Ações</th></tr>
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
              <section ref={settingsScrollRef} className="workspace-page" data-builder-name="settings-page">
                <div className="settings-layout">
                  <nav className="settings-nav" aria-label="Seções das configurações">
                    {SETTINGS_SECTIONS.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={activeSettingsSection === section.id ? 'is-active' : ''}
                        aria-current={activeSettingsSection === section.id ? 'true' : undefined}
                        onClick={() => scrollToSettingsSection(section.id)}
                      >
                        <section.icon size={15} strokeWidth={1.5} aria-hidden="true" />
                        <span>{section.label}</span>
                      </button>
                    ))}
                  </nav>
                  <div className="settings-content">
                    <p className="card-kicker">Configurações</p>
                    <h2>Configurações do vault</h2>
                    <p>Personalize a escrita, a leitura e o comportamento do workspace.</p>
                    <div className="settings-section" id="settings-aparencia" aria-labelledby="appearance-preferences-title">
                      <p className="card-kicker" id="appearance-preferences-title">Aparência</p>
                  <div className="settings-toggle">
                    <span>
                      <strong>Tema</strong>
                      <small>Escuro aplica contraste noturno em toda a interface. Seguir Obsidian importa o tema do `appearance.json` sem sobrescrever o `.obsidian`.</small>
                    </span>
                    <div className="settings-segmented" role="radiogroup" aria-label="Tema da interface">
                      {THEME_MODES.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={themeMode === option.value}
                          className={themeMode === option.value ? 'is-active' : ''}
                          onClick={() => setThemeMode(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="settings-toggle">
                    <span>
                      <strong>Fonte do editor e da leitura</strong>
                      <small>Familia aplicada aos modos Edicao, Misto e Leitura.</small>
                    </span>
                    <select className="settings-select" value={editorFontFamily} onChange={(event) => setEditorFontFamily(event.target.value as EditorFontFamily)} aria-label="Familia da fonte do editor e da leitura">
                      {FONT_FAMILIES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Tamanho da fonte</strong>
                      <small>Medida base do texto do editor e da leitura em pixels.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={MIN_FONT_SIZE}
                      max={MAX_FONT_SIZE}
                      step={1}
                      value={editorFontSize}
                      onChange={(event) => setEditorFontSize(clampFontSize(Number(event.target.value)))}
                      aria-label="Tamanho da fonte do editor e da leitura"
                    />
                  </label>
                  {vault?.obsidianAppearance?.baseFontSize ? (
                    <label className="settings-toggle">
                      <span>
                        <strong>Tamanho do Obsidian</strong>
                        <small>O Vault declara baseFontSize de {Math.round(vault.obsidianAppearance.baseFontSize)}px. Aplica sem alterar o `.obsidian`.</small>
                      </span>
                      <button type="button" className="secondary-button" onClick={() => setEditorFontSize(clampFontSize(vault.obsidianAppearance?.baseFontSize ?? DEFAULT_FONT_SIZE))}>Usar tamanho do Obsidian</button>
                    </label>
                  ) : null}
                  <label className="settings-toggle">
                    <span>
                      <strong>Limite do historico</strong>
                      <small>Acoes de desfazer/refazer mantidas por nota no editor ({DEFAULT_HISTORY_LIMIT} por padrao).</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={MIN_HISTORY_LIMIT}
                      max={MAX_HISTORY_LIMIT}
                      step={5}
                      value={historyLimit}
                      onChange={(event) => setHistoryLimit(clampHistoryLimit(Number(event.target.value)))}
                      aria-label="Limite do histórico de desfazer e refazer"
                    />
                  </label>
                  {vault?.obsidianAppearance?.ignoredAppearanceFields.length ? (
                    <p className="settings-note" role="status">
                      {vault.obsidianAppearance.ignoredAppearanceFields.length} campo(s) de `appearance.json` com tipo invalido foram ignorados sem descartar os demais.
                    </p>
                  ) : null}
                </div>
                <div className="settings-section" id="settings-workspace" aria-labelledby="workspace-preferences-title">
                  <p className="card-kicker" id="workspace-preferences-title">Workspace</p>
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
                    <small>Define a cor do título e do icone de fechar enquanto uma aba esta em hover.</small>
                  </span>
                  <input
                    type="color"
                    value={tabHoverTextColor}
                    onChange={(event) => setTabHoverTextColor(event.target.value)}
                    aria-label="Cor do texto no hover das abas"
                  />
                </label>
                </div>
                <div className="settings-section" id="settings-leitura" aria-labelledby="reading-preferences-title">
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
                <div className="settings-section" id="settings-grafo3d" aria-labelledby="graph3d-preferences-title">
                  <p className="card-kicker" id="graph3d-preferences-title">Grafo 3D</p>
                  <label className="settings-toggle">
                    <span>
                      <strong>Tamanho dos nos</strong>
                      <small>Raio base dos orbes 3D no grafo.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={0.2}
                      max={3}
                      step={0.05}
                      value={graph3dNodeSize}
                      onChange={(event) => setGraph3dNodeSize(updateNumberSetting(event.target.value, graph3dNodeSize, 0.2, 3))}
                      aria-label="Tamanho dos nos no grafo 3D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Distancia entre nos</strong>
                      <small>Raio das orbitas dos eletrons ao redor do elemento com mais conexoes.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={2}
                      max={20}
                      step={0.5}
                      value={graph3dNodeSpacing}
                      onChange={(event) => setGraph3dNodeSpacing(updateNumberSetting(event.target.value, graph3dNodeSpacing, 2, 20))}
                      aria-label="Distancia entre nos no grafo 3D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Velocidade de orbitacao</strong>
                      <small>Multiplicador da velocidade com que os eletrons orbitam o nucleo.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={graph3dOrbitSpeed}
                      onChange={(event) => setGraph3dOrbitSpeed(updateNumberSetting(event.target.value, graph3dOrbitSpeed, 0.1, 5))}
                      aria-label="Velocidade de orbitação no grafo 3D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Tamanho maximo das arestas</strong>
                      <small>Distancia maxima entre nos conectados; alem dela, a aresta puxa os extremos de volta.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={4}
                      max={40}
                      step={1}
                      value={graph3dMaxEdgeLength}
                      onChange={(event) => setGraph3dMaxEdgeLength(updateNumberSetting(event.target.value, graph3dMaxEdgeLength, 4, 40))}
                      aria-label="Tamanho maximo das arestas no grafo 3D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Tamanho minimo das arestas</strong>
                      <small>Distancia minima entre nos conectados; abaixo dela, a aresta empurra os extremos para longe.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={0}
                      max={30}
                      step={0.5}
                      value={graph3dMinEdgeLength}
                      onChange={(event) => setGraph3dMinEdgeLength(updateNumberSetting(event.target.value, graph3dMinEdgeLength, 0, 30))}
                      aria-label="Tamanho minimo das arestas no grafo 3D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Fator de aumento por conexao</strong>
                      <small>Quanto cada conexao adicional aumenta o raio do no.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={graph3dDegreeGrowth}
                      onChange={(event) => setGraph3dDegreeGrowth(updateNumberSetting(event.target.value, graph3dDegreeGrowth, 0, 1))}
                      aria-label="Fator de aumento por conexao no grafo 3D"
                    />
                  </label>
                </div>
                <div className="settings-section" id="settings-grafo2d" aria-labelledby="graph2d-preferences-title">
                  <p className="card-kicker" id="graph2d-preferences-title">Grafo 2D</p>
                  <p className="settings-section-description">Forcas da simulacao do grafo 2D, no modelo do Obsidian: repulsao 1/distancia² entre nos, molas das arestas (rigidez e descanso), amortecimento da velocidade e atracao ao anel central.</p>
                  <label className="settings-toggle">
                    <span>
                      <strong>Repulsao</strong>
                      <small>Forca com que os nos se repelem entre si (inversa ao quadrado da distancia).</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      step={50}
                      value={graph2dRepulsionStrength}
                      onChange={(event) => setGraph2dRepulsionStrength(updateNumberSetting(event.target.value, graph2dRepulsionStrength, -Infinity, Infinity))}
                      aria-label="Forca de repulsao dos nos no grafo 2D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Rigidez da mola</strong>
                      <small>Forca das arestas por unidade de distancia alem do descanso.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      step={0.1}
                      value={graph2dLinkStiffness}
                      onChange={(event) => setGraph2dLinkStiffness(updateNumberSetting(event.target.value, graph2dLinkStiffness, -Infinity, Infinity))}
                      aria-label="Rigidez da mola das arestas no grafo 2D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Amortecimento</strong>
                      <small>Decaimento da velocidade por segundo; mais alto = movimento mais "gredoso".</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      step={0.05}
                      value={graph2dVelocityDecay}
                      onChange={(event) => setGraph2dVelocityDecay(updateNumberSetting(event.target.value, graph2dVelocityDecay, -Infinity, Infinity))}
                      aria-label="Amortecimento da velocidade no grafo 2D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Distancia do link</strong>
                      <small>Comprimento de descanso das molas entre nos conectados.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      step={0.5}
                      value={graph2dLinkDistance}
                      onChange={(event) => setGraph2dLinkDistance(updateNumberSetting(event.target.value, graph2dLinkDistance, -Infinity, Infinity))}
                      aria-label="Distancia do link no grafo 2D"
                    />
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Forca central</strong>
                      <small>Atracao ao anel no meio do grafo; nos dentro do anel ficam soltos.</small>
                    </span>
                    <input
                      className="settings-number"
                      type="number"
                      step={5}
                      value={graph2dCenterForce}
                      onChange={(event) => setGraph2dCenterForce(updateNumberSetting(event.target.value, graph2dCenterForce, -Infinity, Infinity))}
                      aria-label="Forca central do grafo 2D"
                    />
                  </label>
                </div>
                <div className="settings-section" id="settings-revisao" aria-labelledby="review-gap-preferences-title">
                  <p className="card-kicker" id="review-gap-preferences-title">Revisão</p>
                  <label className="settings-toggle">
                    <span>
                      <strong>Lacunas da ultima revisao no editor</strong>
                      <small>Como destacar os trechos esquecidos ou confundidos na nota, usando o resultado mais recente. O Markdown nunca e modificado.</small>
                    </span>
                    <select
                      className="settings-select"
                      value={reviewGapMode}
                      onChange={(event) => setReviewGapMode(event.target.value as ReviewGapMode)}
                      aria-label="Exibição das lacunas da última revisão"
                    >
                      <option value="always">Sempre visiveis</option>
                      <option value="hover">Somente no hover</option>
                      <option value="off">Desativadas</option>
                    </select>
                  </label>
                  <VaultReviewPolicySettings vaultPath={vault.path} />
                <SegmentationSettings vaultPath={vault.path} />
                <ReviewNotificationSettings
                  lastCheck={notificationLastCheck}
                  onRequestCheck={() => {
                    void checkReviewNotifications({
                      vaultPath: vault.path,
                      nowUnixMs: Date.now(),
                      localDayStartUnixMs: localDayStartUnixMs(),
                    }).then(setNotificationLastCheck).catch(() => undefined)
                  }}
                />
                <ReviewAiSettings vaultPath={vault.path} />
                </div>
                <div className="settings-section" id="settings-aplicativo" aria-labelledby="app-preferences-title">
                  <p className="card-kicker" id="app-preferences-title">Aplicativo</p>
                  <div className="settings-toggle">
                    <span>
                      <strong>Versão do MirrorMind</strong>
                      <small>{appVersion ? `Você está na versão ${appVersion}.` : 'Versão disponível no app desktop.'}</small>
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void appUpdater.checkNow()}
                      disabled={appUpdater.status.kind === 'checking' || appUpdater.status.kind === 'downloading'}
                    >
                      {appUpdater.status.kind === 'checking' ? 'Verificando…' : 'Verificar atualizações'}
                    </button>
                  </div>
                  {appUpdater.status.kind === 'upToDate' ? (
                    <p className="settings-note" role="status">MirrorMind está atualizado.</p>
                  ) : null}
                  {appUpdater.status.kind === 'available' ? (
                    <p className="settings-note" role="status">
                      Nova versão disponível: {appUpdater.status.update.version}. Use o aviso no canto da janela para baixar e instalar.
                    </p>
                  ) : null}
                  {appUpdater.status.kind === 'failed' ? (
                    <p className="settings-note" role="status">{appUpdater.status.message}</p>
                  ) : null}
                </div>
                </div>
                </div>
              </section>
            )}
          </section>
          </section>
        {explorerContextMenu ? (
            <div className="explorer-context-menu-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExplorerContextMenu(null) }} onContextMenu={(event) => event.preventDefault()}>
              <div className="explorer-context-menu" role="menu" aria-label={`Ações para ${explorerContextMenu.target.name}`} style={{ left: explorerContextMenu.x, top: explorerContextMenu.y }}>
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
            <section className="note-search-modal external-change-modal" role="dialog" aria-modal="true" aria-label="Alteração externa detectada">
              <div className="move-item-heading">
                <strong>Alteracao externa detectada</strong>
                <span>A nota <b>{externalNoteConflict.externalNote.name.replace(/\.md$/i, '')}</b> foi modificada fora do MirrorMind enquanto voce tinha um rascunho local.</span>
              </div>
              <p>Escolha qual versao deve permanecer no editor. Nenhuma versao será sobrescrita automaticamente.</p>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={loadExternalNoteVersion}>Carregar arquivo externo</button>
                <button type="button" onClick={keepLocalNoteVersion}>Manter meu rascunho</button>
              </div>
            </section>
          </div>
        ) : null}
        {externalRemovedNote ? (
          <div className="note-search-backdrop external-change-backdrop" role="presentation">
            <section className="note-search-modal external-change-modal" role="dialog" aria-modal="true" aria-label="Nota removida fora do MirrorMind">
              <div className="move-item-heading">
                <strong>Nota removida externamente</strong>
                <span>A nota <b>{externalRemovedNote.relativePath.replace(/\.md$/i, '')}</b> foi removida ou movida por outro aplicativo. Seu rascunho continua preservado.</span>
              </div>
              <p>Restaure no caminho original, salve o rascunho em uma nova nota ou feche a aba sem recriar o arquivo.</p>
              <label className="recovered-note-path-field">
                <span>Novo caminho</span>
                <input
                  value={recoveredNotePath}
                  onChange={(event) => setRecoveredNotePath(event.target.value)}
                  placeholder="recuperadas/minha-nota.md"
                  aria-label="Novo caminho para a nota recuperada"
                />
              </label>
              <div className="folder-dialog-actions external-removed-note-actions">
                <button type="button" className="secondary-button" onClick={closeExternallyRemovedNote} disabled={loading}>Fechar aba</button>
                <button type="button" className="secondary-button" onClick={() => void saveExternallyRemovedNoteAsNew()} disabled={loading || !recoveredNotePath.trim()}>Salvar como nova</button>
                <button type="button" onClick={() => void restoreExternallyRemovedNote()} disabled={loading}>Restaurar arquivo</button>
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
        {showSpecialFilesDialog ? (
          <div className="note-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSpecialFilesDialog(false) }}>
            <section className="note-search-modal special-files-modal" role="dialog" aria-modal="true" aria-label="Arquivos com compatibilidade limitada" onKeyDown={(event) => { if (event.key === 'Escape') setShowSpecialFilesDialog(false) }}>
              <div className="move-item-heading">
                <strong>Arquivos preservados</strong>
                <span>Estes arquivos permanecem no Vault, mas ainda não podem ser visualizados ou editados aqui.</span>
                <button autoFocus type="button" className="modal-close-button" onClick={() => setShowSpecialFilesDialog(false)} aria-label="Fechar arquivos especiais"><X size={15} aria-hidden="true" /></button>
              </div>
              {specialFilesTruncated ? <p className="special-files-limit-notice" role="status">Mostrando os primeiros 500 arquivos. A coleta foi interrompida para manter o workspace responsivo.</p> : null}
              <div className="special-files-list">
                {specialFiles.map((file) => (
                  <article key={file.relativePath} className="special-file-row">
                    <div>
                      {(file.kind === 'canvas' || file.kind === 'excalidraw') ? (
                        <button
                          type="button"
                          className="special-file-open-button"
                          onClick={() => void openSpecialFileViewer(file)}
                          aria-label={`Visualizar ${file.name}`}
                          title="Visualizar somente leitura"
                        >
                          {file.name}
                        </button>
                      ) : (
                        <strong>{file.name}</strong>
                      )}
                      <code>{file.relativePath}</code>
                    </div>
                    <span className={`special-file-kind is-${file.kind}`}>{SPECIAL_FILE_LABELS[file.kind]}</span>
                    <p>{SPECIAL_FILE_LIMITATIONS[file.kind]} O arquivo será preservado sem alterações.</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : null}
        {specialFileViewer ? (
          specialFileViewerContent !== null ? (
            <SpecialFileViewer
              file={specialFileViewer}
              content={specialFileViewerContent}
              onClose={() => setSpecialFileViewer(null)}
            />
          ) : specialFileViewerError !== null ? (
            <div className="note-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSpecialFileViewer(null) }}>
              <section className="note-search-modal" role="dialog" aria-modal="true" aria-label={`Erro ao visualizar ${specialFileViewer.name}`}>
                <div className="move-item-heading">
                  <strong>{specialFileViewer.name}</strong>
                  <span>Não foi possível ler o arquivo para visualizacao.</span>
                  <button autoFocus type="button" className="modal-close-button" onClick={() => setSpecialFileViewer(null)} aria-label="Fechar erro de visualização"><X size={15} aria-hidden="true" /></button>
                </div>
                <p className="field-error" role="alert">{specialFileViewerError}</p>
              </section>
            </div>
          ) : (
            <div className="note-search-backdrop" role="presentation">
              <section className="note-search-modal" role="dialog" aria-modal="true" aria-label={`Lendo ${specialFileViewer.name}`}>
                <p className="special-files-limit-notice" role="status">Lendo o arquivo para visualizacao...</p>
              </section>
            </div>
          )
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
        {graphConnectSource ? createPortal(
          <div className="note-search-backdrop" role="presentation" style={{ pointerEvents: 'auto' }}>
            <section className="note-search-modal" role="dialog" aria-modal="true" aria-label="Criar conexao no grafo">
              <input autoFocus value={graphConnectQuery} onChange={(event) => setGraphConnectQuery(event.target.value)} placeholder="Buscar nota para conectar" aria-label="Buscar nota para conectar" />
              <div className="note-search-results">
                {graphConnectNotes.map((note) => (
                  <button key={note.relativePath} type="button" onClick={() => void createGraphConnection(graphConnectSource, note)}>{note.relativePath.replace(/\.md$/i, '')}</button>
                ))}
                {graphConnectNotes.length === 0 ? <p>Nenhuma outra nota disponivel para conectar.</p> : null}
              </div>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setGraphConnectSource(null)}>Cancelar</button>
              </div>
            </section>
          </div>,
          document.body,
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
              {wikilinkIndexProgress ? (
                <p className="wikilink-index-progress" role="status">
                  Indexando wikilinks... ({wikilinkIndexProgress.processed} de {wikilinkIndexProgress.total} notas)
                  {!wikilinkIndexCancelled ? (
                    <button type="button" className="secondary-button" onClick={() => void cancelWikilinkIndexBuild()}>Cancelar</button>
                  ) : (
                    <span className="wikilink-index-cancelled">Indexacao cancelada; usando varredura completa.</span>
                  )}
                </p>
              ) : null}
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
              {wikilinkIndexProgress ? (
                <p className="wikilink-index-progress" role="status">
                  Indexando wikilinks... ({wikilinkIndexProgress.processed} de {wikilinkIndexProgress.total} notas)
                  {!wikilinkIndexCancelled ? (
                    <button type="button" className="secondary-button" onClick={() => void cancelWikilinkIndexBuild()}>Cancelar</button>
                  ) : (
                    <span className="wikilink-index-cancelled">Indexacao cancelada; usando varredura completa.</span>
                  )}
                </p>
              ) : null}
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
                <span>{deleteTarget.type === 'folder' ? `A pasta "${deleteTarget.name}" e todo o seu conteudo serao movidos para a lixeira.` : `A nota "${deleteTarget.name.replace(/\.md$/i, '')}" será movida para a lixeira.`}</span>
              </div>
              <label className="delete-confirmation-preference">
                <input type="checkbox" checked={skipSoftDeleteConfirmation} onChange={(event) => setSkipSoftDeleteConfirmation(event.target.checked)} />
                Não mostrar esta confirmacao novamente
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
                <span>{permanentDeleteTarget.itemType === 'folder' ? `A pasta "${permanentDeleteTarget.originalRelativePath}" e todo o seu conteudo serao removidos definitivamente.` : `A nota "${permanentDeleteTarget.originalRelativePath.replace(/\.md$/i, '')}" será removida definitivamente e nao podera ser restaurada.`}</span>
              </div>
              <div className="folder-dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setPermanentDeleteTarget(null)}>Cancelar</button>
                <button type="button" className="danger-button" onClick={() => void permanentlyDeleteTrashItem()} disabled={loading}>Excluir permanentemente</button>
              </div>
            </section>
          </div>
        ) : null}
        <BuilderModeControl enabled={isBuilderModeEnabled} onEnabledChange={setBuilderModeEnabled} />
        <UpdateBanner
          updater={appUpdater}
          onBeforeInstall={async () => {
            // O install do updater encerra o app (NSIS/MSI relança ao concluir):
            // garante que o rascunho ativo esteja salvo em disco antes.
            if (!isDirty) return
            await saveActiveNote(false)
          }}
        />
      </main>
    )
  }

  return (
    <main className="app-shell vault-selection-shell" data-builder-name="vault-selection-shell">
      <TitleBar />
      <UpdateBanner updater={appUpdater} />
      <aside className="vault-selection-rail" aria-label="MirrorMind" data-builder-name="vault-selection-rail">
        <span className="vault-selection-mark">MM</span>
        <span className="vault-selection-rail-label">Vaults</span>
      </aside>
      <section className="hero-panel">
        <p className="eyebrow">Bem-vindo ao MirrorMind</p>
        <h1>Vault local, notas em Markdown e base pronta para revisar conhecimento.</h1>
        <p className="hero-copy">
          Suas notas são arquivos Markdown numa pasta do seu computador — nada é enviado para
          servidores. Abra um vault existente (inclusive do Obsidian) ou crie um novo.
        </p>
        <div className="status-strip" role="status">
          <span className={`status-dot${loading ? ' is-busy' : ''}`}></span>
          <span>{status}</span>
        </div>
      </section>

      <section className="vault-grid" data-builder-name="vault-selection-actions">
        <article className="action-card">
          <div className="card-header">
            <span className="card-kicker">Vault existente</span>
            <h2>Abrir vault existente</h2>
          </div>
          <p>
            Selecione uma pasta já existente no computador. O app vai reconhecer notas
            <code>.md</code> e detectar se o vault já veio do Obsidian.
          </p>
          <button type="button" onClick={chooseExistingVault} disabled={loading}>
            Escolher pasta
          </button>
        </article>

        <article className="action-card action-card--accent">
          <div className="card-header">
            <span className="card-kicker">Novo vault</span>
            <h2>Criar novo vault</h2>
          </div>
          <p>Crie um vault novo do zero com a estrutura interna do app pronta para uso.</p>
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
              <span>Não perguntar novamente e abrir este vault automaticamente.</span>
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

function VaultDiagnosticsBanner({
  diagnostics,
  onDismiss,
  onRetry,
}: {
  diagnostics: ScanDiagnostics
  onDismiss: () => void
  onRetry: () => void
}) {
  const { parts, paths } = scanDiagnosticsSummary(diagnostics)
  return (
    <div className="vault-diagnostics-banner" role="status" aria-live="polite">
      <div className="vault-diagnostics-icon" aria-hidden="true">
        <FileWarning size={15} strokeWidth={1.5} />
      </div>
      <div className="vault-diagnostics-text">
        <p className="vault-diagnostics-title">Leitura parcial do vault</p>
        <p className="vault-diagnostics-detail">
          {parts.join(' · ') || 'Algumas pastas ou notas nao puderam ser lidas.'} A parte
          valida continua disponivel e nada foi sobrescrito.
        </p>
        {paths.length > 0 ? (
          <ul className="vault-diagnostics-paths">
            {paths.map((path) => <li key={path}>{path}</li>)}
          </ul>
        ) : null}
      </div>
      <div className="vault-diagnostics-actions">
        <button type="button" className="secondary-button" onClick={onRetry}>
          Tentar novamente
        </button>
        <button
          type="button"
          className="vault-diagnostics-dismiss"
          onClick={onDismiss}
          aria-label="Fechar aviso de leitura parcial"
        >
          <span aria-hidden="true">&#10005;</span>
        </button>
      </div>
    </div>
  )
}

export default App
