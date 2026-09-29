import type { ComponentProps, Dispatch, MouseEvent, ReactNode, RefObject, SetStateAction } from 'react'
import { Button } from '../../components/ui/Button'
import {
  ChevronDown,
  Eye,
  MoreHorizontal,
  Redo2,
  Search,
  TextCursorInput,
  Undo2,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { NoteTagRow } from '../../components/NoteTagRow'
import { FrontmatterPanelForm } from '../../components/FrontmatterPanelForm'
import type { FrontmatterPanelData, FrontmatterRow } from '../../components/markdownLivePreview'
import { PostitMenu } from '../postits/PostitMenu'
import { PostitOrphansDialog } from '../postits/PostitOrphansDialog'
import type { usePostitPopover } from '../postits/usePostitPopover'
import { formatNoteTitleAsPath, type CreateNoteForm, type TagSummary } from '../../lib/vault'
import type { ReviewGapMode } from '../settings/SettingsPage'
import type { NoteReviewGap } from '../review/noteReviewGaps'
import type { NoteReviewUnit } from '../review/noteReviewUnits'
import { Field } from '../../components/ui/Field'

/** Chaves das ações do header (movidas do `App.tsx` sem mudança — o App
 * importa daqui para o cálculo de overflow). */
export const HEADER_ACTION_KEYS = ['favorite', 'indexadora', 'review', 'factcheck'] as const
export type HeaderActionKey = (typeof HEADER_ACTION_KEYS)[number]

/** Modo de visualização da nota (mesma união do `App.tsx`). */
export type EditorMode = 'mixed' | 'edit' | 'read'

/** Template de nota (`list_templates`). Movido do `App.tsx` — o App importa. */
export type NoteTemplate = { id: string; name: string; content: string }

/** Cabeçalho do editor extraído do `App.tsx`: título (nova nota, rename
 * inline, botão), tags, post-its, ações (histórico, autosave, overflow),
 * controle de modo, lacunas de revisão, busca, ferramentas Markdown e
 * painel de frontmatter. O App continua dono dos estados e callbacks. */
export type HeaderTitle = {
  activeNoteName: string
  isNewNoteDraft: boolean
  createNoteForm: CreateNoteForm
  setCreateNoteForm: Dispatch<SetStateAction<CreateNoteForm>>
  saveActiveNote: () => void
  saving: boolean
  loading: boolean
  templates: NoteTemplate[]
  selectedTemplateId: string
  applyTemplate: (templateId: string) => void
  isInlineTitleEditing: boolean
  setInlineTitleEditing: (editing: boolean) => void
  inlineTitle: string
  setInlineTitle: (title: string) => void
  renameActiveNoteFromTitle: (nextTitle: string) => void
  startInlineTitleRename: () => void
}

export type HeaderTags = {
  noteTags: string[]
  tagIndex: TagSummary[]
  applyExistingTag: (tag: string) => void
  removeTag: (tag: string) => void
}

export type HeaderHistory = {
  actionsRef: RefObject<HTMLDivElement | null>
  preserveSelection: (event: MouseEvent<HTMLButtonElement>) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export type HeaderModes = {
  editorMode: EditorMode
  changeMode: (mode: EditorMode) => void
  reviewGaps: NoteReviewGap[]
  reviewUnits: NoteReviewUnit[]
  reviewGapMode: ReviewGapMode
  setReviewGapMode: (mode: ReviewGapMode) => void
  openNoteFind: () => void
  markdownToolsOpen: boolean
  setMarkdownToolsOpen: Dispatch<SetStateAction<boolean>>
}

export type HeaderFrontmatter = {
  panelOpen: boolean
  setPanelOpen: Dispatch<SetStateAction<boolean>>
  getData: () => FrontmatterPanelData
  compatibilityNotes: ComponentProps<typeof FrontmatterPanelForm>['compatibilityNotes']
  applyPanel: (rows: FrontmatterRow[]) => string | null
  openNote: (relativePath: string) => Promise<void>
}

export type EditorHeaderProps = {
  title: HeaderTitle
  tags: HeaderTags
  postits: Pick<
    ReturnType<typeof usePostitPopover>,
    'notePostits' | 'postitMenuItems' | 'orphans' | 'handlePostitWidgetClick' | 'deletePostitById'
  >
  showPostitOrphans: boolean
  setShowPostitOrphans: (show: boolean) => void
  history: HeaderHistory
  isAutoSaveEnabled: boolean
  autoSaveState: 'idle' | 'pending' | 'saving' | 'saved'
  hiddenActions: HeaderActionKey[]
  renderHeaderAction: (key: HeaderActionKey) => ReactNode
  modes: HeaderModes
  frontmatter: HeaderFrontmatter
}

export function EditorHeader({
  title: {
    activeNoteName,
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
  },
  tags: {
    noteTags,
    tagIndex,
    applyExistingTag,
    removeTag,
  },
  postits,
  showPostitOrphans,
  setShowPostitOrphans,
  history: {
    actionsRef: headerActionsRef,
    preserveSelection: preserveEditorSelection,
    undo: undoLastCommand,
    redo: redoLastCommand,
    canUndo: canUndoActiveEditor,
    canRedo: canRedoActiveEditor,
  },
  isAutoSaveEnabled,
  autoSaveState,
  hiddenActions,
  renderHeaderAction,
  modes: {
    editorMode,
    changeMode: changeEditorMode,
    reviewGaps,
    reviewUnits,
    reviewGapMode,
    setReviewGapMode,
    openNoteFind,
    markdownToolsOpen: isMarkdownToolsOpen,
    setMarkdownToolsOpen,
  },
  frontmatter: {
    panelOpen: frontmatterPanelOpen,
    setPanelOpen: setFrontmatterPanelOpen,
    getData: getFrontmatterPanelData,
    compatibilityNotes,
    applyPanel: applyFrontmatterPanel,
    openNote,
  },
}: EditorHeaderProps) {
  const {
    notePostits,
    postitMenuItems,
    orphans: postitOrphans,
    handlePostitWidgetClick,
    deletePostitById,
  } = postits

  return (
    <div className="editor-header" data-builder-name="editor-header">
      <div>
        {isNewNoteDraft ? (
          <>
          <Field
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
            placeholder="Título da nota"
            aria-label="Título da nova nota"
            autoComplete="off"
            spellCheck={false}
          />
          <select value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)} aria-label="Template da nota">
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          </>
        ) : isInlineTitleEditing ? (
          <Field
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
                setInlineTitle(activeNoteName)
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
            {activeNoteName}
          </button>
        )}
        {/* Tags sempre visiveis abaixo do titulo (antes moravam no
            painel do arrow down): badges + "+" com popover. */}
        <NoteTagRow
          tags={noteTags}
          availableTags={tagIndex.map((entry) => entry.tag)}
          onApplyTag={applyExistingTag}
          onRemoveTag={removeTag}
        />
        {postitOrphans.length > 0 || notePostits.length > 0 ? (
          <div className="note-header-postits">
            {notePostits.length > 0 ? (
              <PostitMenu items={postitMenuItems} onOpen={handlePostitWidgetClick} />
            ) : null}
            {postitOrphans.length > 0 ? (
              <button
                type="button"
                className="postit-orphans-chip"
                onClick={() => setShowPostitOrphans(true)}
                title="Post-its cuja âncora sumiu da nota"
              >
                {postitOrphans.length === 1
                  ? '1 post-it sem âncora'
                  : `${postitOrphans.length} post-its sem âncora`}
              </button>
            ) : null}
          </div>
        ) : null}
        <PostitOrphansDialog
          open={showPostitOrphans}
          orphans={postitOrphans}
          onClose={() => setShowPostitOrphans(false)}
          onOpen={(postitId) => {
            setShowPostitOrphans(false)
            handlePostitWidgetClick(postitId)
          }}
          onDelete={deletePostitById}
        />
      </div>
      <div className="editor-actions" ref={headerActionsRef}>
        <div className="history-actions" aria-label="Histórico de edição">
          <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onMouseDown={preserveEditorSelection} onClick={() => void undoLastCommand()} disabled={!canUndoActiveEditor || loading || saving} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Undo2 size={15} strokeWidth={1.5} aria-hidden="true" /></Button>
          <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onMouseDown={preserveEditorSelection} onClick={() => void redoLastCommand()} disabled={!canRedoActiveEditor || loading || saving} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><Redo2 size={15} strokeWidth={1.5} aria-hidden="true" /></Button>
        </div>
        {isAutoSaveEnabled && !isNewNoteDraft ? (
          <span className={`autosave-indicator is-${autoSaveState}`} aria-live="polite">
            {autoSaveState === 'pending' ? 'Alterações pendentes' : autoSaveState === 'saving' ? 'Salvando...' : autoSaveState === 'saved' ? 'Salvo' : 'Auto Save'}
          </span>
        ) : null}
        {!hiddenActions.includes('favorite') ? renderHeaderAction('favorite') : null}
        {!hiddenActions.includes('indexadora') ? renderHeaderAction('indexadora') : null}
        {!hiddenActions.includes('review') ? renderHeaderAction('review') : null}
        {!hiddenActions.includes('factcheck') ? renderHeaderAction('factcheck') : null}
        {hiddenActions.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm header-overflow-trigger"
                aria-label="Mais ações"
                title="Mais ações"
              >
                <MoreHorizontal size={15} strokeWidth={1.8} aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="header-overflow-menu">
              {HEADER_ACTION_KEYS.filter((key) => hiddenActions.includes(key)).map((key) => renderHeaderAction(key))}
            </PopoverContent>
          </Popover>
        ) : null}
          <div
            className="editor-mode-control"
          role="radiogroup"
          aria-label="Modo de visualização da nota"
          title="Edicao mostra o código, Misto edita o bloco ativo, Leitura mostra a nota formatada."
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
            title="Edição: mostra o Markdown puro"
          >Edição</button>
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
        {editorMode !== 'edit' && (reviewGaps.length > 0 || reviewUnits.length > 0) ? (
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
              aria-checked={reviewGapMode === 'off'}
              className={reviewGapMode === 'off' ? 'is-active' : ''}
              onClick={() => setReviewGapMode('off')}
              title="Minhas cores: mostra só o marca-texto, sem as lacunas"
              aria-label="Minhas cores (somente destaques)"
            >
              Minhas cores
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={reviewGapMode === 'always'}
              className={reviewGapMode === 'always' ? 'is-active' : ''}
              onClick={() => setReviewGapMode('always')}
              title="Revisão: lacunas sempre visíveis, com halo em volta do marca-texto"
              aria-label="Revisão (lacunas sempre visíveis)"
            >
              Revisão
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={reviewGapMode === 'hover'}
              className={reviewGapMode === 'hover' ? 'is-active' : ''}
              onClick={() => setReviewGapMode('hover')}
              title="Misto: nota limpa, lacunas aparecem no hover"
              aria-label="Misto (lacunas somente no hover)"
            >
              Misto
            </button>
          </div>
        ) : null}
        <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={openNoteFind} title="Buscar na nota (Ctrl+F)" aria-label="Buscar na nota"><Search size={15} strokeWidth={1.5} aria-hidden="true" /></Button>
        {editorMode !== 'read' ? (
          <Button
            type="button"
            className="ui-button ui-button--secondary ui-button--sm markdown-tools-toggle${isMarkdownToolsOpen ? ' is-active' : ''}"
            onClick={() => setMarkdownToolsOpen((isOpen) => !isOpen)}
            title="Ferramentas de Markdown"
            aria-label="Ferramentas de Markdown"
            aria-expanded={isMarkdownToolsOpen}
          >
            <TextCursorInput size={15} strokeWidth={1.5} aria-hidden="true" />
          </Button>
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
            aria-label={frontmatterPanelOpen ? 'Recolher propriedades da nota' : 'Expandir propriedades da nota'}
          >
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
          {frontmatterPanelOpen ? (
            <div className="frontmatter-menu-collapse">
              <div id="frontmatter-menu-panel" className="frontmatter-menu-panel">
                <FrontmatterPanelForm
                  {...getFrontmatterPanelData()}
                  compatibilityNotes={compatibilityNotes}
                  onApply={applyFrontmatterPanel}
                  onOpenBacklink={(relativePath) => void openNote(relativePath)}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
