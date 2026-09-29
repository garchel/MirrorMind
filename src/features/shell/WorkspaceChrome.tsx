import type { Dispatch, SetStateAction } from 'react'
import { Button } from '../../components/ui/Button'
import {
  BookOpenCheck,
  ClipboardList,
  Hash,
  LayoutDashboard,
  Network,
  Plus,
  Table2,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import { BsLayoutSidebarInset, BsLayoutSidebarInsetReverse } from 'react-icons/bs'
import { TitleBarBrand } from '../../components/TitleBar'
import type { NotePreview, VaultSummary } from '../../lib/vault'

/** Páginas do workspace (movido do `App.tsx` sem mudança — o App importa). */
export type WorkspacePage =
  | 'notes'
  | 'review'
  | 'dashboard'
  | 'reports'
  | 'tags'
  | 'bases'
  | 'graph'
  | 'settings'
  | 'trash'
  | 'goals'

/** Abas de notas (dentro do `TitleBar`, só na página de notas). */
export function TabStrip({
  openTabs,
  notes,
  activeNotePath,
  openNote,
  closeTab,
  loading,
  saving,
  startNewNote,
}: {
  openTabs: string[]
  notes: NotePreview[]
  activeNotePath: string | null
  openNote: (relativePath: string) => Promise<void>
  closeTab: (tabPath: string) => void
  loading: boolean
  saving: boolean
  startNewNote: () => void
}) {
  return (
    <div className="tab-strip" role="tablist" aria-label="Notas abertas" data-builder-name="tab-strip">
      {openTabs.length > 0 ? (
        openTabs.map((tabPath) => {
          const tabName = tabPath === '__new_note__' ? 'Nova nota' : notes.find((note) => note.relativePath === tabPath)?.name ?? tabPath
          return (
            <div
              key={tabPath}
              className={`tab-chip${tabPath === activeNotePath ? ' is-active' : ''}`}
            >
              <Button
                type="button"
                className="ui-button tab-select"
                onClick={() => void openNote(tabPath)}
                disabled={loading || saving}
                role="tab"
                aria-selected={tabPath === activeNotePath}
                aria-controls="note-editor"
              >
                {tabName}
              </Button>
              <Button
                type="button"
                className="ui-button tab-close"
                onClick={() => closeTab(tabPath)}
                disabled={loading || saving}
                aria-label={`Fechar ${tabName}`}
              >
                <X size={14} strokeWidth={1.7} aria-hidden="true" />
                ×
              </Button>
            </div>
          )
        })
      ) : (
        <p className="empty-tabs">As notas abertas aparecerão aqui em abas.</p>
      )}
      <Button type="button" className="ui-button new-tab-button" onClick={startNewNote} disabled={loading || saving} title="Nova nota na raiz do vault" aria-label="Nova nota na raiz do vault">
        <Plus size={16} strokeWidth={1.7} aria-hidden="true" />
      </Button>
    </div>
  )
}

/** Trilho lateral de navegação entre páginas do workspace. */
export function WorkspaceRail({
  isSidebarExpanded,
  setSidebarExpanded,
  workspacePage,
  setWorkspacePage,
  openTagManagementPage,
  openGraphPage,
  openTrashPage,
}: {
  isSidebarExpanded: boolean
  setSidebarExpanded: Dispatch<SetStateAction<boolean>>
  workspacePage: WorkspacePage
  setWorkspacePage: (page: WorkspacePage) => void
  openTagManagementPage: () => void
  openGraphPage: () => void
  openTrashPage: () => void
}) {
  return (
    <aside className="workspace-rail" aria-label="Ferramentas do workspace" data-builder-name="workspace-rail">
      <TitleBarBrand />
      <Button
        type="button"
        className="ui-button rail-button"
        onClick={() => setSidebarExpanded((isExpanded) => !isExpanded)}
        aria-label={isSidebarExpanded ? 'Recolher barra lateral' : 'Expandir barra lateral'}
        aria-expanded={isSidebarExpanded}
        title={isSidebarExpanded ? 'Recolher barra lateral' : 'Expandir barra lateral'}
      >
        {isSidebarExpanded ? <BsLayoutSidebarInsetReverse size={17} aria-hidden="true" /> : <BsLayoutSidebarInset size={17} aria-hidden="true" />}
        <span className="rail-label rail-label--menu">Menu</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'notes' ? ' is-active' : ''}`}
        onClick={() => setWorkspacePage('notes')}
        aria-label="Voltar para notas"
        title="Notas"
      >
        <span className="rail-icon" aria-hidden="true">&#9998;</span>
        <span className="rail-label">Notas</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'review' ? ' is-active' : ''}`}
        onClick={() => setWorkspacePage('review')}
        aria-label="Abrir fila de revisão"
        title="Revisar"
      >
        <BookOpenCheck size={17} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Revisar</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'goals' ? ' is-active' : ''}`}
        onClick={() => setWorkspacePage('goals')}
        aria-label="Abrir metas de aprendizado"
        title="Metas"
      >
        <Target size={17} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Metas</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'dashboard' ? ' is-active' : ''}`}
        onClick={() => setWorkspacePage('dashboard')}
        aria-label="Abrir painel de aprendizado"
        title="Painel de aprendizado"
      >
        <LayoutDashboard size={17} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Painel</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'reports' ? ' is-active' : ''}`}
        onClick={() => setWorkspacePage('reports')}
        aria-label="Abrir relatórios de revisão"
        title="Relatórios"
      >
        <ClipboardList size={17} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Relatórios</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'tags' ? ' is-active' : ''}`}
        onClick={() => void openTagManagementPage()}
        aria-label="Abrir gerenciador de tags"
        title="Tags"
      >
        <Hash size={17} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Tags</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'bases' ? ' is-active' : ''}`}
        onClick={() => setWorkspacePage('bases')}
        aria-label="Abrir tabela de notas"
        title="Tabela"
      >
        <Table2 size={17} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Tabela</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'graph' ? ' is-active' : ''}`}
        onClick={() => void openGraphPage()}
        aria-label="Abrir grafo das notas"
        title="Grafo das notas"
      >
        <Network size={17} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Grafo</span>
      </Button>
      <Button
        type="button"
        className={`rail-button${workspacePage === 'trash' ? ' is-active' : ''}`}
        onClick={() => void openTrashPage()}
        aria-label="Abrir lixeira"
        title="Lixeira"
      >
        <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="rail-label">Lixeira</span>
      </Button>
      <Button
        type="button"
        className="ui-button rail-button rail-button--bottom"
        onClick={() => setWorkspacePage('settings')}
        aria-label="Configurações"
        title="Configurações"
      >
        <span className="rail-icon" aria-hidden="true">&#9881;</span>
        <span className="rail-label">Configurações</span>
      </Button>
    </aside>
  )
}

/** Topbar do workspace (vault ativo + inicialização + troca) e erro global. */
export function WorkspaceTopbar({
  vault,
  initializeMetadata,
  loading,
  saving,
  chooseExistingVault,
  error,
}: {
  vault: VaultSummary
  initializeMetadata: () => void
  loading: boolean
  saving: boolean
  chooseExistingVault: () => void
  error: string | null
}) {
  return (
    <>
      <header className="workspace-topbar">
        <div>
          <p className="eyebrow">Vault ativo</p>
          <h1 className="workspace-title">{vault.name}</h1>
        </div>
        <div className="workspace-actions">
          {!vault.metadata.isInitialized ? (
            <Button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={initializeMetadata}
              disabled={loading || saving}
            >
              Inicializar .mirmind
            </Button>
          ) : null}
          <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={chooseExistingVault} disabled={loading || saving}>
            Trocar vault
          </Button>
        </div>
      </header>

      {error ? <p className="error-banner" role="alert">{error}</p> : null}
    </>
  )
}
