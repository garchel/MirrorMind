import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import { Button } from '../../components/ui/Button'
import {
  AlertTriangle,
  FileWarning,
  Filter,
  FolderInput,
  FolderPlus,
  ListFilter,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import {
  getVaultModeLabel,
  hasScanDiagnostics,
  scanDiagnosticsSummary,
  type NotePreview,
  type NoteTreeNode,
  type ScanDiagnostics,
  type SpecialVaultFile,
  type SyncConflictCopy,
  type TagSummary,
  type VaultSummary,
} from '../../lib/vault'

/** Menu de contexto do explorador (nota/pasta). Movido do `App.tsx` sem
 * mudança — o App importa este tipo para o estado. */
export type ExplorerContextMenu = {
  x: number
  y: number
  target: { path: string; name: string; type: 'note' | 'folder' }
}

/** Barra lateral do explorador extraída do `App.tsx`: overview do vault,
 * ações (nova nota/pasta, filtro de tags, especiais, conflitos), banner de
 * diagnóstico, árvore (`renderTree` continua no App) e rodapé de troca de
 * vault. Mesmos nomes, textos e comportamentos. */
export type ExplorerOverview = {
  vault: VaultSummary
  totalNoteCount: number
}

export type ExplorerTree = {
  favoriteNotes: NotePreview[]
  noteTree: NoteTreeNode[]
  renderTree: (nodes: NoteTreeNode[]) => ReactNode
  dropFolderPath: string | null
}

export type ExplorerTagFilter = {
  selectedTags: string[]
  setSelectedTags: Dispatch<SetStateAction<string[]>>
  tagFilterQuery: string
  setTagFilterQuery: (query: string) => void
  showTagFilterDropdown: boolean
  setShowTagFilterDropdown: Dispatch<SetStateAction<boolean>>
  matchingTagSuggestions: TagSummary[]
  tagFilterDropdownRef: RefObject<HTMLDivElement | null>
}

export type ExplorerNotices = {
  specialFiles: SpecialVaultFile[]
  specialFilesTruncated: boolean
  setShowSpecialFilesDialog: (show: boolean) => void
  syncConflictCopies: SyncConflictCopy[]
  setShowSyncConflicts: (show: boolean) => void
  vaultDiagnostics: ScanDiagnostics | null
  diagnosticsDismissed: boolean
  setDiagnosticsDismissed: (dismissed: boolean) => void
}

export type ExplorerFooter = {
  loading: boolean
  saving: boolean
  chooseExistingVault: () => void
  refreshNotes: (vaultPath: string) => void
}

export type ExplorerActions = {
  startNewNote: () => void
  openNote: (relativePath: string) => Promise<void>
  retryVaultDiagnostics: () => void
  setShowFolderDialog: (show: boolean) => void
  setStatus: (message: string) => void
}

export type ExplorerSidebarProps = {
  overview: ExplorerOverview
  tree: ExplorerTree
  tagFilter: ExplorerTagFilter
  notices: ExplorerNotices
  footer: ExplorerFooter
  actions: ExplorerActions
}

export function ExplorerSidebar({
  overview: {
    vault,
    totalNoteCount,
  },
  tree: {
    favoriteNotes,
    noteTree,
    renderTree,
    dropFolderPath,
  },
  tagFilter: {
    selectedTags,
    setSelectedTags,
    tagFilterQuery,
    setTagFilterQuery,
    showTagFilterDropdown,
    setShowTagFilterDropdown,
    matchingTagSuggestions,
    tagFilterDropdownRef,
  },
  notices: {
    specialFiles,
    specialFilesTruncated,
    setShowSpecialFilesDialog,
    syncConflictCopies,
    setShowSyncConflicts,
    vaultDiagnostics,
    diagnosticsDismissed,
    setDiagnosticsDismissed,
  },
  footer: {
    loading,
    saving,
    chooseExistingVault,
    refreshNotes,
  },
  actions: {
    startNewNote,
    openNote,
    retryVaultDiagnostics,
    setShowFolderDialog,
    setStatus,
  },
}: ExplorerSidebarProps) {
  return (
    <aside className="notes-sidebar" data-builder-name="notes-sidebar">
      <div className="sidebar-block">
        <p className="card-kicker">Overview</p>
        <ul className="sidebar-metrics">
          <li>
            <span>Notas</span>
            <strong>{totalNoteCount}</strong>
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
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={startNewNote} title="Nova nota" aria-label="Nova nota">
              <span aria-hidden="true">&#9998;</span>
            </Button>
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setShowFolderDialog(true)} title="Nova pasta" aria-label="Nova pasta">
              <FolderPlus size={15} strokeWidth={1.5} aria-hidden="true" />
            </Button>
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setStatus('As notas estão ordenadas por nome.')} title="Ordenação" aria-label="Ordenação">
              <span aria-hidden="true">&#8645;</span>
            </Button>
            <div className="explorer-filter-control" ref={tagFilterDropdownRef}>
              <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setShowTagFilterDropdown((open) => !open)} title="Filtrar tags (Ctrl+Shift+F)" aria-label="Filtrar por tags" aria-expanded={showTagFilterDropdown}>
                {selectedTags.length > 0 ? <ListFilter size={15} strokeWidth={1.5} aria-hidden="true" /> : <Filter size={15} strokeWidth={1.5} aria-hidden="true" />}
              </Button>
              {showTagFilterDropdown ? (
                <div className="tag-filter-dropdown" role="dialog" aria-label="Filtro rápido de tags">
                  <div className="tag-filter-selection">
                    {selectedTags.map((tag) => (
                      <Button key={tag} type="button" className="ui-button tag-filter-chip" onClick={() => setSelectedTags((tags) => tags.filter((item) => item !== tag))}>#{tag} <X size={11} aria-hidden="true" /></Button>
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
              <Button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm special-files-button"
                onClick={() => setShowSpecialFilesDialog(true)}
                title={`${specialFiles.length}${specialFilesTruncated ? '+' : ''} arquivo${specialFiles.length === 1 ? '' : 's'} preservado${specialFiles.length === 1 ? '' : 's'} sem edição`}
                aria-label={`Ver ${specialFiles.length}${specialFilesTruncated ? ' ou mais' : ''} arquivo${specialFiles.length === 1 ? '' : 's'} com compatibilidade limitada`}
              >
                <FileWarning size={15} strokeWidth={1.5} aria-hidden="true" />
                <span aria-hidden="true">{specialFiles.length}{specialFilesTruncated ? '+' : ''}</span>
              </Button>
            ) : null}
            {syncConflictCopies.length > 0 ? (
              <Button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm special-files-button"
                onClick={() => setShowSyncConflicts(true)}
                title={`${syncConflictCopies.length} ${syncConflictCopies.length === 1 ? 'cópia de conflito' : 'cópias de conflito'} de sincronização fora do inventário`}
                aria-label={`Resolver ${syncConflictCopies.length} ${syncConflictCopies.length === 1 ? 'cópia de conflito' : 'cópias de conflito'} de sincronização`}
              >
                <AlertTriangle size={15} strokeWidth={1.5} aria-hidden="true" />
                <span aria-hidden="true">{syncConflictCopies.length}</span>
              </Button>
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
        <Button
          type="button"
          className="ui-button vault-switch-button"
          onClick={() => void chooseExistingVault()}
          disabled={loading || saving}
          title={`${vault.path} — clique para trocar de vault`}
        >
          <span className="vault-indicator-icon" aria-hidden="true">&#9670;</span>
          <span>{vault.name}</span>
        </Button>
        <Button type="button" className="ui-button ui-button--secondary ui-button--sm vault-refresh-button" onClick={() => void refreshNotes(vault.path)} disabled={loading || saving} title="Atualizar explorador" aria-label="Atualizar explorador de arquivos">
          <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </footer>
    </aside>
  )
}

/** Menu de contexto de nota/pasta do explorador (moved do `App.tsx`). */
export function ExplorerItemMenu({
  menu,
  favorites,
  onClose,
  onToggleFavorite,
  onMoveFolder,
  onRename,
  onDelete,
}: {
  menu: ExplorerContextMenu
  favorites: string[]
  onClose: () => void
  onToggleFavorite: (relativePath: string) => void
  onMoveFolder: (path: string, name: string) => void
  onRename: (path: string, name: string, type: 'note' | 'folder') => void
  onDelete: (target: ExplorerContextMenu['target']) => void
}) {
  return (
    <div className="explorer-context-menu-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} onContextMenu={(event) => event.preventDefault()}>
      <div className="explorer-context-menu" role="menu" aria-label={`Ações para ${menu.target.name}`} style={{ left: menu.x, top: menu.y }}>
        {menu.target.type === 'note' ? (
          <button type="button" role="menuitem" onClick={() => { void onToggleFavorite(menu.target.path); onClose() }}>
            <Star size={14} strokeWidth={1.5} fill={favorites.includes(menu.target.path) ? 'currentColor' : 'none'} aria-hidden="true" />
            {favorites.includes(menu.target.path) ? 'Remover dos favoritos' : 'Favoritar nota'}
          </button>
        ) : (
          <button type="button" role="menuitem" onClick={() => { onMoveFolder(menu.target.path, menu.target.name); onClose() }}>
            <FolderInput size={14} strokeWidth={1.5} aria-hidden="true" />
            Mover pasta
          </button>
        )}
        <button type="button" role="menuitem" onClick={() => { onRename(menu.target.path, menu.target.name, menu.target.type); onClose() }}>
          <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
          Renomear
        </button>
        <Button type="button" role="menuitem" className="ui-button is-danger" onClick={() => { onDelete(menu.target); onClose() }}>
          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
          Enviar para lixeira
        </Button>
      </div>
    </div>
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
        <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onRetry}>
          Tentar novamente
        </Button>
        <Button
          type="button"
          className="ui-button vault-diagnostics-dismiss"
          onClick={onDismiss}
          aria-label="Fechar aviso de leitura parcial"
        >
          <span aria-hidden="true">&#10005;</span>
        </Button>
      </div>
    </div>
  )
}
