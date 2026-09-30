import { lazy, Suspense, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from './components/ui/Button'
import { createPortal } from 'react-dom'
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { EditorState } from '@codemirror/state'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { errorMessage, invoke, isTauriRuntime } from './lib/tauri'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { BookMarked, CheckCircle2, ClipboardList, Folder, FolderOpen, Star, X } from 'lucide-react'
import { HugeiconsIcon } from '@hugeicons/react'
import { File02Icon } from '@hugeicons/core-free-icons'
import { RiFocus2Fill, RiFocus2Line } from '@remixicon/react'
import 'katex/dist/katex.min.css'
import { BuilderModeControl } from './components/BuilderModeControl'
import { TitleBar } from './components/TitleBar'
import type { FrontmatterPanelData, FrontmatterRow, LinkTarget } from './components/markdownLivePreview'
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover'
import { NoteReadinessControl, type ReviewStartInfo } from './features/review/NoteReadinessControl'
import { NoteStructureReport } from './features/review/NoteStructureReport'
import { applyStructuralAuditEdit } from './features/review/structuralAuditApply'
import { NoteReviewPolicyControl } from './features/review/NoteReviewPolicyControl'
import type { ExpiredDeadlineItem, UpcomingDeadlineItem } from './features/review/reviewDashboard'
import { auditNoteStructure, verifyNoteFacts, type FactCheckAttempt, type StructuralAudit } from './features/review/ai'
import { useReviewAiSettings } from './features/review/ReviewAiSettingsContext'
import { getNoteReviewGaps, type NoteReviewGap } from './features/review/noteReviewGaps'
import { getNoteReviewUnits, type NoteReviewUnit } from './features/review/noteReviewUnits'
import { getDueReviewQueue, type DueReviewItem } from './features/review/reviewQueue'
import { checkReviewNotifications, type ReviewNotificationCheck } from './features/review/reviewNotifications'
import { localDayStartUnixMs } from './features/review/reviewDashboard'
import { nudgeCursor } from './lib/nudgeCursor'
import { isAutoUpdateEnabled, setAutoUpdateEnabled, useAppUpdater } from './lib/useAppUpdater'
import { useEscapeToClose } from './lib/escapeStack'
import { UpdateBanner } from './components/UpdateBanner'
import { Modal } from './components/Modal'
import { PageSkeleton } from './components/PageSkeleton'
import { type GraphMode } from './components/GraphToolbar'
import { useGraphSettings } from './lib/useGraphSettings'
import { useAppearanceSettings } from './lib/useAppearanceSettings'
import { useNoteSearch } from './lib/useNoteSearch'
import { useTrashItems } from './lib/useTrashItems'
import { usePref } from './lib/prefs'

import { canApplyInventoryIncrementally, createVaultScanCoordinator, diffVaultNotePaths, enqueueVaultFileSystemChange, isVaultWatcherEventForRequest, type ScopedVaultFileSystemChange } from './lib/vaultWatcher'
import { findTextMatches } from './lib/findMatches'
import { resolveMarkdownAutocompleteData } from './lib/markdown-autocomplete'
import { findReadMatches, type ReadFindMatch } from './lib/readFind'
import { applyWikilinkEdit, buildWikilinkIndex, getWikilinkBacklinks, getWikilinkTargets } from './lib/wikilinkIndex'
import { createVaultIndex } from './lib/vaultIndex'
import { isIndexadora, removeIndexadoraSection, setIndexadoraFlag, syncIndexadoraSection } from './lib/indexadora'
import type { MarkdownCodeEditorHandle, MarkdownEditorHistoryStatus, MarkdownEditorSession } from './components/MarkdownCodeEditor'
import {
  matchesShortcut,
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
  TagSummary,
  VaultFileSystemChange,
  VaultSummary,
} from './lib/vault'
import {
  buildNoteTree,
  formatDailyNotePath,
  formatNoteTitleAsPath,
  formatVaultNameError,
  isVaultPathAffected,
  normalizeRecoveredNotePath,
  parseNoteDocument,
  parseNoteDocumentList,
  parseHistoryStatus,
  parseRecentVaultPreference,
  parseVaultInventory,
  parseVaultSummary,
  remapVaultPath,
  suggestVaultName,
  type ScanDiagnostics,
  type SyncConflictCopy,
} from './lib/vault'
import './App.css'
import { appendWikilinkToContent, countMarkdownWords, detectUnsupportedMarkdownFeatures, displayWikilinkTargetName, extractMarkdownTags, extractObsidianWikiLinks, getMarkdownBody, getMarkdownFrontmatterProperties, getMarkdownFrontmatterPropertySource, normalizeMarkdownTag, removeMarkdownFrontmatterProperty, resolveObsidianWikiLinkPath, setMarkdownFrontmatterPropertySource, transformMarkdownTable, type MarkdownFormat, type MarkdownTableAction } from './lib/markdown'
import { usePostitPopover } from './features/postits/usePostitPopover'
import { useFormatToolbar } from './features/format/useFormatToolbar'
import { SyncConflictsDialog } from './features/sync/SyncConflictsDialog'
import {
  accumulateObsidianForces2D,
  graph2dLineTransform,
  GRAPH_2D_BOUNDS,
  GRAPH_2D_WORLD_CENTER,
  GRAPH_2D_WORLD_SIZE,
  OBSIDIAN_PHYSICS_2D,
  type NoteGraphLayoutLink,
} from './lib/noteGraphLayout'
import {
  type Graph2DPhysics,
  type GraphDocument,
  type GraphPosition,
  type GraphViewport,
  type NoteGraphLink,
} from './lib/graphTypes'
import { buildGraph2dGroupCentersForGroups, buildGraphGroups, buildGroupMaps } from './lib/graphGrouping'
import { selectRenderedGraphDocuments } from './lib/graphCulling'
import { TagIndex } from './lib/tagIndex'
import { SpecialFileViewer } from './components/SpecialFileViewer'
import {
  effectiveThemeMode,
  fontFamilyCss,
} from './lib/appearance'
import { SettingsPage, type ReviewGapMode } from './features/settings/SettingsPage'
import { GraphPage } from './features/graph/GraphPage'
import { ExplorerItemMenu, ExplorerSidebar, type ExplorerContextMenu } from './features/explorer/ExplorerSidebar'
import { EditorHeader, HEADER_ACTION_KEYS, type HeaderActionKey, type NoteTemplate } from './features/editor/EditorHeader'
import { EditorContent } from './features/editor/EditorContent'
import { VaultSelection } from './features/vault/VaultSelection'
import { disabledSessionClient } from './lib/session'
import { isBillingEnabled } from './lib/billing'
import { TabStrip, WorkspaceRail, WorkspaceTopbar, type WorkspacePage } from './features/shell/WorkspaceChrome'
import { TrashPage } from './features/trash/TrashPage'
import { useSettingsNav, type SettingsSectionId } from './features/settings/useSettingsNav'
import { buildGraphSvg, downloadPng, downloadSvg, graphNodeExportColor } from './lib/graphExport'
import type { Graph3DExportRequest, Graph3DExportScene } from './components/NoteGraph3D'

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

type PaletteCommand = { id: string; label: string; description: string; disabled?: boolean }

/** Tipos do grafo (documento, links, viewport, fisica): ver `lib/graphTypes`. */

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

/** Acoes do cabecalho da nota que podem ir para o menu "Mais acoes" quando a
 * largura nao comporta (ordem de prioridade visual; o historico fica sempre
 * visivel por ser pequeno e primario). */
/** Chaves das ações do header: ver `features/editor/EditorHeader`. */

/** Sessoes da pagina de Configuracoes, na ordem do menu lateral. */
// Paginas secundarias (revisao e tags) sao carregadas sob demanda: o codigo
// (e as dependencias exclusivas de cada pagina) so entra no bundle inicial
// quando o usuario navega ate elas.
const ReviewDashboardPage = lazy(() => import('./features/review/ReviewDashboardPage').then((module) => ({ default: module.ReviewDashboardPage })))
const ReviewQueuePage = lazy(() => import('./features/review/ReviewQueuePage').then((module) => ({ default: module.ReviewQueuePage })))
const ReviewReportsPage = lazy(() => import('./features/review/ReviewReportsPage').then((module) => ({ default: module.ReviewReportsPage })))
const ReviewSessionPage = lazy(() => import('./features/review/ReviewSessionPage').then((module) => ({ default: module.ReviewSessionPage })))
const TagManagementPage = lazy(() => import('./features/tags/TagManagementPage').then((module) => ({ default: module.TagManagementPage })))
const BasesPage = lazy(() => import('./features/bases/BasesPage').then((module) => ({ default: module.BasesPage })))
const GoalsPage = lazy(() => import('./features/goals/GoalsPage').then((module) => ({ default: module.GoalsPage })))

/** Avisos em linguagem simples sobre trechos com exibicao limitada (vão para
 * o painel do arrow down, nao para o cabecalho). A promessa e sempre a
 * mesma: o texto original fica intacto, so a exibicao simplifica. */
const COMPATIBILITY_NOTES: Record<string, string> = {
  html: 'Partes em HTML aparecem simplificadas na leitura, mas o texto original continua intacto no arquivo.',
  'obsidian-comment': 'Comentários %% do Obsidian ficam ocultos na leitura; continuam salvos no arquivo.',
  'plugin-block': 'Blocos de plugins (como dataview) mostram o código em vez do resultado — nada é executado nem alterado.',
  'plugin-inline': 'Comandos de plugins no meio do texto aparecem como texto comum — nada é executado.',
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
  // Teto dos caches por nota (sessoes de cursor/scroll + EditorStates com
  // syntax tree): sem despejo, vaults grandes fixam um por nota visitada.
  // Rascunhos (draftsByPath) NAO entram aqui — guardam trabalho nao salvo.
  useEffect(() => {
    setEditorSessionsByPath((current) => {
      const keys = Object.keys(current)
      if (keys.length <= 30) return current
      const trimmed: Record<string, MarkdownEditorSession> = {}
      for (const key of keys.slice(-30)) trimmed[key] = current[key]
      return trimmed
    })
    const cache = markdownEditorStateCacheRef.current
    if (cache.size > 90) {
      const kept = [...cache.keys()].slice(-90)
      const trimmed = new Map<string, EditorState>()
      for (const key of kept) {
        const state = cache.get(key)
        if (state !== undefined) trimmed.set(key, state)
      }
      markdownEditorStateCacheRef.current = trimmed
    }
  }, [activeNote?.relativePath])
  // Toolbar de formatacao: ver features/format/useFormatToolbar + FormatToolbar
  // (estado, submenu de cores, tracking da selecao e aplicacao).
  // Post-its: ver usePostitPopover (hook chamado mais abaixo, apos noteBody)
  // — estado, commit, resize, ancoras e peek moram em features/postits.
  /** Painel integrado de propriedades (frontmatter): aberto pelo arrow down do
   * cabecalho; sincronizado com o editor via `onFrontmatterExpandedChange`. */
  const [frontmatterPanelOpen, setFrontmatterPanelOpen] = useState(false)
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
  /** Conteúdo do disco em que cada rascunho se baseava (espelho do efeito que
   * copia `draftContent` para `draftsByPath`): permite saber, ao reabrir, se o
   * arquivo mudou por baixo do rascunho (apagada + recriada por fora do app). */
  const draftBaseByPathRef = useRef<Record<string, string>>({})
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
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>('notes')
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
  // O segundo vigia cobre a entrada no editor VINDO DE DENTRO da propria
  // superficie (ex.: header/tags -> editor): as tags moram dentro de
  // `.editor-surface`, entao esse movimento nunca re-dispara o vigia da
  // superficie — mas a transicao de hover do "+" e o popover de tags tambem
  // prendem o I-beam em branco no WebView2. O pulso tardio (+300ms) cobre o
  // caso em que a transicao/animacao ainda roda quando o pulso imediato
  // expira: o cursor so fixa depois que a composicao assenta.
  useEffect(() => {
    let insideSurface = false
    let insideEditor = false
    const onMouseOver = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.workspace-shell .editor-surface') && !insideSurface) {
        insideSurface = true
        nudgeCursor(30)
      }
      if (target.closest('.workspace-shell .codemirror-markdown-editor') && !insideEditor) {
        insideEditor = true
        nudgeCursor(30)
        window.setTimeout(() => nudgeCursor(30), 300)
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
      if (
        target.closest('.workspace-shell .codemirror-markdown-editor') &&
        !(related instanceof Element && related.closest('.workspace-shell .codemirror-markdown-editor'))
      ) {
        insideEditor = false
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
  // Auditoria estrutural deterministica (sem IA): pagina propria dentro do
  // menu (espelho da pagina de avaliacao da nota), aberta pelo botao
  // "Avaliar estrutura".
  const [auditReportOpen, setAuditReportOpen] = useState(false)
  const [structuralAudit, setStructuralAudit] = useState<StructuralAudit | null>(null)
  const [structuralAuditLoading, setStructuralAuditLoading] = useState(false)
  const [structuralAuditError, setStructuralAuditError] = useState<string | null>(null)
  const [structuralAuditAppliedIndex, setStructuralAuditAppliedIndex] = useState<number | null>(null)
  // Verificação factual opcional: operacao separada da avaliacao de memoria,
  // informativa, sem alterar a nota nem as pontuacoes.
  const [factCheckOpen, setFactCheckOpen] = useState(false)
  const [factCheck, setFactCheck] = useState<FactCheckAttempt | null>(null)
  const [factCheckLoading, setFactCheckLoading] = useState(false)
  const [factCheckError, setFactCheckError] = useState<string | null>(null)
  const [notificationLastCheck, setNotificationLastCheck] = useState<ReviewNotificationCheck | null>(null)
  // Acoes do cabecalho escondidas no menu "Mais acoes" (medicao via
  // ResizeObserver; em ordem de prioridade, da ultima para a primeira).
  const [hiddenActions, setHiddenActions] = useState<HeaderActionKey[]>([])
  const hiddenActionsRef = useRef<HeaderActionKey[]>([])
  const headerActionsRef = useRef<HTMLDivElement | null>(null)
  const headerActionsWidthRef = useRef(0)
  const [reviewGaps, setReviewGaps] = useState<NoteReviewGap[]>([])
  const [reviewUnits, setReviewUnits] = useState<NoteReviewUnit[]>([])
  const [reviewGapMode, setReviewGapMode] = usePref<ReviewGapMode>(
    'mirrormind.review-gap-mode',
    'hover',
    (raw) => {
      if (raw === 'off' || raw === 'hover' || raw === 'always') return raw
      throw new Error('valor inválido')
    },
    (value) => value,
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
  // Indice do Vault inteiro (lib/vaultIndex): construido em segundo plano ao
  // abrir o Vault e atualizado incrementalmente (save/rename/exclusao).
  // Alimenta a aba de backlinks e o ranqueamento do autocomplete sem
  // depender do grafo aberto. O grafo tambem bebe deste module: reutiliza o
  // cache de conteudos quando fresco (mesmo Vault e mesmo conjunto de notas)
  // e constroi o proprio indice a partir dele — um so estoque de conteudos.
  const vaultIndexRef = useRef(createVaultIndex())
  const vaultWikilinkIndexLoadedPathRef = useRef<string | null>(null)
  const vaultWikilinkIndexRequestRef = useRef(0)
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
  // Configurações numéricas do grafo via hook extraído (lib/useGraphSettings):
  // 12 prefs globais com as mesmas chaves e validações de antes; a gravação
  // é automática no setter, sem efeitos manuais de localStorage.
  const graph = useGraphSettings()
  const {
    graphRenderLimit,
    setGraph3dNodeSize,
    setGraph3dNodeSpacing,
    setGraph3dOrbitSpeed,
    setGraph3dMaxEdgeLength,
    setGraph3dMinEdgeLength,
    setGraph3dDegreeGrowth,
    graph2dRepulsionStrength,
    setGraph2dRepulsionStrength,
    graph2dLinkStiffness,
    setGraph2dLinkStiffness,
    graph2dVelocityDecay,
    setGraph2dVelocityDecay,
    graph2dLinkDistance,
    setGraph2dLinkDistance,
    graph2dCenterForce,
    setGraph2dCenterForce,
  } = graph
  const [graphSurfaceSize, setGraphSurfaceSize] = useState<{ width: number; height: number } | null>(null)
  const [graphMode3d, setGraphMode3d] = useState(false)
  // Versão do layout 3D (fixa: sem botão de reorganizar, o Big Bang
  // acontece só ao abrir/mudar o modo).
  const [graph3dLayoutVersion] = useState(0)
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
  // Aparência, leitura, editor e atalhos extraídos para
  // lib/useAppearanceSettings — mesmas chaves, mesmos padrões, gravação
  // automática no setter, sem efeitos manuais de localStorage.
  const appearance = useAppearanceSettings()
  const {
    shortcuts,
    isAutoSaveEnabled,
    noteHoverColor,
    tabHoverColor,
    tabHoverTextColor,
    readingFont,
    themeMode,
    editorFontFamily,
    editorFontSize,
    historyLimit,
    readingWidth,
    isReadingLineWrapEnabled,
    isSpellCheckEnabled,
    skipSoftDeleteConfirmation,
    setSkipSoftDeleteConfirmation,
    isPagesFullWidth,
  } = appearance
  // Navegação das Configurações (seções/grupos/menu) extraída para
  // features/settings/useSettingsNav — mesmo comportamento do App original.
  const {
    activeSettingsSection,
    settingsScrollRef,
    scrollToSettingsSection,
    requestSettingsSection,
  } = useSettingsNav(workspacePage === 'settings')

  /** Abre as Configuracoes ja rolando ate a secao pedida (ex.: palette "atalhos"). */
  function openSettingsSection(sectionId: SettingsSectionId) {
    requestSettingsSection(sectionId)
    setWorkspacePage('settings')
  }
  /** Verificação manual do resumo diário (botão em Configurações → Revisão). */
  function handleCheckReviewNotifications() {
    if (!vault) return
    void checkReviewNotifications({
      vaultPath: vault.path,
      nowUnixMs: Date.now(),
      localDayStartUnixMs: localDayStartUnixMs(),
    }).then(setNotificationLastCheck).catch(() => undefined)
  }
  /** Alterna a verificação automática (persiste a preferência + estado local). */
  function handleToggleAutoUpdate(enabled: boolean) {
    setAutoUpdateEnabled(enabled)
    setAutoUpdateEnabledState(enabled)
  }
  /** Abre nota a partir das paginas (metas, revisao, grafo): vai para `notes` e abre. */
  function openNoteInWorkspace(relativePath: string) {
    setWorkspacePage('notes')
    void openNote(relativePath)
  }
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
  const [showNoteSearch, setShowNoteSearch] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [noteSearchQuery, setNoteSearchQuery] = useState('')
  // Busca debounced do dialogo "Abrir nota" extraída para
  // lib/useNoteSearch — mesmo debounce, mesmo comando, mesmas regras.
  const noteSearchResults = useNoteSearch(vault?.path ?? null, noteSearchQuery, showNoteSearch)
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
  const [syncConflictCopies, setSyncConflictCopies] = useState<SyncConflictCopy[]>([])
  const [showSyncConflicts, setShowSyncConflicts] = useState(false)
  const [showSpecialFilesDialog, setShowSpecialFilesDialog] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagFilterQuery, setTagFilterQuery] = useState('')
  const [showTagFilterDialog, setShowTagFilterDialog] = useState(false)
  const [showTagFilterDropdown, setShowTagFilterDropdown] = useState(false)
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenu | null>(null)
  const [showTagDialog, setShowTagDialog] = useState(false)
  const [tagName, setTagName] = useState('')
  const [showPostitOrphans, setShowPostitOrphans] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({ canUndo: false, canRedo: false })
  const [loading, setLoading] = useState(false)
  const [wikilinkIndexProgress, setWikilinkIndexProgress] = useState<{ processed: number; total: number } | null>(null)
  const [wikilinkIndexCancelled, setWikilinkIndexCancelled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Escolha um vault existente ou crie um do zero.')
  // Lixeira extraída para lib/useTrashItems — mesmos comandos e mensagens.
  // `deleteTarget`/soft-delete ficam aqui: tocam abas, rascunhos, nota ativa
  // e índice wikilink (núcleo do editor), sem ganho em extrair.
  const {
    trashItems,
    permanentDeleteTarget,
    setPermanentDeleteTarget,
    openTrashPage,
    restoreTrashItem,
    permanentlyDeleteTrashItem,
  } = useTrashItems({
    vaultPath: vault?.path ?? null,
    refreshNotes,
    goToTrashPage: () => setWorkspacePage('trash'),
    reportStatus: setStatus,
    reportError: setError,
    setBusy: setLoading,
  })
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
  const [autoUpdateEnabled, setAutoUpdateEnabledState] = useState(() => isAutoUpdateEnabled())
  useEffect(() => {
    if (!isTauriRuntime()) return
    void getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion(null))
  }, [])

  // Escape fecha o dialog do topo (um por vez): cada modal se registra na
  // pilha global enquanto aberto. A command palette e o popover do editor
  // tratam Escape manualmente e nao se registram.
  // Escape dos modais migrados para `<Modal>` é registrado pelo próprio
  // componente (pilha global); restam aqui só os casos fora dele: viewer
  // (o estado de "Lendo..." é bloqueante) e palette (UX própria).
  useEscapeToClose(Boolean(specialFileViewer), () => setSpecialFileViewer(null))

  const isDirty = activeNote !== null && draftContent !== activeNote.content
  // Parse único do rascunho por mudança de conteúdo: corpo, tags e
  // propriedades saem de um só useMemo (antes eram 3-5 parses por render,
  // incluindo renders sem digitação — hover, timers, popovers).
  const parsedDraft = useMemo(() => ({
    body: getMarkdownBody(draftContent),
    tags: extractMarkdownTags(draftContent),
    properties: getMarkdownFrontmatterProperties(draftContent),
  }), [draftContent])
  const noteBody = parsedDraft.body
  const noteTags = parsedDraft.tags
  const frontmatterProperties = parsedDraft.properties
  // Lacunas da ultima revisao para o motor unico (modo Leitura = Misto
  // read-only): mesma condicao do classico — desliga com o modo 'off' ou com
  // a nota editada (offsets ficam obsoletos). `bodyOffset` desloca os offsets
  // (que incluem o frontmatter) quando o doc do editor nao tem frontmatter.
  const reviewGapData = reviewGapMode !== 'off' && !isDirty
    ? {
      gaps: reviewGaps,
      units: reviewUnits,
      enabled: true,
      bodyOffset: draftContent.length - noteBody.length,
    }
    : null
  // Post-its: estado e logica moram em features/postits/usePostitPopover (a
  // chamada fica aqui porque as deps — draft, corpo, modo, refs do editor —
  // sao deste componente). A desestruturacao mantem os nomes, entao o JSX e
  // os editores nao mudam.
  const postits = usePostitPopover({
    draftContent,
    setDraftContent,
    noteBody,
    hasActiveNote: activeNote !== null,
    editorMode,
    reportError: (message) => setError(message),
    editor: {
      getSelection: () => markdownCodeEditorRef.current?.getSelection() ?? null,
      getParagraphStartAt: (from) => markdownCodeEditorRef.current?.getParagraphStartAt(from) ?? null,
      getParagraphTextAt: (from) => markdownCodeEditorRef.current?.getParagraphTextAt(from) ?? null,
      getSelectionRect: () => markdownCodeEditorRef.current?.getSelectionRect() ?? null,
      getRectAt: (from) => markdownCodeEditorRef.current?.getRectAt(from) ?? null,
      editorContent: () => editorContentRef.current,
    },
  })
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
          setSyncConflictCopies(inventory.syncConflictCopies)
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
      setSyncConflictCopies([])
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
    void handleRecentVaultStartup()
  }, [])

  // Aparencia: aplica o tema no documento (atributo `data-theme` lido pelo
  // CSS) e as variaveis de fonte/leitura. A persistência vive no hook
  // lib/useAppearanceSettings (gravação automática no setter).
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
    if (activeNote) {
      setDraftsByPath((currentDrafts) => ({ ...currentDrafts, [activeNote.relativePath]: draftContent }))
      draftBaseByPathRef.current[activeNote.relativePath] = activeNote.content
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
    vaultIndexRef.current.markDocumentsStale()
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
        errorMessage(caughtError, 'Não foi possível abrir o vault.')
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
        errorMessage(caughtError, 'Não foi possível reabrir o último vault.')
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
      setError(errorMessage(caughtError, 'Não foi possível salvar a preferencia.'))
    }
  }

  async function dismissRecentVault() {
    try {
      if (skipRecentVaultPrompt) {
        await updateRecentVaultPromptPreference(false)
      }
      setShowRecentVaultModal(false)
    } catch (caughtError) {
      setError(errorMessage(caughtError, 'Não foi possível salvar a preferencia.'))
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
        errorMessage(caughtError, 'Não foi possível criar o vault.')
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
      vaultIndexRef.current.rebuild(vaultPath, contents)
      // Atualiza os backlinks da nota ativa com o indice pronto.
      if (vault && activeNoteRef.current && activeNoteRef.current.relativePath !== '__new_note__') {
        const snapshot = vaultIndexRef.current.getSnapshot()
        if (snapshot) setBacklinks(resolveBacklinksFromIndex(snapshot, activeNoteRef.current.relativePath))
      }
    } catch {
      // Indexacao em segundo plano nunca derruba a interface; o get_backlinks
      // (varredura no disco) continua como fallback.
      vaultIndexRef.current.clear()
    }
  }

  async function retryVaultDiagnostics() {
    if (!vault) return
    try {
      const inventory = parseVaultInventory(
        await invoke<unknown>('scan_vault_inventory', { path: vault.path }),
      )
      setVaultDiagnostics(inventory.diagnostics)
      setSyncConflictCopies(inventory.syncConflictCopies)
      setDiagnosticsDismissed(false)
      setStatus('Varredura refeita.')
    } catch {
      setVaultDiagnostics(null)
      setSyncConflictCopies([])
      setStatus('Não foi possível refazer a varredura do vault.')
    }
  }

  async function refreshNotes(vaultPath: string, preferredPath?: string) {
    setLoading(true)
    setError(null)

    try {
      // Varredura unificada: uma unica passagem no backend produz notas,
      // pastas, anexos, arquivos especiais E o indice de tags (sem a segunda
      // varredura do `get_tag_index`). Favoritos e templates, independentes,
      // rodam em paralelo com o scan.
      const [inventoryPayload, nextFavorites, nextTemplates] = await Promise.all([
        invoke<unknown>('scan_vault_inventory', { path: vaultPath }),
        invoke<string[]>('list_favorites', { path: vaultPath }),
        invoke<NoteTemplate[]>('list_templates', { path: vaultPath }),
      ])
      const inventory = parseVaultInventory(inventoryPayload)
      const nextNotes = inventory.notes
      const nextFolders = inventory.folders
      const nextTagIndex = inventory.tags
      const nextAttachments = inventory.attachments
      const nextSpecialInventory = inventory.specialFiles
      const nextSpecialFiles = nextSpecialInventory.files
      setNotes(nextNotes)
      setFolders(nextFolders)
      setTagIndex(nextTagIndex)
      setAttachments(nextAttachments)
      setSpecialFiles(nextSpecialFiles)
      setSpecialFilesTruncated(nextSpecialInventory.truncated)
      setFavorites(nextFavorites)
      setTemplates(nextTemplates)
      setVaultDiagnostics(inventory.diagnostics)
      setSyncConflictCopies(inventory.syncConflictCopies)
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
        errorMessage(caughtError, 'Não foi possível carregar as notas.')
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
      setSpecialFileViewerError(errorMessage(cause, 'Não foi possível ler o arquivo especial.'))
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
      setError(errorMessage(caughtError, 'Não foi possível abrir a página de tags.'))
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
      setStructuralAuditError(errorMessage(error, String(error)))
    } finally {
      setStructuralAuditLoading(false)
    }
  }

  /** Verificação factual opcional (separada da avaliacao de memoria): compara
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
      setFactCheckError(errorMessage(error, String(error)))
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

  // Abre a pagina de estrutura (sempre re-executa: o conteudo salvo pode ter
  // mudado) e fecha/limpa ao trocar de nota.
  function openAuditReport() {
    if (!vault || !activeNote || isNewNoteDraft) return
    setAuditReportOpen(true)
    void runStructuralAudit()
  }

  useEffect(() => {
    setAuditReportOpen(false)
    setStructuralAudit(null)
    setStructuralAuditError(null)
    setStructuralAuditAppliedIndex(null)
    setFactCheckOpen(false)
    setFactCheck(null)
    setFactCheckError(null)
  }, [activeNote?.relativePath])

  useEffect(() => {
    hiddenActionsRef.current = hiddenActions
  }, [hiddenActions])

  // Overflow do cabecalho em cascata: enquanto o conteudo exceder a largura,
  // esconde a ultima acao visivel (ordem de prioridade). So esconde, nunca
  // mostra — converge porque as chaves sao finitas. Sem layout real (ex.:
  // jsdom, clientWidth 0) mantem tudo inline.
  useEffect(() => {
    const container = headerActionsRef.current
    if (!container || container.clientWidth === 0) return
    if (container.scrollWidth > container.clientWidth) {
      const hidden = hiddenActionsRef.current
      const victim = [...HEADER_ACTION_KEYS].reverse().find((key) => !hidden.includes(key))
      if (victim) setHiddenActions([...hidden, victim])
    }
  }, [hiddenActions])

  // ResizeObserver: quando o cabecalho CRESCE, tenta trazer de volta a ultima
  // escondida (maior prioridade entre as escondidas); a cascata acima
  // re-esconde se ainda nao couber. Sem reacao a encolhimento aqui (a cascata
  // ja cobre) — e sem re-disparo por mover filhos (a largura do conteiner e
  // definida pelo pai, nao pelo conteudo).
  useEffect(() => {
    const container = headerActionsRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const target = headerActionsRef.current
      if (!target || target.clientWidth === 0) return
      const hidden = hiddenActionsRef.current
      if (hidden.length > 0 && target.clientWidth > headerActionsWidthRef.current) {
        setHiddenActions(hidden.slice(0, -1))
      }
      headerActionsWidthRef.current = target.clientWidth
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

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
      // Reutiliza os conteudos do vaultIndex quando frescos (mesmo Vault e
      // MESMO conjunto de notas): abrir o grafo nao rele NADA. Nomes vêm das
      // notas atuais (mesma fonte da checagem); o module guarda so conteudos.
      const cachedDocuments = vaultIndexRef.current.getDocuments()
      if (
        cachedDocuments
        && vaultIndexRef.current.getVaultPath() === vaultPath
        && cachedDocuments.size === notes.length
        && notes.every((note) => cachedDocuments.has(note.relativePath))
      ) {
        const documents = notes.map((note) => ({
          relativePath: note.relativePath,
          name: note.name,
          content: cachedDocuments.get(note.relativePath)?.content ?? '',
        }))
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
      // Guarda os conteudos no module (snapshot de fundo continua valendo).
      vaultIndexRef.current.setDocuments(
        vaultPath,
        allNotes.map((note) => ({ relativePath: note.relativePath, content: note.content })),
      )
      setFocusedGraphPath(activeNote?.relativePath ?? null)
    } catch {
      if (requestId !== graphLoadRequestRef.current) return
      setGraphDocuments([])
        setError('Não foi possível carregar as conexões entre as notas.')
    } finally {
      if (requestId === graphLoadRequestRef.current) {
        setGraphLoading(false)
        setGraphLoadProgress(null)
      }
    }
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
      // Simulacao ambiente (big bang ao abrir o grafo): todos os
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
      // Pasta/tag NÃO excluem nós (highlight sem reset de layout) — só a
      // busca por nome filtra aqui; o resto é esmaecido no render.
      const isOrphan = (degreeByPath[document.relativePath] ?? 0) === 0
      return matchesQuery && (graphMode === 'global' || localGraphPaths.has(document.relativePath)) && (showOnlyGraphOrphans ? isOrphan : showGraphOrphans || !isOrphan)
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
   * abrir o grafo 2D (big bang forcado: `forceBigBang`);
   * qualquer arrasto a cancela. Quando o ambiente oferece um
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

  // Ao abrir o grafo 2D (ou mudar o modo), espalha os nós por toda a
  // área com a simulação ambiente, após a superfície montar. Navegar para
  // outra página ou trocar para 3D limpa a simulação (efeito acima).
  // Filtro pasta/tag é só highlight — não toca neste efeito.
  useEffect(() => {
    if (workspacePage !== 'graph' || graphMode3d || isGraphLoading || graphDocuments.length === 0) return
    // Big bang forcado ao ABRIR o grafo 2D (sem simulacao ativa = primeira
    // abertura/montagem da pagina); mudancas de filtro no meio continuam a
    // simulacao de onde os nos estao, sem re-explodir.
    const forceBigBang = graphPhysicsRef.current === null
    const timeoutId = window.setTimeout(() => startGraph2dAmbientSimulation(forceBigBang), 120)
    return () => window.clearTimeout(timeoutId)
  }, [workspacePage, graphMode3d, isGraphLoading, graphDocuments, graphMode, graphGroupByFolder, showGraphOrphans, showOnlyGraphOrphans])

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
    if (command.id === 'goals') setWorkspacePage('goals')
    if (command.id === 'shortcuts') openSettingsSection('atalhos')
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
      setError(errorMessage(caughtError, 'Não foi possível criar a pasta.'))
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
      // Reindexa incrementalmente no module (remove o caminho antigo e
      // registra o novo com o mesmo conteudo em notas renomeadas).
      vaultIndexRef.current.remapPaths(remapPath)
      // Renomear/mover muda caminhos: remapPaths acima ja invalidou o cache
      // de conteudos, reconstruido na proxima leitura unificada.
      await refreshNotes(vault.path, remapPath(activeNote?.relativePath ?? ''))
      if (target.type === 'note' && activeNote?.relativePath === target.path) {
        void loadBrokenLinks(destinationPath, vault.path)
      }
    } catch (caughtError) {
      setError(errorMessage(caughtError, 'Não foi possível renomear o item.'))
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
          setError(errorMessage(caughtError, 'Não foi possível renomear a nota.'))
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
      setError(errorMessage(caughtError, 'Não foi possível mover o item.'))
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
      setError(errorMessage(caughtError, 'Não foi possível mover a nota.'))
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
      // O module centraliza a ordem: mesmas entradas, mesmas origens.
      const removal = vaultIndexRef.current.removePaths(isDeletedPath)
      for (const sourcePath of removal.affectedSources) void syncIndexadoraPath(sourcePath)
      // Exclusao muda o conjunto de notas: removePaths acima ja invalidou o
      // cache de conteudos, reconstruido na proxima leitura unificada.
      await refreshNotes(vault.path, '')
    } catch (caughtError) {
      setError(errorMessage(caughtError, 'Não foi possível excluir o item.'))
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

  /** Resolve uma copia de conflito substituindo o original pelo conteudo
   * dela; a copia vai para a lixeira (rede de seguranca) e o inventario e
   * refeito. Devolve o erro ou null. */
  async function promoteSyncConflictCopy(copy: SyncConflictCopy): Promise<string | null> {
    if (!vault) return 'Nenhum vault aberto.'
    setLoading(true)
    try {
      const payload = await invoke<unknown>('read_note', { path: vault.path, relativePath: copy.relativePath })
      const copyNote = parseNoteDocument(payload)
      await invoke('save_note', { path: vault.path, relativePath: copy.originalPath, content: copyNote.content })
      await deleteVaultItem({
        path: copy.relativePath,
        name: copy.relativePath.split('/').at(-1) ?? copy.relativePath,
        type: 'note',
      })
      return null
    } catch (caughtError) {
      return errorMessage(caughtError, 'Não foi possível substituir pelo conteúdo da cópia.')
    } finally {
      setLoading(false)
    }
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
      // O arquivo pode ter sido apagado e recriado por fora do app depois que
      // o rascunho foi guardado (o watcher nem sempre vê o ciclo
      // apagar→recriar). A base diz em qual conteúdo do disco o rascunho se
      // baseava: se base e rascunho diferem do disco atual, o rascunho é de
      // outra vida do arquivo — purga rascunho, sessão e estado do editor e
      // adota o disco. Sem base registrada, mantém o rascunho: nunca se
      // descarta trabalho não salvo sem prova de que o arquivo mudou.
      const cachedDraft = draftsByPathRef.current[parsedNote.relativePath]
      const draftBase = draftBaseByPathRef.current[parsedNote.relativePath]
      const resurrectedStaleDraft = cachedDraft !== undefined
        && cachedDraft !== parsedNote.content
        && draftBase !== undefined
        && draftBase !== parsedNote.content
      if (resurrectedStaleDraft) {
        setDraftsByPath((currentDrafts) => {
          const { [parsedNote.relativePath]: _discardedDraft, ...remainingDrafts } = currentDrafts
          return remainingDrafts
        })
        delete draftBaseByPathRef.current[parsedNote.relativePath]
        setEditorSessionsByPath((sessions) => {
          const { [parsedNote.relativePath]: _discardedSession, ...remainingSessions } = sessions
          const { [`${parsedNote.relativePath}::leitura`]: _discardedReadSession, ...remaining } = remainingSessions
          return remaining
        })
        for (const key of markdownEditorStateCacheRef.current.keys()) {
          if (key === parsedNote.relativePath || key.startsWith(`${parsedNote.relativePath}::`)) {
            markdownEditorStateCacheRef.current.delete(key)
          }
        }
      }
      draftBaseByPathRef.current[parsedNote.relativePath] = parsedNote.content
      setActiveNote(parsedNote)
      // Painel de propriedades fecha ao trocar de nota (o editor e recriado
      // com o frontmatter colapsado na barra).
      setFrontmatterPanelOpen(false)
      setOpenTabs((currentTabs) =>
        currentTabs.includes(parsedNote.relativePath)
          ? currentTabs
          : [...currentTabs, parsedNote.relativePath],
      )
      setDraftContent(resurrectedStaleDraft ? parsedNote.content : (draftsByPathRef.current[parsedNote.relativePath] ?? parsedNote.content))
      void loadBacklinks(parsedNote.relativePath, targetVaultPath)
      void loadBrokenLinks(parsedNote.relativePath, targetVaultPath)
      setStatus(`Editando ${parsedNote.relativePath}`)
    } catch (caughtError) {
      const message =
        errorMessage(caughtError, 'Não foi possível abrir a nota.')
      setError(message)
      setStatus('Falha ao abrir a nota selecionada.')
    } finally {
      setLoading(false)
    }
  }

  async function loadBacklinks(relativePath: string, vaultPath: string) {
    // Consulta o indice em memoria (construido em segundo plano ao abrir o
    // Vault); so varre o disco quando o indice ainda nao esta pronto.
    const index = vaultIndexRef.current.getSnapshot()
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
      // Comando por-nota (sem varrer o vault): mesma semantica do levantamento
      // completo, já filtrado pela nota.
      const items = await invoke<BrokenLink[]>('get_note_broken_links', { path: vaultPath, relativePath })
      setBrokenLinks(items)
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
        ?? vaultIndexRef.current.entryTargets(notePath)
      if (graphWikilinkIndexRef.current) {
        graphWikilinkIndexRef.current = applyWikilinkEdit(
          graphWikilinkIndexRef.current,
          parsedNote.relativePath,
          parsedNote.content,
        )
      }
      // Mantem o indice do Vault em dia para backlinks/autocomplete e para a
      // sincronizacao das notas indexadoras (o grafo pode nunca ter sido aberto).
      vaultIndexRef.current.applyEdit(parsedNote.relativePath, parsedNote.content)
      // O cache de conteudos do module acompanha o salvamento.
      vaultIndexRef.current.updateDocumentContent(parsedNote.relativePath, parsedNote.content)
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
        errorMessage(caughtError, 'Não foi possível salvar a nota.')
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
    const index = graphWikilinkIndexRef.current ?? vaultIndexRef.current.getSnapshot()
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
      vaultIndexRef.current.applyEdit(path, synced)
      vaultIndexRef.current.updateDocumentContent(path, synced)
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
    const index = graphWikilinkIndexRef.current ?? vaultIndexRef.current.getSnapshot()
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
    const index = graphWikilinkIndexRef.current ?? vaultIndexRef.current.getSnapshot()
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
    // O rascunho mantido passa a se basear no disco atual (versão externa):
    // sem isso, reabrir a nota o trataria como fantasma e o purgaria.
    draftBaseByPathRef.current[externalNote.relativePath] = externalNote.content
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
      setError(errorMessage(caughtError, 'Não foi possível restaurar a nota.'))
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
      setError(errorMessage(caughtError, 'Não foi possível recuperar a nota.'))
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

  // Toolbar de formatacao (features/format): posicionada pela sessao do
  // editor; sem nota ou sem selecao, o componente nao renderiza nada.
  const format = useFormatToolbar({
    activeEditorSession,
    hasActiveNote: activeNote !== null,
    editorMode,
    setDraftContent,
    focusEditor: focusActiveEditor,
    editor: {
      getSelection: () => markdownCodeEditorRef.current?.getSelection() ?? null,
      getSelectionRect: () => markdownCodeEditorRef.current?.getSelectionRect() ?? null,
      editorContent: () => editorContentRef.current,
    },
  })
  const { applyMarkdownFormat, hideSelectionPopover } = format

  // Popover de formatacao: aparece nos modos com editor quando ha uma selecao
  // nao-colapsada (logica no hook); o blur e tratado abaixo (onBlur).

  const noteFindMatches = useMemo(
    () => (noteFindOpen ? findTextMatches(draftContent, noteFindQuery) : []),
    [noteFindOpen, noteFindQuery, draftContent],
  )
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
      // `postits` e gerenciado pelos pinos da margem esquerda (nao editavel
      // como texto YAML no painel — o texto do post-it pode conter quebras).
      .filter((key) => key.toLowerCase() !== 'postits')
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
      backlinks: backlinkEntries,
      // Links quebrados moram no painel (secao compacta com nomes curtos);
      // `brokenLinks` chega junto com a nota e ja vem filtrado por ela.
      brokenLinks: (brokenLinks ?? []).map((link) => ({
        target: link.target,
        displayName: displayWikilinkTargetName(link.target),
      })),
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
      // `postits` e propriedade gerenciada pelos post-its (nao e linha do
      // painel): NUNCA sai por aqui, senao salvar o painel apagaria os
      // post-its da nota.
      if (key.toLowerCase() === 'postits') continue
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

  // --- Post-its: logica em features/postits/usePostitPopover (hook). ---

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
      setError(errorMessage(caughtError, 'Não foi possível anexar o arquivo.'))
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
    let targetPath = existingPath ?? resolvedPath
    if (!existingPath && !relativePath.includes('/') && !relativePath.includes('\\') && sourcePath.includes('/')) {
      // `[[nome]]` sem pasta, criado a partir de uma nota dentro de pasta
      // (ex.: meta): nasce na mesma pasta da nota de origem, nao na raiz.
      // Com pasta explicita (`[[nova/página]]`) o caminho pedido e respeitado.
      const sourceFolder = sourcePath.split('/').slice(0, -1).join('/')
      targetPath = `${sourceFolder}/${targetPath}`
    }

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
        setError(errorMessage(caughtError, 'Não foi possível criar a nota vinculada.'))
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
        setStatus(`Conexão criada: ${sourceLabel} -> ${targetPath}`)
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
      setStatus(`Conexão criada: ${sourceLabel} -> ${targetPath}`)
    } catch (caughtError) {
      const message =
        errorMessage(caughtError, 'Não foi possível criar a conexão.')
      setError(message)
        setStatus('Falha ao criar a conexão.')
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
      ?? vaultIndexRef.current.entryTargets(relativePath)
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
    vaultIndexRef.current.applyEdit(relativePath, content)
    vaultIndexRef.current.updateDocumentContent(relativePath, content)
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
                    {depth === 0 && node.path === 'Metas' ? (
                      <>
                        <RiFocus2Line className="tree-icon tree-icon--folder-closed" size={14} aria-hidden="true" />
                        <RiFocus2Fill className="tree-icon tree-icon--folder-open" size={14} aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        <Folder className="tree-icon tree-icon--folder-closed" size={14} strokeWidth={1.5} aria-hidden="true" />
                        <FolderOpen className="tree-icon tree-icon--folder-open" size={14} strokeWidth={1.5} aria-hidden="true" />
                      </>
                    )}
                    <span className="tree-item-label">{node.name}</span>
                  </summary>
                  {node.children?.length ? renderTree(node.children, depth + 1) : null}
                </details>
              </div>
            ) : (
              <div className="tree-item-row">
                <Button
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
                  <span className="tree-icon tree-icon--note" aria-hidden="true"><HugeiconsIcon icon={File02Icon} size={14} strokeWidth={1.5} /></span>
                  <span className="tree-item-label">{node.name.replace(/\.md$/i, '')}</span>
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    )
  }

  // Derivacoes caras do render (arvore, grafo, autocomplete, listas):
  // memoizadas para a digitacao nao reconstruir estruturas do vault a cada
  // tecla. Tudo aqui e derivacao pura das deps — refs mutaveis sao lidas
  // fora (snapshot/backlinks) para nao congelar, e o `if (vault)` abaixo so
  // consome (com guards para vault nulo).
  const hasSelectedTags = selectedTags.length > 0
  const filteredNotes = useMemo(() => {
    if (!vault) return []
    if (!hasSelectedTags) return notes
    return notes.filter((note) => selectedTags.every((tag) => tagIndex.find((entry) => entry.tag === tag)?.notePaths.includes(note.relativePath)))
  }, [vault, notes, hasSelectedTags, selectedTags, tagIndex])
  const visibleFolders = useMemo(() => {
    if (!vault) return []
    if (!hasSelectedTags) return folders
    return folders.filter((folder) => filteredNotes.some((note) => note.relativePath.startsWith(`${folder}/`)))
  }, [vault, folders, hasSelectedTags, filteredNotes])
  const noteTree = useMemo(() => buildNoteTree(filteredNotes, visibleFolders), [filteredNotes, visibleFolders])
  const linkableNotes = useMemo(() => {
    if (!vault) return []
    const activePath = activeNote?.relativePath
    const query = noteLinkQuery.trim().toLowerCase()
    return notes.filter((note) => note.relativePath !== activePath && note.relativePath.toLowerCase().includes(query))
  }, [vault, notes, activeNote, noteLinkQuery])
  const compatibilityNotes = useMemo(
    () => detectUnsupportedMarkdownFeatures(draftContent).map((feature) => COMPATIBILITY_NOTES[feature] ?? feature),
    [draftContent],
  )
  const activeNotePaths = useMemo(() => notes.map((note) => note.relativePath), [notes])
  const tagKeys = useMemo(() => tagIndex.map((entry) => entry.tag), [tagIndex])
  const vaultSnapshot = vaultIndexRef.current.getSnapshot()
  const graphBacklinks = graphWikilinkIndex?.backlinks ?? null
  // Notas conectadas para ranquear o autocomplete: derivacao pura no lib
  // (alvos do rascunho + backlinks do indice, com fallback para o grafo).
  const markdownAutocompleteData = useMemo(() => resolveMarkdownAutocompleteData({
    notePaths: activeNotePaths,
    activeNotePath: activeNote?.relativePath ?? null,
    isNewNoteDraft,
    draftContent,
    attachments,
    tags: tagKeys,
    vaultBacklinks: vaultSnapshot?.backlinks ?? null,
    graphBacklinks,
  }), [activeNotePaths, activeNote, isNewNoteDraft, draftContent, attachments, tagKeys, vaultSnapshot, graphBacklinks])
  const favoriteNotes = useMemo(() => {
    if (!vault) return []
    return notes.filter((note) => favorites.includes(note.relativePath))
  }, [vault, notes, favorites])
  const matchingTagSuggestions = useMemo(() => {
    if (!vault) return []
    const query = tagFilterQuery.trim().replace(/^#/, '').toLowerCase()
    return tagIndex.filter((entry) => !selectedTags.includes(entry.tag) && entry.tag.includes(query))
  }, [vault, tagIndex, selectedTags, tagFilterQuery])
  const allGraphLinks = useMemo(() => {
    if (!vault) return []
    return graphWikilinkIndex
      ? buildNoteGraphLinksFromIndex(graphWikilinkIndex, graphDocuments)
      : buildNoteGraphLinks(graphDocuments, activeNotePaths)
  }, [vault, graphWikilinkIndex, graphDocuments, activeNotePaths])
  const allGraphDegreeByPath = useMemo(() => allGraphLinks.reduce<Record<string, number>>((degrees, link) => {
    degrees[link.source] = (degrees[link.source] ?? 0) + 1
    degrees[link.target] = (degrees[link.target] ?? 0) + 1
    return degrees
  }, {}), [allGraphLinks])
  const orphanGraphDocuments = useMemo(() => {
    if (!vault) return []
    return graphDocuments.filter((document) => (allGraphDegreeByPath[document.relativePath] ?? 0) === 0)
  }, [vault, graphDocuments, allGraphDegreeByPath])
  // Adjacência (ida e volta) e índice por caminho: BFS, vizinhos do hover e
  // chips do drawer saem de O(1) em vez de varrer todos os links/notas.
  const graphAdjacency = useMemo(() => {
    const adjacency = new Map<string, Set<string>>()
    const link = (from: string, to: string) => {
      let neighbors = adjacency.get(from)
      if (!neighbors) {
        neighbors = new Set<string>()
        adjacency.set(from, neighbors)
      }
      neighbors.add(to)
    }
    for (const { source, target } of allGraphLinks) {
      link(source, target)
      link(target, source)
    }
    return adjacency
  }, [allGraphLinks])
  const graphDocByPath = useMemo(
    () => new Map(graphDocuments.map((document) => [document.relativePath, document] as const)),
    [graphDocuments],
  )
  const localGraphCenterPath = focusedGraphPath ?? activeNote?.relativePath ?? null
  // Grafo local por profundidade: BFS a partir do centro ate `graphLocalDepth`
  // saltos; `localGraphBeyond` sao as notas alcancaveis alem dessa profundidade
  // (usadas no aviso de resultado limitado).
  const { localGraphReached, localGraphBeyond } = useMemo(() => {
    const reached = new Set<string>()
    const beyond = new Set<string>()
    if (!vault || !localGraphCenterPath) return { localGraphReached: reached, localGraphBeyond: beyond }
    reached.add(localGraphCenterPath)
    let frontier = [localGraphCenterPath]
    for (let hop = 1; hop <= graphLocalDepth; hop += 1) {
      const nextLevel = new Set<string>()
      for (const node of frontier) {
        for (const neighbor of graphAdjacency.get(node) ?? []) {
          if (!reached.has(neighbor)) nextLevel.add(neighbor)
        }
      }
      for (const path of nextLevel) reached.add(path)
      frontier = [...nextLevel]
    }
    for (const node of frontier) {
      for (const neighbor of graphAdjacency.get(node) ?? []) {
        if (!reached.has(neighbor)) beyond.add(neighbor)
      }
    }
    return { localGraphReached: reached, localGraphBeyond: beyond }
  }, [vault, localGraphCenterPath, graphLocalDepth, allGraphLinks, graphAdjacency])
  const localGraphPaths = localGraphReached
  const graphFolders = useMemo(() => {
    if (!vault) return []
    return [...new Set(graphDocuments.map((document) => document.relativePath.split('/').slice(0, -1).join('/')).filter(Boolean))].sort()
  }, [vault, graphDocuments])
  const focusedGraphDocument = useMemo(() => {
    if (!vault) return null
    return graphDocuments.find((document) => document.relativePath === focusedGraphPath) ?? null
  }, [vault, graphDocuments, focusedGraphPath])
  // Notas candidatas a nova conexao no grafo: exclui a propria nota de origem
  // e as que ja sao alvo de uma saida existente (pelo indice em memoria). A
  // origem pode ser o no focado (drawer) ou uma nota orfa (painel de limpeza).
  const graphConnectNotes = useMemo(() => {
    if (!vault || !graphConnectSource) return []
    const indexTargets = graphWikilinkIndex
      ? new Set(getWikilinkTargets(graphWikilinkIndex, graphConnectSource.relativePath))
      : new Set<string>()
    return notes.filter((note) =>
      note.relativePath !== graphConnectSource.relativePath
      && !indexTargets.has(note.relativePath)
      && note.relativePath.toLowerCase().includes(graphConnectQuery.trim().toLowerCase()),
    )
  }, [vault, notes, graphConnectSource, graphConnectQuery, graphWikilinkIndex])
  const focusedIncomingLinks = useMemo(
    () => (focusedGraphPath ? allGraphLinks.filter((link) => link.target === focusedGraphPath) : []),
    [focusedGraphPath, allGraphLinks],
  )
  const focusedOutgoingLinks = useMemo(
    () => (focusedGraphPath ? allGraphLinks.filter((link) => link.source === focusedGraphPath) : []),
    [focusedGraphPath, allGraphLinks],
  )
  // Notas que referenciam a selecionada (para os chips clicaveis no drawer).
  const focusedIncomingNotes = useMemo(() => focusedIncomingLinks
    .map((link) => graphDocByPath.get(link.source))
    .filter((document): document is GraphDocument => document !== undefined)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  [focusedIncomingLinks, graphDocByPath])
  const visibleGraphDocuments = useMemo(() => {
    if (!vault) return []
    return graphDocuments.filter((document) => {
      const title = document.name.replace(/\.md$/i, '').toLowerCase()
      const matchesQuery = !graphQuery.trim() || title.includes(graphQuery.trim().toLowerCase())
      // Pasta/tag NÃO excluem nós (highlight sem reset de layout) — só a
      // busca por nome filtra aqui; o resto é esmaecido no render.
      const isOrphan = (allGraphDegreeByPath[document.relativePath] ?? 0) === 0
      return matchesQuery && (graphMode === 'global' || localGraphPaths.has(document.relativePath)) && (showOnlyGraphOrphans ? isOrphan : showGraphOrphans || !isOrphan)
    })
  }, [vault, graphDocuments, graphQuery, graphMode, localGraphPaths, showOnlyGraphOrphans, showGraphOrphans, allGraphDegreeByPath])
  const visibleGraphPaths = useMemo(
    () => new Set(visibleGraphDocuments.map((document) => document.relativePath)),
    [visibleGraphDocuments],
  )
  // Derivação pesada do grafo memoizada FORA do `if (vault)` (hooks não
  // podem viver no ramo condicional): só recalcula quando docs, links ou
  // filtros mudam — nunca por tecla digitada. Posições/culling/centros
  // ficam no render porque leem refs vivas da física a cada frame.
  // (Adjacência e índice por caminho moram junto aos memos acima, antes
  // do BFS que os consome.)
  const graphFilterActive = graphFolder !== '' || graphTag !== ''
  const graphFilterMatchPaths: Set<string> | null = useMemo(() => {
    if (!vault || !graphFilterActive) return null
    return new Set(
      graphDocuments
        .filter((document) => (!graphFolder || document.relativePath.startsWith(`${graphFolder}/`))
          && (!graphTag || graphTagIndex.tagsOf(document.relativePath).includes(graphTag)))
        .map((document) => document.relativePath),
    )
  }, [vault, graphFilterActive, graphDocuments, graphFolder, graphTag])
  const graphDimmedPaths: Set<string> | null = useMemo(() => {
    if (!vault || graphFilterMatchPaths === null) return null
    return new Set(
      graphDocuments
        .map((document) => document.relativePath)
        .filter((path) => !graphFilterMatchPaths.has(path)),
    )
  }, [vault, graphFilterMatchPaths, graphDocuments])
  const graphLinks = useMemo(
    () => allGraphLinks.filter((link) => visibleGraphPaths.has(link.source) && visibleGraphPaths.has(link.target)),
    [allGraphLinks, visibleGraphPaths],
  )
  const graphDegreeByPath = useMemo(() => graphLinks.reduce<Record<string, number>>((degrees, link) => {
    degrees[link.source] = (degrees[link.source] ?? 0) + 1
    degrees[link.target] = (degrees[link.target] ?? 0) + 1
    return degrees
  }, {}), [graphLinks])
  const graphHoverNeighbors = useMemo(() => {
    if (graphHoverPath === null) return null
    const neighbors = new Set([graphHoverPath])
    for (const neighbor of graphAdjacency.get(graphHoverPath) ?? []) neighbors.add(neighbor)
    return neighbors
  }, [graphHoverPath, graphAdjacency])
  // Tipo de agrupamento ativo: pasta tem prioridade sobre tag.
  const graphGroupingKind: 'folder' | 'tag' | null = graphGroupByFolder
    ? 'folder'
    : graphGroupByTag
      ? 'tag'
      : null
  // Mapas de grupos (pasta ou tag) para legenda, cores e exportacao
  // (somente com o agrupamento ativo; null economiza o calculo no uso diario).
  const graphGroupMaps = useMemo(() => {
    if (!vault || !graphGroupingKind) return null
    return buildGroupMaps(graphDocuments, {
      kind: graphGroupingKind,
      tagsOfPath: (path) => graphTagIndexRef.current.tagsOf(path),
      primaryTag: graphPrimaryTag || undefined,
      colorOverrides: graphColorOverrides,
    })
  }, [vault, graphGroupingKind, graphDocuments, graphPrimaryTag, graphColorOverrides])
  const graphExportLegend = useMemo(() => graphGroupMaps
    ? graphGroupMaps.groups.map((group) => ({ label: group.label, color: group.color }))
    : [], [graphGroupMaps])

  if (vault) {
    const graphTags = graphTagIndex.allTags()
    // Highlight do filtro pasta/tag: conjunto dos que casam (null = sem
    // filtro). 2D usa `is-dimmed`, 3D recebe `dimmedPaths`; o layout e a
    // simulação nunca mudam por causa dele. Sem useMemo aqui: este bloco
    // roda num ramo condicional da página do grafo (hooks quebrariam).
    // A estabilidade para o 3D é garantida por chave de conteúdo lá dentro.
    // (Filtros, links, graus e vizinhos vêm dos memos acima do `if`.)
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
      // Nós destacados pelo filtro nunca são cortados pelo culling.
      priorityPaths: focusedGraphPath || graphHoverPath || graphFilterMatchPaths
        ? new Set([...(focusedGraphPath ? [focusedGraphPath] : []), ...(graphHoverNeighbors ?? []), ...(graphFilterMatchPaths ?? [])])
        : undefined,
    })
    const graphRenderedPaths = new Set(renderedGraphDocuments.map((document) => document.relativePath))
    const graphIsSummarized = renderedGraphDocuments.length < visibleGraphDocuments.length
    // Centros dos grupos (pasta ou tag) para a mola da fisica 2D: atualizado
    // no render com o conjunto visivel atual; a fisica le em
    // graphGroupCentersRef. (Tipo, mapas e legenda vêm dos memos acima.)
    graphGroupCentersRef.current = graphGroupingKind && !graphMode3d
      ? buildGraph2dGroupCentersForGroups(buildGraphGroups(visibleGraphDocuments, {
          kind: graphGroupingKind,
          tagsOfPath: (path) => graphTagIndexRef.current.tagsOf(path),
          primaryTag: graphPrimaryTag || undefined,
        }))
      : null

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
      { id: 'goals', label: 'Abrir metas', description: 'Vai para a página de Metas de aprendizado.' },
      { id: 'favorite', label: favorites.includes(activeNote?.relativePath ?? '') ? 'Remover dos favoritos' : 'Adicionar aos favoritos', description: 'Fixa ou remove a nota atual.', disabled: !activeNote || isNewNoteDraft },
      { id: 'undo', label: 'Desfazer', description: 'Reverte a última alteração da nota ou do vault.', disabled: !canUndoActiveEditor },
      { id: 'redo', label: 'Refazer', description: 'Refaz a última alteração da nota ou do vault.', disabled: !canRedoActiveEditor },
      { id: 'settings', label: 'Abrir configurações', description: 'Vai para as configurações do workspace.' },
      { id: 'shortcuts', label: 'Configurar atalhos', description: 'Abre Configurações na seção Atalhos.' },
      { id: 'goals', label: 'Ir para metas', description: 'Abre a página de metas de aprendizado.' },
    ]
    const matchingCommands = paletteCommands.filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(commandQuery.trim().toLowerCase()))
    const moveDestinationOptions = ['', ...folders].filter((folder) =>
      !moveTarget || moveTarget.type === 'note' || (folder !== moveTarget.path && !folder.startsWith(`${moveTarget.path}/`)),
    )

    /** Acoes do cabecalho por chave, icon-only (icone + tooltip): o mesmo
     * elemento rende inline ou no menu "Mais acoes". Chamada de funcao, nao
     * componente — mover de lugar nao remonta. Retorna null em rascunho de
     * nota nova (sem acoes de nota existente). */
    function renderHeaderAction(key: HeaderActionKey) {
      if (isNewNoteDraft || !activeNote || !vault) return null
      switch (key) {
        case 'favorite':
          return (
            <Button key={key} type="button" className={`ui-button ui-button--secondary ui-button--sm favorite-button${favorites.includes(activeNote.relativePath) ? ' is-active' : ''}`} onClick={() => void toggleActiveFavorite()} title="Fixar nota" aria-label="Fixar nota"><Star size={15} fill={favorites.includes(activeNote.relativePath) ? 'currentColor' : 'none'} aria-hidden="true" /></Button>
          )
        case 'indexadora':
          return (
            <Button
              key={key}
              type="button"
              className={`ui-button ui-button--secondary ui-button--sm indexadora-button${isIndexadora(activeNote.content) ? ' is-active' : ''}`}
              onClick={() => void toggleActiveNoteIndexadora()}
              disabled={saving || loading}
              title={isIndexadora(activeNote.content) ? 'Nota indexadora: remove a lista automatica de referencias' : 'Declarar como nota indexadora: lista automaticamente as notas que referenciam esta nota'}
              aria-label="Declarar nota como indexadora"
              aria-pressed={isIndexadora(activeNote.content)}
            >
              <BookMarked size={15} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          )
        case 'review':
          return (
            <Popover key={key} open={reviewMenuOpen} onOpenChange={(open) => {
              setReviewMenuOpen(open)
              if (!open) setReviewReportOpen(false)
            }}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm note-review-menu-trigger"
                  aria-label="Avaliação e revisão da nota"
                  title="Avaliação e revisão da nota"
                >
                  <span className={`note-review-status-dot is-${noteReadiness ?? 'none'}`} aria-hidden="true" />
                  <ClipboardList size={15} strokeWidth={1.5} aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="note-review-menu">
                {auditReportOpen ? (
                  <NoteStructureReport
                    audit={structuralAudit}
                    loading={structuralAuditLoading}
                    error={structuralAuditError}
                    appliedIndex={structuralAuditAppliedIndex}
                    onBack={() => setAuditReportOpen(false)}
                    onRetry={() => void runStructuralAudit()}
                    onApply={handleApplyStructuralAuditEdit}
                  />
                ) : (
                <NoteReadinessControl
                  vaultPath={vault.path}
                  relativePath={activeNote.relativePath}
                  sourceRevision={activeNote.content}
                  isDirty={isDirty}
                  disabled={loading || saving}
                  noteTags={noteTags}
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
                  onAuditStructure={openAuditReport}
                  adjustments={reviewReportOpen ? null : (
                    <>
                      <NoteReviewPolicyControl
                        vaultPath={vault.path}
                        relativePath={activeNote.relativePath}
                        sourceRevision={activeNote.content}
                        isDirty={isDirty}
                        disabled={loading || saving}
                      />
                    </>
                  )}
                />
                )}
              </PopoverContent>
            </Popover>
          )
        case 'factcheck':
          return (
            <Popover key={key} open={factCheckOpen} onOpenChange={(open) => {
              setFactCheckOpen(open)
              if (open && factCheck === null && factCheckError === null) void runFactCheck()
            }}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm structural-audit-trigger"
                  aria-label="Verificar fatos da nota"
                  title="Verificação factual opcional — compara as afirmações com conhecimento externo, sem alterar a nota nem as pontuações"
                >
                  <CheckCircle2 size={15} strokeWidth={1.5} aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="structural-audit-scope fact-check-panel">
                <header className="structural-audit-header">
                  <strong>Verificação factual</strong>
                  <small>Compara as afirmações da nota com conhecimento externo — não altera a nota nem as revisões.</small>
                </header>
                {factCheckLoading ? (
                  <div className="structural-audit-state">Verificando os fatos…</div>
                ) : factCheckError ? (
                  <div className="structural-audit-state is-error">
                    <span>{factCheckError}</span>
                    <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void runFactCheck()}>Tentar novamente</Button>
                  </div>
                ) : factCheck === null ? (
                    <div className="structural-audit-state">Preparando a verificação…</div>
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
          )
        default:
          return null
      }
    }

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
        data-pages-width={isPagesFullWidth ? 'full' : 'spaced'}
      >
        <TitleBar>
          {workspacePage === 'notes' ? (
            <TabStrip
              openTabs={openTabs}
              notes={notes}
              activeNotePath={activeNote?.relativePath ?? null}
              openNote={openNote}
              closeTab={closeTab}
              loading={loading}
              saving={saving}
              startNewNote={startNewNote}
            />
          ) : null}
        </TitleBar>
        <a className="skip-link" href="#workspace-content">Pular para o conteúdo da nota</a>
        <WorkspaceRail
          isSidebarExpanded={isSidebarExpanded}
          setSidebarExpanded={setSidebarExpanded}
          workspacePage={workspacePage}
          setWorkspacePage={setWorkspacePage}
          openTagManagementPage={openTagManagementPage}
          openGraphPage={openGraphPage}
          openTrashPage={openTrashPage}
        />
        <WorkspaceTopbar
          vault={vault}
          initializeMetadata={initializeMetadata}
          loading={loading}
          saving={saving}
          chooseExistingVault={chooseExistingVault}
          error={error}
        />

        <section className="workspace-grid">
          <ExplorerSidebar
            overview={{ vault, totalNoteCount: notes.length }}
            tree={{ favoriteNotes, noteTree, renderTree, dropFolderPath }}
            tagFilter={{
              selectedTags,
              setSelectedTags,
              tagFilterQuery,
              setTagFilterQuery,
              showTagFilterDropdown,
              setShowTagFilterDropdown,
              matchingTagSuggestions,
              tagFilterDropdownRef,
            }}
            notices={{
              specialFiles,
              specialFilesTruncated,
              setShowSpecialFilesDialog,
              syncConflictCopies,
              setShowSyncConflicts,
              vaultDiagnostics,
              diagnosticsDismissed,
              setDiagnosticsDismissed,
            }}
            footer={{ loading, saving, chooseExistingVault, refreshNotes }}
            actions={{ startNewNote, openNote, retryVaultDiagnostics, setShowFolderDialog, setStatus }}
          />

          <section id="workspace-content" className="editor-surface" role="region" aria-label="Conteúdo do workspace" tabIndex={-1} data-builder-name="workspace-content-panel">
            {workspacePage === 'notes' ? (
              <>
            {activeNote ? (
              <>
                <EditorHeader
                  title={{
                    activeNoteName: activeNote.name.replace(/\.md$/i, ''),
                    isNewNoteDraft,
                    createNoteForm,
                    setCreateNoteForm,
                    saveActiveNote,
                    saving,
                    loading,
                    templates,
                    selectedTemplateId,
                    applyTemplate,
                    isInlineTitleEditing,
                    setInlineTitleEditing,
                    inlineTitle,
                    setInlineTitle,
                    renameActiveNoteFromTitle,
                    startInlineTitleRename,
                  }}
                  tags={{
                    noteTags,
                    tagIndex,
                    applyExistingTag,
                    removeTag,
                  }}
                  postits={postits}
                  showPostitOrphans={showPostitOrphans}
                  setShowPostitOrphans={setShowPostitOrphans}
                  history={{
                    actionsRef: headerActionsRef,
                    preserveSelection: preserveEditorSelection,
                    undo: undoLastCommand,
                    redo: redoLastCommand,
                    canUndo: canUndoActiveEditor,
                    canRedo: canRedoActiveEditor,
                  }}
                  isAutoSaveEnabled={isAutoSaveEnabled}
                  autoSaveState={autoSaveState}
                  hiddenActions={hiddenActions}
                  renderHeaderAction={renderHeaderAction}
                  modes={{
                    editorMode,
                    changeMode: changeEditorMode,
                    reviewGaps,
                    reviewUnits,
                    reviewGapMode,
                    setReviewGapMode,
                    openNoteFind,
                    markdownToolsOpen: isMarkdownToolsOpen,
                    setMarkdownToolsOpen,
                  }}
                  frontmatter={{
                    panelOpen: frontmatterPanelOpen,
                    setPanelOpen: setFrontmatterPanelOpen,
                    getData: getFrontmatterPanelData,
                    compatibilityNotes,
                    applyPanel: applyFrontmatterPanel,
                    openNote,
                  }}
                />

                <EditorContent
                  note={{
                    name: activeNote.name.replace(/\.md$/i, ''),
                    path: activeNote.relativePath,
                  }}
                  editorContentRef={editorContentRef}
                  find={{
                    open: noteFindOpen,
                    inputRef: noteFindInputRef,
                    query: noteFindQuery,
                    setQuery: setNoteFindQuery,
                    navigate: navigateNoteFind,
                    close: closeNoteFind,
                    index: noteFindIndex,
                    total: findTotal,
                  }}
                  engines={{
                    mode: editorMode,
                    codeEditorRef: markdownCodeEditorRef,
                    historyLimit,
                    spellCheck: isSpellCheckEnabled,
                    stateCacheRef: markdownEditorStateCacheRef,
                    autocompleteData: markdownAutocompleteData,
                    hideSelectionPopover,
                    openNoteFind,
                    draftContent,
                    setDraftContent,
                    setHistoryStatus: setMarkdownHistoryStatus,
                    sessionsByPath: editorSessionsByPath,
                    setSessionsByPath: setEditorSessionsByPath,
                    panelRef: editorPanelRef,
                    reviewGapData,
                    reviewGapMode,
                    readingStyle,
                    handleMixedOpenLink,
                    resolveMixedAssetUrl,
                    resolveMixedEmbedBody,
                    vaultPath: vault?.path,
                    noteBody,
                    lineWrap: isReadingLineWrapEnabled,
                    getActiveSelection: getActiveEditorSelection,
                  }}
                  format={format}
                  postits={postits}
                  noteWordCount={noteWordCount}
                  tools={{
                    open: isMarkdownToolsOpen,
                    toolsRef: markdownToolsRef,
                    orientation: markdownToolsOrientation,
                    position: markdownToolsPosition,
                    startDrag: startMarkdownToolsDrag,
                    toggleOrientation: toggleMarkdownToolsOrientation,
                    preserveSelection: preserveEditorSelection,
                    selectTool: selectMarkdownTool,
                    applyTableAction: applyMarkdownTableAction,
                    insertAttachment,
                    setShowNoteLinkDialog,
                    setShowTagDialog,
                  }}
                />
              </>
            ) : (
              <div className="editor-empty-state">
                <p className="card-kicker">Workspace pronto</p>
                <h2>Escolha uma nota ou crie a primeira.</h2>
                <p>
                  Assim que uma nota for aberta, esta área vira o editor principal do vault com
                  salvamento direto em <code>.md</code>.
                </p>
              </div>
            )}
              </>
            ) : workspacePage === 'review' || workspacePage === 'dashboard' || workspacePage === 'reports' || workspacePage === 'tags' || workspacePage === 'bases' || workspacePage === 'goals' ? (
              <Suspense fallback={<PageSkeleton variant={workspacePage} />}>
                {workspacePage === 'goals' ? (
                  <GoalsPage
                    vaultPath={vault.path}
                    onOpenNote={openNoteInWorkspace}
                  />
                ) : workspacePage === 'review' ? (
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
                      onOpenNote={openNoteInWorkspace}
                      onBrowseNotes={() => setWorkspacePage('notes')}
                    />
                  )
                ) : workspacePage === 'dashboard' ? (
                  <ReviewDashboardPage
                    vaultPath={vault.path}
                    onOpenNote={openNoteInWorkspace}
                    onStartReview={(item) => void handleStartReviewFromDeadline(item)}
                  />
                ) : workspacePage === 'reports' ? (
                  <ReviewReportsPage
                    vaultPath={vault.path}
                    onOpenNote={openNoteInWorkspace}
                  />
                ) : workspacePage === 'bases' ? (
                  <BasesPage
                    vaultPath={vault.path}
                    notePreviews={notes}
                    onOpenNote={openNoteInWorkspace}
                  />
                ) : (
                  <TagManagementPage
                    vaultPath={vault.path}
                    onTagsChanged={synchronizeTagChanges}
                  />
                )}
              </Suspense>
            ) : workspacePage === 'graph' ? (
              <GraphPage
                graph={graph}
                documents={{
                  totalNoteCount: notes.length,
                  all: graphDocuments,
                  visible: visibleGraphDocuments,
                  rendered: renderedGraphDocuments,
                  orphans: orphanGraphDocuments,
                }}
                topology={{
                  links: graphLinks,
                  degreeByPath: graphDegreeByPath,
                  positions: graphNodePositions,
                  renderedPaths: graphRenderedPaths,
                  dimmedPaths: graphDimmedPaths,
                  hoverNeighbors: graphHoverNeighbors,
                }}
                filters={{
                  folders: graphFolders,
                  tags: graphTags,
                  active: graphFilterActive,
                  matchPaths: graphFilterMatchPaths,
                  groupingKind: graphGroupingKind,
                  groupMaps: graphGroupMaps,
                  summarized: graphIsSummarized,
                  mode: graphMode,
                  setMode: setGraphMode,
                  localDepth: graphLocalDepth,
                  setLocalDepth: setGraphLocalDepth,
                  folder: graphFolder,
                  setFolder: setGraphFolder,
                  tag: graphTag,
                  setTag: setGraphTag,
                  query: graphQuery,
                  setQuery: setGraphQuery,
                  hideAllNames: graphHideAllNames,
                  setHideAllNames: setGraphHideAllNames,
                  groupByFolder: graphGroupByFolder,
                  setGroupByFolder: setGraphGroupByFolder,
                  groupByTag: graphGroupByTag,
                  setGroupByTag: setGraphGroupByTag,
                  primaryTag: graphPrimaryTag,
                  setPrimaryTag: setGraphPrimaryTag,
                  colorOverrides: graphColorOverrides,
                  setColorOverrides: setGraphColorOverrides,
                  showOrphans: showGraphOrphans,
                  setShowOrphans: setShowGraphOrphans,
                  showOnlyOrphans: showOnlyGraphOrphans,
                  setShowOnlyOrphans: setShowOnlyGraphOrphans,
                }}
                view={{
                  loading: isGraphLoading,
                  loadProgress: graphLoadProgress,
                  uiVisible: graphUiVisible,
                  setUiVisible: setGraphUiVisible,
                  settingsOpen: graphSettingsOpen,
                  setSettingsOpenSynced: setGraphSettingsOpenSynced,
                  exportOpen: graphExportOpen,
                  setExportOpen: setGraphExportOpen,
                  exportScale: graphExportScale,
                  setExportScale: setGraphExportScale,
                  exportRequest: graphExportRequest,
                  layoutVersion: graph3dLayoutVersion,
                  mode3d: graphMode3d,
                  setMode3d: setGraphMode3d,
                  viewport: graphViewport,
                  setViewport: setGraphViewport,
                }}
                selection={{
                  focusedPath: focusedGraphPath,
                  setFocusedPath: setFocusedGraphPath,
                  focusedDocument: focusedGraphDocument,
                  incomingLinks: focusedIncomingLinks,
                  outgoingLinks: focusedOutgoingLinks,
                  incomingNotes: focusedIncomingNotes,
                  detailOpen: graphDetailOpen,
                  setDetailOpen: setGraphDetailOpen,
                  hoverPath: graphHoverPath,
                  setHoverPath: setGraphHoverPath,
                  localBeyond: localGraphBeyond,
                  localCenterPath: localGraphCenterPath,
                  activeNotePath: activeNote?.relativePath ?? null,
                }}
                refs={{
                  surfaceRef: graphSurfaceRef,
                  panRef: graphPanRef,
                  nodeDragRef: graphNodeDragRef,
                  skipNodeClickRef: graphSkipNodeClickRef,
                  physicsRef: graphPhysicsRef,
                  physicsFrameRef: graphPhysicsFrameRef,
                  nodeElementsRef: graph2dNodeElementsRef,
                  linkElementsRef: graph2dLinkElementsRef,
                  uiHideTimerRef: graphUiHideTimerRef,
                  tagIndexRef: graphTagIndexRef,
                }}
                actions={{
                  updateNumberSetting,
                  poke: pokeGraphUi,
                  resetView: resetGraphView,
                  openPage: openGraphPage,
                  reset3d: resetGraph3dSettings,
                  handleExport: handleGraphExport,
                  handle3dExport: handleGraph3dExport,
                  startNodeDrag: startGraph2dNodeDrag,
                  finishNodeDrag: finishGraph2dNodeDrag,
                  kickPhysics: kickGraph2dPhysics,
                  revealInExplorer: revealNoteInExplorer,
                  copyWikiLink: copyGraphWikiLink,
                  openNote: openNoteInWorkspace,
                  setConnectQuery: setGraphConnectQuery,
                  setConnectSource: setGraphConnectSource,
                }}
              />
            ) : workspacePage === 'trash' ? (
              <TrashPage
                trashItems={trashItems}
                loading={loading}
                restoreTrashItem={restoreTrashItem}
                setPermanentDeleteTarget={setPermanentDeleteTarget}
              />
            ) : (
              <SettingsPage
                vaultPath={vault.path}
                obsidianAppearance={vault?.obsidianAppearance ?? null}
                appearance={appearance}
                graph={graph}
                reviewGapMode={reviewGapMode}
                setReviewGapMode={setReviewGapMode}
                notificationLastCheck={notificationLastCheck}
                onCheckReviewNotifications={handleCheckReviewNotifications}
                appVersion={appVersion}
                appUpdater={appUpdater}
                autoUpdateEnabled={autoUpdateEnabled}
                onToggleAutoUpdate={handleToggleAutoUpdate}
                updateNumberSetting={updateNumberSetting}
                activeSettingsSection={activeSettingsSection}
                onNavigateSettingsSection={scrollToSettingsSection}
                settingsScrollRef={settingsScrollRef}
                accountClient={isBillingEnabled() ? disabledSessionClient : null}
              />
            )}
          </section>
          </section>
        {explorerContextMenu ? (
          <ExplorerItemMenu
            menu={explorerContextMenu}
            favorites={favorites}
            onClose={() => setExplorerContextMenu(null)}
            onToggleFavorite={(relativePath) => void toggleNoteFavorite(relativePath)}
            onMoveFolder={(path, name) => startMove(path, name, 'folder')}
            onRename={(path, name, type) => startRename(path, name, type)}
            onDelete={(target) => requestDelete(target)}
          />
        ) : null}
        <SyncConflictsDialog
          open={showSyncConflicts}
          copies={syncConflictCopies}
          hasOriginal={(originalPath) => notes.some((note) => note.relativePath === originalPath)}
          onClose={() => setShowSyncConflicts(false)}
          onOpen={(relativePath) => {
            setShowSyncConflicts(false)
            void openNote(relativePath)
          }}
          onPromote={(copy) => promoteSyncConflictCopy(copy)}
          onDelete={(copy) => requestDelete({
            path: copy.relativePath,
            name: copy.relativePath.split('/').at(-1) ?? copy.relativePath,
            type: 'note',
          })}
        />
        {externalNoteConflict ? (
          <Modal
            open
            onClose={() => setExternalNoteConflict(null)}
            label="Alteração externa detectada"
            className="note-search-modal external-change-modal"
          >            <div className="move-item-heading">
                <strong>Alteração externa detectada</strong>
                <span>A nota <b>{externalNoteConflict.externalNote.name.replace(/\.md$/i, '')}</b> foi modificada fora do MirrorMind enquanto você tinha um rascunho local.</span>
              </div>
              <p>Escolha qual versão deve permanecer no editor. Nenhuma versão será sobrescrita automaticamente.</p>
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={loadExternalNoteVersion}>Carregar arquivo externo</Button>
                <button type="button" onClick={keepLocalNoteVersion}>Manter meu rascunho</button>
              </div>
          </Modal>
        ) : null}
        {externalRemovedNote ? (
          <Modal
            open
            onClose={() => setExternalRemovedNote(null)}
            label="Nota removida fora do MirrorMind"
            className="note-search-modal external-change-modal"
          >
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
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={closeExternallyRemovedNote} disabled={loading}>Fechar aba</Button>
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void saveExternallyRemovedNoteAsNew()} disabled={loading || !recoveredNotePath.trim()}>Salvar como nova</Button>
                <button type="button" onClick={() => void restoreExternallyRemovedNote()} disabled={loading}>Restaurar arquivo</button>
              </div>
          </Modal>
        ) : null}
        {showCommandPalette ? (
          <div className="note-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCommandPalette(false) }}>
            <section className="note-search-modal command-palette" role="dialog" aria-modal="true" aria-label="Command Palette">
              <input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setShowCommandPalette(false); if (event.key === 'Enter' && matchingCommands[0] && !matchingCommands[0].disabled) runPaletteCommand(matchingCommands[0]) }} placeholder="Digite um comando..." aria-label="Buscar comando" />
              <div className="command-palette-results">
                {matchingCommands.map((command) => <button key={command.id} type="button" disabled={command.disabled} onClick={() => runPaletteCommand(command)}><span>{command.label}</span><small>{command.description}</small></button>)}
                {matchingCommands.length === 0 ? <p>Nenhum comando encontrado.</p> : null}
              </div>
              <div className="folder-dialog-actions"><span className="command-palette-hint">Ctrl+K para abrir</span><Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setShowCommandPalette(false)}>Fechar</Button></div>
            </section>
          </div>
        ) : null}
        {showSpecialFilesDialog ? (
          <Modal
            open
            onClose={() => setShowSpecialFilesDialog(false)}
            label="Arquivos com compatibilidade limitada"
            className="note-search-modal special-files-modal"
          >
              <div className="move-item-heading">
                <strong>Arquivos preservados</strong>
                <span>Estes arquivos permanecem no Vault, mas ainda não podem ser visualizados ou editados aqui.</span>
                <Button autoFocus type="button" className="ui-button modal-close-button" onClick={() => setShowSpecialFilesDialog(false)} aria-label="Fechar arquivos especiais"><X size={15} aria-hidden="true" /></Button>
              </div>
              {specialFilesTruncated ? <p className="special-files-limit-notice" role="status">Mostrando os primeiros 500 arquivos. A coleta foi interrompida para manter o workspace responsivo.</p> : null}
              <div className="special-files-list">
                {specialFiles.map((file) => (
                  <article key={file.relativePath} className="special-file-row">
                    <div>
                      {(file.kind === 'canvas' || file.kind === 'excalidraw') ? (
                        <Button
                          type="button"
                          className="ui-button special-file-open-button"
                          onClick={() => void openSpecialFileViewer(file)}
                          aria-label={`Visualizar ${file.name}`}
                          title="Visualizar somente leitura"
                        >
                          {file.name}
                        </Button>
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
          </Modal>
        ) : null}
        {specialFileViewer ? (
          specialFileViewerContent !== null ? (
            <SpecialFileViewer
              file={specialFileViewer}
              content={specialFileViewerContent}
              onClose={() => setSpecialFileViewer(null)}
            />
          ) : specialFileViewerError !== null ? (
            <Modal
              open
              onClose={() => setSpecialFileViewer(null)}
              label={`Erro ao visualizar ${specialFileViewer.name}`}
              className="note-search-modal"
            >
                <div className="move-item-heading">
                  <strong>{specialFileViewer.name}</strong>
                  <span>Não foi possível ler o arquivo para visualização.</span>
                  <Button autoFocus type="button" className="ui-button modal-close-button" onClick={() => setSpecialFileViewer(null)} aria-label="Fechar erro de visualização"><X size={15} aria-hidden="true" /></Button>
                </div>
                <p className="field-error" role="alert">{specialFileViewerError}</p>
            </Modal>
          ) : (
            <Modal
              open
              onClose={() => setSpecialFileViewer(null)}
              label={`Lendo ${specialFileViewer.name}`}
              className="note-search-modal"
              dismissable={false}
            >
              <p className="special-files-limit-notice" role="status">Lendo o arquivo para visualização...</p>
            </Modal>
          )
        ) : null}
        {showNoteSearch ? (
          <Modal
            open
            onClose={() => setShowNoteSearch(false)}
            label="Abrir nota existente"
            className="note-search-modal"
          >
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
          </Modal>
        ) : null}
        {showTagFilterDialog ? (
          <Modal
            open
            onClose={() => setShowTagFilterDialog(false)}
            label="Filtrar notas por tags"
            className="note-search-modal tag-filter-modal"
          >
              <div className="move-item-heading">
                <strong>Filtrar por tags</strong>
                <span>As notas precisam conter todas as tags selecionadas.</span>
                <Button type="button" className="ui-button modal-close-button" onClick={() => setShowTagFilterDialog(false)} aria-label="Fechar filtro"><X size={15} aria-hidden="true" /></Button>
              </div>
              <div className="tag-filter" aria-label="Filtro de tags">
                <div className="tag-filter-selection">
                  {selectedTags.map((tag) => (
                    <Button key={tag} type="button" className="ui-button tag-filter-chip" onClick={() => setSelectedTags((tags) => tags.filter((item) => item !== tag))} title={`Remover #${tag}`}>
                      #{tag} <X size={11} strokeWidth={1.5} aria-hidden="true" />
                    </Button>
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
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => { setSelectedTags([]); setTagFilterQuery('') }}>Limpar</Button>
                <button type="button" onClick={() => setShowTagFilterDialog(false)}>Aplicar filtro</button>
              </div>
          </Modal>
        ) : null}
        {showNoteLinkDialog ? (
          <Modal
            open
            onClose={() => setShowNoteLinkDialog(false)}
            label="Inserir link para nota"
            className="note-search-modal"
          >
              <input autoFocus value={noteLinkQuery} onChange={(event) => setNoteLinkQuery(event.target.value)} placeholder="Buscar nota para vincular" aria-label="Buscar nota" />
              <div className="note-search-results">
                {linkableNotes.map((note) => (
                  <button key={note.relativePath} type="button" onClick={() => insertInternalLink(note)}>{note.relativePath.replace(/\.md$/i, '')}</button>
                ))}
                {linkableNotes.length === 0 ? <p>Nenhuma outra nota encontrada.</p> : null}
              </div>
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setShowNoteLinkDialog(false)}>Cancelar</Button>
              </div>
          </Modal>
        ) : null}
        {graphConnectSource ? createPortal(
          <div style={{ pointerEvents: 'auto' }}>
          <Modal
            open
            onClose={() => setGraphConnectSource(null)}
            label="Criar conexão no grafo"
            className="note-search-modal"
          >
              <input autoFocus value={graphConnectQuery} onChange={(event) => setGraphConnectQuery(event.target.value)} placeholder="Buscar nota para conectar" aria-label="Buscar nota para conectar" />
              <div className="note-search-results">
                {graphConnectNotes.map((note) => (
                  <button key={note.relativePath} type="button" onClick={() => void createGraphConnection(graphConnectSource, note)}>{note.relativePath.replace(/\.md$/i, '')}</button>
                ))}
                {graphConnectNotes.length === 0 ? <p>Nenhuma outra nota disponível para conectar.</p> : null}
              </div>
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setGraphConnectSource(null)}>Cancelar</Button>
              </div>
          </Modal>
          </div>,
          document.body,
        ) : null}
        {showTagDialog ? (
          <Modal
            open
            onClose={() => setShowTagDialog(false)}
            label="Inserir tag"
            className="note-search-modal"
          >
              <input autoFocus value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') insertTag() }} placeholder="Nome da tag" aria-label="Nome da tag" />
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setShowTagDialog(false)}>Cancelar</Button>
                <button type="button" onClick={insertTag} disabled={!tagName.trim()}>Inserir tag</button>
              </div>
          </Modal>
        ) : null}
        {showFolderDialog ? (
          <Modal
            open
            onClose={() => setShowFolderDialog(false)}
            label="Criar pasta"
            className="note-search-modal"
          >
              <input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createFolder() }} placeholder="Nome ou caminho da pasta" aria-label="Nome da pasta" />
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setShowFolderDialog(false)}>Cancelar</Button>
                <button type="button" onClick={() => void createFolder()} disabled={!folderName.trim() || loading}>Criar pasta</button>
              </div>
          </Modal>
        ) : null}
        {renameTarget ? (
          <Modal
            open
            onClose={() => setRenameTarget(null)}
            label={`Renomear ${renameTarget.type === 'note' ? 'nota' : 'pasta'}`}
            className="note-search-modal"
          >
              <input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameVaultItem() }} placeholder="Novo nome" aria-label="Novo nome" />
              {wikilinkIndexProgress ? (
                <p className="wikilink-index-progress" role="status">
                  Indexando wikilinks... ({wikilinkIndexProgress.processed} de {wikilinkIndexProgress.total} notas)
                  {!wikilinkIndexCancelled ? (
                    <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void cancelWikilinkIndexBuild()}>Cancelar</Button>
                  ) : (
                    <span className="wikilink-index-cancelled">Indexacao cancelada; usando varredura completa.</span>
                  )}
                </p>
              ) : null}
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setRenameTarget(null)}>Cancelar</Button>
                <button type="button" onClick={() => void renameVaultItem()} disabled={!renameName.trim() || loading}>Renomear</button>
              </div>
          </Modal>
        ) : null}
        {moveTarget ? (
          <Modal
            open
            onClose={() => setMoveTarget(null)}
            label={`Mover ${moveTarget.type === 'note' ? 'nota' : 'pasta'}`}
            className="note-search-modal move-item-modal"
          >
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
                    <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void cancelWikilinkIndexBuild()}>Cancelar</Button>
                  ) : (
                    <span className="wikilink-index-cancelled">Indexacao cancelada; usando varredura completa.</span>
                  )}
                </p>
              ) : null}
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setMoveTarget(null)}>Cancelar</Button>
                <button type="button" onClick={() => void moveVaultItem()} disabled={loading}>Mover</button>
              </div>
          </Modal>
        ) : null}
        {deleteTarget ? (
          <Modal
            open
            onClose={() => setDeleteTarget(null)}
            label={`Excluir ${deleteTarget.type === 'note' ? 'nota' : 'pasta'}`}
            className="note-search-modal delete-item-modal"
          >
              <div className="move-item-heading">
                <strong>Enviar para a lixeira?</strong>
                <span>{deleteTarget.type === 'folder' ? `A pasta "${deleteTarget.name}" e todo o seu conteudo serao movidos para a lixeira.` : `A nota "${deleteTarget.name.replace(/\.md$/i, '')}" será movida para a lixeira.`}</span>
              </div>
              <label className="delete-confirmation-preference">
                <input type="checkbox" checked={skipSoftDeleteConfirmation} onChange={(event) => setSkipSoftDeleteConfirmation(event.target.checked)} />
                Não mostrar esta confirmação novamente
              </label>
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
                <Button type="button" className="ui-button ui-button--danger ui-button--sm" onClick={() => void deleteVaultItem()} disabled={loading}>Mover para lixeira</Button>
              </div>
          </Modal>
        ) : null}
        {permanentDeleteTarget ? (
          <Modal
            open
            onClose={() => setPermanentDeleteTarget(null)}
            label="Excluir permanentemente da lixeira"
            className="note-search-modal delete-item-modal"
          >
              <div className="move-item-heading">
                <strong>Excluir permanentemente?</strong>
                <span>{permanentDeleteTarget.itemType === 'folder' ? `A pasta "${permanentDeleteTarget.originalRelativePath}" e todo o seu conteudo serao removidos definitivamente.` : `A nota "${permanentDeleteTarget.originalRelativePath.replace(/\.md$/i, '')}" será removida definitivamente e nao podera ser restaurada.`}</span>
              </div>
              <div className="folder-dialog-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setPermanentDeleteTarget(null)}>Cancelar</Button>
                <Button type="button" className="ui-button ui-button--danger ui-button--sm" onClick={() => void permanentlyDeleteTrashItem()} disabled={loading}>Excluir permanentemente</Button>
              </div>
          </Modal>
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
    <VaultSelection
      loading={loading}
      status={status}
      error={error}
      chooseExistingVault={chooseExistingVault}
      chooseVaultParent={chooseVaultParent}
      createVault={createVault}
      createForm={createForm}
      setCreateForm={setCreateForm}
      showRecentVaultModal={showRecentVaultModal}
      recentVaultPreference={recentVaultPreference}
      dismissRecentVault={dismissRecentVault}
      confirmRecentVault={confirmRecentVault}
      skipRecentVaultPrompt={skipRecentVaultPrompt}
      setSkipRecentVaultPrompt={setSkipRecentVaultPrompt}
      appUpdater={appUpdater}
      isBuilderModeEnabled={isBuilderModeEnabled}
      setBuilderModeEnabled={setBuilderModeEnabled}
    />
  )
}

export default App
